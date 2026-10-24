import type Decimal from 'decimal.js';
import { D } from '../engine/decimal';
import type { IsoDate, Rejection, RejectionCode } from '../engine/types';
import { addDays, isIsoDate } from '../shared/dates';
import { HEADER, splitLine } from '../shared/csv';

// Spec 17.1. UNVERIFIED against a real export: built from third-party reports and a synthetic fixture (plan Task 37).
export interface MoomooImport {
  csv: string; // canonical CSV text, header line first
  rejected: Rejection[]; // line = line in the moomoo file
  notices: string[];
  period: { from: IsoDate; to: IsoDate } | null; // first and last fill date; null when nothing was filled
  lines: number[]; // moomoo file line of each output row: lines[i] for the row on csv line i + 2
}

const REQUIRED = ['Side', 'Symbol', 'Markets', 'Currency', 'Fill Qty', 'Fill Price', 'Fill Time'];
const FEES = ['Commission', 'Platform Fees', 'Clearing Fee', 'Stamp Duty', 'Settlement Fee', 'Consolidated Audit Trail Fees', 'Trading Activity Fee', 'SST', 'SEC Fee'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER = /^-?\d+(\.\d+)?$/;
const DATE_MSG = 'Fill Time must be a date and time like 2024/03/05 21:30:00 or Mar 5, 2024 21:30:00.';

type Row = { line: number; get: (col: string) => string };
type Fill = { date: IsoDate; type: 'BUY' | 'SELL'; ticker: string; qty: Decimal; price: Decimal; amount: Decimal; fees: Decimal; line: number };

// Numbers: commas removed, absolute value (no sign is relied on). null when not a number.
const num = (s: string): Decimal | null => {
  const t = s.replace(/,/g, '');
  return NUMBER.test(t) ? D(t).abs() : null;
};
const plain = (d: Decimal) => d.toFixed();
// ponytail: via Number, exact up to about 10^13 dollars.
const usd = new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isFill = (r: Row) => r.get('Fill Qty') !== '' && !num(r.get('Fill Qty'))?.isZero();
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const list = (t: string[]) => (t.length < 2 ? t.join('') : `${t.slice(0, -1).join(', ')} and ${t.at(-1)}`);

// Spec 17.1.5: Singapore time; a fill before 09:00 belongs to the US trading day that started the evening before.
// ponytail: a fixed 09:00 cutoff in Singapore time, zone label ignored. Ceilings: an export in another zone is dated
// wrongly before 09:00; an overnight-session fill keeps its Singapore date. Upgrade: read the zone label and convert to
// US Eastern before taking the date, once a real file shows the zone.
function fillDate(s: string): IsoDate | null {
  const m =
    /^(\d{4})[-\/](\d{2})[-\/](\d{2})\s+(.*)$/.exec(s) ?? /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s+(.*)$/.exec(s);
  if (!m) return null;
  const date = /\d/.test(m[1]) ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const t = /^(\d{1,2}):\d{2}(?::\d{2})?(?:\s*([AaPp][Mm]))?(?:\s|$)/.exec(m[4]);
  if (!isIsoDate(date) || !t || Number(t[1]) > 23) return null;
  const hour = t[2] ? (Number(t[1]) % 12) + (t[2].toUpperCase() === 'PM' ? 12 : 0) : Number(t[1]);
  return hour < 9 ? addDays(date, -1) : date;
}

// One fill to a canonical row, or the first failing row check (spec 17.1.7).
function toFill(r: Row, order: Row, hasAmount: boolean): Fill | { code: RejectionCode; message: string } {
  const own = (col: string) => r.get(col) || order.get(col);
  const side = own('Side').toLowerCase();
  if (side !== 'buy' && side !== 'sell') return { code: 'bad_type', message: 'Side must be Buy or Sell.' };
  const date = fillDate(r.get('Fill Time'));
  if (!date) return { code: 'bad_date', message: DATE_MSG };
  const numbers: Record<string, Decimal> = {};
  for (const col of ['Fill Qty', 'Fill Price', ...(hasAmount && r.get('Fill Amount') !== '' ? ['Fill Amount'] : []), ...FEES]) {
    const v = col === 'Fill Qty' || col === 'Fill Price' || r.get(col) !== '' ? num(r.get(col)) : D(0);
    if (!v) return { code: 'bad_number', message: `${col} must be a number.` };
    numbers[col] = v;
  }
  const qty = numbers['Fill Qty'];
  const price = numbers['Fill Price'];
  return {
    date,
    type: side === 'buy' ? 'BUY' : 'SELL',
    ticker: own('Symbol').toUpperCase(),
    qty,
    price,
    amount: numbers['Fill Amount'] ?? qty.times(price),
    fees: FEES.reduce((s, c) => s.plus(numbers[c]), D(0)),
    line: r.line,
  };
}

export function importMoomoo(text: string): MoomooImport {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = splitLine(lines[0]).map((c) => c.trim());
  const empty = { csv: HEADER + '\n', notices: [], period: null, lines: [] };
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) return { ...empty, rejected: [{ line: null, code: 'bad_header', message: `This moomoo file is missing these columns: ${missing.join(', ')}.` }] };

  // A name that appears twice (Markets, Currency): the first non-empty of its cells. `--` reads as empty.
  const rows: Row[] = lines.slice(1).flatMap((raw, i) => {
    if (raw.trim() === '') return [];
    const cells = splitLine(raw).map((c) => (c.trim() === '--' ? '' : c.trim()));
    const get = (col: string) => header.flatMap((h, j) => (h === col && cells[j] ? [cells[j]] : []))[0] ?? '';
    return [{ line: i + 2, get }];
  });

  // Spec 17.1.4: a row with a Side starts an order; a row without one is another fill of the current order.
  const rejected: Rejection[] = [];
  const orders: Row[][] = [];
  for (const r of rows) {
    if (r.get('Side') !== '') orders.push([r]);
    else if (orders.length) orders.at(-1)!.push(r);
    else if (isFill(r)) rejected.push({ line: r.line, code: 'bad_type', message: 'Side must be Buy or Sell.' });
  }

  const hasAmount = header.includes('Fill Amount');
  const fills: Fill[] = [];
  const leftOut: Record<string, number> = {};
  let skipped = 0;
  let usOrders = 0;
  for (const [order, ...rest] of orders) {
    const filled = [order, ...rest].filter(isFill);
    if (!filled.length) {
      skipped++;
      continue;
    }
    const market = order.get('Markets') || 'unknown';
    if (market !== 'US') {
      leftOut[market] = (leftOut[market] ?? 0) + 1;
      continue;
    }
    usOrders++;
    const currency = order.get('Currency');
    if (currency !== 'USD') {
      rejected.push({ line: order.line, code: 'trade_currency', message: `Only US trades in USD can be measured; this order is in ${currency}.` });
      continue;
    }
    const before = rejected.length;
    const mine: Fill[] = [];
    for (const r of filled) {
      const f = toFill(r, order, hasAmount);
      if ('code' in f) rejected.push({ line: r.line, ...f });
      else mine.push(f);
    }
    if (rejected.length > before) continue;
    // Guards against an order row that repeats the order total as well as each fill (would double the trade).
    const m = /^([\d,]+(\.\d+)?)@/.exec(order.get('Filled@Avg Price'));
    const stated = m && D(m[1].replace(/,/g, ''));
    const sum = mine.reduce((s, f) => s.plus(f.qty), D(0));
    if (stated && !sum.eq(stated)) {
      rejected.push({ line: order.line, code: 'fill_mismatch', message: `Fills add up to ${plain(sum)} shares, but the order shows ${plain(stated)} filled.` });
      continue;
    }
    fills.push(...mine);
  }
  if (!usOrders && !rejected.length) return { ...empty, rejected: [{ line: null, code: 'empty_file', message: 'The file has no filled orders on the US market.' }] };

  // Spec 17.1.6: stable sort by date, then each day's net USD shortfall becomes a same-day USD deposit.
  fills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: string[] = [];
  const outLines: number[] = [];
  let balance = D(0);
  let funded = D(0);
  let fundedDays = 0;
  fills.forEach((f, i) => {
    out.push([f.date, f.type, f.ticker, plain(f.qty), plain(f.price), 'USD', plain(f.amount), plain(f.fees)].join(','));
    outLines.push(f.line);
    balance = f.type === 'BUY' ? balance.minus(f.amount.plus(f.fees)) : balance.plus(f.amount.minus(f.fees));
    if (fills[i + 1]?.date !== f.date && balance.lt(0)) {
      out.push(`${f.date},DEPOSIT,,,,USD,${plain(balance.neg())},0`);
      outLines.push(f.line);
      funded = funded.minus(balance);
      fundedDays++;
      balance = D(0);
    }
  });

  const notices: string[] = [];
  if (fundedDays) {
    notices.push(
      `This moomoo file lists trades only. USD ${usd.format(Number(funded.toFixed(2)))} was counted as paid in on ${fundedDays} ${plural(fundedDays, 'day', 'days')}, each time the trades needed more USD than the file's own cash. Withdrawals and currency conversions are not in the file, so money from sales stays in the portfolio as cash.`,
    );
  }
  if (skipped) notices.push(`${skipped} ${plural(skipped, 'order with nothing filled was skipped.', 'orders with nothing filled were skipped.')}`);
  const markets = Object.keys(leftOut).sort();
  const n = markets.reduce((s, m) => s + leftOut[m], 0);
  if (n) {
    notices.push(
      `${n} ${plural(n, 'order', 'orders')} on ${list(markets)} ${plural(markets.length, 'market', 'markets')} ${plural(n, 'was', 'were')} left out; this report covers US trades only.`,
    );
  }
  const period = fills.length ? { from: fills[0].date, to: fills.at(-1)!.date } : null;
  return { csv: [HEADER, ...out].join('\n') + '\n', rejected, notices, period, lines: outLines };
}
