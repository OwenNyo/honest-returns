import { expect, test } from 'vitest';
import { D } from '../engine/decimal';
import { formatPct, formatSgd } from './format';

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
