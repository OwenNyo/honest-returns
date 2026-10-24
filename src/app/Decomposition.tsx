import type Decimal from 'decimal.js';
import type { Decomposition as D } from '../engine/types';
import { formatSgd } from './format';

export const signedSgd = (d: Decimal) => `${d.gt(0) ? '+' : ''}${formatSgd(d)}`;

// Spec 10.5: stacked rows, label left, amount right. Conversion cost is shown as the amount it took away.
export function Decomposition({ d }: { d: D }) {
  const row = (label: string, v: Decimal, cls = '') => (
    <p className={`row ${cls}`}>
      <span>{label}</span>
      <span className="num">{signedSgd(v)}</span>
    </p>
  );
  return (
    <div className="rows">
      {row('Price', d.local)}
      {row('Exchange rate', d.fx)}
      {row('Conversion cost', d.conversionCost.neg())}
      {!d.dividends.isZero() && row('Dividends after tax', d.dividends)}
      {row('Total gain', d.totalGain, 'total')}
    </div>
  );
}
