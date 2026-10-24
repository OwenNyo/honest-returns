import { describe, expect, test } from 'vitest';
import { D } from '../engine/decimal';
import type { Decomposition } from '../engine/types';
import { decompositionRows } from './Decomposition';

// Spec 17.3.2 Golden D figures, built by hand so these tests read the rows only.
const dec = (o: Partial<Record<keyof Decomposition, string>>): Decomposition => ({
  local: D(o.local ?? '0'),
  fx: D(o.fx ?? '0'),
  conversionCost: D(o.conversionCost ?? '0'),
  fees: D(o.fees ?? '0'),
  dividends: D(o.dividends ?? '0'),
  withholding: D(o.withholding ?? '0'),
  totalGain: D(o.totalGain ?? '0'),
});
const D1 = dec({ local: '140', fx: '104.9', conversionCost: '35', fees: '1.3', totalGain: '208.6' });
const D2 = dec({ local: '140', fx: '104.9', conversionCost: '35', fees: '1.3', dividends: '4.9', withholding: '2.1', totalGain: '213.5' });

const shown = (d: Decomposition) => decompositionRows(d).map((r) => `${r.label} ${r.value.toFixed(2)}`);
const sumAboveTotal = (d: Decomposition) => {
  const rows = decompositionRows(d);
  return rows.slice(0, -1).reduce((s, r) => s.plus(r.value), D(0));
};

describe('decompositionRows (spec 17.3.3)', () => {
  test('D2 rows in order', () => {
    expect(shown(D2)).toEqual([
      'Price 140.00',
      'Exchange rate 104.90',
      'Dividends before tax 7.00',
      'US tax withheld -2.10',
      'Conversion cost -35.00',
      'Trading fees -1.30',
      'Total gain 213.50',
    ]);
  });

  test('the Total gain row is the last row and has total: true', () => {
    const rows = decompositionRows(D2);
    expect(rows.at(-1)).toMatchObject({ label: 'Total gain', total: true });
  });

  test('D1 rows: no dividend or tax rows', () => {
    expect(decompositionRows(D1).map((r) => r.label)).toEqual(['Price', 'Exchange rate', 'Conversion cost', 'Trading fees', 'Total gain']);
  });

  test('rows add up to Total gain exactly on D1', () => {
    expect(sumAboveTotal(D1).eq(D1.totalGain)).toBe(true);
  });

  test('rows add up to Total gain exactly on D2', () => {
    expect(sumAboveTotal(D2).eq(D2.totalGain)).toBe(true);
  });

  test('no fees row when fees are 0', () => {
    const d = dec({ local: '10', fx: '5', conversionCost: '1', totalGain: '14' });
    expect(decompositionRows(d).map((r) => r.label)).not.toContain('Trading fees');
  });
});
