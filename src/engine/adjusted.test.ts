import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { adjustedCloseTwr, adjustedSeries } from './adjusted';
import { compute } from './compute';
import { D } from './decimal';
import * as goldenA from './fixtures/golden-a';
import type { ComputeInput, FxPoint, LedgerRow, PriceBar } from './types';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}

function rawTwr(input: ComputeInput) {
  const res = compute(input);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return res.twr.value;
}

// Golden E (spec 7), inline: synthetic data.
const bar = (date: string, close: string, divCash = '0'): PriceBar => ({
  date,
  close: D(close),
  splitFactor: D(1),
  divCash: D(divCash),
});
const vooE = [
  bar('2021-03-24', '358'),
  bar('2021-03-25', '360'),
  bar('2021-03-26', '362', '1.50'),
  bar('2021-03-29', '362'),
  bar('2021-03-30', '362'),
  bar('2021-03-31', '365'),
];
const fxE: FxPoint[] = vooE.map((b) => ({ date: b.date, sgdPerUsd: D('1.30') }));
const goldenE = (): ComputeInput => ({
  ledger: ledger(
    [
      HEADER,
      '2021-03-24,DEPOSIT,,,,SGD,1300,0',
      '2021-03-24,FX,USD,1000,,SGD,1300,0',
      '2021-03-24,BUY,VOO,2,358,USD,716,0',
      '2021-03-25,DEPOSIT,,,,SGD,1300,0',
    ].join('\n'),
  ),
  prices: { VOO: vooE },
  fx: fxE,
  endDate: '2021-03-31',
});

describe('adjustedSeries', () => {
  test('scales closes before the ex-date by 1 - divCash / prior close, and leaves later closes unchanged', () => {
    expect(adjustedSeries(vooE).map((b) => b.close.toFixed(10))).toEqual([
      '356.5083333333',
      '358.5000000000',
      '362.0000000000',
      '362.0000000000',
      '362.0000000000',
      '365.0000000000',
    ]);
  });

  test('divides closes before a split by the split factor', () => {
    expect(adjustedSeries(goldenA.prices.AAPL).map((b) => b.close.toFixed(10))).toEqual([
      '125.0000000000',
      '130.0000000000',
      '135.0000000000',
    ]);
  });
});

describe('adjustedCloseTwr on Golden E', () => {
  test('raw-price TWR is 0.00805', () => {
    expect(rawTwr(goldenE()).toFixed(10)).toBe('0.0080500000');
  });

  test('adjusted-close TWR is 0.0065440791', () => {
    expect(adjustedCloseTwr(goldenE()).toFixed(10)).toBe('0.0065440791');
  });
});

describe('adjustedCloseTwr equals raw TWR when adjustment cannot matter', () => {
  test('no dividends, no splits and one flow', () => {
    const i: ComputeInput = {
      ledger: ledger(
        [HEADER, '2021-06-01,DEPOSIT,,,,SGD,1300,0', '2021-06-01,FX,USD,1000,,SGD,1300,0', '2021-06-01,BUY,VOO,10,100,USD,1000,0'].join(
          '\n',
        ),
      ),
      prices: { VOO: [bar('2021-06-01', '100'), bar('2021-06-02', '110')] },
      fx: [
        { date: '2021-06-01', sgdPerUsd: D('1.30') },
        { date: '2021-06-02', sgdPerUsd: D('1.40') },
      ],
      endDate: '2021-06-02',
    };
    expect(adjustedCloseTwr(i).toFixed(10)).toBe(rawTwr(i).toFixed(10));
  });

  test('Golden A: a split with quantities rebased to today gives the same TWR', () => {
    const i: ComputeInput = {
      ledger: ledger(goldenA.csv),
      prices: goldenA.prices,
      fx: goldenA.fx,
      endDate: goldenA.endDate,
    };
    expect(adjustedCloseTwr(i).toFixed(10)).toBe('0.0498448697');
  });
});
