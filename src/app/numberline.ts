const STEPS = [5, 10, 20, 25, 50, 100];
const MAX_TICKS = 7; // at 360 px, 8 or more labels such as "120%" run into each other

// Spec 11.4: the step is the smallest of 5, 10, 20, 25, 50, 100 that keeps the line to at most 7 ticks; the scale runs
// from floor(min(0, twr, xirr) / step) x step to ceil(max(0, twr, xirr) / step) x step. Inputs in percent.
export function numberLineScale(twr: number, xirr: number): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(0, twr, xirr);
  const hi = Math.max(0, twr, xirr);
  // ponytail: past a 600-point range even the 100 step gives more than 7 ticks; it is drawn denser. Add steps if that happens.
  const step = STEPS.find((s) => Math.ceil(hi / s) - Math.floor(lo / s) + 1 <= MAX_TICKS) ?? 100;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return { min, max, ticks };
}
