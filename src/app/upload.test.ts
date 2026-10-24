import { describe, expect, test, vi } from 'vitest';
import { D } from '../engine/decimal';
import MOOMOO from '../importers/fixtures/moomoo-sample.csv?raw';
import { combineFiles } from './combine';
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
      { line: null, code: 'unsupported_tickers', message: 'These tickers are not supported yet: XYZ, ZZZ.', tickers: ['XYZ', 'ZZZ'] },
      { line: null, code: 'prices_not_loaded', message: 'Prices for ABC, QRS are not loaded yet. Try again tomorrow.', tickers: ['ABC', 'QRS'] },
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

// Task 32, spec 16.5: the spec 16.4 ledger with ZZZ unavailable.
const PARTIAL = [
  HEADER,
  '2024-01-02,DEPOSIT,,,,SGD,2754,0',
  '2024-01-02,FX,USD,2040,,SGD,2754,0',
  '2024-01-02,BUY,AAPL,5,200,USD,1000,0',
  '2024-01-02,BUY,ZZZ,10,100,USD,1000,2',
  '2024-03-01,SELL,ZZZ,4,110,USD,440,2',
  '2024-03-15,DIVIDEND,ZZZ,,,USD,10,1.5',
];
const partialBody = (unavailable: { ticker: string; reason: string }[] = [{ ticker: 'ZZZ', reason: 'no_data_yet' }]) => ({
  asOf: '2024-03-31',
  prices: {
    AAPL: [
      ['2024-01-02', '200', '1', '0'],
      ['2024-03-28', '220', '1', '0'],
    ],
  },
  fx: [
    ['2024-01-02', '1.35'],
    ['2024-03-01', '1.34'],
  ],
  unavailable,
});
const result = (out: Awaited<ReturnType<typeof runUpload>>) => {
  if (out.kind !== 'result') throw new Error('expected result, got ' + JSON.stringify(out));
  return out;
};

test('without exclude, an unavailable ticker rejects with prices_not_loaded carrying its tickers', async () => {
  expect(await runUpload(PARTIAL.join('\n'), stubFetch(partialBody()))).toEqual({
    kind: 'rejected',
    rejected: [{ line: null, code: 'prices_not_loaded', message: 'Prices for ZZZ are not loaded yet. Try again tomorrow.', tickers: ['ZZZ'] }],
  });
});

// Task 39, spec 18.1.1: the ZZZ cash flows written as USD DEPOSIT and WITHDRAW rows in a plain file.
test('the spec 16.4 ledger written with USD flows computes from a plain file', async () => {
  const csv = [
    HEADER,
    ...PARTIAL.slice(1, 4),
    '2024-01-02,WITHDRAW,,,,USD,1002,0',
    '2024-03-01,DEPOSIT,,,,USD,438,0',
    '2024-03-15,DEPOSIT,,,,USD,8.5,0',
  ].join('\n');
  const last = result(await runUpload(csv, stubFetch(partialBody([])))).result.series.at(-1)!;
  expect([last.netInvestedSgd.toFixed(2), last.valueSgd.toFixed(2)]).toEqual(['1999.61', '2123.23']);
});

test('with exclude ZZZ, the result names ZZZ as excluded', async () => {
  const out = result(await runUpload(PARTIAL.join('\n'), stubFetch(partialBody()), 'start', ['ZZZ']));
  expect(out.excluded?.tickers).toEqual(['ZZZ']);
});

test('with exclude ZZZ, the share of what was bought is 0.5004995005', async () => {
  const out = result(await runUpload(PARTIAL.join('\n'), stubFetch(partialBody()), 'start', ['ZZZ']));
  expect(out.excluded?.share.toFixed(10)).toBe('0.5004995005');
});

