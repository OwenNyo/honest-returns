import { expect, test } from 'vitest';
import { FOOTNOTES } from './footnotes';

// Spec 15.3.3, exact text.
const A = (when: 'start' | 'end') =>
  `TWR, time-weighted return. Each day's return is the change in value with that day's deposits and withdrawals taken out, and the daily returns are chained over the period. Deposits and withdrawals count at the ${when} of the day. Periods over 365 days are annualised with a 365-day year; shorter periods show the total.`;
const B =
  "XIRR, money-weighted return. The one yearly rate at which your deposits, your withdrawals and the final value balance to zero, using a 365-day year. Solved by Newton's method from 10%, with a bisection fallback between -99% and 1000%. For periods of 365 days or less it is the total return over the period.";
const C =
  'Prices are unadjusted daily closes from Tiingo, with splits applied on the split date. The USD/SGD rate is the ECB reference rate from Frankfurter. On days without a close or a rate, the last one is carried forward. Values are in SGD at the end of each calendar day.';

test('footnote a for start-of-day timing', () => {
  expect(FOOTNOTES.a('start')).toBe(A('start'));
});

test('footnote a for end-of-day timing', () => {
  expect(FOOTNOTES.a('end')).toBe(A('end'));
});

test('footnote b', () => {
  expect(FOOTNOTES.b).toBe(B);
});

test('footnote c', () => {
  expect(FOOTNOTES.c).toBe(C);
});

test('no footnote contains an em dash', () => {
  for (const s of [FOOTNOTES.a('start'), FOOTNOTES.a('end'), FOOTNOTES.b, FOOTNOTES.c]) expect(s).not.toContain('—');
});
