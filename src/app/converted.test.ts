import { expect, test } from 'vitest';
import { convertedName } from './ConvertedDownloads';

// Spec 18.1.3: the converted file keeps the name before the last dot. The button and saveBlob are not tested here.
test('a .csv name gets -converted before the extension', () => {
  expect(convertedName('U1234567_2024.csv')).toBe('U1234567_2024-converted.csv');
});

test('a name with no extension gets -converted.csv', () => {
  expect(convertedName('statement')).toBe('statement-converted.csv');
});

test('a name with several dots keeps everything before the last dot', () => {
  expect(convertedName('a.b.csv')).toBe('a.b-converted.csv');
});
