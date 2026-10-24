import type Decimal from 'decimal.js';
import type { IsoDate } from '../engine/types';

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Display rounding only (spec 6.1); the engine never rounds.
export const formatPct = (d: Decimal, dp: 1 | 2) => `${d.gte(0) ? '+' : ''}${d.times(100).toFixed(dp)}%`;

export function formatSgd(d: Decimal): string {
  const [int, frac] = d.abs().toFixed(2).split('.');
  return `${d.lt(0) ? '-' : ''}SGD ${group(int)}.${frac}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2025-06-30' -> '30 Jun 2025'
export const formatDate = (d: IsoDate) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
