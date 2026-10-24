import type Decimal from 'decimal.js';
import { compute } from './compute';
import { D } from './decimal';
import type { ComputeInput, ComputeResult, IsoDate, LedgerRow, PriceBar } from './types';
import { valueDaily } from './valuation';

export const BENCHMARKS = ['VOO', 'VT', 'QQQ'] as const; // VOO is the default

// Latest item dated before d (start-of-day timing) or on or before d (end-of-day timing).
const latest = <T extends { date: IsoDate }>(xs: T[], d: IsoDate, end: boolean) =>
  xs.findLast((x) => (end ? x.date <= d : x.date < d));

// Spec 10.14: each day's net SGD inflow converts at the reference rate with no cost into fractional shares
// of `ticker`; each net outflow sells enough shares and converts back. Flows come from the user's valuation,
// so opening balances (decision 2) count as an inflow like a deposit.
// ponytail: withdrawals sell shares only; ex-date dividend cash stays idle in USD and does not fund them.
export function shadowLedger(input: ComputeInput, ticker: string): LedgerRow[] | { error: string } {
  const end = input.flowTiming === 'end';
  const bars = input.prices[ticker];
  const valued = valueDaily(input);
  if (!valued.ok) return { error: valued.rejected[0].message };
  const flows = valued.series
    .filter((p) => !p.netFlowSgd.isZero())
    .map((p): LedgerRow => {
      const type = p.netFlowSgd.isNeg() ? 'WITHDRAW' : 'DEPOSIT';
      return { line: 0, date: p.date, type, ticker: null, quantity: null, price: null, currency: 'SGD', amount: p.netFlowSgd.abs(), fees: D(0) };
    });
  const out: LedgerRow[] = [];
  let holding = D(0);
  let splitsUpTo = flows[0]?.date ?? ''; // splits dated after this and on or before the flow date are applied
  const row = (r: LedgerRow, type: LedgerRow['type'], t: string | null, quantity: Decimal | null, price: Decimal | null, currency: 'SGD' | 'USD', amount: Decimal): LedgerRow =>
    ({ line: r.line, date: r.date, type, ticker: t, quantity, price, currency, amount, fees: D(0) });

  for (const r of flows) {
    for (const b of bars) if (b.date > splitsUpTo && b.date <= r.date) holding = holding.times(b.splitFactor);
    splitsUpTo = r.date;
    const bar = latest(bars, r.date, end);
    const rate = latest(input.fx, r.date, end);
    if (!bar) return { error: `No ${ticker} price ${end ? 'on or ' : ''}before ${r.date}.` };
    if (!rate) return { error: `No USD/SGD rate ${end ? 'on or ' : ''}before ${r.date}.` };
    // A prior-day close is on the old share basis when a split falls on the flow date.
    const split = end ? D(1) : (bars.find((b) => b.date === r.date)?.splitFactor ?? D(1));
    const price = bar.close.div(split);
    const usd = r.amount.div(rate.sgdPerUsd);
    const qty = usd.div(price);
    if (r.type === 'DEPOSIT') {
      holding = holding.plus(qty);
      out.push(r, row(r, 'FX', 'USD', usd, null, 'SGD', r.amount), row(r, 'BUY', ticker, qty, price, 'USD', usd));
    } else {
      if (qty.gt(holding)) return { error: `The benchmark ran out of money on ${r.date}.` };
      holding = holding.minus(qty);
      out.push(row(r, 'SELL', ticker, qty, price, 'USD', usd), row(r, 'FX', 'SGD', r.amount, null, 'USD', usd), r);
    }
  }
  return out;
}

export function benchmark(input: ComputeInput, ticker: string): ComputeResult {
  const ledger = shadowLedger(input, ticker);
  if ('error' in ledger) return { ok: false, rejected: [{ line: null, code: 'benchmark_unavailable', message: ledger.error }] };
  // Shadow trades fall on flow dates, which may have no bar: add one carrying the latest close, which is what
  // valuation uses on that day anyway.
  const bars = input.prices[ticker];
  const extra: PriceBar[] = [];
  for (const d of new Set(ledger.map((r) => r.date))) {
    if (bars.some((b) => b.date === d)) continue;
    extra.push({ date: d, close: latest(bars, d, true)!.close, splitFactor: D(1), divCash: D(0) });
  }
  const merged = [...bars, ...extra].sort((a, b) => a.date.localeCompare(b.date));
  return compute({ ...input, ledger, prices: { [ticker]: merged } });
}
