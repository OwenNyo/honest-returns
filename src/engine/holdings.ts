import type Decimal from 'decimal.js';
import { D } from './decimal';
import type { Dividend } from './dividends';
import type { Ccy, IsoDate, LedgerRow, PriceSeries, ValuationPoint } from './types';

export type HoldingRow =
  | { kind: 'ticker'; ticker: string; shares: Decimal; valueSgd: Decimal; weight: Decimal | null; gainSgd: Decimal }
  | { kind: 'cash'; currency: Ccy; valueSgd: Decimal; weight: Decimal | null }
  | { kind: 'rest'; gainSgd: Decimal }
  | { kind: 'total'; valueSgd: Decimal; gainSgd: Decimal };

// Spec 18.2.1: per-ticker value and SGD gain on the last day, then cash, the rest of the total gain, and the total.
export function holdingRows(
  ledger: LedgerRow[],
  prices: PriceSeries,
  series: ValuationPoint[],
  dividends: Dividend[],
  totalGain: Decimal,
): HoldingRow[] {
  const last = series[series.length - 1];
  const rate = new Map(series.map((p) => [p.date, p.fxRate]));
  // The carried close, as valuation.ts reads it.
  const close = (t: string, d: IsoDate) => prices[t].findLast((b) => b.date <= d)!.close;
  const weight = (v: Decimal) => (last.valueSgd.isZero() ? null : v.div(last.valueSgd));

  const tickers = Object.keys(last.holdings)
    .sort()
    .map((t): HoldingRow & { kind: 'ticker' } => {
      const shares = last.holdings[t];
      const valueSgd = shares.times(close(t, last.date)).times(last.fxRate);
      let gainSgd = valueSgd;
      for (const r of ledger) {
        if (r.ticker !== t) continue;
        const f = rate.get(r.date)!;
        if (r.type === 'SELL') gainSgd = gainSgd.plus(r.amount.minus(r.fees).times(f));
        if (r.type === 'BUY') gainSgd = gainSgd.minus(r.amount.plus(r.fees).times(f));
        if (r.type === 'OPENING') gainSgd = gainSgd.minus(r.quantity!.times(close(t, r.date)).times(f));
      }
      // An ex-date after the end date has no series point and adds nothing.
      for (const d of dividends) {
        const f = rate.get(d.date);
        if (d.ticker === t && f) gainSgd = gainSgd.plus(d.net.times(f));
      }
      return { kind: 'ticker', ticker: t, shares, valueSgd, weight: weight(valueSgd), gainSgd };
    });
  const cash = (['SGD', 'USD'] as const).map((currency): HoldingRow => {
    const valueSgd = currency === 'SGD' ? last.cash.SGD : last.cash.USD.times(last.fxRate);
    return { kind: 'cash', currency, valueSgd, weight: weight(valueSgd) };
  });
  const tickerGains = tickers.reduce((s, r) => s.plus(r.gainSgd), D(0));
  return [
    ...tickers,
    ...cash,
    { kind: 'rest', gainSgd: totalGain.minus(tickerGains) },
    { kind: 'total', valueSgd: last.valueSgd, gainSgd: totalGain },
  ];
}
