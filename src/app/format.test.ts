import { expect, test } from 'vitest';
import { D } from '../engine/decimal';
import { excludingClause, formatPct, formatSgd, formatShare, listTickers } from './format';

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
