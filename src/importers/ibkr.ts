import type Decimal from 'decimal.js';
import { D } from '../engine/decimal';
import type { Rejection, RejectionCode } from '../engine/types';
import { HEADER, splitLine } from '../shared/csv';

export interface SectionCounts { converted: number; skipped: number; rejected: number }
export interface IbkrImport {
  csv: string;
  rejected: Rejection[]; // line = line in the statement
  notices: string[];
  sections: Record<string, SectionCounts>;
  period: { from: string; to: string } | null; // the Statement Period, null when the statement has none
  lines: number[]; // statement line of each output row: lines[i] for the row on csv line i + 2
}

type Rec = { section: string; line: number; f: Record<string, string> }; // f: cells keyed by header name

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Data rows keyed by the most recent Header of their section. Total and SubTotal rows are dropped.
function records(text: string): Rec[] {
  const headers: Record<string, string[]> = {};
  const out: Rec[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const [section, kind, ...cells] = splitLine(raw);
      if (kind === 'Header') headers[section] = cells;
      if (kind !== 'Data' || cells[0]?.startsWith('Total')) return;
      const f: Record<string, string> = {};
      headers[section].forEach((h, j) => (f[h] = cells[j]?.trim() ?? ''));
      out.push({ section, line: i + 1, f });
    });
  return out;
}

// 'January 1, 2026 - October 23, 2026' -> { from: '2026-01-01', to: '2026-10-23' }; a one-day statement has one date.
function parsePeriod(text: string): { from: string; to: string } | null {
  const dates = [...text.matchAll(/(\w+) (\d{1,2}), (\d{4})/g)].map(([, m, d, y]) =>
    MONTHS.includes(m) ? `${y}-${String(MONTHS.indexOf(m) + 1).padStart(2, '0')}-${d.padStart(2, '0')}` : null,
  );
  if (dates.length < 1 || dates.length > 2 || dates.includes(null)) return null;
  return { from: dates[0]!, to: dates.at(-1)! };
}

// Currency per stock symbol, from Trades and Open Positions.
function stockCurrencies(recs: Rec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of recs) {
    if ((r.section === 'Trades' || r.section === 'Open Positions') && r.f['Asset Category'] === 'Stocks') out[r.f.Symbol] = r.f.Currency;
  }
  return out;
}
export const statementCurrencies = (text: string) => stockCurrencies(records(text));

const num = (s: string): Decimal => D(s.replace(/,/g, ''));
const plain = (d: Decimal) => d.toFixed();

