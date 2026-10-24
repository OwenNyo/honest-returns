import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import * as goldenA from './fixtures/golden-a';
import type { ComputeInput, LedgerRow } from './types';
import { valueDaily } from './valuation';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

// Parse ledger lines (header added); fail loudly if the test data itself is invalid.
function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}
const lines = (...l: string[]) => ledger([HEADER, ...l].join('\n'));
const goldenPlus = (...l: string[]) => ledger([goldenA.csv.trimEnd(), ...l].join('\n'));

const input = (rows: LedgerRow[], over: Partial<ComputeInput> = {}): ComputeInput => ({
  ledger: rows,
  prices: goldenA.prices,
  fx: goldenA.fx,
  endDate: goldenA.endDate,
  ...over,
});

function okSeries(i: ComputeInput) {
  const res = valueDaily(i);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return res;
}

describe('valueDaily on Golden A', () => {
  const run = () => okSeries(input(ledger(goldenA.csv)));

  test('has one point per calendar day from first ledger date to endDate', () => {
    expect(run().series.map((p) => p.date)).toEqual([
      '2020-08-28',
      '2020-08-29',
      '2020-08-30',
      '2020-08-31',
      '2020-09-01',
    ]);
  });

  test('values each day in SGD, carrying price and rate over the weekend and applying the split', () => {
    expect(run().series.map((p) => p.valueSgd.toFixed(10))).toEqual([
      '1400.0000000000',
      '1400.0000000000',
      '1400.0000000000',
      '2064.8000000000',
      '1998.0000000000',
    ]);
  });

  test('applies the 4:1 split to the AAPL holding on the ex-date', () => {
    expect(run().series.map((p) => p.holdings.AAPL.toString())).toEqual(['2', '2', '2', '8', '8']);
  });

  test('tracks end-of-day SGD cash', () => {
    expect(run().series.map((p) => p.cash.SGD.toString())).toEqual(['40', '40', '40', '640', '540']);
  });

  test('tracks end-of-day USD cash', () => {
    expect(run().series.map((p) => p.cash.USD.toString())).toEqual(['0', '0', '0', '0', '0']);
  });

  test('records net external flow per day', () => {
    expect(run().series.map((p) => p.netFlowSgd.toString())).toEqual(['1400', '0', '0', '600', '-100']);
  });

  test('records running net invested', () => {
    expect(run().series.map((p) => p.netInvestedSgd.toString())).toEqual(['1400', '1400', '1400', '2000', '1900']);
  });

  test('records the ECB date and rate used, carried on the weekend', () => {
    expect(run().series.map((p) => [p.fxDate, p.fxRate.toString()])).toEqual([
      ['2020-08-28', '1.36'],
      ['2020-08-28', '1.36'],
      ['2020-08-28', '1.36'],
      ['2020-08-31', '1.37'],
      ['2020-09-01', '1.35'],
    ]);
  });

  test('emits one fx_carried warning with the count of carried days', () => {
    const carried = run().warnings.filter((w) => w.code === 'fx_carried');
    expect(carried).toHaveLength(1);
    expect(carried[0].message).toBe('Exchange rate carried forward on 2 days without an ECB fixing.');
  });
});

describe('valueDaily rejections', () => {
  test('not_trading_day: BUY dated on a day with no price bar', () => {
    const res = valueDaily(
      input(
        lines(
          '2020-08-28,DEPOSIT,,,,SGD,1400,0',
          '2020-08-28,FX,USD,1000,,SGD,1360,0',
          '2020-08-29,BUY,AAPL,2,500,USD,1000,0',
        ),
      ),
    );
    expect(res).toEqual({
      ok: false,
      rejected: [{ line: 4, code: 'not_trading_day', message: 'AAPL did not trade on 2020-08-29.' }],
    });
  });

  // Review Focus 4 (engine side)
  test('after_as_of: row dated after endDate names the as-of date', () => {
    const res = valueDaily(input(goldenPlus('2020-09-02,DEPOSIT,,,,SGD,100,0')));
    expect(res).toEqual({
      ok: false,
      rejected: [{ line: 7, code: 'after_as_of', message: 'date is after the latest available prices (2020-09-01).' }],
    });
  });

  test('negative_cash: FX selling more SGD than deposited, blamed on the FX row', () => {
    const res = valueDaily(input(lines('2020-08-28,DEPOSIT,,,,SGD,1400,0', '2020-08-28,FX,USD,1100,,SGD,1500,0')));
    expect(res).toEqual({
      ok: false,
      rejected: [{ line: 3, code: 'negative_cash', message: 'SGD cash would be -100.00 at the end of 2020-08-28.' }],
    });
  });

  test('oversell: SELL 3 AAPL while holding 2', () => {
    const res = valueDaily(
      input(
        lines(
          '2020-08-28,DEPOSIT,,,,SGD,1400,0',
          '2020-08-28,FX,USD,1000,,SGD,1360,0',
          '2020-08-28,BUY,AAPL,2,500,USD,1000,0',
          '2020-08-28,SELL,AAPL,3,500,USD,1500,0',
        ),
      ),
    );
    expect(res).toEqual({
      ok: false,
      rejected: [
        {
          line: 5,
          code: 'oversell',
          message: 'This sells more AAPL than is held: holding would be -1 at the end of 2020-08-28.',
        },
      ],
    });
  });

  test('no_market_data: FX series starts after the first ledger date', () => {
    const res = valueDaily(input(ledger(goldenA.csv), { fx: goldenA.fx.filter((p) => p.date > '2020-08-28') }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]).toMatchObject({ code: 'no_market_data', message: 'No USD/SGD rate on or before 2020-08-28.' });
  });

  test('stops at the first rejection: two overdrafts on different days give one rejection', () => {
    const res = valueDaily(
      input(
        lines(
          '2020-08-28,DEPOSIT,,,,SGD,100,0',
          '2020-08-28,WITHDRAW,,,,SGD,200,0',
          '2020-08-31,WITHDRAW,,,,SGD,50,0',
        ),
      ),
    );
    expect(res).toEqual({
      ok: false,
      rejected: [{ line: 3, code: 'negative_cash', message: 'SGD cash would be -100.00 at the end of 2020-08-28.' }],
    });
  });
});

describe('valueDaily end-of-day checks and holidays', () => {
  // Review Focus 2: FX (priority 3) runs before SELL (priority 4); valid because checks are end-of-day.
  test('sell, convert to SGD and withdraw on the same day is valid', () => {
    const res = okSeries(
      input(
        goldenPlus(
          '2020-09-01,WITHDRAW,,,,SGD,1998,0',
          '2020-09-01,FX,SGD,1458,,USD,1080,0',
          '2020-09-01,SELL,AAPL,8,135,USD,1080,0',
        ),
      ),
    );
    const last = res.series.at(-1)!;
    expect(last.date).toBe('2020-09-01');
    expect(last.cash.SGD.toString()).toBe('0');
    expect(last.cash.USD.toString()).toBe('0');
  });

  // Review Focus 3
  test('a Saturday deposit is valued with the carried close and rate', () => {
    const res = okSeries(input(goldenPlus('2020-08-29,DEPOSIT,,,,SGD,100,0')));
    const sat = res.series.find((p) => p.date === '2020-08-29')!;
    // 140 SGD cash + 2 AAPL x 500 x 1.36
    expect(sat.valueSgd.toFixed(10)).toBe('1500.0000000000');
    expect(sat.fxDate).toBe('2020-08-28');
  });
});
