import { expect, test } from 'vitest';
import { flowTiming, twoNumbers } from './methodModels';

const near = (d: { toNumber(): number }, expected: number) => expect(Math.abs(d.toNumber() - expected)).toBeLessThan(0.0005);

test('two numbers at the default deposits give the figures the page shows', () => {
  const m = twoNumbers([1000, 5000, 1000]);
  near(m.twr, 0.041);
  near(m.xirr, 0.024);
});

test('two numbers: TWR does not change with the size of the middle deposit', () => {
  expect(twoNumbers([1000, 500, 1000]).twr.toString()).toBe(twoNumbers([1000, 5000, 1000]).twr.toString());
});

test('flow timing gives different TWRs for start and end of day', () => {
  expect(flowTiming('start').eq(flowTiming('end'))).toBe(false);
});
