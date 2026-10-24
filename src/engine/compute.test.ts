import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import MOOMOO_CSV from '../importers/fixtures/moomoo-sample.expected.csv?raw';
import { compute, explanationDeposits } from './compute';
import { D } from './decimal';
import { excludeTickers } from './exclude';
import * as goldenA from './fixtures/golden-a';
import type { ComputeInput, LedgerRow, PriceBar } from './types';

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

// ---------------------------------------------------------------------------
// Task 38, spec 17.1.8: explanation deposits in either currency, read from the ledger before exclusion.
// ---------------------------------------------------------------------------

const deposits = (d: { date: string; amount: { toFixed(dp: number): string } }[]) => d.map((x) => [x.date, x.amount.toFixed(4)]);
const pbar = (date: string, close: string): PriceBar => ({ date, close: D(close), splitFactor: D(1), divCash: D(0) });

describe('explanationDeposits', () => {
  test("explanationDeposits counts USD deposits at the day's rate", () => {
    // Spec 17.1.9: the moomoo fixture's expected output, FX 1.35 carried.
    const { rows, rejected } = parseCsv(MOOMOO_CSV);
    if (rejected.length) throw new Error('moomoo output invalid: ' + JSON.stringify(rejected));
    const res = ok({
      ledger: rows,
      prices: {
        AAPL: [pbar('2024-03-05', '150'), pbar('2024-03-08', '160'), pbar('2024-03-12', '170')],
        VOO: [pbar('2024-03-06', '400'), pbar('2024-03-11', '410')],
      },
      fx: [{ date: '2024-03-05', sgdPerUsd: D('1.35') }],
      endDate: '2024-03-12',
    });
    expect(deposits(explanationDeposits(rows, res.series))).toEqual([
      ['2024-03-05', '2027.6865'],
      ['2024-03-06', '1623.3615'],
      ['2024-03-12', '156.6135'],
    ]);
  });

  describe('on the spec 16.4 ledger with ZZZ excluded', () => {
    const original = ledger(
      [
        HEADER,
        '2024-01-02,DEPOSIT,,,,SGD,2754,0',
        '2024-01-02,FX,USD,2040,,SGD,2754,0',
        '2024-01-02,BUY,AAPL,5,200,USD,1000,0',
        '2024-01-02,BUY,ZZZ,10,100,USD,1000,2',
        '2024-03-01,SELL,ZZZ,4,110,USD,440,2',
        '2024-03-15,DIVIDEND,ZZZ,,,USD,10,1.5',
      ].join('\n'),
    );
    const reduced = excludeTickers(original, ['ZZZ']);
    const input: ComputeInput = {
      ledger: reduced,
      prices: { AAPL: [pbar('2024-01-02', '200'), pbar('2024-03-28', '220')] },
      fx: [
        { date: '2024-01-02', sgdPerUsd: D('1.35') },
        { date: '2024-03-01', sgdPerUsd: D('1.34') },
      ],
      endDate: '2024-03-31',
    };
    const series = () => ok(input).series;

    test('excluded sales and dividends never count as deposits', () => {
      expect(deposits(explanationDeposits(reduced, series(), original))).toEqual([['2024-01-02', '2754.0000']]);
    });

    test('without the original ledger, the synthetic USD deposits would count too', () => {
      expect(deposits(explanationDeposits(reduced, series()))).toEqual([
        ['2024-01-02', '2754.0000'],
        ['2024-03-01', '586.9200'],
        ['2024-03-15', '11.3900'],
      ]);
    });

    test('compute with originalLedger set gives the same explanation as before this task', () => {
      // Recorded from compute on this ledger at 3c702ca, before Task 38.
      expect(ok({ ...input, originalLedger: original }).explanation).toBe(
        'XIRR is higher than TWR because more of your money was invested in the stronger periods than in the weaker ones.',
      );
    });
  });

  test('Golden A gives 1400 and 600 (unchanged)', () => {
    const i = goldenInput();
    expect(deposits(explanationDeposits(i.ledger, ok(i).series))).toEqual([
      ['2020-08-28', '1400.0000'],
      ['2020-08-31', '600.0000'],
    ]);
  });
});
