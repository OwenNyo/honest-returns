import type Decimal from 'decimal.js';
import { compute } from './compute';
import { D } from './decimal';
import type { ComputeInput, PriceBar } from './types';

// Spec 10.9, CRSP style, walking backwards: each ex-date scales earlier closes by 1 / splitFactor and
// 1 - divCash / prior close. divCash is restated per today's share (divided by later splits) so the cash
// paid on rebased quantities stays the same.
export function adjustedSeries(bars: PriceBar[]): PriceBar[] {
  const out: PriceBar[] = [];
  let factor = D(1);
  let laterSplits = D(1);
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i];
    out.unshift({ date: b.date, close: b.close.times(factor), splitFactor: D(1), divCash: b.divCash.div(laterSplits) });
    if (i > 0) factor = factor.div(b.splitFactor).times(D(1).minus(b.divCash.div(bars[i - 1].close)));
    laterSplits = laterSplits.times(b.splitFactor);
  }
  return out;
}

// TWR with adjusted closes; share quantities restated in today's basis (times the later split factors).
export function adjustedCloseTwr(input: ComputeInput): Decimal {
  const prices = Object.fromEntries(Object.entries(input.prices).map(([t, bars]) => [t, adjustedSeries(bars)]));
  const ledger = input.ledger.map((r) => {
    if (r.type !== 'BUY' && r.type !== 'SELL' && !(r.type === 'OPENING' && r.ticker)) return r;
    const later = input.prices[r.ticker!].filter((b) => b.date > r.date).reduce((p, b) => p.times(b.splitFactor), D(1));
    return { ...r, quantity: r.quantity!.times(later) };
  });
  const res = compute({ ...input, prices, ledger });
  if (!res.ok) throw new Error('adjusted-close run rejected: ' + JSON.stringify(res.rejected));
  return res.twr.value;
}
