import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { appendYearRows, lastTradingDay, refresh, takeBudget } from './refresh';

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

// lastUsed defaults to the NIGHT date, so priority 0 tickers are cron candidates unless a test says otherwise.
async function seedTickers(
  rows: [ticker: string, priority: number, lastDate: string | null, refreshedOn: string | null, lastUsed?: string | null][],
) {
  for (const [t, p, l, r, u] of rows) {
    await env.DB.prepare('INSERT INTO tickers (ticker, priority, last_date, refreshed_on, added_on, last_used) VALUES (?,?,?,?,?,?)')
      .bind(t, p, l, r, '2026-01-01', u === undefined ? '2026-10-24' : u)
      .run();
  }
}
const hourKey = (d: Date) => d.toISOString().slice(0, 13);
const setBudget = (d: Date, used: number) =>
  env.DB.prepare('INSERT OR REPLACE INTO budget (hour, used) VALUES (?, ?)').bind(hourKey(d), used).run();
const budgetUsed = async (d: Date) =>
  (await env.DB.prepare('SELECT used FROM budget WHERE hour = ?').bind(hourKey(d)).first<{ used: number }>())?.used;
const lastUsed = async (t: string) =>
  (await env.DB.prepare('SELECT last_used FROM tickers WHERE ticker = ?').bind(t).first<{ last_used: string | null }>())?.last_used;
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
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tickers'),
    env.DB.prepare('DELETE FROM prices'),
    env.DB.prepare('DELETE FROM fx'),
    env.DB.prepare('DELETE FROM budget'),
  ]);
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

// Task 43, spec 19.5: two Workers can fetch the same ticker at once, so rows already stored are skipped.
test('appendYearRows skips rows dated on or before the last stored row', () => {
  const out = appendYearRows('[["2020-01-02","1","1","0"],["2020-01-03","2","1","0"]]', [
    ['2020-01-03', '2', '1', '0'],
    ['2020-01-06', '3', '1', '0'],
  ]);
  expect(JSON.parse(out)).toEqual([
    ['2020-01-02', '1', '1', '0'],
    ['2020-01-03', '2', '1', '0'],
    ['2020-01-06', '3', '1', '0'],
  ]);
});

test('appendYearRows with every row already stored returns the stored text unchanged', () => {
  const stored = '[["2020-01-02","1","1","0"],["2020-01-03","2","1","0"]]';
  expect(appendYearRows(stored, [['2020-01-02', '1', '1', '0'], ['2020-01-03', '2', '1', '0']])).toBe(stored);
});

// Task 43, spec 19.3: now minus 22 hours, stepped back over weekends.
test.each([
  ['2026-10-23T21:59:00Z', '2026-10-22'],
  ['2026-10-23T22:00:00Z', '2026-10-23'],
  ['2026-10-24T10:00:00Z', '2026-10-23'],
  ['2026-10-26T10:00:00Z', '2026-10-23'],
  ['2026-10-26T22:30:00Z', '2026-10-26'],
  ['2026-10-25T23:00:00Z', '2026-10-23'],
])('lastTradingDay(%s) is %s', (now, day) => {
  expect(lastTradingDay(new Date(now))).toBe(day);
});

// Task 43, spec 19.4: one budget row per UTC hour, 40 calls.
test('takeBudget allows 40 calls in an hour and refuses the 41st', async () => {
  for (let i = 0; i < 40; i++) expect(await takeBudget(env.DB, NIGHT)).toBe(true);
  expect(await takeBudget(env.DB, NIGHT)).toBe(false);
  expect(await budgetUsed(NIGHT)).toBe(40);
});

test('takeBudget starts again in the next hour', async () => {
  for (let i = 0; i < 40; i++) await takeBudget(env.DB, NIGHT);
  expect(await takeBudget(env.DB, new Date(NIGHT.getTime() + 3_600_000))).toBe(true);
});

test('budget shared: calls made on demand earlier in the hour reduce the cron run', async () => {
  await setBudget(NIGHT, 35);
  await seedTickers(Array.from({ length: 10 }, (_, i) => [`P${i}`, 1, null, null] as [string, number, null, null]));
  const s = stub({});
  const out = await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toHaveLength(5);
  expect(out.stoppedOn).toBeUndefined();
});

