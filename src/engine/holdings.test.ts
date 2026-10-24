import type Decimal from 'decimal.js';
import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { compute } from './compute';
import { D } from './decimal';
import { excludeTickers } from './exclude';
import { type HoldingRow, holdingRows } from './holdings';
import { toFx, toPriceSeries } from './load-market';
import type { Ccy, ComputeInput, FlowTiming, FxPoint, LedgerRow } from './types';

// Spec 18.2: gain by holding. Each case runs compute, then holdingRows on its own input and result.
const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}
const lines = (...l: string[]) => ledger([HEADER, ...l].join('\n'));
const bar = (date: string, close: string, divCash = '0') => ({ date, close: D(close), splitFactor: D(1), divCash: D(divCash) });

function run(input: ComputeInput) {
  const res = compute(input);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  const rows = holdingRows(input.ledger, input.prices, res.series, res.dividends ?? [], res.decomposition!.totalGain);
  return { res, rows, last: res.series[res.series.length - 1] };
}

const f = (d: Decimal | null) => (d === null ? null : d.toFixed(10));
function tickerRow(rows: HoldingRow[], t: string) {
  const r = rows.find((x) => x.kind === 'ticker' && x.ticker === t);
  if (r?.kind !== 'ticker') throw new Error(`no ${t} row`);
  return r;
}
function cashRow(rows: HoldingRow[], ccy: Ccy) {
  const r = rows.find((x) => x.kind === 'cash' && x.currency === ccy);
  if (r?.kind !== 'cash') throw new Error(`no ${ccy} cash row`);
  return r;
}
function restRow(rows: HoldingRow[]) {
  const r = rows.find((x) => x.kind === 'rest');
  if (r?.kind !== 'rest') throw new Error('no rest row');
  return r;
}
function totalRow(rows: HoldingRow[]) {
  const r = rows.find((x) => x.kind === 'total');
  if (r?.kind !== 'total') throw new Error('no total row');
  return r;
}
const tick = (rows: HoldingRow[], t: string) => {
  const r = tickerRow(rows, t);
  return { shares: r.shares.toFixed(), value: f(r.valueSgd), weight: f(r.weight), gain: f(r.gainSgd) };
};
const cash = (rows: HoldingRow[], ccy: Ccy) => {
  const r = cashRow(rows, ccy);
  return { value: f(r.valueSgd), weight: f(r.weight) };
};
// Every row as strings, to compare two runs.
const show = (rows: HoldingRow[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || typeof v === 'string' ? v : (v as Decimal).toFixed(10)])));

// Golden D (spec 7, 17.3.2), inline as in decompose.test.ts.
const fxD: FxPoint[] = [
  { date: '2021-06-01', sgdPerUsd: D('1.30') },
  { date: '2021-06-02', sgdPerUsd: D('1.40') },
];
const ledgerD = () =>
  lines('2021-06-01,DEPOSIT,,,,SGD,1400,0', '2021-06-01,FX,USD,1050,,SGD,1400,0', '2021-06-01,BUY,VOO,10,100,USD,1000,1');
const d1 = (): ComputeInput => ({ ledger: ledgerD(), prices: { VOO: [bar('2021-06-01', '100'), bar('2021-06-02', '110')] }, fx: fxD, endDate: '2021-06-02' });
const d2 = (flowTiming: FlowTiming = 'start', endDate = '2021-06-02'): ComputeInput => ({
  ledger: ledgerD(),
  prices: { VOO: [bar('2021-06-01', '100'), bar('2021-06-02', '110', '0.50')] },
  fx: fxD,
  endDate,
  flowTiming,
});

// Golden C1 (spec 7): a DIVIDEND row on the pay date with withholding 0.90 USD.
const c1 = (): ComputeInput => ({
  ledger: lines(
    '2021-03-25,DEPOSIT,,,,SGD,1300,0',
    '2021-03-25,FX,USD,1000,,SGD,1300,0',
    '2021-03-25,BUY,VOO,2,360,USD,720,0',
    '2021-03-31,DIVIDEND,VOO,2,1.50,USD,3.00,0.90',
  ),
  prices: {
    VOO: [bar('2021-03-25', '360'), bar('2021-03-26', '362', '1.50'), bar('2021-03-29', '362'), bar('2021-03-30', '362'), bar('2021-03-31', '365')],
  },
  fx: ['2021-03-25', '2021-03-26', '2021-03-29', '2021-03-30', '2021-03-31'].map((date) => ({ date, sgdPerUsd: D('1.30') })),
  endDate: '2021-03-31',
});

