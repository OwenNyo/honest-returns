import type Decimal from 'decimal.js';
import { daysBetween } from '../shared/dates';
import { D } from './decimal';
import type { IsoDate, LedgerRow, PriceSeries, Rejection } from './types';

export const US_WITHHOLDING = D('0.30'); // Singapore residents on US dividends (spec 10.6)
const MATCH_DAYS = 90;

export interface Entitlement { ticker: string; exDate: IsoDate; gross: Decimal; withheld: Decimal; net: Decimal }
export interface Dividend extends Entitlement { date: IsoDate; source: 'row' | 'ex_date' }

const movesHolding = (r: LedgerRow) => r.type === 'BUY' || r.type === 'SELL' || (r.type === 'OPENING' && r.ticker !== null);

// Holdings-only pass: on each bar with divCash > 0, the holding after that day's split and before its rows.
export function entitlements(ledger: LedgerRow[], prices: PriceSeries): Entitlement[] {
  const out: Entitlement[] = [];
  for (const [ticker, bars] of Object.entries(prices)) {
    const rows = ledger.filter((r) => r.ticker === ticker && movesHolding(r)).sort((a, b) => a.date.localeCompare(b.date));
    let holding = D(0);
    let i = 0;
    for (const bar of bars) {
      for (; i < rows.length && rows[i].date < bar.date; i++) {
        holding = rows[i].type === 'SELL' ? holding.minus(rows[i].quantity!) : holding.plus(rows[i].quantity!);
      }
      holding = holding.times(bar.splitFactor);
      if (bar.divCash.gt(0) && holding.gt(0)) {
        const gross = holding.times(bar.divCash);
        const withheld = gross.times(US_WITHHOLDING);
        out.push({ ticker, exDate: bar.date, gross, withheld, net: gross.minus(withheld) });
      }
    }
  }
  return out.sort((a, b) => a.exDate.localeCompare(b.exDate));
}

// Spec 10.6 matching: each DIVIDEND row, in date order, takes the latest unmatched entitlement of its ticker
// with an ex-date in the 90 days up to the row date. Stops at the first rejection.
export function matchDividendRows(
  rows: LedgerRow[],
  ents: Entitlement[],
): { matched: Dividend[]; unmatched: Dividend[]; rejected: Rejection[] } {
  const taken = new Set<Entitlement>();
  const matched: Dividend[] = [];
  const divRows = rows.filter((r) => r.type === 'DIVIDEND').sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
  for (const r of divRows) {
    const candidates = ents.filter(
      (e) => e.ticker === r.ticker && e.exDate <= r.date && daysBetween(e.exDate, r.date) <= MATCH_DAYS,
    );
    const e = candidates.findLast((c) => !taken.has(c));
    if (!e) {
      const rejected: Rejection[] = candidates.length
        ? [{ line: r.line, code: 'dividend_duplicate', message: `Another DIVIDEND row already matches the ${r.ticker} ex-date ${candidates.at(-1)!.exDate}.` }]
        : [{ line: r.line, code: 'dividend_unmatched', message: `No ${r.ticker} ex-dividend date in the ${MATCH_DAYS} days up to ${r.date}.` }];
      return { matched: [], unmatched: [], rejected };
    }
    taken.add(e);
    matched.push({ ticker: e.ticker, exDate: e.exDate, date: r.date, gross: r.amount, withheld: r.fees, net: r.amount.minus(r.fees), source: 'row' });
  }
  const unmatched = ents.filter((e) => !taken.has(e)).map((e): Dividend => ({ ...e, date: e.exDate, source: 'ex_date' }));
  return { matched, unmatched, rejected: [] };
}