test('a cron call that fails still counts toward the budget', async () => {
  await seedTickers([['TSTA', 0, null, null]]);
  await refresh(testEnv(), NIGHT, stub({ TSTA: () => new Response('oops', { status: 500 }) }).fetchFn);
  expect(await budgetUsed(NIGHT)).toBe(1);
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

// Task 44, spec 19.8: priority 1 always, other tickers only when used in the last 30 days.
test('priority 1 first, then never-refreshed, then oldest refreshed_on; today is skipped', async () => {
  await seedTickers([
    ['OLD2', 0, '2026-10-01', '2026-10-10'],
    ['TODAY', 1, '2026-10-23', '2026-10-24'],
    ['OLD1', 0, '2026-10-01', '2026-10-01'],
    ['NEW', 0, null, null],
    ['PRIO', 1, '2026-10-01', '2026-10-20'],
    ['UNUSED', 0, '2026-08-31', '2026-09-01', null],
  ]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual(['PRIO', 'NEW', 'OLD1', 'OLD2']);
});

test('30-day window: a ticker last used 30 days ago is refreshed, 31 days ago is not', async () => {
  await seedTickers([
    ['D30', 0, '2026-09-30', '2026-10-01', '2026-09-24'],
    ['D31', 0, '2026-09-30', '2026-10-01', '2026-09-23'],
  ]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual(['D30']);
});

// Spec 19.8: NIGHT is Saturday 2026-10-24, so the last trading day is Friday 2026-10-23.
test('a ticker that already has the last trading day is not a candidate', async () => {
  await seedTickers([
    ['DONE', 0, '2026-10-23', '2026-10-20'],
    ['BEHIND', 0, '2026-10-22', '2026-10-20'],
  ]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual(['BEHIND']);
});

test('NULL last_used is not refreshed', async () => {
  await seedTickers([['TSTA', 0, null, null, null]]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual([]);
});

test('priority 1 always: refreshed with NULL last_used', async () => {
  await seedTickers([['PRIO', 1, null, null, null]]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual(['PRIO']);
});

test('priority 1 comes before a used ticker with an older refreshed_on', async () => {
  await seedTickers([
    ['USED', 0, '2026-08-31', '2026-09-01', '2026-10-24'],
    ['PRIO', 1, '2026-10-19', '2026-10-20', null],
  ]);
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toEqual(['PRIO', 'USED']);
});

// Spec 19.13: at 480 symbols this month the cron fetches only tickers already refreshed this month.
describe('monthly symbol cap', () => {
  const clearRequests = () => env.DB.prepare('DELETE FROM ticker_requests').run();
  beforeEach(clearRequests);
  afterEach(clearRequests);
  // n requests answered not_found this month, each one symbol used.
  const useSymbols = (n: number) =>
    env.DB.batch(
      Array.from({ length: n }, (_, i) =>
        env.DB.prepare("INSERT INTO ticker_requests (ticker, requested_on, status, resolved_on) VALUES (?, '2026-10-02', 'not_found', '2026-10-02')").bind(`N${i}`),
      ),
    );

  test('at the cap a new symbol and a queued request are skipped; a symbol refreshed this month is fetched', async () => {
    await useSymbols(479);
    await seedTickers([
      ['THIS', 0, '2026-10-20', '2026-10-01'], // refreshed this month: the 480th symbol
      ['LAST', 0, '2026-09-29', '2026-09-30'],
      ['NEW', 0, null, null],
    ]);
    await env.DB.prepare("INSERT INTO ticker_requests (ticker, requested_on, status) VALUES ('QNEW', '2026-10-20', 'queued')").run();
    const s = stub({});
    await refresh(testEnv(), NIGHT, s.fetchFn);
    expect(s.tiingoTickers()).toEqual(['THIS']);
  });

  test('not_found rows alone reach the cap', async () => {
    await useSymbols(480);
    await seedTickers([['NEW', 0, null, null]]);
    const s = stub({});
    await refresh(testEnv(), NIGHT, s.fetchFn);
    expect(s.tiingoTickers()).toEqual([]);
  });

  test('a fetch that reaches the cap during the run stops further new symbols', async () => {
    await useSymbols(478);
    await seedTickers([
      ['THIS', 0, '2026-10-20', '2026-10-01'],
      ['LAST', 0, '2026-09-29', '2026-09-30'],
      ['NEW', 0, null, null],
    ]);
    const s = stub({});
    await refresh(testEnv(), NIGHT, s.fetchFn);
    expect(s.tiingoTickers()).toEqual(['NEW', 'THIS']);
  });
});

test('at most 40 Tiingo calls are made in one run', async () => {
  await seedTickers(Array.from({ length: 50 }, (_, i) => [`T${String(i).padStart(2, '0')}`, 0, null, null] as [string, number, null, null]));
  const s = stub({});
  await refresh(testEnv(), NIGHT, s.fetchFn);
  expect(s.tiingoTickers()).toHaveLength(40);
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM tickers WHERE refreshed_on IS NULL').first<{ n: number }>();
  expect(left!.n).toBe(10);
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

// Task 20, spec 9.3 step 4 and 10.8: queued ticker requests are fetched first, within the same 40-call budget (spec 19.4).
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

  test('queued requests and refreshes share the 40-call budget', async () => {
    await seedRequests(Array.from({ length: 39 }, (_, i) => [`Q${String(i).padStart(2, '0')}`, '2026-10-01', 'queued'] as [string, string, string]));
    await seedTickers(Array.from({ length: 10 }, (_, i) => [`T${i}`, 0, null, null] as [string, number, null, null]));
    const s = stub({});
    await refresh(testEnv(), NIGHT, s.fetchFn);
    const called = s.tiingoTickers();
    expect(called).toHaveLength(40);
    expect(called.slice(0, 39).every((t) => t.startsWith('Q'))).toBe(true);
  });

  test('more than 40 queued requests leave the rest queued', async () => {
    await seedRequests(Array.from({ length: 50 }, (_, i) => [`Q${String(i).padStart(2, '0')}`, '2026-10-01', 'queued'] as [string, string, string]));
    await refresh(testEnv(), NIGHT, stub({}).fetchFn);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM ticker_requests WHERE status = 'queued'").first<{ n: number }>();
    expect(left!.n).toBe(10);
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

