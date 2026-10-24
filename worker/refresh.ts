import { addDays } from '../src/shared/dates';
import { frankfurterUrl, toFxRows } from './frankfurter';
import type { Env } from './index';
import { type Bar, tiingoRequest, toBars } from './tiingo';

const BACKFILL_FROM = '2005-01-01';
const TIINGO_BUDGET = 45; // per run; 10 runs a night stays under 50 an hour and 1,000 a day
const FX_HOUR = 22;

// Appends rows to a stored JSON array by string concatenation (no parse of the existing text).
export function appendYearRows(existing: string | null, newRows: unknown[][]): string {
  const added = JSON.stringify(newRows);
  return existing ? existing.slice(0, -1) + ',' + added.slice(1) : added;
}

const byYear = <T extends [string, ...string[]]>(rows: T[]) => {
  const out = new Map<number, T[]>();
  for (const r of rows) {
    const y = Number(r[0].slice(0, 4));
    out.set(y, [...(out.get(y) ?? []), r]);
  }
  return out;
};

// Spec 9.3. Sequential fetches; HTTP 429, 5xx or a network error stops the run.
export async function refresh(
  env: Env,
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<{ fetched: string[]; fxUpdated: boolean; stoppedOn?: string }> {
  const db = env.DB;
  const today = now.toISOString().slice(0, 10);
  const fxUpdated = now.getUTCHours() === FX_HOUR ? await refreshFx(db, today, fetchFn) : false;

  // Spec 10.8 step 4: queued ticker requests first, oldest first, within the same budget.
  const queued = await db
    .prepare("SELECT ticker FROM ticker_requests WHERE status = 'queued' ORDER BY requested_on, ticker LIMIT ?")
    .bind(TIINGO_BUDGET)
    .all<{ ticker: string }>();
  const fetched: string[] = [];
  for (const { ticker } of queued.results) {
    const got = await fetchBars(ticker, BACKFILL_FROM, null, env.TIINGO_TOKEN, fetchFn);
    if (got === 'stop') return { fetched, fxUpdated, stoppedOn: ticker };
    const resolve = (status: string) =>
      db.prepare('UPDATE ticker_requests SET status = ?, resolved_on = ? WHERE ticker = ?').bind(status, today, ticker);
    if (got === 'not_found') {
      await resolve('not_found').run();
      continue;
    }
    fetched.push(ticker);
    await db.batch([
      db
        .prepare('INSERT OR IGNORE INTO tickers (ticker, priority, last_date, refreshed_on, added_on) VALUES (?, 0, ?, ?, ?)')
        .bind(ticker, got.at(-1)?.[0] ?? null, today, today),
      ...(await priceWrites(db, ticker, got)),
      resolve('added'),
    ]);
  }

  const due = await db
    .prepare(
      'SELECT ticker, last_date FROM tickers WHERE refreshed_on IS NULL OR refreshed_on < ? ' +
        'ORDER BY priority DESC, refreshed_on IS NOT NULL, refreshed_on, ticker LIMIT ?',
    )
    .bind(today, TIINGO_BUDGET - queued.results.length)
    .all<{ ticker: string; last_date: string | null }>();

  const markRefreshed = (t: string) => db.prepare('UPDATE tickers SET refreshed_on = ? WHERE ticker = ?').bind(today, t);
  for (const { ticker, last_date } of due.results) {
    const bars = await fetchBars(ticker, last_date ? addDays(last_date, 1) : BACKFILL_FROM, last_date, env.TIINGO_TOKEN, fetchFn);
    if (bars === 'stop') return { fetched, fxUpdated, stoppedOn: ticker };
    if (bars === 'not_found') {
      await markRefreshed(ticker).run();
      continue;
    }
    fetched.push(ticker);
    if (bars.length === 0) {
      await markRefreshed(ticker).run();
      continue;
    }
    await db.batch([
      ...(await priceWrites(db, ticker, bars)),
      db.prepare('UPDATE tickers SET last_date = ?, refreshed_on = ? WHERE ticker = ?').bind(bars[bars.length - 1][0], today, ticker),
    ]);
  }
  return { fetched, fxUpdated };
}

// One Tiingo call. 'stop' on HTTP 429, 5xx or a network error (the run ends); 'not_found' on 404;
// otherwise the bars dated after lastDate.
async function fetchBars(
  ticker: string,
  from: string,
  lastDate: string | null,
  token: string,
  fetchFn: typeof fetch,
): Promise<Bar[] | 'stop' | 'not_found'> {
  let res: Response;
  try {
    res = await fetchFn(tiingoRequest(ticker, from, token));
  } catch (e) {
    console.error(`refresh: ${ticker} network error, stopping: ${e}`);
    return 'stop';
  }
  if (res.status === 404) {
    console.warn(`refresh: ${ticker} not found at Tiingo`);
    return 'not_found';
  }
  if (!res.ok) {
    console.error(`refresh: ${ticker} HTTP ${res.status}, stopping`);
    return 'stop';
  }
  return toBars(await res.json()).filter((b) => !lastDate || b[0] > lastDate);
}

// Statements that append bars to the ticker's stored year rows.
async function priceWrites(db: D1Database, ticker: string, bars: Bar[]): Promise<D1PreparedStatement[]> {
  if (bars.length === 0) return [];
  const groups = byYear(bars);
  const stored = await db
    .prepare(`SELECT year, rows FROM prices WHERE ticker = ? AND year IN (${[...groups.keys()].map(() => '?').join(',')})`)
    .bind(ticker, ...groups.keys())
    .all<{ year: number; rows: string }>();
  const existing = new Map(stored.results.map((r) => [r.year, r.rows]));
  return [...groups].map(([year, rows]) =>
    db
      .prepare('INSERT INTO prices (ticker, year, rows) VALUES (?,?,?) ON CONFLICT (ticker, year) DO UPDATE SET rows = excluded.rows')
      .bind(ticker, year, appendYearRows(existing.get(year) ?? null, rows)),
  );
}

// Returns true when new rates were stored. A failed Frankfurter call throws, so the cron run is logged as failed.
async function refreshFx(db: D1Database, today: string, fetchFn: typeof fetch): Promise<boolean> {
  const last = await db.prepare('SELECT rows FROM fx ORDER BY year DESC LIMIT 1').first<{ rows: string }>();
  const lastDate = last ? (JSON.parse(last.rows) as [string, string][]).at(-1)![0] : null;
  const from = lastDate ? addDays(lastDate, 1) : BACKFILL_FROM;
  if (from > today) return false;
  const res = await fetchFn(frankfurterUrl(from, today));
  if (!res.ok) throw new Error(`refresh: Frankfurter HTTP ${res.status}`);
  // Frankfurter may include the fixing before `from`, so keep only dates after the last stored one.
  const rows = toFxRows(await res.json()).filter((r) => !lastDate || r[0] > lastDate);
  if (rows.length === 0) return false;
  const groups = byYear(rows);
  const stored = await db
    .prepare(`SELECT year, rows FROM fx WHERE year IN (${[...groups.keys()].map(() => '?').join(',')})`)
    .bind(...groups.keys())
    .all<{ year: number; rows: string }>();
  const existing = new Map(stored.results.map((r) => [r.year, r.rows]));
  await db.batch(
    [...groups].map(([year, yearRows]) =>
      db
        .prepare('INSERT INTO fx (year, rows) VALUES (?,?) ON CONFLICT (year) DO UPDATE SET rows = excluded.rows')
        .bind(year, appendYearRows(existing.get(year) ?? null, yearRows)),
    ),
  );
  return true;
}
