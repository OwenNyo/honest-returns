import { expect, test, vi } from 'vitest';
import { runUpload } from './upload';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';
const GOLDEN_A = [
  HEADER,
  '2020-08-28,DEPOSIT,,,,SGD,1400,0',
  '2020-08-28,FX,USD,1000,,SGD,1360,0',
  '2020-08-28,BUY,AAPL,2,500,USD,1000,0',
  '2020-08-31,DEPOSIT,,,,SGD,600,0',
  '2020-09-01,WITHDRAW,,,,SGD,100,0',
].join('\n');

// Golden A market data (spec 7) in the /api/prices format (spec 9.2).
const goldenBody = (asOf = '2020-09-01') => ({
  asOf,
  prices: {
    AAPL: [
      ['2020-08-28', '500', '1', '0'],
      ['2020-08-31', '130', '4', '0'],
      ['2020-09-01', '135', '1', '0'],
    ],
  },
  fx: [
    ['2020-08-28', '1.36'],
    ['2020-08-31', '1.37'],
    ['2020-09-01', '1.35'],
  ],
  unavailable: [],
});

const stubFetch = (body: unknown) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body));

test('parse rejections come back without calling the prices API', async () => {
  const fetchFn = stubFetch(goldenBody());
  const out = await runUpload('date,type\n2020-08-28,DEPOSIT', fetchFn);
  expect(out).toEqual({
    kind: 'rejected',
    rejected: [
      { line: null, code: 'bad_header', message: 'The first line must be: date,type,ticker,quantity,price,currency,amount,fees' },
    ],
  });
  expect(fetchFn).not.toHaveBeenCalled();
});

test('unavailable tickers produce unsupported_tickers and prices_not_loaded with sorted lists', async () => {
  const csv = [
    HEADER,
    '2020-08-28,DEPOSIT,,,,SGD,1400,0',
    '2020-08-28,FX,USD,1000,,SGD,1360,0',
    '2020-08-28,BUY,ZZZ,1,10,USD,10,0',
    '2020-08-28,BUY,XYZ,1,10,USD,10,0',
    '2020-08-28,BUY,QRS,1,10,USD,10,0',
    '2020-08-28,BUY,ABC,1,10,USD,10,0',
  ].join('\n');
  const body = {
    asOf: null,
    prices: {},
    fx: [],
    unavailable: [
      { ticker: 'ZZZ', reason: 'not_on_allowlist' },
      { ticker: 'QRS', reason: 'no_data_yet' },
      { ticker: 'XYZ', reason: 'not_on_allowlist' },
      { ticker: 'ABC', reason: 'no_data_yet' },
    ],
  };
  const out = await runUpload(csv, stubFetch(body));
  expect(out).toEqual({
    kind: 'rejected',
    rejected: [
      { line: null, code: 'unsupported_tickers', message: 'These tickers are not supported yet: XYZ, ZZZ.' },
      { line: null, code: 'prices_not_loaded', message: 'Prices for ABC, QRS are not loaded yet. Try again tomorrow.' },
    ],
  });
});

test('a row dated after asOf is rejected with after_as_of naming asOf', async () => {
  const out = await runUpload(GOLDEN_A, stubFetch(goldenBody('2020-08-31')));
  expect(out).toEqual({
    kind: 'rejected',
    rejected: [{ line: 6, code: 'after_as_of', message: 'date is after the latest available prices (2020-08-31).' }],
  });
});

test('a clean Golden A upload computes to endDate = asOf', async () => {
  const out = await runUpload(GOLDEN_A, stubFetch(goldenBody()));
  if (out.kind !== 'result') throw new Error('expected result, got ' + JSON.stringify(out));
  expect(out.asOf).toBe('2020-09-01');
  expect(out.tickers).toEqual(['AAPL']);
  expect(out.result.series.at(-1)!.date).toBe('2020-09-01');
});

test('a clean upload reports start-of-day TWR by default', async () => {
  const out = await runUpload(GOLDEN_A, stubFetch(goldenBody()));
  if (out.kind !== 'result') throw new Error('expected result, got ' + JSON.stringify(out));
  expect(out.result.twr.value.toFixed(10)).toBe('0.0498448697');
});

test('end-of-day timing changes the TWR', async () => {
  const out = await runUpload(GOLDEN_A, stubFetch(goldenBody()), 'end');
  if (out.kind !== 'result') throw new Error('expected result, got ' + JSON.stringify(out));
  expect(out.result.twr.value.toFixed(10)).toBe('0.0631089832');
});

test('more than 50 distinct tickers is rejected before the prices API is called', async () => {
  const fetchFn = stubFetch(goldenBody());
  const buys = Array.from({ length: 51 }, (_, i) => `2020-08-28,BUY,T${i},1,1,USD,1,0`);
  const csv = [HEADER, '2020-08-28,DEPOSIT,,,,SGD,1400,0', '2020-08-28,FX,USD,1000,,SGD,1360,0', ...buys].join('\n');
  expect(await runUpload(csv, fetchFn)).toEqual({
    kind: 'rejected',
    rejected: [{ line: null, code: 'too_many_tickers', message: 'A file can hold at most 50 different tickers; this one has 51.' }],
  });
  expect(fetchFn).not.toHaveBeenCalled();
});

test('a file with no tickers computes from fx alone', async () => {
  const fetchFn = stubFetch({ ...goldenBody(), prices: {} });
  const csv = [HEADER, '2020-08-28,DEPOSIT,,,,SGD,1400,0', '2020-08-28,FX,USD,1000,,SGD,1360,0'].join('\n');
  const out = await runUpload(csv, fetchFn);
  expect(out.kind).toBe('result');
  expect(String(fetchFn.mock.calls[0][0])).toContain('tickers=&');
});

// Task 25, spec 15.1.3: asOf null with nothing unavailable is the empty state, not a throw.
test('asOf null with no unavailable tickers gives { kind: "empty" }', async () => {
  const csv = [HEADER, '2020-08-28,DEPOSIT,,,,SGD,1400,0', '2020-08-28,FX,USD,1000,,SGD,1360,0'].join('\n');
  const out = await runUpload(csv, stubFetch({ asOf: null, prices: {}, fx: [], unavailable: [] }));
  expect(out).toEqual({ kind: 'empty' });
});
