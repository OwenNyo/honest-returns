import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { benchmark, shadowLedger } from './benchmark';
import { D } from './decimal';
import type { ComputeInput, FxPoint, LedgerRow, PriceBar } from './types';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}

// Golden F (spec 7), inline: synthetic data.
const bar = (date: string, close: string, divCash = '0'): PriceBar => ({
  date,
  close: D(close),
  splitFactor: D(1),
  divCash: D(divCash),
});
const vooF = [bar('2021-05-28', '100'), bar('2021-06-01', '100'), bar('2021-06-02', '110')];
const fxAt = (...dates: string[]): FxPoint[] => dates.map((date) => ({ date, sgdPerUsd: D('1.30') }));
const goldenF = (over: Partial<ComputeInput> = {}): ComputeInput => ({
  ledger: ledger([HEADER, '2021-06-01,DEPOSIT,,,,SGD,1300,0', '2021-06-02,WITHDRAW,,,,SGD,143,0'].join('\n')),
  prices: { VOO: vooF },
  fx: fxAt('2021-05-28', '2021-06-01', '2021-06-02'),
  endDate: '2021-06-02',
  ...over,
});

function ok(input: ComputeInput, ticker: string) {
  const res = benchmark(input, ticker);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return res;
}
const near = (v: { toString(): string }, expected: number) =>
  expect(Math.abs(Number(v.toString()) - expected)).toBeLessThan(1e-9);

describe('benchmark on Golden F, start-of-day timing', () => {
  test('end value is 1272.7 SGD (8.9 VOO x 110 x 1.30)', () => {
    expect(ok(goldenF(), 'VOO').series.at(-1)!.valueSgd.toFixed(10)).toBe('1272.7000000000');
  });

  test('withdrawal sells 1.1 shares at the prior close, leaving 8.9', () => {
    expect(ok(goldenF(), 'VOO').series.at(-1)!.holdings.VOO.toString()).toBe('8.9');
  });

  test('TWR is 0.10', () => {
    expect(ok(goldenF(), 'VOO').twr.value.toFixed(10)).toBe('0.1000000000');
  });

  test('XIRR (Y = T = 1) is 0.089', () => {
    const x = ok(goldenF(), 'VOO').xirr;
    if (x.kind !== 'ok') throw new Error('expected ok XIRR');
    near(x.value, 0.089);
  });
});

describe('benchmark on Golden F, end-of-day timing', () => {
  const end = () => ok(goldenF({ flowTiming: 'end' }), 'VOO');

  test('withdrawal uses the same-day close 110 and sells 1 share: end value 1287', () => {
    expect(end().series.at(-1)!.valueSgd.toFixed(10)).toBe('1287.0000000000');
  });

  test('TWR is 0.10', () => {
    expect(end().twr.value.toFixed(10)).toBe('0.1000000000');
  });
});

describe('benchmark tickers and dividends', () => {
  test('runs on any benchmark ticker, for example QQQ', () => {
    expect(ok(goldenF({ prices: { QQQ: vooF } }), 'QQQ').series.at(-1)!.valueSgd.toFixed(10)).toBe('1272.7000000000');
  });

  test('dividends on the benchmark are booked on the ex-date after 30% withholding', () => {
    const i = goldenF({
      ledger: ledger([HEADER, '2021-06-01,DEPOSIT,,,,SGD,1300,0'].join('\n')),
      prices: { VOO: [bar('2021-05-28', '100'), bar('2021-06-01', '100'), bar('2021-06-02', '110', '1')] },
    });
    // 10 shares x 1 x 0.7 = 7 USD; (1100 + 7) x 1.30
    expect(ok(i, 'VOO').series.at(-1)!.valueSgd.toFixed(10)).toBe('1439.1000000000');
  });
});

describe('shadowLedger', () => {
  test('returns an error when a withdrawal exceeds the shadow value', () => {
    const i: ComputeInput = {
      ledger: ledger([HEADER, '2021-06-01,DEPOSIT,,,,SGD,1300,0', '2021-06-03,WITHDRAW,,,,SGD,1000,0'].join('\n')),
      prices: { VOO: [bar('2021-05-28', '100'), bar('2021-06-01', '100'), bar('2021-06-02', '50'), bar('2021-06-03', '50')] },
      fx: fxAt('2021-05-28', '2021-06-01', '2021-06-02', '2021-06-03'),
      endDate: '2021-06-03',
    };
    // Shadow value before 06-03: 10 x 50 x 1.30 = 650 SGD < 1000.
    expect(shadowLedger(i, 'VOO')).toEqual({ error: 'The benchmark ran out of money on 2021-06-03.' });
  });
});
