import type Decimal from 'decimal.js';
import type { Decomposition as D } from '../engine/types';
import { formatSgd } from './format';

export const signedSgd = (d: Decimal) => `${d.gt(0) ? '+' : ''}${formatSgd(d)}`;

// Spec 17.3.3: every row above Total gain adds up to it exactly. Costs are shown as the amount they took away.
export function decompositionRows(d: D): { label: string; value: Decimal; total?: true }[] {
  const hasDividends = !d.dividends.isZero() || !d.withholding.isZero();
  return [
    { label: 'Price', value: d.local },
    { label: 'Exchange rate', value: d.fx },
    ...(hasDividends ? [{ label: 'Dividends before tax', value: d.dividends.plus(d.withholding) }] : []),
    ...(d.withholding.isZero() ? [] : [{ label: 'US tax withheld', value: d.withholding.neg() }]),
    { label: 'Conversion cost', value: d.conversionCost.neg() },
    ...(d.fees.isZero() ? [] : [{ label: 'Trading fees', value: d.fees.neg() }]),
    { label: 'Total gain', value: d.totalGain, total: true as const },
  ];
}

// Spec 10.5: stacked rows, label left, amount right.
export function Decomposition({ d }: { d: D }) {
  return (
    <div className="rows">
      {decompositionRows(d).map((r) => (
        <p key={r.label} className={r.total ? 'row total' : 'row'}>
          <span>{r.label}</span>
          <span className="num">{signedSgd(r.value)}</span>
        </p>
      ))}
    </div>
  );
}
