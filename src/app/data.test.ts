import { expect, test, vi } from 'vitest';
import { fetchPrices, loadSample } from './data';

// Stub /api/prices body: a bar and an FX point on every calendar day, so any ledger
// that only buys with cash it has computes ok without depending on real closes.
function everyDayBody(from: string, to: string) {
  const bars: [string, string, string, string][] = [];
  const fx: [string, string][] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    bars.push([d, '100', '1', '0']);
    fx.push([d, '1.35']);
  }
  return { asOf: to, prices: { AAPL: bars, VOO: bars }, fx, unavailable: [] };
}

const stubFetch = (body: unknown, status = 200) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body, { status }));

test('fetchPrices requests /api/prices with the tickers and from date', async () => {
  const fetchFn = stubFetch(everyDayBody('2020-01-01', '2020-01-03'));
  await fetchPrices(['AAPL', 'VOO'], '2019-01-02', fetchFn);
  expect(String(fetchFn.mock.calls[0][0])).toBe('/api/prices?tickers=AAPL,VOO&from=2019-01-02');
});

test('fetchPrices returns the response body', async () => {
  const body = everyDayBody('2020-01-01', '2020-01-03');
  const res = await fetchPrices(['AAPL', 'VOO'], '2019-01-02', stubFetch(body));
  expect(res.asOf).toBe('2020-01-03');
});

test('fetchPrices rejects when the API answers with an error status', async () => {
  const fetchFn = stubFetch({ error: 'internal' }, 500);
  await expect(fetchPrices(['AAPL'], '2019-01-02', fetchFn)).rejects.toThrow();
});

test('loadSample fetches AAPL and VOO prices once from 2019-01-02', async () => {
  const fetchFn = stubFetch(everyDayBody('2018-01-01', '2025-06-30'));
  await loadSample(fetchFn);
  expect(fetchFn).toHaveBeenCalledOnce();
  expect(String(fetchFn.mock.calls[0][0])).toBe('/api/prices?tickers=AAPL,VOO&from=2019-01-02');
});

test('loadSample computes the sample to the fixed end date 2025-06-30', async () => {
  const res = await loadSample(stubFetch(everyDayBody('2018-01-01', '2025-06-30')));
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  expect(res.series.at(-1)!.date).toBe('2025-06-30');
});

test('loadSample returns the asOf date from the API', async () => {
  const res = await loadSample(stubFetch(everyDayBody('2018-01-01', '2025-06-30')));
  expect(res.asOf).toBe('2025-06-30');
});

// Task 25, spec 15.1.3: an empty price cache is a state, not an error.
test('loadSample resolves { kind: "empty" } when the API answers asOf null', async () => {
  const body = {
    asOf: null,
    prices: {},
    fx: [],
    unavailable: [
      { ticker: 'AAPL', reason: 'no_data_yet' },
      { ticker: 'VOO', reason: 'no_data_yet' },
    ],
  };
  expect(await loadSample(stubFetch(body))).toEqual({ kind: 'empty' });
});

test('loadSample still rejects when the API answers HTTP 500', async () => {
  await expect(loadSample(stubFetch({ error: 'internal' }, 500))).rejects.toThrow();
});
