import { describe, expect, test } from 'vitest';
import { compute } from '../engine/compute';
import { D } from '../engine/decimal';
import * as goldenA from '../engine/fixtures/golden-a';
import type { LedgerRow, ValuationPoint } from '../engine/types';
import { parseCsv } from '../shared/csv';
import type { Loaded } from './data';
import { storyFacts } from './story';

// Task 26, spec 15.1.4: every figure on Home is derived from the sample's Loaded result.
function goldenLoaded(): Loaded {
  const { rows } = parseCsv(goldenA.csv);
  const result = compute({ ledger: rows, prices: goldenA.prices, fx: goldenA.fx, endDate: goldenA.endDate });
  if (!result.ok) throw new Error('Golden A did not compute: ' + JSON.stringify(result.rejected));
  return { ...result, asOf: goldenA.endDate, ledger: rows };
}

describe('storyFacts on Golden A', () => {
  const facts = () => storyFacts(goldenLoaded());

  test('counts the DEPOSIT rows', () => {
    expect(facts().deposits).toBe(2);
  });

  test('money in is the last netInvestedSgd', () => {
    expect(facts().moneyIn.toString()).toBe('1900');
  });

  test('counts the FX rows', () => {
    expect(facts().conversions).toBe(1);
  });

  test('counts BUY rows per ticker', () => {
    expect(facts().buysByTicker).toEqual({ AAPL: 1 });
  });

  test('fxFrom is the first series rate and its ECB date', () => {
    const { fxFrom } = facts();
    expect({ rate: fxFrom.rate.toString(), date: fxFrom.date }).toEqual({ rate: '1.36', date: '2020-08-28' });
  });

  test('fxTo is the last series rate and its ECB date', () => {
    const { fxTo } = facts();
    expect({ rate: fxTo.rate.toString(), date: fxTo.date }).toEqual({ rate: '1.35', date: '2020-09-01' });
  });

  test('split is the first holding change with no BUY or SELL that day', () => {
    const { split } = facts();
    expect(split && { ...split, before: split.before.toString(), after: split.after.toString() }).toEqual({
      ticker: 'AAPL',
      date: '2020-08-31',
      before: '2',
      after: '8',
    });
  });

  test('years shorter than 90 days are left out', () => {
    expect(facts().years).toEqual([]);
  });
});

// A hand-built result with two full years and one short one. Only the fields storyFacts reads matter.
function point(date: string): ValuationPoint {
  return {
    date,
    valueSgd: D(1000),
    netFlowSgd: D(0),
    netInvestedSgd: D(1750),
    dailyReturn: D(0),
    fxRate: D('1.35'),
    fxDate: date,
    cash: { SGD: D(0), USD: D(0) },
    holdings: {},
  };
}
const deposit = (line: number, date: string, amount: number): LedgerRow => ({
  line,
  date,
  type: 'DEPOSIT',
  ticker: null,
  quantity: null,
  price: null,
  currency: 'SGD',
  amount: D(amount),
  fees: D(0),
});
function handBuilt(twr2019: string, twr2020: string): Loaded {
  return {
    ok: true,
    series: [point('2019-03-01'), point('2021-02-28')],
    twr: { value: D('0.05'), annualised: true, days: 730 },
    xirr: { kind: 'ok', value: D('0.04'), annualised: true, multipleRoots: false },
    warnings: [],
    yearReturns: [
      { year: 2019, twr: D(twr2019), days: 306 },
      { year: 2020, twr: D(twr2020), days: 366 },
      { year: 2021, twr: D('0.5'), days: 59 },
    ],
    explanation: '',
    asOf: '2021-02-28',
    ledger: [deposit(2, '2019-03-01', 1000), deposit(3, '2020-03-01', 500), deposit(4, '2020-06-01', 250)],
  };
}

describe('storyFacts years', () => {
  test('lists years of at least 90 days with their TWR and deposits', () => {
    const { years } = storyFacts(handBuilt('0.1', '-0.05'));
    expect(years.map((y) => ({ year: y.year, twr: y.twr.toString(), deposited: y.deposited.toString() }))).toEqual([
      { year: 2019, twr: '0.1', deposited: '1000' },
      { year: 2020, twr: '-0.05', deposited: '750' },
    ]);
  });

  test('best and worst are the years with the highest and lowest TWR', () => {
    const { best, worst } = storyFacts(handBuilt('0.1', '-0.05'));
    expect({ best, worst }).toEqual({ best: 2019, worst: 2020 });
  });

  test('ties go to the earlier year', () => {
    const { best, worst } = storyFacts(handBuilt('0.1', '0.1'));
    expect({ best, worst }).toEqual({ best: 2019, worst: 2019 });
  });
});
