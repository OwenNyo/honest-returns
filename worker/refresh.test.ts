import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { appendYearRows, refresh } from './refresh';

const testEnv = () => ({ DB: env.DB, TIINGO_TOKEN: 'test-token' });
const NIGHT = new Date('2026-10-24T23:00:00Z'); // not the FX hour
const FX_HOUR = new Date('2026-10-24T22:05:00Z');

type Route = (req: Request) => Response | Promise<Response>;

// Stub fetch: records every request and answers Tiingo by ticker, Frankfurter with fxBody.
function stub(tiingo: Record<string, Route>, fxBody: unknown = { rates: {} }) {
  const calls: Request[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push(req);
    const url = new URL(req.url);
    if (url.hostname.includes('frankfurter')) return Response.json(fxBody);
    const m = url.pathname.match(/\/tiingo\/daily\/([^/]+)\/prices/);
    if (!m) throw new Error('unexpected request ' + req.url);
    const route = tiingo[decodeURIComponent(m[1]).toUpperCase()];
    return route ? route(req) : Response.json([]);
  });
  const tiingoTickers = () =>
    calls.filter((r) => r.url.includes('tiingo')).map((r) => new URL(r.url).pathname.split('/')[3].toUpperCase());
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

async function seedTickers(rows: [ticker: string, priority: number, lastDate: string | null, refreshedOn: string | null][]) {
  for (const [t, p, l, r] of rows) {
    await env.DB.prepare('INSERT INTO tickers (ticker, priority, last_date, refreshed_on, added_on) VALUES (?,?,?,?,?)')
      .bind(t, p, l, r, '2026-01-01')
      .run();
  }
}
const tickerRow = (t: string) =>
  env.DB.prepare('SELECT last_date, refreshed_on FROM tickers WHERE ticker = ?').bind(t).first<{ last_date: string | null; refreshed_on: string | null }>();
const yearRows = async (t: string, year: number) => {
  const r = await env.DB.prepare('SELECT rows FROM prices WHERE ticker = ? AND year = ?').bind(t, year).first<{ rows: string }>();
  return r ? JSON.parse(r.rows) : null;
};
const fxRows = async (year: number) => {
  const r = await env.DB.prepare('SELECT rows FROM fx WHERE year = ?').bind(year).first<{ rows: string }>();
  return r ? JSON.parse(r.rows) : null;
};

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM tickers'), env.DB.prepare('DELETE FROM prices'), env.DB.prepare('DELETE FROM fx')]);
});

test('appendYearRows starts a new year row from null', () => {
  expect(JSON.parse(appendYearRows(null, [['2020-01-02', '1', '1', '0']]))).toEqual([['2020-01-02', '1', '1', '0']]);
});

test('appendYearRows appends after the existing rows', () => {
  const out = appendYearRows('[["2020-01-02","1","1","0"]]', [['2020-01-03', '2', '1', '0']]);
  expect(JSON.parse(out)).toEqual([
    ['2020-01-02', '1', '1', '0'],
    ['2020-01-03', '2', '1', '0'],
  ]);
});

test('a Tiingo item is stored as string tuples in its year row', async () => {
  await seedTickers([['TSTA', 0, null, null]]);
  const s = stub({ TSTA: () => Response.json([item('2020-08-31', 129.04, 4, 0)]) });
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(await yearRows('TSTA', 2020)).toEqual([['2020-08-31', '129.04', '4', '0']]);
});

test('a successful fetch updates last_date and refreshed_on', async () => {
  await seedTickers([['TSTA', 0, null, null]]);
  const s = stub({ TSTA: () => Response.json([item('2020-08-31', 129.04, 4, 0)]) });
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(await tickerRow('TSTA')).toEqual({ last_date: '2020-08-31', refreshed_on: '2026-10-24' });
});

test('the Tiingo request carries the token header', async () => {
  await seedTickers([['TSTA', 0, null, null]]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.calls[0].headers.get('Authorization')).toBe('Token test-token');
});

