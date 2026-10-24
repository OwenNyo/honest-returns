import type Decimal from 'decimal.js';
import type { IsoDate } from '../engine/types';
import type { Excluded } from './upload';

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

// Spec 16.6: 'ZZZ', 'YYY and ZZZ', 'XXX, YYY and ZZZ'.
export const listTickers = (t: string[]) => (t.length < 2 ? t.join('') : `${t.slice(0, -1).join(', ')} and ${t.at(-1)}`);

// Spec 16.3: whole percent, half-even (the D default); a share above 0 never shows as 0%.
export function formatShare(d: Decimal): string {
  const pct = d.times(100).toFixed(0);
  return pct === '0' && d.gt(0) ? 'less than 1%' : `${pct}%`;
}

// Spec 16.6: the share card and the PDF give the count only, never a ticker.
export const excludesLine = ({ tickers, share }: Excluded) =>
  `Excludes ${tickers.length} holding${tickers.length > 1 ? 's' : ''}, ${formatShare(share)} of what was bought.`;

// Spec 16.6: the result title names one or two tickers; three or more become a count, as the notice lists them.
export const excludingClause = ({ tickers, share }: Excluded) =>
  `excluding ${tickers.length > 2 ? `${tickers.length} holdings` : listTickers(tickers)}, ${formatShare(share)} of what was bought`;
