import type Decimal from 'decimal.js';
import { addDays } from '../shared/dates';
import { D } from './decimal';
import type { Ccy, ComputeInput, LedgerRow, Rejection, RowType, ValuationPoint, Warning } from './types';

export type ValuationResult =
  | { ok: true; series: ValuationPoint[]; warnings: Warning[] }
  | { ok: false; rejected: Rejection[] };

// Spec 6.2 step 3: order of rows within one day.
const PRIORITY: Record<RowType, number> = { DEPOSIT: 1, DIVIDEND: 2, FX: 3, BUY: 4, SELL: 4, WITHDRAW: 5 };

const reject = (line: number | null, code: Rejection['code'], message: string): ValuationResult => ({
  ok: false,
  rejected: [{ line, code, message }],
});

// Cash change per currency for one row (spec 5 table).
function cashDeltas(r: LedgerRow): Partial<Record<Ccy, Decimal>> {
  switch (r.type) {
    case 'DEPOSIT':
      return { SGD: r.amount };
    case 'WITHDRAW':
      return { SGD: r.amount.neg() };
    case 'FX':
      return { [r.currency]: r.amount.plus(r.fees).neg(), [r.ticker as Ccy]: r.quantity! };
    case 'BUY':
      return { USD: r.amount.plus(r.fees).neg() };
    case 'SELL':
    case 'DIVIDEND':
      return { USD: r.amount.minus(r.fees) };
  }
}

export function valueDaily(input: ComputeInput): ValuationResult {
  const { prices, fx, endDate } = input;
  const ledger = [...input.ledger].sort(
    (a, b) => a.date.localeCompare(b.date) || PRIORITY[a.type] - PRIORITY[b.type] || a.line - b.line,
  );

  // Pre-checks before the loop, in file order.
  const barDates: Record<string, Set<string>> = {};
  for (const r of input.ledger) {
    if (r.date > endDate) return reject(r.line, 'after_as_of', `date is after the latest available prices (${endDate}).`);
  }
  for (const r of input.ledger) {
    if (r.type !== 'BUY' && r.type !== 'SELL') continue;
    const t = r.ticker!;
    barDates[t] ??= new Set((prices[t] ?? []).map((b) => b.date));
    if (!barDates[t].has(r.date)) return reject(r.line, 'not_trading_day', `${t} did not trade on ${r.date}.`);
  }

  const cash: Record<Ccy, Decimal> = { SGD: D(0), USD: D(0) };
  const holdings: Record<string, Decimal> = {};
  const barIdx: Record<string, number> = {}; // index of the latest bar dated <= d, per held ticker
  let fxIdx = -1;
  let rowIdx = 0;
  let netInvested = D(0);
  let carried = 0;
  const series: ValuationPoint[] = [];

  for (let d = ledger[0].date; d <= endDate; d = addDays(d, 1)) {
    // Move bar pointers to the latest bar dated <= d.
    for (const t of Object.keys(holdings)) {
      const bars = prices[t];
      while (barIdx[t] + 1 < bars.length && bars[barIdx[t] + 1].date <= d) barIdx[t]++;
      // 1. Split on the ex-date.
      const bar = bars[barIdx[t]];
      if (bar?.date === d && !bar.splitFactor.eq(1) && !holdings[t].isZero()) {
        holdings[t] = holdings[t].times(bar.splitFactor);
      }
    }

    // 3. Ledger rows dated d, already in priority order.
    const today: LedgerRow[] = [];
    while (rowIdx < ledger.length && ledger[rowIdx].date === d) today.push(ledger[rowIdx++]);
    let netFlow = D(0);
    for (const r of today) {
      for (const [c, v] of Object.entries(cashDeltas(r)) as [Ccy, Decimal][]) cash[c] = cash[c].plus(v);
      if (r.type === 'DEPOSIT') netFlow = netFlow.plus(r.amount);
      if (r.type === 'WITHDRAW') netFlow = netFlow.minus(r.amount);
      if (r.type === 'BUY' || r.type === 'SELL') {
        const t = r.ticker!;
        if (!(t in holdings)) {
          holdings[t] = D(0);
          barIdx[t] = prices[t].findIndex((b) => b.date === d); // exists: checked before the loop
        }
        holdings[t] = r.type === 'BUY' ? holdings[t].plus(r.quantity!) : holdings[t].minus(r.quantity!);
      }
    }

    // 4. End-of-day checks; the sort order only decides which row is blamed.
    for (const c of ['SGD', 'USD'] as const) {
      if (cash[c].isNeg()) {
        const row = today.findLast((r) => cashDeltas(r)[c]?.isNeg())!;
        return reject(row.line, 'negative_cash', `${c} cash would be ${cash[c].toFixed(2)} at the end of ${d}.`);
      }
    }
    for (const [t, q] of Object.entries(holdings)) {
      if (q.isNeg()) {
        const row = today.findLast((r) => r.type === 'SELL' && r.ticker === t)!;
        return reject(
          row.line,
          'oversell',
          `This sells more ${t} than is held: holding would be ${q} at the end of ${d}.`,
        );
      }
    }

    // 5. Value. Day-level market data rejections have no line.
    while (fxIdx + 1 < fx.length && fx[fxIdx + 1].date <= d) fxIdx++;
    if (fxIdx < 0) return reject(null, 'no_market_data', `No USD/SGD rate on or before ${d}.`);
    const rate = fx[fxIdx];
    if (rate.date !== d) carried++;
    let usd = cash.USD;
    for (const [t, q] of Object.entries(holdings)) {
      // ponytail: no `No {ticker} price` rejection; a holding starts with a BUY on a bar date, so a bar always exists.
      usd = usd.plus(q.times(prices[t][barIdx[t]].close));
    }
    netInvested = netInvested.plus(netFlow);
    series.push({
      date: d,
      valueSgd: cash.SGD.plus(usd.times(rate.sgdPerUsd)),
      netFlowSgd: netFlow,
      netInvestedSgd: netInvested,
      dailyReturn: D(0),
      fxRate: rate.sgdPerUsd,
      fxDate: rate.date,
      cash: { ...cash },
      holdings: { ...holdings },
    });
  }

  const warnings: Warning[] = [];
  if (carried > 0) {
    warnings.push({ code: 'fx_carried', message: `Exchange rate carried forward on ${carried} days without an ECB fixing.` });
  }
  return { ok: true, series, warnings };
}
