import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { compute } from './compute';
import { D } from './decimal';
import * as goldenA from './fixtures/golden-a';
import type { ComputeInput, LedgerRow } from './types';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}

const goldenInput = (over: Partial<ComputeInput> = {}): ComputeInput => ({
  ledger: ledger(goldenA.csv),
  prices: goldenA.prices,
  fx: goldenA.fx,
  endDate: goldenA.endDate,
  ...over,
});

function ok(input: ComputeInput) {
  const res = compute(input);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return res;
}
const near = (v: { toString(): string }, expected: number) =>
  expect(Math.abs(Number(v.toString()) - expected)).toBeLessThan(1e-9);

describe('compute on Golden A', () => {
  test('default timing is start of day: cumulative TWR over 4 days', () => {
    const res = ok(goldenInput());
    expect(res.twr.value.toFixed(10)).toBe('0.0498448697');
    expect(res.twr.annualised).toBe(false);
    expect(res.twr.days).toBe(4);
  });

  test('XIRR includes the terminal value and is cumulative', () => {
    const res = ok(goldenInput());
    if (res.xirr.kind !== 'ok') throw new Error('expected xirr ok');
    near(res.xirr.value, 0.0633663606);
    expect(res.xirr.annualised).toBe(false);
    expect(res.xirr.multipleRoots).toBe(false);
  });

  test('series carries filled daily returns', () => {
    expect(ok(goldenInput()).series.map((p) => p.dailyReturn.toFixed(10))).toEqual([
      '0.0000000000',
      '0.0000000000',
      '0.0000000000',
      '0.0324000000',
      D(1998).div('1964.8').minus(1).toFixed(10),
    ]);
  });

  test('end-of-day timing changes TWR only', () => {
    const res = ok(goldenInput({ flowTiming: 'end' }));
    expect(res.twr.value.toFixed(10)).toBe('0.0631089832');
    if (res.xirr.kind !== 'ok') throw new Error('expected xirr ok');
    near(res.xirr.value, 0.0633663606);
  });

  test('passes the fx_carried warning through', () => {
    expect(ok(goldenInput()).warnings).toContainEqual(
      expect.objectContaining({
        code: 'fx_carried',
        message: 'Exchange rate carried forward on 2 days without an ECB fixing.',
      }),
    );
  });
});

describe('compute rejections', () => {
  test('a rejected ledger returns ok false with the engine rejection and no numbers', () => {
    const res = compute(
      goldenInput({
        ledger: ledger([HEADER, '2020-08-28,DEPOSIT,,,,SGD,1400,0', '2020-08-28,FX,USD,1100,,SGD,1500,0'].join('\n')),
      }),
    );
    expect(res).toEqual({
      ok: false,
      rejected: [{ line: 3, code: 'negative_cash', message: 'SGD cash would be -100.00 at the end of 2020-08-28.' }],
    });
  });
});

describe('compute warnings', () => {
  // Investor flows -100, +230, -132 a year apart, terminal value 0: Golden B2 roots 0.10 and 0.20.
  test('adds xirr_multiple_roots when XIRR has more than one root', () => {
    const rows = ledger(
      [
        HEADER,
        '2021-01-01,DEPOSIT,,,,SGD,100,0',
        '2021-01-01,FX,USD,100,,SGD,100,0',
        '2021-01-01,BUY,X,1,100,USD,100,0',
        '2022-01-01,SELL,X,1,230,USD,230,0',
        '2022-01-01,FX,SGD,230,,USD,230,0',
        '2022-01-01,WITHDRAW,,,,SGD,230,0',
        '2023-01-01,DEPOSIT,,,,SGD,132,0',
        '2023-01-01,FX,USD,132,,SGD,132,0',
        '2023-01-01,BUY,X,1,132,USD,132,0',
      ].join('\n'),
    );
    const bar = (date: string, close: string) => ({ date, close: D(close), splitFactor: D(1), divCash: D(0) });
    const res = ok({
      ledger: rows,
      prices: { X: [bar('2021-01-01', '100'), bar('2022-01-01', '230'), bar('2023-01-01', '132'), bar('2023-01-02', '0')] },
      fx: [{ date: '2021-01-01', sgdPerUsd: D(1) }],
      endDate: '2023-01-02',
    });
    if (res.xirr.kind !== 'ok') throw new Error('expected xirr ok');
    near(res.xirr.value, 0.1);
    expect(res.xirr.multipleRoots).toBe(true);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({
        code: 'xirr_multiple_roots',
        message:
          'More than one rate between -99% and 1000% balances these cash flows; showing the one found from a 10% starting guess.',
      }),
    );
  });
});
