import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DAILY_CLIENT_TICKERS, resolveTickers } from './requests';

// Spec 10.8 and 19.7: POST /api/ticker-requests, monthly cap of 90 new tickers, per-client daily cap of tickers
// counted by a hashed IP in D1. Endpoint tests run with the budget spent (spec 19.8), so they never reach the real
// fetch; the fetching paths are tested through resolveTickers with a stubbed fetch.

const testEnv = () => ({ DB: env.DB, TIINGO_TOKEN: 'test-token' });

type Route = (req: Request) => Response | Promise<Response>;

// Stub fetch: records every request and answers Tiingo by ticker (copied from refresh.test.ts).
function stub(tiingo: Record<string, Route>) {
  const calls: Request[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push(req);
    const m = new URL(req.url).pathname.match(/\/tiingo\/daily\/([^/]+)\/prices/);
    if (!m) throw new Error('unexpected request ' + req.url);
    const route = tiingo[decodeURIComponent(m[1]).toUpperCase()];
    return route ? route(req) : Response.json([]);
  });
  const tiingoTickers = () => calls.map((r) => new URL(r.url).pathname.split('/')[3].toUpperCase());
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, tiingoTickers };
}

const item = (date: string, close: number, splitFactor = 1, divCash = 0) => ({
  date: `${date}T00:00:00.000Z`,
  close,
  high: close,
  low: close,
  open: close,
  volume: 1000,
  adjClose: close,
  splitFactor,
  divCash,
});

const hourKey = (d: Date) => d.toISOString().slice(0, 13);
const setBudget = (d: Date, used: number) =>
  env.DB.prepare('INSERT OR REPLACE INTO budget (hour, used) VALUES (?, ?)').bind(hourKey(d), used).run();
// The current and the next UTC hour, so a test that crosses the hour still never calls Tiingo.
const spendBudget = async () => {
  const now = new Date();
  await setBudget(now, 40);
  await setBudget(new Date(now.getTime() + 3_600_000), 40);
};

