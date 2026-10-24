import { describe, expect, test } from 'vitest';
import { D } from './decimal';
import { explainGap, yearlyTwr } from './explain';
import type { IsoDate, RateResult, ValuationPoint, XirrResult } from './types';

const rate = (v: string): RateResult => ({ value: D(v), annualised: true, days: 2000 });
const xirrOk = (v: string): XirrResult => ({ kind: 'ok', value: D(v), annualised: true, multipleRoots: false });
const yr = (year: number, twr: string) => ({ year, twr: D(twr), days: 365 });
const dep = (date: IsoDate, amount: number) => ({ date, amount: D(amount) });

// One point per calendar day; dailyReturn set on the given dates, 0 elsewhere.
function series(from: IsoDate, to: IsoDate, returns: Record<IsoDate, string>): ValuationPoint[] {
  const out: ValuationPoint[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({
      date,
      valueSgd: D(0),
      netFlowSgd: D(0),
      netInvestedSgd: D(0),
      dailyReturn: D(returns[date] ?? 0),
      fxRate: D(1),
      fxDate: date,
      cash: { SGD: D(0), USD: D(0) },
      holdings: {},
    });
  }
  return out;
}

describe('yearlyTwr', () => {
  test('chains daily returns within each calendar year and counts days', () => {
    const s = series('2019-01-01', '2020-12-31', { '2019-03-01': '0.1', '2019-09-02': '-0.5', '2020-05-04': '0.2' });
    const got = yearlyTwr(s).map((y) => ({ year: y.year, twr: y.twr.toFixed(10), days: y.days }));
    expect(got).toEqual([
      { year: 2019, twr: '-0.4500000000', days: 365 },
      { year: 2020, twr: '0.2000000000', days: 366 },
    ]);
  });
});

describe('explainGap, spec 10.7 rules', () => {
  test('rule 1: no_sign_change', () => {
    const s = explainGap({ twr: rate('0.1'), xirr: { kind: 'undefined', reason: 'no_sign_change' }, yearReturns: [], deposits: [] });
    expect(s).toBe('XIRR cannot be calculated because the cash flows never change sign.');
  });

  test('rule 2: no_root_in_range', () => {
    const s = explainGap({ twr: rate('0.1'), xirr: { kind: 'undefined', reason: 'no_root_in_range' }, yearReturns: [], deposits: [] });
    expect(s).toBe('XIRR cannot be calculated because no rate between -99% and 1000% balances the cash flows.');
  });

  test('rule 3: period_too_short', () => {
    const s = explainGap({ twr: rate('0.1'), xirr: { kind: 'undefined', reason: 'period_too_short' }, yearReturns: [], deposits: [] });
    expect(s).toBe('XIRR needs at least two different dates.');
  });

  test('rule 4: gap under 0.5 points', () => {
    const s = explainGap({
      twr: rate('0.10'),
      xirr: xirrOk('0.098'),
      yearReturns: [yr(2019, '0.312'), yr(2022, '-0.181')],
      deposits: [dep('2019-01-02', 15), dep('2022-06-01', 85)],
    });
    expect(s).toBe('TWR and XIRR are within 0.5 percentage points, so the timing of your deposits made little difference.');
  });

  test('rule 5: lower, most deposits before the worst year', () => {
    const s = explainGap({
      twr: rate('0.10'),
      xirr: xirrOk('0.05'),
      yearReturns: [yr(2019, '0.1'), yr(2022, '-0.181')],
      deposits: [dep('2019-01-02', 60), dep('2023-01-02', 40)],
    });
    expect(s).toBe('XIRR is lower than TWR because 60% of your deposits arrived before the 2022 fall of 18.1%.');
  });

  test('rule 6: lower, most deposits after the best year', () => {
    const s = explainGap({
      twr: rate('0.10'),
      xirr: xirrOk('0.05'),
      yearReturns: [yr(2019, '0.312'), yr(2022, '-0.181')],
      deposits: [dep('2019-01-02', 15), dep('2022-06-01', 85)],
    });
    expect(s).toBe('XIRR is lower than TWR because 85% of your deposits arrived after 2019, the strongest year (+31.2%).');
  });

  test('rule 7: lower, no year explains it', () => {
    const s = explainGap({
      twr: rate('0.10'),
      xirr: xirrOk('0.05'),
      yearReturns: [yr(2019, '-0.1'), yr(2021, '0.2')],
      deposits: [dep('2020-06-01', 100)],
    });
    expect(s).toBe('XIRR is lower than TWR because more of your money was invested in the weaker periods than in the stronger ones.');
  });

  test('rule 8: higher, most deposits before the best year', () => {
    const s = explainGap({
      twr: rate('0.05'),
      xirr: xirrOk('0.10'),
      yearReturns: [yr(2021, '0.25'), yr(2022, '-0.1')],
      deposits: [dep('2019-01-02', 70), dep('2022-01-03', 30)],
    });
    expect(s).toBe('XIRR is higher than TWR because 70% of your deposits arrived before the 2021 gain of 25.0%.');
  });

  test('rule 9: higher, most deposits after the worst year', () => {
    const s = explainGap({
      twr: rate('0.05'),
      xirr: xirrOk('0.10'),
      yearReturns: [yr(2019, '0.1'), yr(2020, '-0.2')],
      deposits: [dep('2019-01-02', 10), dep('2021-01-04', 90)],
    });
    expect(s).toBe('XIRR is higher than TWR because 90% of your deposits arrived after the 2020 fall of 20.0%.');
  });

  test('rule 10: higher, no year explains it', () => {
    const s = explainGap({
      twr: rate('0.05'),
      xirr: xirrOk('0.10'),
      yearReturns: [yr(2019, '0.1'), yr(2021, '-0.2')],
      deposits: [dep('2020-06-01', 100)],
    });
    expect(s).toBe('XIRR is higher than TWR because more of your money was invested in the stronger periods than in the weaker ones.');
  });

  test('a tie for best year picks the earlier year', () => {
    const s = explainGap({
      twr: rate('0.10'),
      xirr: xirrOk('0.05'),
      yearReturns: [yr(2019, '0.2'), yr(2020, '0.2'), yr(2022, '-0.05')],
      deposits: [dep('2019-01-02', 10), dep('2020-06-01', 30), dep('2022-06-01', 60)],
    });
    expect(s).toBe('XIRR is lower than TWR because 90% of your deposits arrived after 2019, the strongest year (+20.0%).');
  });

  test('years with fewer than 90 days in the series are not candidates for best year', () => {
    // 2019: full year, +10%. 2020: 61 days, +50% (would be best if counted).
    const s = series('2019-01-01', '2020-03-01', { '2019-06-03': '0.1', '2020-02-03': '0.5' });
    const out = explainGap({
      twr: rate('0.10'),
      xirr: xirrOk('0.05'),
      yearReturns: yearlyTwr(s),
      deposits: [dep('2019-01-01', 10), dep('2020-02-01', 90)],
    });
    expect(out).toBe('XIRR is lower than TWR because 90% of your deposits arrived after 2019, the strongest year (+10.0%).');
  });
});