test('a new ticker is backfilled from 2005-01-01', async () => {
  await seedTickers([['TSTA', 0, null, null]]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(new URL(s.calls[0].url).searchParams.get('startDate')).toBe('2005-01-01');
});

test('a known ticker is fetched from the day after last_date', async () => {
  await seedTickers([['TSTA', 0, '2020-12-30', '2026-10-01']]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(new URL(s.calls[0].url).searchParams.get('startDate')).toBe('2020-12-31');
});

test('rows across a year boundary go to two year rows, keep existing rows and skip duplicates', async () => {
  await seedTickers([['TSTA', 0, '2020-12-30', '2026-10-01']]);
  await env.DB.prepare('INSERT INTO prices (ticker, year, rows) VALUES (?,?,?)')
    .bind('TSTA', 2020, '[["2020-12-29","10","1","0"],["2020-12-30","11","1","0"]]')
    .run();
  const s = stub({
    TSTA: () => Response.json([item('2020-12-30', 11), item('2020-12-31', 12), item('2021-01-04', 13)]),
  });
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(await yearRows('TSTA', 2020)).toEqual([
    ['2020-12-29', '10', '1', '0'],
    ['2020-12-30', '11', '1', '0'],
    ['2020-12-31', '12', '1', '0'],
  ]);
  expect(await yearRows('TSTA', 2021)).toEqual([['2021-01-04', '13', '1', '0']]);
  expect((await tickerRow('TSTA'))!.last_date).toBe('2021-01-04');
});

test('tickers are refreshed by priority, then never-refreshed, then oldest refreshed_on; today is skipped', async () => {
  await seedTickers([
    ['OLD2', 0, '2026-10-01', '2026-10-10'],
    ['TODAY', 1, '2026-10-23', '2026-10-24'],
    ['OLD1', 0, '2026-10-01', '2026-10-01'],
    ['NEW', 0, null, null],
    ['PRIO', 1, '2026-10-01', '2026-10-20'],
  ]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual(['PRIO', 'NEW', 'OLD1', 'OLD2']);
});

test('at most 45 Tiingo calls are made in one run', async () => {
  await seedTickers(Array.from({ length: 50 }, (_, i) => [`T${String(i).padStart(2, '0')}`, 0, null, null] as [string, number, null, null]));
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toHaveLength(45);
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM tickers WHERE refreshed_on IS NULL').first<{ n: number }>();
  expect(left!.n).toBe(5);
});

test('an empty Tiingo response sets refreshed_on only', async () => {
  await seedTickers([['TSTA', 0, '2026-10-22', '2026-10-01']]);
  await refresh(testEnv(), NIGHT, stub({}).fetchFn);
  expect(await tickerRow('TSTA')).toEqual({ last_date: '2026-10-22', refreshed_on: '2026-10-24' });
});

test('FX is not fetched outside the 22:00 UTC run', async () => {
  const s = stub({});
  const out = await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.calls.filter((r) => r.url.includes('frankfurter'))).toHaveLength(0);
  expect(out.fxUpdated).toBe(false);
});

test('the 22:00 UTC run fetches FX from the day after the last fx date to today and appends it', async () => {
  await env.DB.prepare('INSERT INTO fx (year, rows) VALUES (?,?)').bind(2026, '[["2026-10-21","1.29"]]').run();
  const s = stub({}, { amount: 1, base: 'USD', rates: { '2026-10-22': { SGD: 1.2912 }, '2026-10-23': { SGD: 1.2905 } } });
  const out = await refresh(testEnv(), FX_HOUR, s.fetchFn);
  const fxCalls = s.calls.filter((r) => r.url.includes('frankfurter'));
  expect(fxCalls).toHaveLength(1);
  expect(fxCalls[0].url).toContain('2026-10-22');
  expect(fxCalls[0].url).toContain('2026-10-24');
  expect(await fxRows(2026)).toEqual([
    ['2026-10-21', '1.29'],
    ['2026-10-22', '1.2912'],
    ['2026-10-23', '1.2905'],
  ]);
  expect(out.fxUpdated).toBe(true);
});

test('with no fx stored, the FX backfill starts at 2005-01-01', async () => {
  const s = stub({}, { amount: 1, base: 'USD', rates: {} });
  await refresh(testEnv(), FX_HOUR, s.fetchFn);
  const fxCall = s.calls.find((r) => r.url.includes('frankfurter'))!;
  expect(fxCall.url).toContain('2005-01-01');
});

test.each([
  ['HTTP 429', () => new Response('slow down', { status: 429 })],
  ['HTTP 500', () => new Response('oops', { status: 500 })],
  ['a network error', () => { throw new TypeError('network'); }],
])('%s stops the run and leaves later tickers untouched', async (_name, fail: Route) => {
  await seedTickers([
    ['TSTA', 2, null, null],
    ['TSTB', 1, null, null],
    ['TSTC', 0, null, null],
  ]);
  const s = stub({ TSTA: () => Response.json([item('2026-10-23', 10)]), TSTB: fail });
  const out = await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual(['TSTA', 'TSTB']);
  expect(out.stoppedOn).toBe('TSTB');
  expect(await tickerRow('TSTB')).toEqual({ last_date: null, refreshed_on: null });
  expect(await tickerRow('TSTC')).toEqual({ last_date: null, refreshed_on: null });
});

test('a 404 sets refreshed_on and the run continues', async () => {
  await seedTickers([
    ['TSTA', 1, null, null],
    ['TSTB', 0, null, null],
  ]);
  const s = stub({ TSTA: () => new Response('not found', { status: 404 }) });
  const out = await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(await tickerRow('TSTA')).toEqual({ last_date: null, refreshed_on: '2026-10-24' });
  expect(s.tiingoTickers()).toEqual(['TSTA', 'TSTB']);
  expect(out.stoppedOn).toBeUndefined();
});

// Task 20, spec 9.3 step 4 and 10.8: queued ticker requests are fetched first, within the same 45-call budget.
describe('queued ticker requests', () => {
  const clearRequests = () => env.DB.prepare('DELETE FROM ticker_requests').run();
  beforeEach(clearRequests);
  afterEach(clearRequests);

  async function seedRequests(rows: [ticker: string, requestedOn: string, status: string][]) {
    for (const [t, on, status] of rows) {
      await env.DB.prepare('INSERT INTO ticker_requests (ticker, requested_on, status) VALUES (?,?,?)').bind(t, on, status).run();
    }
  }
  const requestRow = (t: string) =>
    env.DB.prepare('SELECT status, resolved_on FROM ticker_requests WHERE ticker = ?').bind(t).first<{ status: string; resolved_on: string | null }>();

  test('queued requests are fetched oldest first, before allowlist refreshes', async () => {
    await seedTickers([['TSTA', 1, null, null]]);
    await seedRequests([
      ['QNEW2', '2026-10-20', 'queued'],
      ['QNEW1', '2026-10-10', 'queued'],
      ['QDONE', '2026-10-01', 'added'],
      ['QGONE', '2026-10-01', 'not_found'],
    ]);
    const s = stub({});
    await refresh(testEnv(), NIGHT, s.fetchFn);
    expect(s.tiingoTickers()).toEqual(['QNEW1', 'QNEW2', 'TSTA']);
  });

  test('queued requests and refreshes share the 45-call budget', async () => {
    await seedRequests(Array.from({ length: 40 }, (_, i) => [`Q${String(i).padStart(2, '0')}`, '2026-10-01', 'queued'] as [string, string, string]));
    await seedTickers(Array.from({ length: 10 }, (_, i) => [`T${i}`, 0, null, null] as [string, number, null, null]));
    const s = stub({});
    await refresh(testEnv(), NIGHT, s.fetchFn);
    const called = s.tiingoTickers();
    expect(called).toHaveLength(45);
    expect(called.slice(0, 40).every((t) => t.startsWith('Q'))).toBe(true);
  });

  test('more than 45 queued requests leave the rest queued', async () => {
    await seedRequests(Array.from({ length: 50 }, (_, i) => [`Q${String(i).padStart(2, '0')}`, '2026-10-01', 'queued'] as [string, string, string]));
    await refresh(testEnv(), NIGHT, stub({}).fetchFn);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM ticker_requests WHERE status = 'queued'").first<{ n: number }>();
    expect(left!.n).toBe(5);
  });

  test('a queued ticker is backfilled from 2005-01-01', async () => {
    await seedRequests([['QNEW', '2026-10-20', 'queued']]);
    const s = stub({});
    await refresh(testEnv(), NIGHT, s.fetchFn);
    expect(new URL(s.calls[0].url).searchParams.get('startDate')).toBe('2005-01-01');
  });

  test('a 404 marks the request not_found and does not add the ticker', async () => {
    await seedRequests([['QNEW', '2026-10-20', 'queued']]);
    await refresh(testEnv(), NIGHT, stub({ QNEW: () => new Response('not found', { status: 404 }) }).fetchFn);
    expect(await requestRow('QNEW')).toEqual({ status: 'not_found', resolved_on: '2026-10-24' });
    expect(await tickerRow('QNEW')).toBeNull();
  });

  test('a successful fetch marks the request added', async () => {
    await seedRequests([['QNEW', '2026-10-20', 'queued']]);
    await refresh(testEnv(), NIGHT, stub({ QNEW: () => Response.json([item('2026-10-23', 10)]) }).fetchFn);
    expect(await requestRow('QNEW')).toEqual({ status: 'added', resolved_on: '2026-10-24' });
  });

  test('a successful fetch adds the ticker to the allowlist with priority 0', async () => {
    await seedRequests([['QNEW', '2026-10-20', 'queued']]);
    await refresh(testEnv(), NIGHT, stub({ QNEW: () => Response.json([item('2026-10-23', 10)]) }).fetchFn);
    const row = await env.DB.prepare('SELECT priority, last_date, refreshed_on FROM tickers WHERE ticker = ?').bind('QNEW').first();
    expect(row).toEqual({ priority: 0, last_date: '2026-10-23', refreshed_on: '2026-10-24' });
  });

  test('a successful fetch writes the prices', async () => {
    await seedRequests([['QNEW', '2026-10-20', 'queued']]);
    await refresh(testEnv(), NIGHT, stub({ QNEW: () => Response.json([item('2026-10-23', 10)]) }).fetchFn);
    expect(await yearRows('QNEW', 2026)).toEqual([['2026-10-23', '10', '1', '0']]);
  });

  test('HTTP 429 on a queued ticker stops the run and leaves it queued', async () => {
    await seedTickers([['TSTA', 1, null, null]]);
    await seedRequests([['QNEW', '2026-10-20', 'queued']]);
    const s = stub({ QNEW: () => new Response('slow down', { status: 429 }) });
    const out = await refresh(testEnv(), NIGHT, s.fetchFn);
    expect(out.stoppedOn).toBe('QNEW');
    expect(s.tiingoTickers()).toEqual(['QNEW']);
    expect(await requestRow('QNEW')).toEqual({ status: 'queued', resolved_on: null });
  });
});
