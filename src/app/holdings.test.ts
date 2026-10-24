import { describe, expect, test } from 'vitest';
import { compute } from '../engine/compute';
import { D } from '../engine/decimal';
import { type HoldingRow, holdingRows } from '../engine/holdings';
import type { ComputeInput } from '../engine/types';
import { parseCsv } from '../shared/csv';
import { holdingLines } from './Holdings';

// Spec 18.2.3: the strings of the Gain by holding rows. HoldingRows (the markup) is not tested here.
const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';
const lines = (...l: string[]) => {
  const { rows, rejected } = parseCsv([HEADER, ...l].join('\n'));
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
};
const bar = (date: string, close: string, divCash = '0') => ({ date, close: D(close), splitFactor: D(1), divCash: D(divCash) });
function rowsOf(input: ComputeInput): HoldingRow[] {
  const res = compute(input);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return holdingRows(input.ledger, input.prices, res.series, res.dividends ?? [], res.decomposition!.totalGain);
}

// Golden D2 (spec 7, 17.3.2).
const D2: ComputeInput = {
  ledger: lines('2021-06-01,DEPOSIT,,,,SGD,1400,0', '2021-06-01,FX,USD,1050,,SGD,1400,0', '2021-06-01,BUY,VOO,10,100,USD,1000,1'),
  prices: { VOO: [bar('2021-06-01', '100'), bar('2021-06-02', '110', '0.50')] },
  fx: [
    { date: '2021-06-01', sgdPerUsd: D('1.30') },
    { date: '2021-06-02', sgdPerUsd: D('1.40') },
  ],
  endDate: '2021-06-02',
};

// Golden H (spec 18.2.2): VOO closed during the period.
const G_DATES = ['2021-06-01', '2021-06-02', '2021-06-03', '2021-06-04', '2021-06-07'];
const H: ComputeInput = {
  ledger: lines(
    '2021-06-01,DEPOSIT,,,,SGD,2600,0',
    '2021-06-01,FX,USD,2000,,SGD,2600,0',
    '2021-06-01,BUY,VOO,10,100,USD,1000,1',
    '2021-06-01,BUY,AAPL,10,50,USD,500,1',
    '2021-06-03,SELL,VOO,10,120,USD,1200,1',
  ),
  prices: {
    VOO: ['100', '120', '120', '90', '108'].map((c, i) => bar(G_DATES[i], c)),
    AAPL: [bar('2021-06-01', '50'), bar('2021-06-04', '55'), bar('2021-06-07', '60')],
  },
  fx: [
    { date: '2021-06-01', sgdPerUsd: D('1.30') },
    { date: '2021-06-04', sgdPerUsd: D('1.32') },
  ],
  endDate: '2021-06-07',
};

// Zero end value (spec 18.2.2).
const ZERO: ComputeInput = {
  ledger: lines('2024-01-02,DEPOSIT,,,,SGD,100,0', '2024-01-02,WITHDRAW,,,,SGD,100,0'),
  prices: {},
  fx: [{ date: '2024-01-02', sgdPerUsd: D('1.35') }],
  endDate: '2024-01-02',
};

describe('holdingLines (spec 18.2.3)', () => {
  test('D2 lines', () => {
    expect(holdingLines(rowsOf(D2))).toEqual([
      { label: 'VOO', note: '10 shares, SGD 1,540.00, 95.4%', gain: '+SGD 243.60' },
      { label: 'SGD cash', note: 'SGD 0.00, 0.0%', gain: null },
      { label: 'USD cash', note: 'SGD 73.50, 4.6%', gain: null },
      { label: 'Cash and exchange on cash', note: null, gain: '-SGD 30.10' },
      { label: 'Total', note: 'SGD 1,613.50', gain: '+SGD 213.50', total: true },
    ]);
  });

  test('one share reads 1 share', () => {
    const row: HoldingRow = { kind: 'ticker', ticker: 'AAPL', shares: D(1), valueSgd: D('270'), weight: D(1), gainSgd: D('10') };
    expect(holdingLines([row])[0].note?.startsWith('1 share, ')).toBe(true);
  });

  test('a closed position reads 0 shares', () => {
    const voo = holdingLines(rowsOf(H)).find((l) => l.label === 'VOO');
    expect(voo).toMatchObject({ note: '0 shares, SGD 0.00, 0.0%', gain: '+SGD 257.40' });
  });

  test('null weights are left out', () => {
    const notes = holdingLines(rowsOf(ZERO))
      .filter((l) => /^(SGD|USD) cash$/.test(l.label))
      .map((l) => l.note);
    expect(notes).toEqual(['SGD 0.00', 'SGD 0.00']);
  });
});
