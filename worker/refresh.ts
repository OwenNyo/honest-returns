import type { IsoDate } from '../src/engine/types';
import { addDays } from '../src/shared/dates';
import { frankfurterUrl, toFxRows } from './frankfurter';
import type { Env } from './index';
import { type Bar, tiingoRequest, toBars } from './tiingo';

const BACKFILL_FROM = '2005-01-01';
// Spec 19.4: Tiingo calls per UTC hour, shared by the cron, /api/prices and ticker requests. A rolling 24 hours touches
// at most 25 clock hours: 40 x 25 = 1,000, Tiingo's daily limit.
export const TIINGO_BUDGET = 40;
// Spec 19.13: distinct Tiingo symbols per UTC month, 20 under the free plan's 500.
export const MONTHLY_SYMBOLS = 480;
const FX_HOUR = 22;

// The date of the last row of a stored JSON array of rows, read from the tail of the string without JSON.parse.
export const lastStoredDate = (rows: string) => /"(\d{4}-\d{2}-\d{2})"[^\]]*\]\]$/.exec(rows)?.[1];

// Appends rows to a stored JSON array by string concatenation (no parse of the existing text).
// Rows dated on or before the last stored row are dropped: two Workers can fetch the same ticker at once (spec 19.5).
// ponytail: a concurrent duplicate fetch is tolerated here, not prevented; the second writer's call is wasted, not stored twice.
export function appendYearRows(existing: string | null, newRows: unknown[][]): string {
  if (!existing) return JSON.stringify(newRows);
  const last = lastStoredDate(existing);
  const rows = last ? newRows.filter((r) => (r[0] as string) > last) : newRows;
  return rows.length ? existing.slice(0, -1) + ',' + JSON.stringify(rows).slice(1) : existing;
}

// Spec 19.3: a day's bar is expected from 22:00 UTC (after the 16:00 New York close), so now minus 22 hours, back over weekends.
// ponytail: weekends only, no US holiday calendar; on about ten holidays a year served tickers look stale and cost
// one call per UTC day with no new bar. Add a holiday list here if those wasted calls matter.
export function lastTradingDay(now: Date): IsoDate {
  let d = new Date(now.getTime() - 22 * 3_600_000).toISOString().slice(0, 10);
  while ([0, 6].includes(new Date(d).getUTCDay())) d = addDays(d, -1);
  return d;
}

// Spec 19.4: claims one Tiingo call from this UTC hour's budget; increment and check in one statement, so two
// Workers cannot both take the last call. false = budget spent.
// ponytail: UTC clock-hour buckets. If Tiingo counts a rolling hour, 40 calls at 21:59 and 40 at 22:00 exceed its 50 and
// it answers 429, which every path treats as 'stop'. Upgrade: one row per call, counted over the last 3,600 seconds.
export async function takeBudget(db: D1Database, now: Date): Promise<boolean> {
  const row = await db
    .prepare('INSERT INTO budget (hour, used) VALUES (?1, 1) ON CONFLICT (hour) DO UPDATE SET used = used + 1 WHERE used < ?2 RETURNING used')
    .bind(now.toISOString().slice(0, 13), TIINGO_BUDGET)
    .first();
  return row !== null;
}

// Spec 19.13: a ticker not refreshed since the first of this UTC month costs a symbol when fetched.
const monthStart = (today: IsoDate) => today.slice(0, 8) + '01';
const newSymbol = (refreshedOn: string | null, today: IsoDate) => !refreshedOn || refreshedOn < monthStart(today);

// Spec 19.13: true when this month's symbols are spent: tickers refreshed this month plus requests answered not_found
// this month. Checked before every fetch of a new symbol.
// ponytail: check then fetch, so two Workers can both pass at 479; the 20-symbol margin under 500 covers that race.
export async function atSymbolCap(db: D1Database, today: IsoDate): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM tickers WHERE refreshed_on >= ?1) + ' +
        "(SELECT COUNT(*) FROM ticker_requests WHERE status = 'not_found' AND resolved_on >= ?1) AS n",
    )
    .bind(monthStart(today))
    .first<{ n: number }>();
  return row!.n >= MONTHLY_SYMBOLS;
}

const byYear = <T extends [string, ...string[]]>(rows: T[]) => {
  const out = new Map<number, T[]>();
  for (const r of rows) {
    const y = Number(r[0].slice(0, 4));
    out.set(y, [...(out.get(y) ?? []), r]);
  }
  return out;
};

