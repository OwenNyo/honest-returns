import { expect, test } from 'vitest';
import { D } from './decimal';

test('D adds decimals exactly', () => {
  expect(D('0.1').plus('0.2').toString()).toBe('0.3');
});
