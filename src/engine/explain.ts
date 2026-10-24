import type Decimal from 'decimal.js';
import { D } from './decimal';
import type { IsoDate, RateResult, ValuationPoint, XirrResult, YearReturn } from './types';

const MIN_DAYS = 90; // shorter years are not candidates for best or worst year
const SMALL_GAP = 0.5; // percentage points

// TWR chained within each calendar year from dailyReturn, with the number of days in the series.
export function yearlyTwr(series: ValuationPoint[]): YearReturn[] {
  const out: { year: number; growth: Decimal; days: number }[] = [];
  for (const p of series) {
    const year = Number(p.date.slice(0, 4));
    let cur = out[out.length - 1];
    if (!cur || cur.year !== year) out.push((cur = { year, growth: D(1), days: 0 }));
    cur.growth = cur.growth.times(p.dailyReturn.plus(1));
    cur.days++;
  }
  return out.map(({ year, growth, days }) => ({ year, twr: growth.minus(1), days }));
}

const pct1 = (d: Decimal) => d.abs().times(100).toFixed(1);

// Spec 10.7. First matching rule wins.
export function explainGap(input: {
  twr: RateResult;
  xirr: XirrResult;
  yearReturns: YearReturn[];
  deposits: { date: IsoDate; amount: Decimal }[];
}, possessive: 'your' | 'their' = 'your'): string {
  const { twr, xirr, deposits } = input;
  if (xirr.kind === 'undefined') {
    if (xirr.reason === 'no_sign_change') return 'XIRR cannot be calculated because the cash flows never change sign.';
    if (xirr.reason === 'no_root_in_range')
      return 'XIRR cannot be calculated because no rate between -99% and 1000% balances the cash flows.';
    return 'XIRR needs at least two different dates.';
  }
  const gap = xirr.value.minus(twr.value).times(100);
  if (gap.abs().lt(SMALL_GAP))
    return `TWR and XIRR are within 0.5 points, so the timing of ${possessive} deposits made little difference.`;

  // Ties go to the earliest year: only a strictly better year replaces the current pick.
  const years = input.yearReturns.filter((y) => y.days >= MIN_DAYS);
  const pick = (better: (a: Decimal, b: Decimal) => boolean) =>
    years.reduce<YearReturn | undefined>((acc, y) => (!acc || better(y.twr, acc.twr) ? y : acc), undefined);
  const best = pick((a, b) => a.gt(b));
  const worst = pick((a, b) => a.lt(b));
  const total = deposits.reduce((s, d) => s.plus(d.amount), D(0));
  const share = (inWindow: (date: IsoDate) => boolean) =>
    deposits.filter((d) => inWindow(d.date)).reduce((s, d) => s.plus(d.amount), D(0)).div(total);
  const before = (y: number) => share((d) => d < `${y}-01-01`);
  const after = (y: number) => share((d) => d > `${y}-12-31`);
  const whole = (s: Decimal) => s.times(100).toFixed(0);
  const worstFell = worst && worst.twr.lt(0) ? worst : undefined;
  const bestRose = best && best.twr.gt(0) ? best : undefined;

  if (gap.lt(0)) {
    if (worstFell && before(worstFell.year).gte(0.5))
      return `XIRR is lower than TWR because ${whole(before(worstFell.year))}% of ${possessive} deposits arrived before the ${worstFell.year} fall of ${pct1(worstFell.twr)}%.`;
    if (bestRose && after(bestRose.year).gte(0.5))
      return `XIRR is lower than TWR because ${whole(after(bestRose.year))}% of ${possessive} deposits arrived after ${bestRose.year}, the strongest year (+${pct1(bestRose.twr)}%).`;
    return `XIRR is lower than TWR because more of ${possessive} money was invested in the weaker periods than in the stronger ones.`;
  }
  if (bestRose && before(bestRose.year).gte(0.5))
    return `XIRR is higher than TWR because ${whole(before(bestRose.year))}% of ${possessive} deposits arrived before the ${bestRose.year} gain of ${pct1(bestRose.twr)}%.`;
  if (worstFell && after(worstFell.year).gte(0.5))
    return `XIRR is higher than TWR because ${whole(after(worstFell.year))}% of ${possessive} deposits arrived after the ${worstFell.year} fall of ${pct1(worstFell.twr)}%.`;
  return `XIRR is higher than TWR because more of ${possessive} money was invested in the stronger periods than in the weaker ones.`;
}
