import type { Context } from 'hono';
import type { IsoDate } from '../src/engine/types';
import { MONTHLY_NEW_TICKERS } from '../src/engine/constants';
import { addDays } from '../src/shared/dates';
import { TickerRequestBody } from '../src/shared/api';
import type { Env } from './index';
import { addTicker, atSymbolCap, takeBudget } from './refresh';

// Tickers fetched or queued per hashed client IP per UTC day (spec 19.7). Tickers that need no fetch cost nothing.
// ponytail: a client with many IPs is many clients; the hourly Tiingo budget, not this cap, keeps Tiingo's limits safe.
export const DAILY_CLIENT_TICKERS = 30;
const DEV_SALT = 'honest-returns-dev-salt'; // used only when the REQUEST_SALT secret is not set (local dev)

export type RequestStatus = 'added' | 'queued' | 'not_found' | 'already_available' | 'limit_reached';

async function clientHash(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Spec 10.8 and 19.7: load requested tickers at once when the budget allows, otherwise queue them for the cron.
export async function postTickerRequests(c: Context<{ Bindings: Env }>) {
  if (!c.env.REQUEST_SALT) console.warn('ticker-requests: REQUEST_SALT is not set, hashing client IPs with the dev salt');
  const client = await clientHash(c.req.header('CF-Connecting-IP') ?? '', c.env.REQUEST_SALT ?? DEV_SALT);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request', message: 'The body must be JSON.' }, 400);
  }
  const parsed = TickerRequestBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'bad_request', message: parsed.error.issues[0].message }, 400);
  return c.json(await resolveTickers(c.env, client, [...new Set(parsed.data.tickers)], new Date()));
}

// Spec 19.4 applied to client_requests: increment and check in one statement. false = the client's cap is reached.
export async function takeClientTicker(db: D1Database, client: string, today: IsoDate): Promise<boolean> {
  const row = await db
    .prepare(
      'INSERT INTO client_requests (client, day, count) VALUES (?1, ?2, 1) ' +
        'ON CONFLICT (client, day) DO UPDATE SET count = count + 1 WHERE count < ?3 RETURNING count',
    )
    .bind(client, today, DAILY_CLIENT_TICKERS)
    .first();
  return row !== null;
}

// Spec 19.7 rules 1 to 7, first match wins per ticker.
export async function resolveTickers(
  env: Env,
  client: string,
  tickers: string[],
  now: Date,
  fetchFn: typeof fetch = fetch,
): Promise<{ results: { ticker: string; status: RequestStatus }[]; availableFrom: IsoDate | null }> {
  const db = env.DB;
  const today = now.toISOString().slice(0, 10);
  const used = await db
    .prepare("SELECT COUNT(*) AS n FROM ticker_requests WHERE status IN ('queued','added') AND requested_on >= ?")
    .bind(today.slice(0, 8) + '01')
    .first<{ n: number }>();
  let count = used!.n;
  let refused = false; // a fetch was refused in this POST (budget spent or 'stop'), so the rest is queued
  let monthCap = false;
  let clientCap = false;

  const results: { ticker: string; status: RequestStatus }[] = [];
  for (const ticker of tickers) {
    const listed = await db.prepare('SELECT 1 FROM tickers WHERE ticker = ?').bind(ticker).first();
    const request = await db
      .prepare('SELECT status, resolved_on FROM ticker_requests WHERE ticker = ?')
      .bind(ticker)
      .first<{ status: string; resolved_on: string | null }>();
    const queued = request?.status === 'queued';
    let status: RequestStatus;
    if (listed || request?.status === 'added') status = 'already_available';
    else if (request?.status === 'not_found' && request.resolved_on === today) status = 'not_found';
    else if (!queued && count >= MONTHLY_NEW_TICKERS) {
      status = 'limit_reached';
      monthCap = true;
    } else if (await atSymbolCap(db, today)) {
      // Spec 19.13: Tiingo's distinct symbols for the month are spent; nothing stored, the client is not charged.
      status = 'limit_reached';
      monthCap = true;
    } else if (!(await takeClientTicker(db, client, today))) {
      // ponytail: a ticker the budget then refuses still costs the client one of its 30; simpler than handing it back.
      status = 'limit_reached';
      clientCap = true;
    } else {
      const got = refused || !(await takeBudget(db, now)) ? 'stop' : await addTicker(env, ticker, today, fetchFn);
      if (got === 'stop') {
        refused = true;
        await db
          .prepare(
            "INSERT INTO ticker_requests (ticker, requested_on, status) VALUES (?, ?, 'queued') " +
              "ON CONFLICT (ticker) DO UPDATE SET requested_on = CASE WHEN status = 'queued' THEN requested_on ELSE excluded.requested_on END, " +
              "status = 'queued', resolved_on = NULL",
          )
          .bind(ticker, today)
          .run();
        status = 'queued';
      } else status = got;
      if (status !== 'not_found' && !queued) count++;
    }
    results.push({ ticker, status });
  }
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return { results, availableFrom: monthCap ? nextMonth : clientCap ? addDays(today, 1) : null };
}
