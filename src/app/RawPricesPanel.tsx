import { useMemo } from 'react';
import { adjustedCloseTwr } from '../engine/adjusted';
import type { ComputeInput, RateResult } from '../engine/types';
import { formatPct } from './format';

// Spec 10.9 panel copy, for the result's own ledger and prices.
export function rawPricesText(input: ComputeInput, twr: RateResult, possessive: 'your' | 'their' = 'your'): string {
  const adjusted = adjustedCloseTwr(input);
  const pp = twr.value.minus(adjusted).abs().times(100).toFixed(1);
  return (
    `Valuing ${possessive} shares with adjusted close would give a TWR of ${formatPct(adjusted, 1)} instead of ${formatPct(twr.value, 1)}, ` +
    `a difference of ${pp} points. Adjusted close rewrites past prices to include later dividends and splits. ` +
    'That is right for one buy-and-hold position, but once money is added over time it values earlier holdings at prices that never traded.'
  );
}

export function RawPricesPanel({ input, twr, possessive }: { input: ComputeInput; twr: RateResult; possessive?: 'your' | 'their' }) {
  const text = useMemo(() => rawPricesText(input, twr, possessive), [input, twr, possessive]);
  return <p className="section-intro">{text}</p>;
}
