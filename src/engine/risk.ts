import type Decimal from 'decimal.js';
import { DAYS_PER_YEAR } from './constants';
import { D } from './decimal';
import type { Risk, ValuationPoint } from './types';

// Spec 17.2.1: largest fall of the TWR index from its running peak. The start (index 1) is a peak dated on the first day.
export function maxDrawdown(series: ValuationPoint[]): Omit<Risk, 'volatility'> {
  let index = D(1);
  let peak = D(1);
  let peakAt = series[0].date;
  let worst = D(0);
  let peakDate: string | null = null;
  let troughDate: string | null = null;
  for (const p of series) {
    index = index.times(p.dailyReturn.plus(1));
    if (index.gt(peak)) {
      peak = index;
      peakAt = p.date;
    }
    const dd = index.div(peak).minus(1);
    // Rounded so a tie decided by Decimal noise keeps the earliest trough (spec 17.2.1).
    if (dd.toDecimalPlaces(20).lt(worst.toDecimalPlaces(20))) {
      worst = dd;
      peakDate = peakAt;
      troughDate = p.date;
    }
  }
  return { maxDrawdown: worst, peakDate, troughDate };
}

// Spec 17.2.1: sample standard deviation of every calendar day's return, scaled by sqrt(365). Needs at least 2 points.
export function volatility(series: ValuationPoint[]): Decimal {
  const n = series.length;
  const mean = series.reduce((s, p) => s.plus(p.dailyReturn), D(0)).div(n);
  const ss = series.reduce((s, p) => s.plus(p.dailyReturn.minus(mean).pow(2)), D(0));
  return ss.div(n - 1).times(DAYS_PER_YEAR).sqrt();
}