const today = () => new Date().toISOString().slice(0, 10);
const firstOfNextMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};
const lastMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)).toISOString().slice(0, 10);
};
// A fresh client IP per call site, so the per-client daily counter never leaks between tests.
const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 256)).join('.')}`;

const post = (body: unknown, ip = randomIp()) =>
  exports.default.fetch('http://x/api/ticker-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const json = async (body: unknown, ip?: string) => (await (await post(body, ip)).json()) as any;

async function seedRequests(n: number, requestedOn: string, status = 'queued', prefix = 'Q') {
  const stmts = Array.from({ length: n }, (_, i) =>
    env.DB.prepare('INSERT INTO ticker_requests (ticker, requested_on, status) VALUES (?,?,?)').bind(
      `${prefix}${String(i).padStart(3, '0')}`,
      requestedOn,
      status,
    ),
  );
  if (stmts.length) await env.DB.batch(stmts);
}

const NEW_TICKERS = "('TSTR','NEWA','NEWB','NEWC','BADX','Q000')";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ticker_requests'),
    env.DB.prepare('DELETE FROM client_requests'),
    env.DB.prepare('DELETE FROM budget'),
    env.DB.prepare(`DELETE FROM tickers WHERE ticker IN ${NEW_TICKERS}`),
    env.DB.prepare(`DELETE FROM prices WHERE ticker IN ${NEW_TICKERS}`),
    env.DB.prepare("INSERT INTO tickers (ticker, priority, added_on) VALUES ('TSTR', 0, '2026-01-01')"),
  ]);
  await spendBudget();
});

test('a new ticker is queued', async () => {
  expect(await json({ tickers: ['NEWA'] })).toEqual({ results: [{ ticker: 'NEWA', status: 'queued' }], availableFrom: null });
});

test('a queued ticker is stored with status queued and today as requested_on', async () => {
  await post({ tickers: ['NEWA'] });
  const row = await env.DB.prepare('SELECT requested_on, status, resolved_on FROM ticker_requests WHERE ticker = ?').bind('NEWA').first();
  expect(row).toEqual({ requested_on: today(), status: 'queued', resolved_on: null });
});

test('queue fallback: requesting a queued ticker again with the budget spent gives queued', async () => {
  await env.DB.prepare("INSERT INTO ticker_requests (ticker, requested_on, status) VALUES ('NEWA', ?, 'queued')").bind(lastMonth()).run();
  expect((await json({ tickers: ['NEWA'] })).results).toEqual([{ ticker: 'NEWA', status: 'queued' }]);
  const row = await env.DB.prepare('SELECT requested_on FROM ticker_requests WHERE ticker = ?').bind('NEWA').first<{ requested_on: string }>();
  expect(row!.requested_on).toBe(lastMonth());
});

test('a ticker on the allowlist gives already_available and is not queued', async () => {
  expect((await json({ tickers: ['TSTR'] })).results).toEqual([{ ticker: 'TSTR', status: 'already_available' }]);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM ticker_requests').first<{ n: number }>();
  expect(n!.n).toBe(0);
});

test('lower-case tickers with spaces are normalised', async () => {
  expect((await json({ tickers: [' newb '] })).results).toEqual([{ ticker: 'NEWB', status: 'queued' }]);
});

test('with 90 queued or added this month, a new ticker gives limit_reached and availableFrom the first of next month', async () => {
  await seedRequests(60, today(), 'queued', 'Q');
  await seedRequests(30, today(), 'added', 'A');
  expect(await json({ tickers: ['NEWA'] })).toEqual({
    results: [{ ticker: 'NEWA', status: 'limit_reached' }],
    availableFrom: firstOfNextMonth(),
  });
});

test('limit_reached is not stored', async () => {
  await seedRequests(90, today());
  await post({ tickers: ['NEWA'] });
  const row = await env.DB.prepare('SELECT 1 FROM ticker_requests WHERE ticker = ?').bind('NEWA').first();
  expect(row).toBeNull();
});

test('the 90th new ticker of the month is queued and the 91st is not', async () => {
  await seedRequests(89, today());
  expect((await json({ tickers: ['NEWA', 'NEWB'] })).results).toEqual([
    { ticker: 'NEWA', status: 'queued' },
    { ticker: 'NEWB', status: 'limit_reached' },
  ]);
});

test('not_found requests do not count toward the monthly cap', async () => {
  await seedRequests(89, today(), 'queued', 'Q');
  await seedRequests(5, today(), 'not_found', 'N');
  expect((await json({ tickers: ['NEWA'] })).results).toEqual([{ ticker: 'NEWA', status: 'queued' }]);
});

test('requests from last month do not count toward the monthly cap', async () => {
  await seedRequests(90, lastMonth());
  expect((await json({ tickers: ['NEWA'] })).results).toEqual([{ ticker: 'NEWA', status: 'queued' }]);
});

test.each([
  ['an empty list', { tickers: [] }],
  ['11 tickers', { tickers: Array.from({ length: 11 }, (_, i) => `T${i}`) }],
  ['a ticker with a bad character', { tickers: ['TS$A'] }],
  ['a ticker over 10 characters', { tickers: ['ABCDEFGHIJK'] }],
  ['no tickers field', {}],
  ['a body that is not JSON', 'not json'],
])('%s gives 400 bad_request', async (_name, body) => {
  const res = await post(body);
  expect(res.status).toBe(400);
  const b = (await res.json()) as any;
  expect(b.error).toBe('bad_request');
  expect(typeof b.message).toBe('string');
});

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test('client cap, endpoint: the 31st queued ticker of the day answers limit_reached with HTTP 200 and availableFrom tomorrow', async () => {
  const ip = randomIp();
  for (let i = 0; i < DAILY_CLIENT_TICKERS; i++) {
    expect((await json({ tickers: [`CAP${String(i).padStart(2, '0')}`] }, ip)).results).toEqual([
      { ticker: `CAP${String(i).padStart(2, '0')}`, status: 'queued' },
    ]);
  }
  const res = await post({ tickers: ['CAPXX'] }, ip);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ results: [{ ticker: 'CAPXX', status: 'limit_reached' }], availableFrom: tomorrow() });
});

test('no 429: an over-cap POST still answers 200 and queues the tickers within the cap', async () => {
  const ip = randomIp();
  for (let p = 0; p < 3; p++) await post({ tickers: Array.from({ length: 9 }, (_, i) => `CAP${p}${i}`) }, ip); // 27 counted
  const res = await post({ tickers: Array.from({ length: 10 }, (_, i) => `OVR${i}`) }, ip);
  expect(res.status).toBe(200);
  expect(((await res.json()) as any).results.map((r: { status: string }) => r.status)).toEqual([
    ...Array(3).fill('queued'),
    ...Array(7).fill('limit_reached'),
  ]);
});

test('a ticker listed twice gives one result and costs the client one', async () => {
  expect((await json({ tickers: ['DUPA', 'DUPA'] })).results).toEqual([{ ticker: 'DUPA', status: 'queued' }]);
  const n = await env.DB.prepare('SELECT SUM(count) AS n FROM client_requests').first<{ n: number }>();
  expect(n!.n).toBe(1);
});

test('the client IP is not stored in D1 in plain text', async () => {
  const ip = '198.51.100.77';
  await post({ tickers: ['NEWA'] }, ip);
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>();
  for (const { name } of tables.results) {
    const rows = await env.DB.prepare(`SELECT * FROM "${name}"`).all();
    expect(JSON.stringify(rows.results)).not.toContain(ip);
  }
});

// Task 46, spec 19.7: resolveTickers with a stubbed Tiingo and an empty budget.
describe('resolveTickers', () => {
  const NOW = new Date('2026-10-26T15:00:00Z');
  const DAY = '2026-10-26';

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM budget').run();
  });

  const statuses = (out: { results: { status: string }[] }) => out.results.map((r) => r.status);
  const clientCount = async (client: string) =>
    (await env.DB.prepare('SELECT count FROM client_requests WHERE client = ? AND day = ?').bind(client, DAY).first<{ count: number }>())?.count;
  const setClientCount = (client: string, count: number) =>
    env.DB.prepare('INSERT OR REPLACE INTO client_requests (client, day, count) VALUES (?, ?, ?)').bind(client, DAY, count).run();
  const requestRow = (t: string) =>
    env.DB.prepare('SELECT status, resolved_on FROM ticker_requests WHERE ticker = ?').bind(t).first<{ status: string; resolved_on: string | null }>();
  const seedRequest = (t: string, status: string, resolvedOn: string | null) =>
    env.DB.prepare('INSERT INTO ticker_requests (ticker, requested_on, status, resolved_on) VALUES (?, ?, ?, ?)').bind(t, '2026-10-01', status, resolvedOn).run();
  const notFound = () => new Response('not found', { status: 404 });

  test('added: a new ticker is fetched from 2005-01-01, stored and marked added', async () => {
    const s = stub({ NEWA: () => Response.json([item('2026-10-23', 10)]) });
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA'], NOW, s.fetchFn);
    expect(out.results).toEqual([{ ticker: 'NEWA', status: 'added' }]);
    expect(new URL(s.calls[0].url).searchParams.get('startDate')).toBe('2005-01-01');
    const row = await env.DB.prepare('SELECT priority, last_date, refreshed_on, added_on, last_used FROM tickers WHERE ticker = ?').bind('NEWA').first();
    expect(row).toEqual({ priority: 0, last_date: '2026-10-23', refreshed_on: DAY, added_on: DAY, last_used: DAY });
    expect(await requestRow('NEWA')).toEqual({ status: 'added', resolved_on: DAY });
    const prices = await env.DB.prepare('SELECT rows FROM prices WHERE ticker = ? AND year = 2026').bind('NEWA').first<{ rows: string }>();
    expect(JSON.parse(prices!.rows)).toEqual([['2026-10-23', '10', '1', '0']]);
  });

  test('added: a queued ticker is fetched and not counted again', async () => {
    await seedRequests(89, DAY); // Q000 to Q088, queued this month
    const out = await resolveTickers(testEnv(), 'client-a', ['Q000', 'NEWA'], NOW, stub({}).fetchFn);
    expect(statuses(out)).toEqual(['added', 'added']);
  });

  test('not_found: a 404 answers not_found at once and does not count', async () => {
    await seedRequests(89, DAY);
    const out = await resolveTickers(testEnv(), 'client-a', ['BADX', 'NEWA'], NOW, stub({ BADX: notFound }).fetchFn);
    expect(statuses(out)).toEqual(['not_found', 'added']);
    expect((await requestRow('BADX'))!.status).toBe('not_found');
    expect(await env.DB.prepare('SELECT 1 FROM tickers WHERE ticker = ?').bind('BADX').first()).toBeNull();
  });

  test('not_found resolved today is answered without a call', async () => {
    await seedRequest('BADX', 'not_found', DAY);
    const s = stub({ BADX: notFound });
    const out = await resolveTickers(testEnv(), 'client-a', ['BADX'], NOW, s.fetchFn);
    expect(statuses(out)).toEqual(['not_found']);
    expect(s.calls).toHaveLength(0);
  });

  test('a not_found from an earlier day is tried again', async () => {
    await seedRequest('BADX', 'not_found', '2026-10-20');
    const s = stub({ BADX: notFound });
    await resolveTickers(testEnv(), 'client-a', ['BADX'], NOW, s.fetchFn);
    expect(s.calls).toHaveLength(1);
  });

  test('queue fallback: with the budget spent a new ticker is queued', async () => {
    await setBudget(NOW, 40);
    const s = stub({});
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA'], NOW, s.fetchFn);
    expect(statuses(out)).toEqual(['queued']);
    expect(s.calls).toHaveLength(0);
    expect(await requestRow('NEWA')).toEqual({ status: 'queued', resolved_on: null });
    expect(await clientCount('client-a')).toBe(1);
  });

  test('budget shared: once a fetch is refused, the rest of the request is queued', async () => {
    await setBudget(NOW, 39);
    const s = stub({});
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA', 'NEWB', 'NEWC'], NOW, s.fetchFn);
    expect(statuses(out)).toEqual(['added', 'queued', 'queued']);
    expect(s.calls).toHaveLength(1);
  });

  test('HTTP 429 queues that ticker and the rest', async () => {
    const s = stub({ NEWA: () => new Response('slow down', { status: 429 }) });
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA', 'NEWB'], NOW, s.fetchFn);
    expect(statuses(out)).toEqual(['queued', 'queued']);
    expect(s.calls).toHaveLength(1);
  });

  test('client cap: the 31st fetched ticker of the day answers limit_reached and the rest of the POST still runs', async () => {
    await setClientCount('client-a', 29);
    const s = stub({});
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA', 'NEWB', 'NEWC'], NOW, s.fetchFn);
    expect(statuses(out)).toEqual(['added', 'limit_reached', 'limit_reached']);
    expect(s.calls).toHaveLength(1);
    expect(await requestRow('NEWB')).toBeNull();
    expect(await requestRow('NEWC')).toBeNull();
    expect(out.availableFrom).toBe('2026-10-27');
  });

  test('client cap: tickers that need no fetch cost nothing', async () => {
    await setClientCount('client-a', 30);
    const out = await resolveTickers(testEnv(), 'client-a', ['TSTR'], NOW, stub({}).fetchFn);
    expect(statuses(out)).toEqual(['already_available']);
    expect(await clientCount('client-a')).toBe(30);
  });

  test('client cap: a queued ticker counts', async () => {
    await setBudget(NOW, 40);
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA', 'NEWB'], NOW, stub({}).fetchFn);
    expect(statuses(out)).toEqual(['queued', 'queued']);
    expect(await clientCount('client-a')).toBe(2);
  });

  test('client cap: a not_found fetch counts', async () => {
    await resolveTickers(testEnv(), 'client-a', ['BADX'], NOW, stub({ BADX: notFound }).fetchFn);
    expect(await clientCount('client-a')).toBe(1);
  });

  test("client cap: one client's count does not affect another", async () => {
    await setClientCount('client-a', 30);
    const out = await resolveTickers(testEnv(), 'client-b', ['NEWA'], NOW, stub({}).fetchFn);
    expect(statuses(out)).toEqual(['added']);
  });

  test('client cap: availableFrom is next month when the monthly cap also applies', async () => {
    await seedRequests(90, DAY);
    await setClientCount('client-a', 30);
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA'], NOW, stub({}).fetchFn);
    expect(out).toEqual({ results: [{ ticker: 'NEWA', status: 'limit_reached' }], availableFrom: '2026-11-01' });
  });

  // Spec 19.13: 480 requests answered not_found this month spend the month's symbols.
  test('symbol cap: a new ticker answers limit_reached until next month, with no call and no charge', async () => {
    await env.DB.batch(
      Array.from({ length: 480 }, (_, i) =>
        env.DB.prepare("INSERT INTO ticker_requests (ticker, requested_on, status, resolved_on) VALUES (?, '2026-10-02', 'not_found', '2026-10-02')").bind(`N${i}`),
      ),
    );
    const s = stub({});
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA'], NOW, s.fetchFn);
    expect(out).toEqual({ results: [{ ticker: 'NEWA', status: 'limit_reached' }], availableFrom: '2026-11-01' });
    expect(s.calls).toHaveLength(0);
    expect(await requestRow('NEWA')).toBeNull();
    expect(await clientCount('client-a')).toBeUndefined();
  });

  // Spec 19.5: a not_found from last month that loads this month counts toward this month's 90.
  test('a not_found row from last month that is added this month counts toward the monthly cap', async () => {
    await seedRequests(89, DAY);
    await env.DB.prepare("INSERT INTO ticker_requests (ticker, requested_on, status, resolved_on) VALUES ('BADX', '2026-09-15', 'not_found', '2026-09-15')").run();
    expect(statuses(await resolveTickers(testEnv(), 'client-a', ['BADX'], NOW, stub({}).fetchFn))).toEqual(['added']);
    expect(statuses(await resolveTickers(testEnv(), 'client-a', ['NEWA'], NOW, stub({}).fetchFn))).toEqual(['limit_reached']);
  });

  test('limit_reached: at the monthly cap a new ticker is not fetched', async () => {
    await seedRequests(90, DAY);
    const s = stub({});
    const out = await resolveTickers(testEnv(), 'client-a', ['NEWA'], NOW, s.fetchFn);
    expect(statuses(out)).toEqual(['limit_reached']);
    expect(s.calls).toHaveLength(0);
  });
});
