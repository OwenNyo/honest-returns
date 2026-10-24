import type Decimal from 'decimal.js';
import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { shadowLedger } from './benchmark';
import { compute } from './compute';
import { D } from './decimal';
import { excludedShare, excludeTickers } from './exclude';
import type { ComputeInput, FxPoint, LedgerRow, PriceBar } from './types';

// Spec 16.4 worked example: ZZZ excluded, AAPL stays.
const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';
const CSV = [
  HEADER,
  '2024-01-02,DEPOSIT,,,,SGD,2754,0',
  '2024-01-02,FX,USD,2040,,SGD,2754,0',
  '2024-01-02,BUY,AAPL,5,200,USD,1000,0',
  '2024-01-02,BUY,ZZZ,10,100,USD,1000,2',
  '2024-03-01,SELL,ZZZ,4,110,USD,440,2',
  '2024-03-15,DIVIDEND,ZZZ,,,USD,10,1.5',
];

function ledger(lines: string[]): LedgerRow[] {
  const { rows, rejected } = parseCsv(lines.join('\n'));
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}
const bar = (date: string, close: string): PriceBar => ({ date, close: D(close), splitFactor: D(1), divCash: D(0) });
const fx: FxPoint[] = [
  { date: '2024-01-02', sgdPerUsd: D('1.35') },
  { date: '2024-03-01', sgdPerUsd: D('1.34') },
];
const rows = ledger(CSV);
const reducedInput = (): ComputeInput => ({
  ledger: excludeTickers(rows, ['ZZZ']),
  prices: { AAPL: [bar('2024-01-02', '200'), bar('2024-03-28', '220')] },
  fx,
  endDate: '2024-03-31',
});

function ok(input: ComputeInput) {
  const res = compute(input);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return res;
}
// Decimals as strings, so equal values compare equal whatever their internal form.
const str = (d: Decimal | null) => (d === null ? null : d.toFixed(10));
const show = (r: LedgerRow) => ({ ...r, quantity: str(r.quantity), price: str(r.price), amount: str(r.amount), fees: str(r.fees) });
const flow = (line: number, date: string, type: 'DEPOSIT' | 'WITHDRAW', amount: string) =>
  show({ line, date, type, ticker: null, quantity: null, price: null, currency: 'USD', amount: D(amount), fees: D(0) });
const at = (date: string) => ok(reducedInput()).series.find((p) => p.date === date)!;

describe('excludeTickers on the spec 16.4 ledger', () => {
  test('keeps lines 2 to 4 and turns the ZZZ BUY, SELL and DIVIDEND into USD flow rows on the same lines', () => {
    expect(excludeTickers(rows, ['ZZZ']).map(show)).toEqual([
      show(rows[0]),
      show(rows[1]),
      show(rows[2]),
      flow(5, '2024-01-02', 'WITHDRAW', '1002'),
      flow(6, '2024-03-01', 'DEPOSIT', '438'),
      flow(7, '2024-03-15', 'DEPOSIT', '8.5'),
    ]);
  });

  test('a ticker not in the ledger leaves the rows unchanged', () => {
    expect(excludeTickers(rows, ['NOPE']).map(show)).toEqual(rows.map(show));
  });

  test('drops an OPENING position row of the excluded ticker and keeps an OPENING USD cash row', () => {
    const opening = ledger([HEADER, '2024-01-02,OPENING,ZZZ,10,100,USD,1000,0', '2024-01-02,OPENING,,,,USD,38,0']);
    expect(excludeTickers(opening, ['ZZZ']).map(show)).toEqual([show(opening[1])]);
  });
});

describe('compute on the reduced ledger (spec 16.4)', () => {
  test('computes with no rejection', () => {
    expect(compute(reducedInput()).ok).toBe(true);
  });

  test('end-of-day USD cash is 38 on 2024-01-02, 476 on 2024-03-01 and 484.5 on 2024-03-31', () => {
    expect([at('2024-01-02'), at('2024-03-01'), at('2024-03-31')].map((p) => p.cash.USD.toFixed(2))).toEqual([
      '38.00',
      '476.00',
      '484.50',
    ]);
  });

  test('SGD cash is 0 on every day', () => {
    expect(ok(reducedInput()).series.every((p) => p.cash.SGD.isZero())).toBe(true);
  });

  test('netFlowSgd is 1401.30, 586.92 and 11.39 on the three flow dates', () => {
    expect([at('2024-01-02'), at('2024-03-01'), at('2024-03-15')].map((p) => p.netFlowSgd.toFixed(10))).toEqual([
      '1401.3000000000',
      '586.9200000000',
      '11.3900000000',
    ]);
  });

  test('net invested at the end is 1999.61', () => {
    expect(ok(reducedInput()).series.at(-1)!.netInvestedSgd.toFixed(10)).toBe('1999.6100000000');
  });

  test('end value is 2123.23 SGD', () => {
    expect(ok(reducedInput()).series.at(-1)!.valueSgd.toFixed(10)).toBe('2123.2300000000');
  });

  test('holdings at the end are AAPL 5 only', () => {
    const h = ok(reducedInput()).series.at(-1)!.holdings;
    expect(Object.fromEntries(Object.entries(h).map(([t, q]) => [t, q.toString()]))).toEqual({ AAPL: '5' });
  });

  test('first daily return is 0', () => {
    expect(ok(reducedInput()).series[0].dailyReturn.isZero()).toBe(true);
  });

  test('no dividends are recorded', () => {
    expect(ok(reducedInput()).dividends).toEqual([]);
  });

  test('decomposition dividends is 0', () => {
    expect(ok(reducedInput()).decomposition!.dividends.isZero()).toBe(true);
  });
});

describe('benchmark on the reduced ledger', () => {
  test('shadowLedger deposits follow the reduced flows: 1401.30, 586.92 and 11.39', () => {
    const shadow = shadowLedger({ ...reducedInput(), flowTiming: 'end' }, 'AAPL');
    if ('error' in shadow) throw new Error(shadow.error);
    const deposits = shadow.filter((r) => r.type === 'DEPOSIT' && r.currency === 'SGD');
    expect(deposits.map((r) => [r.date, r.amount.toFixed(10)])).toEqual([
      ['2024-01-02', '1401.3000000000'],
      ['2024-03-01', '586.9200000000'],
      ['2024-03-15', '11.3900000000'],
    ]);
  });
});

describe('excludedShare (spec 16.3)', () => {
  test('is 1352.70 / 2702.70 = 0.5004995005 on the spec 16.4 ledger', () => {
    expect(excludedShare(rows, ['ZZZ'], fx).toFixed(10)).toBe('0.5004995005');
  });

  test('an excluded OPENING position counts on both sides and opening cash on neither', () => {
    const withOpening = ledger([...CSV, '2024-01-02,OPENING,ZZZ,10,100,USD,1000,0', '2024-01-02,OPENING,,,,SGD,500,0']);
    // (1352.70 + 1350) / (2702.70 + 1350)
    const expected = D('2702.70').div('4052.70').toFixed(10);
    expect(excludedShare(withOpening, ['ZZZ'], fx).toFixed(10)).toBe(expected);
  });
});
