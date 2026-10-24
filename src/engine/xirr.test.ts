import { describe, expect, test } from 'vitest';
import { D } from './decimal';
import { xirr } from './xirr';

const f = (date: string, amount: string) => ({ date, amount: D(amount) });

// Spec 6.8: XIRR is compared to 1e-9.
function okValue(res: ReturnType<typeof xirr>) {
  if (res.kind !== 'ok') throw new Error('expected ok, got ' + JSON.stringify(res));
  return res;
}
const near = (v: { toString(): string }, expected: number) =>
  expect(Math.abs(Number(v.toString()) - expected)).toBeLessThan(1e-9);

describe('xirr', () => {
  test('Golden A: same-date flows are summed, short period gives cumulative rate', () => {
    const res = okValue(
      xirr(
        [f('2020-08-28', '-1400'), f('2020-08-31', '-600'), f('2020-09-01', '100'), f('2020-09-01', '1998')],
        '2020-09-01',
      ),
    );
    near(res.value, 0.0633663606);
    expect(res.annualised).toBe(false);
    expect(res.multipleRoots).toBe(false);
  });

  test('B1: two flows over 731 days, annualised', () => {
    const res = okValue(xirr([f('2020-01-01', '-1000'), f('2022-01-01', '1210')], '2022-01-01'));
    near(res.value, 0.0998565877);
    expect(res.annualised).toBe(true);
    expect(res.multipleRoots).toBe(false);
  });

  test('B2: two roots, Newton from 0.10 returns 0.1 and flags multiple roots', () => {
    const res = okValue(
      xirr([f('2021-01-01', '-100'), f('2022-01-01', '230'), f('2023-01-01', '-132')], '2023-01-01'),
    );
    near(res.value, 0.1);
    expect(res.multipleRoots).toBe(true);
  });

  test('B3: flows never change sign', () => {
    expect(
      xirr([f('2021-01-01', '-100'), f('2021-06-01', '-50'), f('2022-01-01', '0')], '2022-01-01'),
    ).toEqual({ kind: 'undefined', reason: 'no_sign_change' });
  });

  test('B4: zero-length period', () => {
    expect(xirr([f('2021-01-01', '-100'), f('2021-01-01', '100')], '2021-01-01')).toEqual({
      kind: 'undefined',
      reason: 'period_too_short',
    });
  });

  test('B5: rate far above 1000%', () => {
    expect(xirr([f('2020-01-01', '-100'), f('2021-01-02', '100000')], '2021-01-02')).toEqual({
      kind: 'undefined',
      reason: 'no_root_in_range',
    });
  });

  test('B6: Newton leaves the range, bisection returns -0.95', () => {
    const res = okValue(xirr([f('2021-01-01', '-1000'), f('2022-01-01', '50')], '2022-01-01'));
    near(res.value, -0.95);
    expect(res.annualised).toBe(false);
  });
});
