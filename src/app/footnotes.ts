import type { FlowTiming } from '../engine/types';

// Spec 15.3.3, exact text: the single source for the PDF statement and the methodology page.
export const FOOTNOTES = {
  a: (timing: FlowTiming) =>
    `TWR, time-weighted return. Each day's return is the change in value with that day's deposits and withdrawals taken out, and the daily returns are chained over the period. Deposits and withdrawals count at the ${timing} of the day. Periods over 365 days are annualised with a 365-day year; shorter periods show the total.`,
  b: "XIRR, money-weighted return. The one yearly rate at which your deposits, your withdrawals and the final value balance to zero, using a 365-day year. Solved by Newton's method from 10%, with a bisection fallback between -99% and 1000%. For periods of 365 days or less it is the total return over the period.",
  c: 'Prices are unadjusted daily closes from Tiingo, with splits applied on the split date. The USD/SGD rate is the ECB reference rate from Frankfurter. On days without a close or a rate, the last one is carried forward. Values are in SGD at the end of each calendar day.',
};
