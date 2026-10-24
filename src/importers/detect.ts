import { HEADER, splitLine } from '../shared/csv';

// Which converter a dropped file needs, from its first line.
export function detectFormat(text: string): 'canonical' | 'ibkr' | 'moomoo' | 'unknown' {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0];
  if (first.startsWith('Statement,Header,')) return 'ibkr';
  if (first.split(',').map((h) => h.trim().toLowerCase()).join(',') === HEADER) return 'canonical';
  const cells = splitLine(first).map((c) => c.trim());
  if (['Side', 'Symbol', 'Fill Qty'].every((c) => cells.includes(c))) return 'moomoo';
  return 'unknown';
}
