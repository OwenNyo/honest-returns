import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { D } from './decimal';
import * as goldenA from './fixtures/golden-a';
import { annualise, dailyReturns, twr } from './twr';
import type { ValuationPoint } from './types';
import { valueDaily } from './valuation';

function goldenSeries(): ValuationPoint[] {
  const { rows } = parseCsv(goldenA.csv);
  const res = valueDaily({ ledger: rows, prices: goldenA.prices, fx: goldenA.fx, endDate: goldenA.endDate });
  if (!res.ok) throw new Error('Golden A should value: ' + JSON.stringify(res.rejected));
  return res.series;
}

// Hand-built point: only value and flow matter for TWR.
const pt = (date: string, value: string, flow: string): ValuationPoint => ({
  date,
  valueSgd: D(value),
  netFlowSgd: D(flow),
  netInvestedSgd: D(0),
  dailyReturn: D(0),
  fxRate: D(1),
  fxDate: date,
  cash: { SGD: D(0), USD: D(0) },
  holdings: {},
});

describe('dailyReturns on Golden A', () => {
  test('start of day: r = V / (V_prev + F) - 1', () => {
    const { series } = dailyReturns(goldenSeries(), 'start');
    expect(series.map((p) => p.dailyReturn.toFixed(10))).toEqual([
      '0.0000000000',
      '0.0000000000',
      '0.0000000000',
      '0.0324000000',
      D(1998).div('1964.8').minus(1).toFixed(10),
    ]);
  });

  test('end of day: r = (V - F) / V_prev - 1, first day 0', () => {
    const { series } = dailyReturns(goldenSeries(), 'end');
    expect(series.map((p) => p.dailyReturn.toFixed(10))).toEqual([
      '0.0000000000',
      '0.0000000000',
      '0.0000000000',
      D('1464.8').div(1400).minus(1).toFixed(10),
      D(2098).div('2064.8').minus(1).toFixed(10),
    ]);
  });

  test('start-of-day cumulative TWR', () => {
    expect(twr(dailyReturns(goldenSeries(), 'start').series).toFixed(10)).toBe('0.0498448697');
  });

  test('end-of-day cumulative TWR', () => {
    expect(twr(dailyReturns(goldenSeries(), 'end').series).toFixed(10)).toBe('0.0631089832');
  });

  test('Golden A produces no TWR warnings', () => {
    expect(dailyReturns(goldenSeries(), 'start').warnings).toEqual([]);
  });
});

describe('dailyReturns denominators', () => {
  test('zero denominator gives 0 and no warning', () => {
    const res = dailyReturns([pt('2021-01-01', '0', '0'), pt('2021-01-02', '0', '0')], 'start');
    expect(res.series.map((p) => p.dailyReturn.toString())).toEqual(['0', '0']);
    expect(res.warnings).toEqual([]);
  });

  test('negative denominator gives 0 and one twr_negative_base warning naming the date', () => {
    const res = dailyReturns([pt('2021-01-01', '100', '100'), pt('2021-01-02', '10', '-150')], 'start');
    expect(res.series[1].dailyReturn.toString()).toBe('0');
    expect(res.warnings).toEqual([
      {
        code: 'twr_negative_base',
        date: '2021-01-02',
        message: 'TWR skips 2021-01-02: withdrawals exceeded the start-of-day value.',
      },
    ]);
  });
});

describe('annualise', () => {
  test('annualises periods over 365 days', () => {
    const r = annualise(D('0.21'), 731);
    expect(r.value.toFixed(10)).toBe('0.0998565877');
    expect(r.annualised).toBe(true);
    expect(r.days).toBe(731);
  });

  test('reports the cumulative value for 365 days or less', () => {
    const r = annualise(D('0.05'), 365);
    expect(r.value.toString()).toBe('0.05');
    expect(r.annualised).toBe(false);
    expect(r.days).toBe(365);
  });
});