// Golden H (spec 18.2.2): VOO bought and sold, AAPL still held.
const GOLDEN_G_DATES = ['2021-06-01', '2021-06-02', '2021-06-03', '2021-06-04', '2021-06-07'];
const h = (): ComputeInput => ({
  ledger: lines(
    '2021-06-01,DEPOSIT,,,,SGD,2600,0',
    '2021-06-01,FX,USD,2000,,SGD,2600,0',
    '2021-06-01,BUY,VOO,10,100,USD,1000,1',
    '2021-06-01,BUY,AAPL,10,50,USD,500,1',
    '2021-06-03,SELL,VOO,10,120,USD,1200,1',
  ),
  prices: {
    VOO: ['100', '120', '120', '90', '108'].map((c, i) => bar(GOLDEN_G_DATES[i], c)),
    AAPL: [bar('2021-06-01', '50'), bar('2021-06-04', '55'), bar('2021-06-07', '60')],
  },
  fx: [
    { date: '2021-06-01', sgdPerUsd: D('1.30') },
    { date: '2021-06-04', sgdPerUsd: D('1.32') },
  ],
  endDate: '2021-06-07',
});

// Golden O (spec 18.2.2): an opening position valued at the carried close, not the row price.
const o = (): ComputeInput => ({
  ledger: lines('2024-01-01,OPENING,AAPL,5,190,USD,950,0', '2024-01-01,OPENING,,,,SGD,100,0'),
  prices: { AAPL: [bar('2023-12-29', '195'), bar('2024-01-31', '210')] },
  fx: [
    { date: '2023-12-29', sgdPerUsd: D('1.33') },
    { date: '2024-01-31', sgdPerUsd: D('1.34') },
  ],
  endDate: '2024-01-31',
});

// Spec 16.4 with ZZZ excluded.
const rows164 = () =>
  lines(
    '2024-01-02,DEPOSIT,,,,SGD,2754,0',
    '2024-01-02,FX,USD,2040,,SGD,2754,0',
    '2024-01-02,BUY,AAPL,5,200,USD,1000,0',
    '2024-01-02,BUY,ZZZ,10,100,USD,1000,2',
    '2024-03-01,SELL,ZZZ,4,110,USD,440,2',
    '2024-03-15,DIVIDEND,ZZZ,,,USD,10,1.5',
  );
const p164 = (): ComputeInput => {
  const original = rows164();
  return {
    ledger: excludeTickers(original, ['ZZZ']),
    prices: { AAPL: [bar('2024-01-02', '200'), bar('2024-03-28', '220')] },
    fx: [
      { date: '2024-01-02', sgdPerUsd: D('1.35') },
      { date: '2024-03-01', sgdPerUsd: D('1.34') },
    ],
    endDate: '2024-03-31',
    originalLedger: original,
  };
};

// Zero end value (spec 18.2.2).
const zero = (): ComputeInput => ({
  ledger: lines('2024-01-02,DEPOSIT,,,,SGD,100,0', '2024-01-02,WITHDRAW,,,,SGD,100,0'),
  prices: {},
  fx: [{ date: '2024-01-02', sgdPerUsd: D('1.35') }],
  endDate: '2024-01-02',
});

