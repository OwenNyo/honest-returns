import type Decimal from 'decimal.js';
import { D } from './decimal';
import type { FxPoint, LedgerRow } from './types';

// Spec 16.2: an excluded ticker leaves the measured portfolio. Its BUY becomes a USD WITHDRAW and its SELL and
// DIVIDEND a USD DEPOSIT of the same cash, on the same line, so cash balances do not change. Its OPENING
// positions are dropped. Output order equals input order.
export function excludeTickers(ledger: LedgerRow[], tickers: string[]): LedgerRow[] {
  const out: LedgerRow[] = [];
  for (const r of ledger) {
    if (!r.ticker || !tickers.includes(r.ticker)) out.push(r);
    else if (r.type === 'BUY' || r.type === 'SELL' || r.type === 'DIVIDEND') {
      const buy = r.type === 'BUY';
      const amount = buy ? r.amount.plus(r.fees) : r.amount.minus(r.fees);
      out.push({ ...r, type: buy ? 'WITHDRAW' : 'DEPOSIT', ticker: null, quantity: null, price: null, currency: 'USD', amount, fees: D(0) });
    }
    // OPENING position of an excluded ticker: dropped (no cash effect).
  }
  return out;
}

// Spec 16.3: excluded gross buys and opening positions over all of them, in SGD at the day's valuation rate
// (latest ECB point on or before the day, as valuation.ts step 5). Not read from the series: a dropped opening
// position can be dated before the reduced ledger's first day. The API sends FX from the year before the first date.
export function excludedShare(ledger: LedgerRow[], tickers: string[], fx: FxPoint[]): Decimal {
  let excluded = D(0);
  let total = D(0);
  for (const r of ledger) {
    if (r.type !== 'BUY' && !(r.type === 'OPENING' && r.ticker)) continue;
    const sgd = (r.type === 'BUY' ? r.amount.plus(r.fees) : r.amount).times(fx.findLast((p) => p.date <= r.date)!.sgdPerUsd);
    total = total.plus(sgd);
    if (tickers.includes(r.ticker!)) excluded = excluded.plus(sgd);
  }
  return total.isZero() ? D(0) : excluded.div(total); // no buys or positions at all: nothing was bought, so 0
}
