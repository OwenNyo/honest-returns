import { addDays } from '../src/shared/dates';
import { frankfurterUrl, toFxRows } from './frankfurter';
import type { Env } from './index';
import { tiingoRequest, toBars } from './tiingo';

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

  const due = await db
    .prepare(
      'SELECT ticker, last_date FROM tickers WHERE refreshed_on IS NULL OR refreshed_on < ? ' +
        'ORDER BY priority DESC, refreshed_on IS NOT NULL, refreshed_on, ticker LIMIT ?',
    )
    .bind(today, TIINGO_BUDGET)
    .all<{ ticker: string; last_date: string | null }>();

  const fetched: string[] = [];
  const markRefreshed = (t: string) => db.prepare('UPDATE tickers SET refreshed_on = ? WHERE ticker = ?').bind(today, t);
  for (const { ticker, last_date } of due.results) {
    let res: Response;
    try {
      res = await fetchFn(tiingoRequest(ticker, last_date ? addDays(last_date, 1) : BACKFILL_FROM, env.TIINGO_TOKEN));
    } catch (e) {
      console.error(`refresh: ${ticker} network error, stopping: ${e}`);
      return { fetched, fxUpdated, stoppedOn: ticker };
    }
    if (res.status === 404) {
      console.warn(`refresh: ${ticker} not found at Tiingo`);
      await markRefreshed(ticker).run();
      continue;
    }
    if (!res.ok) {
      console.error(`refresh: ${ticker} HTTP ${res.status}, stopping`);
      return { fetched, fxUpdated, stoppedOn: ticker };
    }
    const bars = toBars(await res.json()).filter((b) => !last_date || b[0] > last_date);
    fetched.push(ticker);
    if (bars.length === 0) {
      await markRefreshed(ticker).run();
      continue;
    }
    const groups = byYear(bars);
    const stored = await db
      .prepare(`SELECT year, rows FROM prices WHERE ticker = ? AND year IN (${[...groups.keys()].map(() => '?').join(',')})`)
      .bind(ticker, ...groups.keys())
      .all<{ year: number; rows: string }>();
    const existing = new Map(stored.results.map((r) => [r.year, r.rows]));
    await db.batch([
      ...[...groups].map(([year, rows]) =>
        db
          .prepare('INSERT INTO prices (ticker, year, rows) VALUES (?,?,?) ON CONFLICT (ticker, year) DO UPDATE SET rows = excluded.rows')
          .bind(ticker, year, appendYearRows(existing.get(year) ?? null, rows)),
      ),
      db.prepare('UPDATE tickers SET last_date = ?, refreshed_on = ? WHERE ticker = ?').bind(bars[bars.length - 1][0], today, ticker),
    ]);
  }
  return { fetched, fxUpdated };
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