// Spec "Task 15 addendum": IBKR Activity Statement CSV to canonical CSV text.
export function importIbkr(text: string, known: Record<string, string> = {}): IbkrImport {
  const recs = records(text);
  const rows: string[] = [];
  const lines: number[] = [];
  const rejected: Rejection[] = [];
  const sections: Record<string, SectionCounts> = {};
  const count = (r: Rec, k: keyof SectionCounts) => {
    sections[r.section] ??= { converted: 0, skipped: 0, rejected: 0 };
    sections[r.section][k]++;
  };
  const emit = (r: Rec, ...cells: (string | Decimal | null)[]) => {
    rows.push(cells.map((c) => (c === null ? '' : typeof c === 'string' ? c : plain(c))).join(','));
    lines.push(r.line);
    count(r, 'converted');
  };
  const reject = (r: Rec, code: RejectionCode, message: string) => {
    rejected.push({ line: r.line, code, message });
    count(r, 'rejected');
  };
  const of = (section: string) => recs.filter((r) => r.section === section);

  // Opening balances, dated the first day of the statement Period.
  const periodText = of('Statement').find((r) => r.f['Field Name'] === 'Period')?.f['Field Value'] ?? '';
  const period = parsePeriod(periodText);
  const startDate = () => {
    if (!period) throw new Error(`IBKR statement Period not understood: "${periodText}"`);
    return period.from;
  };
  // Mark-to-Market has no currency column; take it from the symbol's trades or open positions, or from
  // other statements in the same set (`known`), for a position held through a statement with no trades.
  const currencyOf: Record<string, string> = { ...known, ...stockCurrencies(recs) };
  for (const r of of('Mark-to-Market Performance Summary')) {
    if (r.f['Asset Category'] !== 'Stocks' || num(r.f['Prior Quantity']).isZero()) count(r, 'skipped');
    else if (currencyOf[r.f.Symbol] !== 'USD') reject(r, 'trade_currency', 'OPENING must be in USD.');
    else {
      const q = num(r.f['Prior Quantity']);
      const p = num(r.f['Prior Price']);
      emit(r, startDate(), 'OPENING', r.f.Symbol, q, p, 'USD', q.times(p), '0');
    }
  }
  for (const r of of('Cash Report')) {
    if (r.f['Currency Summary'] !== 'Starting Cash') continue;
    const amount = num(r.f.Total);
    if (r.f.Currency === 'Base Currency Summary' || amount.isZero()) count(r, 'skipped');
    else if (r.f.Currency !== 'SGD' && r.f.Currency !== 'USD') reject(r, 'bad_currency', 'currency must be SGD or USD.');
    else if (amount.isNeg()) reject(r, 'not_positive', 'amount must be greater than zero.');
    else emit(r, startDate(), 'OPENING', null, null, null, r.f.Currency, amount, '0');
  }

  let options = 0;
  for (const r of of('Trades')) {
    if (r.f.DataDiscriminator !== 'Order') continue;
    const cat = r.f['Asset Category'];
    const date = r.f['Date/Time'].slice(0, 10);
    const q = num(r.f.Quantity);
    const proceeds = num(r.f.Proceeds).abs();
    if (cat === 'Stocks') {
      const type = q.isNeg() ? 'SELL' : 'BUY';
      if (r.f.Currency !== 'USD') reject(r, 'trade_currency', `${type} must be in USD.`);
      else emit(r, date, type, r.f.Symbol, q.abs(), num(r.f['T. Price']), 'USD', proceeds, num(r.f['Comm/Fee']).abs());
    } else if (cat === 'Forex') {
      if (r.f.Symbol !== 'USD.SGD') {
        reject(r, 'fx_pair', 'FX must convert between SGD and USD: put the currency sold in currency and the currency bought in ticker.');
        continue;
      }
      // Decision 3: the commission is in SGD; fold it into the SGD leg and write fees 0.
      const comm = num(r.f['Comm in SGD']).abs();
      if (q.isNeg()) emit(r, date, 'FX', 'SGD', proceeds.minus(comm), null, 'USD', q.abs(), '0');
      else emit(r, date, 'FX', 'USD', q, null, 'SGD', proceeds.plus(comm), '0');
    } else {
      if (cat === 'Equity and Index Options') options++;
      count(r, 'skipped');
    }
  }

  for (const r of of('Deposits & Withdrawals')) {
    const amount = num(r.f.Amount);
    const type = amount.isNeg() ? 'WITHDRAW' : 'DEPOSIT';
    if (r.f.Currency !== 'SGD') reject(r, 'flow_currency', 'DEPOSIT and WITHDRAW must be in SGD.');
    else if (amount.isZero()) count(r, 'skipped');
    else emit(r, r.f['Settle Date'], type, null, null, null, 'SGD', amount.abs(), '0');
  }

  // Dividends joined to withholding by symbol and date; several rows for one key are summed (reversals net out).
  const key = (r: Rec) => `${/^([^(]+)\(/.exec(r.f.Description)?.[1] ?? r.f.Description}|${r.f.Date}`;
  const tax: Record<string, Decimal> = {};
  for (const r of of('Withholding Tax')) tax[key(r)] = (tax[key(r)] ?? D(0)).plus(num(r.f.Amount));
  const gross: Record<string, Decimal> = {};
  const firstLine: Record<string, number> = {};
  for (const r of of('Dividends')) {
    if (r.f.Currency !== 'USD') {
      reject(r, 'trade_currency', 'DIVIDEND must be in USD.');
      continue;
    }
    gross[key(r)] = (gross[key(r)] ?? D(0)).plus(num(r.f.Amount));
    firstLine[key(r)] ??= r.line;
    count(r, 'converted');
  }
  for (const [k, amount] of Object.entries(gross)) {
    if (!amount.gt(0)) continue; // ponytail: a fully reversed dividend leaves nothing to book
    const [symbol, date] = k.split('|');
    rows.push([date, 'DIVIDEND', symbol, '', '', 'USD', plain(amount), plain((tax[k] ?? D(0)).abs())].join(','));
    lines.push(firstLine[k]);
  }
  for (const r of of('Withholding Tax')) count(r, key(r) in gross ? 'converted' : 'skipped');

  const notices = options
    ? [`Options trades were skipped: ${options} rows. Results are approximate because option premiums also moved your cash.`]
    : [];
  return { csv: [HEADER, ...rows].join('\n') + '\n', rejected, notices, sections, period, lines };
}
