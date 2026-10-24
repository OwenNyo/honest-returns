import type { Context } from 'hono';
import { MONTHLY_NEW_TICKERS, TOTAL_TICKERS } from '../src/engine/constants';
import { TickerRequestBody } from '../src/shared/api';
import type { Env } from './index';

export const DAILY_CLIENT_REQUESTS = 10; // per hashed client IP per UTC day; every POST counts
const DEV_SALT = 'honest-returns-dev-salt'; // used only when the REQUEST_SALT secret is not set (local dev)

type Status = 'queued' | 'already_queued' | 'already_available' | 'limit_reached' | 'list_full';

async function clientHash(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Spec 10.8: queue tickers for the nightly cron, within the monthly cap of new tickers.
export async function postTickerRequests(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (!c.env.REQUEST_SALT) console.warn('ticker-requests: REQUEST_SALT is not set, hashing client IPs with the dev salt');
  const client = await clientHash(c.req.header('CF-Connecting-IP') ?? '', c.env.REQUEST_SALT ?? DEV_SALT);
  const counted = await db
    .prepare(
      'INSERT INTO client_requests (client, day, count) VALUES (?, ?, 1) ' +
        'ON CONFLICT (client, day) DO UPDATE SET count = count + 1 RETURNING count',
    )
    .bind(client, today)
    .first<{ count: number }>();
  if (counted!.count > DAILY_CLIENT_REQUESTS) return c.json({ error: 'too_many_requests' }, 429);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request', message: 'The body must be JSON.' }, 400);
  }
  const parsed = TickerRequestBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'bad_request', message: parsed.error.issues[0].message }, 400);

  const monthStart = today.slice(0, 8) + '01';
  const used = await db
    .prepare("SELECT COUNT(*) AS n FROM ticker_requests WHERE status IN ('queued','added') AND requested_on >= ?")
    .bind(monthStart)
    .first<{ n: number }>();
  let count = used!.n;
  const list = await db
    .prepare("SELECT (SELECT COUNT(*) FROM tickers) + (SELECT COUNT(*) FROM ticker_requests WHERE status = 'queued') AS n")
    .first<{ n: number }>();
  let listCount = list!.n;

  const results: { ticker: string; status: Status }[] = [];
  for (const ticker of parsed.data.tickers) {
    const listed = await db.prepare('SELECT 1 FROM tickers WHERE ticker = ?').bind(ticker).first();
    const request = await db.prepare('SELECT status FROM ticker_requests WHERE ticker = ?').bind(ticker).first<{ status: string }>();
    let status: Status;
    if (listed || request?.status === 'added') status = 'already_available';
    else if (request?.status === 'queued') status = 'already_queued';
    else if (count >= MONTHLY_NEW_TICKERS) status = 'limit_reached';
    else if (listCount >= TOTAL_TICKERS) status = 'list_full';
    else {
      // A ticker Tiingo did not know before may be listed now, so a not_found request is queued again.
      await db
        .prepare(
          "INSERT INTO ticker_requests (ticker, requested_on, status) VALUES (?, ?, 'queued') " +
            "ON CONFLICT (ticker) DO UPDATE SET requested_on = excluded.requested_on, status = 'queued', resolved_on = NULL",
        )
        .bind(ticker, today)
        .run();
      count++;
      listCount++;
      status = 'queued';
    }
    results.push({ ticker, status });
  }
  const limited = results.some((r) => r.status === 'limit_reached');
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return c.json({ results, availableFrom: limited ? nextMonth : null });
}
