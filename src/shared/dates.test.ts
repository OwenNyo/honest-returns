import { describe, expect, test } from 'vitest';
import { addDays, daysBetween, isIsoDate } from './dates';

describe('daysBetween', () => {
  test('counts calendar days across a leap year', () => {
    expect(daysBetween('2020-01-01', '2022-01-01')).toBe(731);
  });

  test('is zero for the same date', () => {
    expect(daysBetween('2021-01-01', '2021-01-01')).toBe(0);
  });
});

describe('addDays', () => {
  test('lands on 29 February in a leap year', () => {
    expect(addDays('2020-02-28', 1)).toBe('2020-02-29');
  });

  test('crosses a year boundary', () => {
    expect(addDays('2020-12-31', 1)).toBe('2021-01-01');
  });
});

describe('isIsoDate', () => {
  test('accepts a real YYYY-MM-DD date', () => {
    expect(isIsoDate('2020-02-29')).toBe(true);
  });

  test('rejects a date that does not exist', () => {
    expect(isIsoDate('2021-02-30')).toBe(false);
  });

  test('rejects other date formats', () => {
    expect(isIsoDate('02/03/2021')).toBe(false);
  });
});
