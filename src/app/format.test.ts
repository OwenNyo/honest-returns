import { expect, test } from 'vitest';
import { D } from '../engine/decimal';
import { excludingClause, formatPct, formatSgd, formatShare, listTickers, riskText, yearLabel } from './format';

test('formatPct puts a plus sign on a positive rate and rounds to 1 dp', () => {
  expect(formatPct(D('0.142349'), 1)).toBe('+14.2%');
});

test('formatPct keeps the trailing zero on a negative rate', () => {
  expect(formatPct(D('-0.03'), 1)).toBe('-3.0%');
});

test('formatPct rounds to 2 dp when asked', () => {
  expect(formatPct(D('0.0498448697'), 2)).toBe('+4.98%');
});

test('formatSgd groups thousands and shows 2 dp', () => {
  expect(formatSgd(D('1234.56'))).toBe('SGD 1,234.56');
});

test('formatSgd puts the minus sign before the currency', () => {
  expect(formatSgd(D('-312'))).toBe('-SGD 312.00');
});

// Spec 16.6: ticker lists and the share of what was bought.
test('listTickers gives one ticker as is', () => {
  expect(listTickers(['ZZZ'])).toBe('ZZZ');
});

test('listTickers joins two tickers with and', () => {
  expect(listTickers(['YYY', 'ZZZ'])).toBe('YYY and ZZZ');
});

test('listTickers joins three tickers with commas and a final and', () => {
  expect(listTickers(['XXX', 'YYY', 'ZZZ'])).toBe('XXX, YYY and ZZZ');
});

test('formatShare rounds to a whole percent', () => {
  expect(formatShare(D('0.5004995005'))).toBe('50%');
});

test('formatShare shows a share above 0 that rounds to 0 as less than 1%', () => {
  expect(formatShare(D('0.004'))).toBe('less than 1%');
});

test('formatShare shows 0 as 0%', () => {
  expect(formatShare(D(0))).toBe('0%');
});

test('formatShare shows 1 as 100%', () => {
  expect(formatShare(D(1))).toBe('100%');
});

test('excludingClause names one or two tickers', () => {
  expect(excludingClause({ tickers: ['ZZZ'], share: D('0.5') })).toBe('excluding ZZZ, 50% of what was bought');
  expect(excludingClause({ tickers: ['YYY', 'ZZZ'], share: D('0.5') })).toBe('excluding YYY and ZZZ, 50% of what was bought');
});

test('excludingClause gives a count for three or more tickers', () => {
  expect(excludingClause({ tickers: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], share: D('0.86') })).toBe('excluding 8 holdings, 86% of what was bought');
});

// Spec 17.4: a full calendar year shows the year alone; a partial year shows its days.
const year = (y: number, days: number) => yearLabel({ year: y, twr: D(0), days });

test('yearLabel shows a full leap year as the year alone', () => {
  expect(year(2020, 366)).toBe('2020');
});

test('yearLabel shows a full common year as the year alone', () => {
  expect(year(2021, 365)).toBe('2021');
});

test('yearLabel shows a partial year with its days', () => {
  expect(year(2019, 364)).toBe('2019 (364 days)');
});

test('yearLabel shows 365 days of a leap year as partial', () => {
  expect(year(2024, 365)).toBe('2024 (365 days)');
});

// Spec 17.2.3: the prose under Largest fall and volatility.
test('riskText names the largest fall, its dates and the volatility sentence', () => {
  expect(
    riskText({ maxDrawdown: D('-0.2892571569'), peakDate: '2020-02-14', troughDate: '2020-03-23', volatility: D('0.2496930424') }),
  ).toBe(
    'The largest fall of the TWR line from an earlier high was 28.9%, from 14 Feb 2020 to 23 Mar 2020. Volatility is how far daily returns swing, as a standard deviation scaled to a year. Both use the daily returns behind TWR, so a withdrawal is not a fall and a deposit does not hide one.',
  );
});

test('riskText with no fall and no volatility says the line never fell and that 90 days are needed', () => {
  expect(riskText({ maxDrawdown: D(0), peakDate: null, troughDate: null, volatility: null })).toBe(
    'The TWR line never fell below an earlier high. Volatility is how far daily returns swing, as a standard deviation scaled to a year. It needs at least 90 days of data. Both use the daily returns behind TWR, so a withdrawal is not a fall and a deposit does not hide one.',
  );
});
