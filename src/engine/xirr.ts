import type Decimal from 'decimal.js';
import { daysBetween } from '../shared/dates';
import { D } from './decimal';
import type { IsoDate, XirrResult } from './types';

const LO = -0.99;
const HI = 10;
const TOL = 1e-12;

// Spec 6.7. Float64 by design (spec 6.8): a root-finder on a rate is not a money path.
export function xirr(flows: { date: IsoDate; amount: Decimal }[], endDate: IsoDate): XirrResult {
  const byDate = new Map<IsoDate, number>();
  for (const f of flows) byDate.set(f.date, (byDate.get(f.date) ?? 0) + Number(f.amount.toString()));
  const start = [...byDate.keys()].sort()[0];
  const T = daysBetween(start, endDate);
  if (T === 0) return { kind: 'undefined', reason: 'period_too_short' };
  const Y = T > 365 ? 365 : T;
  const cf = [...byDate].filter(([, a]) => a !== 0).map(([d, a]) => ({ a, t: daysBetween(start, d) / Y }));
  if (!cf.some((c) => c.a > 0) || !cf.some((c) => c.a < 0)) return { kind: 'undefined', reason: 'no_sign_change' };

  const f = (r: number) => cf.reduce((s, c) => s + c.a * (1 + r) ** -c.t, 0);
  const df = (r: number) => cf.reduce((s, c) => s - c.t * c.a * (1 + r) ** (-c.t - 1), 0);

  const root = newton(f, df) ?? bisect(f);
  if (root === null) return { kind: 'undefined', reason: 'no_root_in_range' };

  let changes = 0;
  let prevSign = 0;
  for (let k = 0; k <= 1099; k++) {
    const sign = Math.sign(f((k - 99) / 100));
    if (sign === 0) continue;
    if (prevSign !== 0 && sign !== prevSign) changes++;
    prevSign = sign;
  }
  return { kind: 'ok', value: D(root.toString()), annualised: T > 365, multipleRoots: changes > 1 };
}

function newton(f: (r: number) => number, df: (r: number) => number): number | null {
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const d = df(r);
    if (d === 0) return null;
    const next = r - f(r) / d;
    if (!Number.isFinite(next) || next < LO || next > HI) return null;
    if (Math.abs(next - r) < TOL) return next;
    r = next;
  }
  return null;
}

function bisect(f: (r: number) => number): number | null {
  let lo = LO;
  let hi = HI;
  let flo = f(lo);
  if (Math.sign(flo) === Math.sign(f(hi))) return null;
  for (let i = 0; i < 200 && hi - lo >= TOL; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}