test('with exclude ZZZ, net invested at the end is 1999.61', async () => {
  const out = result(await runUpload(PARTIAL.join('\n'), stubFetch(partialBody()), 'start', ['ZZZ']));
  expect(out.result.series.at(-1)!.netInvestedSgd.toFixed(10)).toBe('1999.6100000000');
});

test('an unavailable ticker not in exclude still rejects, naming only that ticker', async () => {
  const csv = [...PARTIAL, '2024-01-02,BUY,YYY,1,10,USD,10,0'].join('\n');
  const body = partialBody([
    { ticker: 'YYY', reason: 'no_data_yet' },
    { ticker: 'ZZZ', reason: 'no_data_yet' },
  ]);
  expect(await runUpload(csv, stubFetch(body), 'start', ['ZZZ'])).toEqual({
    kind: 'rejected',
    rejected: [{ line: null, code: 'prices_not_loaded', message: 'Prices for YYY are not loaded yet. Try again tomorrow.', tickers: ['YYY'] }],
  });
});

test('with nothing unavailable and no exclude, excluded is null', async () => {
  expect(result(await runUpload(GOLDEN_A, stubFetch(goldenBody()))).excluded).toBeNull();
});

describe('two canonical files split on 2024-03-01, with exclude ZZZ', () => {
  const files = [
    { name: 'a.csv', text: PARTIAL.slice(0, 5).join('\n') },
    {
      name: 'b.csv',
      text: [
        HEADER,
        '2024-03-01,OPENING,AAPL,5,200,USD,1000,0',
        '2024-03-01,OPENING,ZZZ,10,100,USD,1000,0',
        '2024-03-01,OPENING,,,,USD,38,0',
        ...PARTIAL.slice(5),
      ].join('\n'),
    },
  ];
  const both = async () => ({
    split: await runUpload(files, stubFetch(partialBody()), 'start', ['ZZZ']),
    single: result(await runUpload(PARTIAL.join('\n'), stubFetch(partialBody()), 'start', ['ZZZ'])),
  });

  test('gives a result, so the excluded opening position is not reconciled', async () => {
    expect((await both()).split.kind).toBe('result');
  });

  test('has the same end value, net invested and TWR as the single file', async () => {
    const { split, single } = await both();
    const nums = (o: ReturnType<typeof result>) => [
      o.result.series.at(-1)!.valueSgd.toFixed(10),
      o.result.series.at(-1)!.netInvestedSgd.toFixed(10),
      o.result.twr.value.toFixed(10),
    ];
    expect(nums(result(split))).toEqual(nums(single));
  });

  test('books no cash adjustment notice', async () => {
    expect(result((await both()).split).notices).toEqual([]);
  });
});

test('with exclude ZZZ, an engine rejection maps back to its own line', async () => {
  const csv = [...PARTIAL, '2024-03-28,SELL,AAPL,6,220,USD,1320,0'].join('\n');
  const out = await runUpload(csv, stubFetch(partialBody()), 'start', ['ZZZ']);
  expect(out).toEqual({
    kind: 'rejected',
    rejected: [{ line: 8, code: 'oversell', message: 'This sells more AAPL than is held: holding would be -1 at the end of 2024-03-28.' }],
  });
});

// A first statement with zero starting cash opens with position rows only; once excluded, that date is before the
// reduced ledger's first day, so the share cannot read its rate from the series.
test('with exclude ZZZ, an excluded opening position dated before every other row still counts in the share', async () => {
  const csv = [HEADER, '2024-01-01,OPENING,ZZZ,10,100,USD,1000,0', ...PARTIAL.slice(1, 4)].join('\n');
  const body = { ...partialBody(), fx: [['2023-12-29', '1.32'], ...partialBody().fx] };
  const out = result(await runUpload(csv, stubFetch(body), 'start', ['ZZZ']));
  // 1000 x 1.32 (rate carried from 2023-12-29) over that plus the AAPL buy, 1000 x 1.35
  expect(out.excluded?.share.toFixed(10)).toBe(D('1320').div('2670').toFixed(10));
});

