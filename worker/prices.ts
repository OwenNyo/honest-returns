import type { Context } from 'hono';
import { PricesQuery } from '../src/shared/api';
import type { Env } from './index';

// Strips the outer brackets of a stored JSON array: '[[a],[b]]' -> '[a],[b]'.
const inner = (rows: string) => rows.slice(1, -1);
const joinRows = (rows: string[]) => '[' + rows.map(inner).filter((s) => s !== '').join(',') + ']';

// Spec 9.2. The body is built from the stored strings without JSON.parse, to stay inside the CPU limit.
export async function getPrices(c: Context<{ Bindings: Env }>) {
  const parsed = PricesQuery.safeParse({ tickers: c.req.query('tickers'), from: c.req.query('from') });
  if (!parsed.success) return c.json({ error: 'bad_request', message: parsed.error.issues[0].message }, 400);
  const { tickers, from } = parsed.data;
  const minYear = Number(from.slice(0, 4)) - 1;
  const db = c.env.DB;
  const marks = tickers.map(() => '?').join(',');

  const known = tickers.length
    ? (
        await db
          .prepare(`SELECT ticker, last_date FROM tickers WHERE ticker IN (${marks})`)
          .bind(...tickers)
          .all<{ ticker: string; last_date: string | null }>()
      ).results
    : [];
  const lastDate = new Map(known.map((r) => [r.ticker, r.last_date]));
  const available = tickers.filter((t) => lastDate.get(t)).sort();
  const unavailable = tickers
    .filter((t) => !lastDate.get(t))
    .map((t) => ({ ticker: t, reason: lastDate.has(t) ? 'no_data_yet' : 'not_on_allowlist' }));

  const byTicker = new Map<string, string[]>(available.map((t) => [t, []]));
  if (available.length) {
    const rows = await db
      .prepare(
        `SELECT ticker, rows FROM prices WHERE ticker IN (${available.map(() => '?').join(',')}) AND year >= ? ORDER BY ticker, year`,
      )
      .bind(...available, minYear)
      .all<{ ticker: string; rows: string }>();
    for (const r of rows.results) byTicker.get(r.ticker)!.push(r.rows);
  }
  const fxRows = (await db.prepare('SELECT rows FROM fx WHERE year >= ? ORDER BY year').bind(minYear).all<{ rows: string }>())
    .results.map((r) => r.rows);

  // asOf = min(last_date of available tickers, last fx date); null if either is missing. No tickers requested: the last fx date.
  const lastFx = fxRows.length ? /"(\d{4}-\d{2}-\d{2})"[^\]]*\]\]$/.exec(fxRows[fxRows.length - 1])?.[1] : undefined;
  const asOf = lastFx && (available.length || !tickers.length) ? [...available.map((t) => lastDate.get(t)!), lastFx].sort()[0] : null;

  const prices = [...byTicker].map(([t, rows]) => `${JSON.stringify(t)}:${joinRows(rows)}`).join(',');
  const body = `{"asOf":${JSON.stringify(asOf)},"prices":{${prices}},"fx":${joinRows(fxRows)},"unavailable":${JSON.stringify(unavailable)}}`;
  return c.body(body, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
}
