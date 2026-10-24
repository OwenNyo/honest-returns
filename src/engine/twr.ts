import type Decimal from 'decimal.js';
import { D } from './decimal';
import type { FlowTiming, RateResult, ValuationPoint, Warning } from './types';

// Spec 6.6: fills dailyReturn. V_{-1} = 0; a zero or negative denominator gives r = 0.
export function dailyReturns(
  series: ValuationPoint[],
  timing: FlowTiming,
): { series: ValuationPoint[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  let prev = D(0);
  const out = series.map((p) => {
    const denom = timing === 'start' ? prev.plus(p.netFlowSgd) : prev;
    const numer = timing === 'start' ? p.valueSgd : p.valueSgd.minus(p.netFlowSgd);
    prev = p.valueSgd;
    if (denom.isNeg()) {
      warnings.push({
        code: 'twr_negative_base',
        date: p.date,
        message: `TWR skips ${p.date}: withdrawals exceeded the start-of-day value.`,
      });
    }
    const dailyReturn = denom.gt(0) ? numer.div(denom).minus(1) : D(0);
    return { ...p, dailyReturn };
  });
  return { series: out, warnings };
}

export function twr(series: ValuationPoint[]): Decimal {
  return series.reduce((acc, p) => acc.times(p.dailyReturn.plus(1)), D(1)).minus(1);
}

export function annualise(cumulative: Decimal, days: number): RateResult {
  if (days <= 365) return { value: cumulative, annualised: false, days };
  return { value: D.pow(cumulative.plus(1), D(365).div(days)).minus(1), annualised: true, days };
}