test('excluding the only holding of a file rejects with nothing_left and no tickers', async () => {
  const csv = [HEADER, '2024-01-02,OPENING,ZZZ,10,100,USD,1000,0'].join('\n');
  expect(await runUpload(csv, stubFetch(partialBody()), 'start', ['ZZZ'])).toEqual({
    kind: 'rejected',
    rejected: [{ line: null, code: 'nothing_left', message: 'Excluding these holdings leaves nothing to measure.' }],
  });
});

// Task 38, spec 17.1.9: the moomoo fixture through runUpload with the spec's stub prices.
describe('the moomoo fixture computes with funding deposits', () => {
  const body = {
    asOf: '2024-03-12',
    prices: {
      AAPL: [
        ['2024-03-05', '150', '1', '0'],
        ['2024-03-08', '160', '1', '0'],
        ['2024-03-12', '170', '1', '0'],
      ],
      VOO: [
        ['2024-03-06', '400', '1', '0'],
        ['2024-03-11', '410', '1', '0'],
      ],
    },
    fx: [['2024-03-05', '1.35']],
    unavailable: [],
  };
  const run = async () => result(await runUpload([{ name: 'moomoo.csv', text: MOOMOO }], stubFetch(body)));

  test('net invested at the end is 3807.6615 (2820.49 x 1.35)', async () => {
    expect((await run()).result.series.at(-1)!.netInvestedSgd.toFixed(10)).toBe('3807.6615000000');
  });

  test('value at the end is 4050', async () => {
    expect((await run()).result.series.at(-1)!.valueSgd.toFixed(10)).toBe('4050.0000000000');
  });

  test('USD cash at the end is 0', async () => {
    expect((await run()).result.series.at(-1)!.cash.USD.toFixed(10)).toBe('0.0000000000');
  });

  test('TWR cumulative is 0.0649010829', async () => {
    expect((await run()).result.twr.value.toFixed(10)).toBe('0.0649010829');
  });

  test('XIRR is 0.0710198440', async () => {
    const x = (await run()).result.xirr;
    if (x.kind !== 'ok') throw new Error('expected ok XIRR');
    expect(x.value.toFixed(10)).toBe('0.0710198440');
  });

  test('trading fees are 13.4865 SGD (9.99 x 1.35)', async () => {
    expect((await run()).result.decomposition!.fees.toFixed(10)).toBe('13.4865000000');
  });

  test('notices include the funding notice', async () => {
    expect((await run()).notices).toContain(
      "This moomoo file lists trades only. USD 2,820.49 was counted as paid in on 3 days, each time the trades needed more USD than the file's own cash. Withdrawals and currency conversions are not in the file, so money from sales stays in the portfolio as cash.",
    );
  });
});

describe('runUpload passes the ledger before exclusion', () => {
  test('with exclude ZZZ, originalLedger holds the ZZZ BUY row', async () => {
    const out = result(await runUpload(PARTIAL.join('\n'), stubFetch(partialBody()), 'start', ['ZZZ']));
    expect(out.input.originalLedger?.some((r) => r.type === 'BUY' && r.ticker === 'ZZZ')).toBe(true);
  });

  test('with exclude ZZZ, the ledger does not hold the ZZZ BUY row', async () => {
    const out = result(await runUpload(PARTIAL.join('\n'), stubFetch(partialBody()), 'start', ['ZZZ']));
    expect(out.input.ledger.some((r) => r.type === 'BUY' && r.ticker === 'ZZZ')).toBe(false);
  });

  test('without exclude, originalLedger equals the combined rows', async () => {
    const out = result(await runUpload(GOLDEN_A, stubFetch(goldenBody())));
    const combined = combineFiles([{ name: '', text: GOLDEN_A }]);
    if ('rejected' in combined) throw new Error('expected rows');
    expect(out.input.originalLedger).toEqual(combined.rows);
  });
});
