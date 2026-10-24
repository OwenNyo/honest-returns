import { afterEach, expect, test, vi } from 'vitest';
import { clearLedger, loadLedger, saveLedger } from './saved';

// Spec 10.12 and the Checkpoint 3 addendum: the saved form holds the whole file set.
const KEY = 'honest-returns:ledger:v1';

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

const files = [
  { name: '2024.csv', text: 'date,type\n2024-01-02,DEPOSIT' },
  { name: '2025.csv', text: 'date,type\n2025-01-02,DEPOSIT' },
];
const data = { files, broker: 'ibkr' as const, timing: 'end' as const, exclude: ['ZZZ'] };
const valid = { version: 1, files, broker: 'canonical', timing: 'start', exclude: [], savedAt: '2026-10-24T03:00:00.000Z' };
const stored = (v: unknown) => fakeStorage({ [KEY]: JSON.stringify(v) });

afterEach(() => vi.useRealTimers());

test('saveLedger writes version 1 with files, broker, timing and exclude under honest-returns:ledger:v1', () => {
  const s = fakeStorage();
  saveLedger(s, data);
  expect(JSON.parse(s.getItem(KEY)!)).toMatchObject({ version: 1, ...data });
});

test('loadLedger returns what saveLedger wrote, exclude included', () => {
  const s = fakeStorage();
  saveLedger(s, data);
  const loaded = loadLedger(s);
  expect(loaded).toEqual({ ...data, savedAt: loaded?.savedAt });
});

test('loadLedger returns a stored valid ledger without the version field', () => {
  const { version: _, ...rest } = valid;
  expect(loadLedger(stored(valid))).toEqual(rest);
});

// Spec 16.7: saves from before partial reports have no exclude field.
test('loadLedger reads a missing exclude as an empty list', () => {
  const { version: _, exclude: __, ...rest } = valid;
  expect(loadLedger(stored({ ...valid, exclude: undefined }))).toEqual({ ...rest, exclude: [] });
});

test('savedAt is an ISO date string for the time of saving', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T03:00:00Z'));
  const s = fakeStorage();
  saveLedger(s, data);
  const { savedAt } = JSON.parse(s.getItem(KEY)!);
  expect(savedAt).toMatch(/^2026-10-24/);
});

test('savedAt parses as a date', () => {
  const s = fakeStorage();
  saveLedger(s, data);
  expect(Number.isNaN(Date.parse(JSON.parse(s.getItem(KEY)!).savedAt))).toBe(false);
});

test('loadLedger returns null when nothing is saved', () => {
  expect(loadLedger(fakeStorage())).toBeNull();
});

test('loadLedger returns null when the stored value is not JSON', () => {
  expect(loadLedger(fakeStorage({ [KEY]: '{not json' }))).toBeNull();
});

test.each([
  ['version is 2', { ...valid, version: 2 }],
  ['version is missing', { ...valid, version: undefined }],
  ['the value is not an object', 'a string'],
  ['the value is null', null],
  ['files is missing', { ...valid, files: undefined }],
  ['files is not an array', { ...valid, files: { name: 'a', text: 'b' } }],
  ['files is empty', { ...valid, files: [] }],
  ['a file has no text', { ...valid, files: [{ name: 'a.csv' }] }],
  ['a file name is not a string', { ...valid, files: [{ name: 1, text: 'x' }] }],
  ['a file text is not a string', { ...valid, files: [{ name: 'a.csv', text: null }] }],
  ['a file is not an object', { ...valid, files: ['a.csv'] }],
  ['broker is not ibkr, canonical or moomoo', { ...valid, broker: 'schwab' }],
  ['broker is missing', { ...valid, broker: undefined }],
  ['timing is not start or end', { ...valid, timing: 'middle' }],
  ['timing is missing', { ...valid, timing: undefined }],
  ['exclude is not an array', { ...valid, exclude: 'ZZZ' }],
  ['an exclude entry is not a string', { ...valid, exclude: [1] }],
  ['exclude is null', { ...valid, exclude: null }],
])('loadLedger returns null when %s', (_, value) => {
  expect(loadLedger(stored(value))).toBeNull();
});

// Spec 17.1.8: moomoo is a saved broker.
test('broker moomoo round-trips', () => {
  const s = fakeStorage();
  saveLedger(s, { ...data, broker: 'moomoo' });
  expect(loadLedger(s)?.broker).toBe('moomoo');
});

test('clearLedger removes the saved ledger', () => {
  const s = stored(valid);
  clearLedger(s);
  expect(s.getItem(KEY)).toBeNull();
});
