import { env, exports } from 'cloudflare:workers';
import { beforeEach, expect, test } from 'vitest';
import { DAILY_CLIENT_REQUESTS } from './requests';
import { MONTHLY_NEW_TICKERS, TOTAL_TICKERS } from '../src/engine/constants';

// Spec 10.8 and checkpoint 1 decision 12: POST /api/ticker-requests, monthly cap of 90 new tickers,
// per-client daily cap counted by a hashed IP in D1. No network calls: the endpoint only touches D1.

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

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ticker_requests'),
    env.DB.prepare("DELETE FROM tickers WHERE ticker = 'TSTR'"),
    env.DB.prepare("INSERT INTO tickers (ticker, priority, added_on) VALUES ('TSTR', 0, '2026-01-01')"),
  ]);
});

test('a new ticker is queued', async () => {
  expect(await json({ tickers: ['NEWA'] })).toEqual({ results: [{ ticker: 'NEWA', status: 'queued' }], availableFrom: null });
});

test('a queued ticker is stored with status queued and today as requested_on', async () => {
  await post({ tickers: ['NEWA'] });
  const row = await env.DB.prepare('SELECT requested_on, status, resolved_on FROM ticker_requests WHERE ticker = ?').bind('NEWA').first();
  expect(row).toEqual({ requested_on: today(), status: 'queued', resolved_on: null });
});

test('requesting the same ticker again gives already_queued', async () => {
  await post({ tickers: ['NEWA'] });
  expect((await json({ tickers: ['NEWA'] })).results).toEqual([{ ticker: 'NEWA', status: 'already_queued' }]);
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

test('one client is limited after DAILY_CLIENT_REQUESTS requests in a day', async () => {
  const ip = randomIp();
  for (let i = 0; i < DAILY_CLIENT_REQUESTS; i++) expect((await post({ tickers: ['NEWA'] }, ip)).status).toBe(200);
  const res = await post({ tickers: ['NEWA'] }, ip);
  expect(res.status).toBe(429);
  expect(((await res.json()) as any).error).toBe('too_many_requests');
});

test('the daily limit of one client does not affect another', async () => {
  const ip = randomIp();
  for (let i = 0; i <= DAILY_CLIENT_REQUESTS; i++) await post({ tickers: ['NEWA'] }, ip);
  expect((await post({ tickers: ['NEWA'] }, randomIp())).status).toBe(200);
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

// Tiingo's free plan allows 500 distinct symbols a month and every ticker on the list is fetched nightly,
// so the list (tickers plus queued requests) stops growing at TOTAL_TICKERS.
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM tickers WHERE ticker LIKE 'ZZ%'").run();
});

// Pads the tickers table with synthetic ZZ rows until it holds exactly n rows.
async function fillTickers(n: number) {
  const have = (await env.DB.prepare('SELECT COUNT(*) AS n FROM tickers').first<{ n: number }>())!.n;
  const stmts = Array.from({ length: n - have }, (_, i) =>
    env.DB.prepare("INSERT INTO tickers (ticker, priority, added_on) VALUES (?, 0, '2026-01-01')").bind(`ZZ${String(i).padStart(3, '0')}`),
  );
  if (stmts.length) await env.DB.batch(stmts);
}

test('with the list one short of TOTAL_TICKERS, the first new ticker is queued and the second is list_full', async () => {
  await seedRequests(1, lastMonth());
  await fillTickers(TOTAL_TICKERS - 2);
  expect(await json({ tickers: ['NEWA', 'NEWB'] })).toEqual({
    results: [
      { ticker: 'NEWA', status: 'queued' },
      { ticker: 'NEWB', status: 'list_full' },
    ],
    availableFrom: null,
  });
});

test('with the list at TOTAL_TICKERS, a new ticker is list_full and not stored', async () => {
  await fillTickers(TOTAL_TICKERS);
  expect((await json({ tickers: ['NEWA'] })).results).toEqual([{ ticker: 'NEWA', status: 'list_full' }]);
  const row = await env.DB.prepare('SELECT 1 FROM ticker_requests WHERE ticker = ?').bind('NEWA').first();
  expect(row).toBeNull();
});

test('with the list at TOTAL_TICKERS, available and queued tickers keep their status', async () => {
  await seedRequests(1, today());
  await fillTickers(TOTAL_TICKERS - 1);
  expect((await json({ tickers: ['TSTR', 'Q000'] })).results).toEqual([
    { ticker: 'TSTR', status: 'already_available' },
    { ticker: 'Q000', status: 'already_queued' },
  ]);
});

test('when both the monthly cap and the list cap apply, the status is limit_reached', async () => {
  await seedRequests(MONTHLY_NEW_TICKERS, today());
  await fillTickers(TOTAL_TICKERS);
  expect((await json({ tickers: ['NEWA'] })).results).toEqual([{ ticker: 'NEWA', status: 'limit_reached' }]);
});

test('the UI shows the list_full message', async () => {
  const src = await import('../src/app/RequestTickers.tsx?raw');
  expect(src.default).toContain('The ticker list is full for now. More cannot be added until some are retired.');
});