describe('holdingRows on Golden D', () => {
  test('D2: VOO gain is 243.6 with the ex-date dividend', () => {
    expect(tick(run(d2()).rows, 'VOO')).toEqual({ shares: '10', value: '1540.0000000000', weight: '0.9544468547', gain: '243.6000000000' });
  });

  test('D2: rows in order are VOO, SGD cash, USD cash, rest, total', () => {
    const { rows } = run(d2());
    expect(rows.map((r) => r.kind)).toEqual(['ticker', 'cash', 'cash', 'rest', 'total']);
    expect(rows.flatMap((r) => (r.kind === 'cash' ? [r.currency] : []))).toEqual(['SGD', 'USD']);
  });

  test('D2: USD cash is 73.5 and the rest is -30.1', () => {
    const { rows } = run(d2());
    expect(cash(rows, 'USD')).toEqual({ value: '73.5000000000', weight: '0.0455531453' });
    expect(cash(rows, 'SGD')).toEqual({ value: '0.0000000000', weight: '0.0000000000' });
    expect(f(restRow(rows).gainSgd)).toBe('-30.1000000000');
  });

  test('D2: total value is 1613.5 and total gain equals decomposition.totalGain exactly', () => {
    const { rows, res } = run(d2());
    const total = totalRow(rows);
    expect(total.gainSgd.eq(res.decomposition!.totalGain)).toBe(true);
    expect([f(total.valueSgd), f(total.gainSgd)]).toEqual(['1613.5000000000', '213.5000000000']);
  });

  test('D1: VOO gain is 238.7, 4.9 below D2 (the net dividend 3.5 USD x 1.40)', () => {
    const g1 = tickerRow(run(d1()).rows, 'VOO').gainSgd;
    const g2 = tickerRow(run(d2()).rows, 'VOO').gainSgd;
    expect(f(g1)).toBe('238.7000000000');
    expect(f(g2.minus(g1))).toBe('4.9000000000');
  });

  test('an ex-date after the end date adds nothing', () => {
    const { rows } = run(d2('start', '2021-06-01'));
    expect([f(tickerRow(rows, 'VOO').gainSgd), f(restRow(rows).gainSgd), f(totalRow(rows).gainSgd)]).toEqual([
      '-1.3000000000',
      '-35.0000000000',
      '-36.3000000000',
    ]);
  });
});

describe('holdingRows on Golden C, H and O', () => {
  test("C1: a DIVIDEND row adds its net amount at the pay date's rate", () => {
    const { rows } = run(c1());
    expect(tick(rows, 'VOO')).toMatchObject({ value: '949.0000000000', weight: '0.7212726015', gain: '15.7300000000' });
    expect(cash(rows, 'USD').value).toBe('366.7300000000');
    expect(f(restRow(rows).gainSgd)).toBe('0.0000000000');
  });

  test('H: a closed position shows 0 shares and its realised gain', () => {
    const { rows } = run(h());
    expect(tick(rows, 'VOO')).toEqual({ shares: '0', value: '0.0000000000', weight: '0.0000000000', gain: '257.4000000000' });
    expect(tick(rows, 'AAPL')).toEqual({ shares: '10', value: '792.0000000000', weight: '0.2612102743', gain: '140.7000000000' });
    expect(cash(rows, 'USD')).toEqual({ value: '2240.0400000000', weight: '0.7387897257' });
    expect(f(restRow(rows).gainSgd)).toBe('33.9400000000');
    expect([f(totalRow(rows).valueSgd), f(totalRow(rows).gainSgd)]).toEqual(['3032.0400000000', '432.0400000000']);
  });

  test('H: ticker rows are sorted A to Z', () => {
    expect(run(h()).rows.flatMap((r) => (r.kind === 'ticker' ? [r.ticker] : []))).toEqual(['AAPL', 'VOO']);
  });

  test("O: an OPENING position's gain counts from the statement start at the carried close", () => {
    const { rows } = run(o());
    expect(tick(rows, 'AAPL')).toEqual({ shares: '5', value: '1407.0000000000', weight: '0.9336429993', gain: '110.2500000000' });
    expect(cash(rows, 'SGD')).toEqual({ value: '100.0000000000', weight: '0.0663570007' });
    expect(f(restRow(rows).gainSgd)).toBe('0.0000000000');
  });
});

describe('holdingRows on the spec 16.4 ledger with ZZZ excluded', () => {
  test('16.4: an excluded ticker has no row', () => {
    const { rows } = run(p164());
    expect(rows.flatMap((r) => (r.kind === 'ticker' ? [r.ticker] : []))).toEqual(['AAPL']);
    expect(tick(rows, 'AAPL')).toMatchObject({ value: '1474.0000000000', weight: '0.6942253077', gain: '124.0000000000' });
    expect(cash(rows, 'USD')).toEqual({ value: '649.2300000000', weight: '0.3057746923' });
    expect(f(restRow(rows).gainSgd)).toBe('-0.3800000000');
    expect(f(totalRow(rows).gainSgd)).toBe('123.6200000000');
  });
});

