import { HEADER } from '../shared/csv';

// Which converter a dropped file needs, from its first line.
export function detectFormat(text: string): 'canonical' | 'ibkr' | 'unknown' {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0];
  if (first.startsWith('Statement,Header,')) return 'ibkr';
  if (first.split(',').map((h) => h.trim().toLowerCase()).join(',') === HEADER) return 'canonical';
  return 'unknown';
}
