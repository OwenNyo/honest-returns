import { expect, test } from 'vitest';
import { numberLineScale } from './numberline';

// Spec 11.4: floor(min(0, twr, xirr) / 5) x 5 to ceil(max(0, twr, xirr) / 5) x 5, ticks every 5.
test('positive rates scale from 0 up to the next multiple of 5', () => {
  expect(numberLineScale(14.2, 11.8)).toEqual({ min: 0, max: 15, ticks: [0, 5, 10, 15] });
});

test('a negative rate extends the scale below 0', () => {
  expect(numberLineScale(-7, 3)).toEqual({ min: -10, max: 5, ticks: [-10, -5, 0, 5] });
});

test('a wide range steps up so the line keeps at most 7 ticks', () => {
  expect(numberLineScale(135, 12)).toEqual({ min: 0, max: 150, ticks: [0, 25, 50, 75, 100, 125, 150] });
});