const CASES: [string, () => ComputeInput][] = [
  ['D2', () => d2()],
  ['H', h],
  ['O', o],
  ['16.4', p164],
];

describe('holdingRows identities', () => {
  test.each(CASES)('ticker and cash values add up to the end value exactly (%s)', (_, input) => {
    const { rows, last } = run(input());
    const sum = rows.reduce((s, r) => (r.kind === 'ticker' || r.kind === 'cash' ? s.plus(r.valueSgd) : s), D(0));
    expect(sum.eq(last.valueSgd)).toBe(true);
  });

  test.each(CASES)('ticker gains and the rest add up to the total gain exactly (%s)', (_, input) => {
    const { rows } = run(input());
    const sum = rows.reduce((s, r) => (r.kind === 'ticker' || r.kind === 'rest' ? s.plus(r.gainSgd) : s), D(0));
    expect(sum.eq(totalRow(rows).gainSgd)).toBe(true);
  });

  test.each(CASES)('weights add up to 1 (%s)', (_, input) => {
    const { rows } = run(input());
    const sum = rows.reduce((s, r) => (r.kind === 'ticker' || r.kind === 'cash' ? s.plus(r.weight!) : s), D(0));
    expect(sum.toFixed(10)).toBe('1.0000000000');
  });

  test('a zero end value gives null weights', () => {
    const { rows } = run(zero());
    expect([cashRow(rows, 'SGD').weight, cashRow(rows, 'USD').weight]).toEqual([null, null]);
    expect([f(totalRow(rows).valueSgd), f(totalRow(rows).gainSgd)]).toEqual(['0.0000000000', '0.0000000000']);
  });

  test('flow timing has no effect (D2)', () => {
    expect(show(run(d2('end')).rows)).toEqual(show(run(d2('start')).rows));
  });
});

// The sample portfolio is a gitignored local fixture; skip when absent (as in sample.test.ts).
type RawMarket = { prices: Record<string, [string, string, string, string][]>; fx: [string, string][] };
const marketFiles = import.meta.glob<RawMarket>('./fixtures/sample-market.json', { eager: true, import: 'default' });
const ledgerFiles = import.meta.glob<string>('../sample/sample-ledger.csv', { eager: true, query: '?raw', import: 'default' });
const rawMarket = marketFiles['./fixtures/sample-market.json'];
const sampleCsv = ledgerFiles['../sample/sample-ledger.csv'];

describe.skipIf(rawMarket === undefined || sampleCsv === undefined)('holdingRows on the sample portfolio (needs local fixture)', () => {
  const sample = async (flowTiming: FlowTiming): Promise<ComputeInput> => {
    const { SAMPLE_END } = await import('../sample');
    return { ledger: ledger(sampleCsv), prices: toPriceSeries(rawMarket.prices), fx: toFx(rawMarket.fx), endDate: SAMPLE_END, flowTiming };
  };

  test('sample, start timing: AAPL, VOO, USD cash, rest and total', async () => {
    const { rows } = run(await sample('start'));
    expect(tick(rows, 'AAPL')).toEqual({ shares: '275', value: '71926.4469000000', weight: '0.5706799265', gain: '28884.9282580500' });
    expect(tick(rows, 'VOO')).toEqual({ shares: '71', value: '51412.8497240000', weight: '0.4079206267', gain: '19485.6499876430' });
    expect(cash(rows, 'USD')).toEqual({ value: '2697.1093643960', weight: '0.0213994468' });
    expect(f(restRow(rows).gainSgd)).toBe('-334.1722572970');
    expect([f(totalRow(rows).valueSgd), f(totalRow(rows).gainSgd)]).toEqual(['126036.4059883960', '48036.4059883960']);
  });

  test('flow timing has no effect (sample)', async () => {
    expect(show(run(await sample('end')).rows)).toEqual(show(run(await sample('start')).rows));
  });
});
