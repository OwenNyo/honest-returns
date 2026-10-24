import { expect, test } from 'vitest';
import { SECTIONS } from './sections';

// Spec 15.1.5: the Analyse sections and their order live in one array. Later tasks add entries.
const SPEC = [
  { id: 'returns', title: 'Returns' },
  { id: 'decomposition', title: 'Where the gain came from' },
  { id: 'dividends', title: 'Dividends' },
  { id: 'benchmark', title: 'Against a single fund' },
  { id: 'raw-prices', title: 'Why raw prices' },
];

test('Returns is the first section', () => {
  expect(SECTIONS[0]).toEqual({ id: 'returns', title: 'Returns' });
});

test('every section is one of the spec sections, with its spec title, in spec order', () => {
  const present = new Set(SECTIONS.map((s) => s.id));
  expect(SECTIONS).toEqual(SPEC.filter((s) => present.has(s.id)));
});