// Spec 9.3 and 19.8. Sequential fetches; HTTP 429, 5xx or a network error stops the run, and so does a spent budget.
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
  const spent = () => {
    console.warn('refresh: budget spent');
    return { fetched, fxUpdated };
  };
  for (const { ticker } of queued.results) {
    if (await atSymbolCap(db, today)) break; // every queued ticker is a new symbol (spec 19.13)
    if (!(await takeBudget(db, now))) return spent();
    const got = await addTicker(env, ticker, today, fetchFn);
    if (got === 'stop') return { fetched, fxUpdated, stoppedOn: ticker };
    if (got === 'added') fetched.push(ticker);
  }

  // Spec 19.8: priority 1 always, other tickers only when served in the last 30 days (NULL last_used = unused).
  // A ticker that already has the last trading day's bar (fetched on demand, or a weekend run) is skipped.
  // Spec 19.13: at the symbol cap only tickers refreshed this month are candidates, so the run is not spent on skips.
  // LIMIT is the whole budget, not what the queued step left: queued tickers skipped at the cap made no call.
  const due = await db
    .prepare(
      'SELECT ticker, last_date, refreshed_on FROM tickers WHERE (refreshed_on IS NULL OR refreshed_on < ?1) ' +
        'AND (priority = 1 OR last_used >= ?2) AND (last_date IS NULL OR last_date < ?4) ' +
        'AND (?5 = 0 OR refreshed_on >= ?6) ' +
        'ORDER BY priority DESC, refreshed_on IS NOT NULL, refreshed_on, ticker LIMIT ?3',
    )
    .bind(today, addDays(today, -30), TIINGO_BUDGET, lastTradingDay(now), (await atSymbolCap(db, today)) ? 1 : 0, monthStart(today))
    .all<{ ticker: string; last_date: string | null; refreshed_on: string | null }>();

  for (const { ticker, last_date, refreshed_on } of due.results) {
    if (newSymbol(refreshed_on, today) && (await atSymbolCap(db, today))) continue;
    if (!(await takeBudget(db, now))) return spent();
    if ((await updateTicker(env, ticker, last_date, today, fetchFn)) === 'stop') return { fetched, fxUpdated, stoppedOn: ticker };
    fetched.push(ticker);
  }
  return { fetched, fxUpdated };
}

// Spec 19.5: backfills a new ticker and records the request as added or not_found. The request row is upserted
// (requested_on kept while queued, else today, so a not_found from an earlier month counts in this month's cap), because
// the request endpoint may have no row yet. The caller claims the budget.
export async function addTicker(
  env: Env,
  ticker: string,
  today: IsoDate,
  fetchFn: typeof fetch,
): Promise<'added' | 'not_found' | 'stop'> {
  const db = env.DB;
  const got = await fetchBars(ticker, BACKFILL_FROM, null, env.TIINGO_TOKEN, fetchFn);
  if (got === 'stop') return 'stop';
  const resolve = (status: string) =>
    db
      .prepare(
        'INSERT INTO ticker_requests (ticker, requested_on, status, resolved_on) VALUES (?1, ?2, ?3, ?2) ' +
          'ON CONFLICT (ticker) DO UPDATE SET status = excluded.status, resolved_on = excluded.resolved_on, ' +
          "requested_on = CASE WHEN status = 'queued' THEN requested_on ELSE excluded.requested_on END",
      )
      .bind(ticker, today, status);
  if (got === 'not_found') {
    await resolve('not_found').run();
    return 'not_found';
  }
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO tickers (ticker, priority, last_date, refreshed_on, added_on, last_used) VALUES (?1, 0, ?2, ?3, ?3, ?3)')
      .bind(ticker, got.at(-1)?.[0] ?? null, today),
    ...(await priceWrites(db, ticker, got)),
    resolve('added'),
  ]);
  return 'added';
}

// Spec 19.5: brings a stored ticker up to date from the day after lastDate. The caller claims the budget.
export async function updateTicker(
  env: Env,
  ticker: string,
  lastDate: IsoDate | null,
  today: IsoDate,
  fetchFn: typeof fetch,
): Promise<'ok' | 'stop'> {
  const db = env.DB;
  const bars = await fetchBars(ticker, lastDate ? addDays(lastDate, 1) : BACKFILL_FROM, lastDate, env.TIINGO_TOKEN, fetchFn);
  if (bars === 'stop') return 'stop';
  if (bars === 'not_found' || bars.length === 0) {
    await db.prepare('UPDATE tickers SET refreshed_on = ? WHERE ticker = ?').bind(today, ticker).run();
    return 'ok';
  }
  await db.batch([
    ...(await priceWrites(db, ticker, bars)),
    db.prepare('UPDATE tickers SET last_date = ?, refreshed_on = ? WHERE ticker = ?').bind(bars[bars.length - 1][0], today, ticker),
  ]);
  return 'ok';
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
