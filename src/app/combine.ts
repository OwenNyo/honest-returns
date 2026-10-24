import type Decimal from 'decimal.js';
import { D } from '../engine/decimal';
import type { FlowTiming, FxPoint, IsoDate, LedgerRow, PriceSeries, Rejection } from '../engine/types';
import { valueDaily } from '../engine/valuation';
import { detectFormat } from '../importers/detect';
import { importIbkr, statementCurrencies } from '../importers/ibkr';
import { importMoomoo } from '../importers/moomoo';
import { parseCsv } from '../shared/csv';
import { addDays } from '../shared/dates';

export type InputFile = { name: string; text: string };
export type Converted = { name: string; csv: string }; // csv: the importer's canonical CSV text, header first
export type Origin = { file: string; line: number };
export interface Combined {
  rows: LedgerRow[];
  origin: Origin[]; // indexed by the new row line
  periods: { name: string; from: IsoDate; to: IsoDate }[]; // earliest first
  notices: string[];
  openings: Opening[]; // OPENING rows of every file after the earliest, kept out of `rows` for reconcile()
  converted: Converted[]; // spec 18.1.2: one entry per IBKR or moomoo file, earliest period first
}
export type Opening = { name: string; start: IsoDate; rows: LedgerRow[] };

export const POSITION_TOLERANCE = D('0.0001');

const minDate = (rows: LedgerRow[]) => rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
const maxDate = (rows: LedgerRow[]) => rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);

// Spec 15.4.2: convert each file, order by period, reject overlaps, merge with one line counter.
export function combineFiles(files: InputFile[]): Combined | { rejected: Rejection[] } {
  const multi = files.length > 1;
  const tag = (r: Rejection): Rejection => (multi ? { ...r, file: name } : r);
  let name = '';
  const rejected: Rejection[] = [];
  const notices: string[] = [];
  const parsed: { name: string; rows: LedgerRow[]; from: IsoDate; to: IsoDate; stated: boolean; csv: string | null }[] = [];
  const formats = files.map((f) => detectFormat(f.text));
  // Spec 17.1.8: funding starts from zero cash in each moomoo file, so a second file would count money in twice.
  if (formats.filter((x) => x === 'moomoo').length > 1) {
    const message = "Use one moomoo file that covers all your trades. Cash is worked out from each file's own trades, so moomoo files cannot be combined.";
    return { rejected: [{ line: null, code: 'moomoo_files', message }] };
  }
  // A position held through a statement with no trades takes its currency from the other statements.
  const known = Object.assign({}, ...files.filter((_, i) => formats[i] === 'ibkr').map((f) => statementCurrencies(f.text)));

  for (const [i, f] of files.entries()) {
    name = f.name;
    const ibkr = formats[i] === 'ibkr' ? importIbkr(f.text, known) : null;
    const moomoo = formats[i] === 'moomoo' ? importMoomoo(f.text) : null;
    const imported = ibkr ?? moomoo;
    if (imported?.rejected.length) {
      rejected.push(...imported.rejected.map(tag));
      continue;
    }
    notices.push(...(imported?.notices ?? []));
    const out = parseCsv(imported ? imported.csv : f.text);
    // Converted rows and their rejections point at the statement line, not the converted CSV line.
    const toStatement = <T extends { line: number | null }>(x: T): T =>
      imported && x.line !== null ? { ...x, line: imported.lines[x.line - 2] } : x;
    if (out.rejected.length) {
      rejected.push(...out.rejected.map(toStatement).map(tag));
      continue;
    }
    // Step 2: an IBKR statement states its period; a moomoo or canonical file covers its first to last row date.
    if (ibkr && !ibkr.period) throw new Error(`${f.name}: the IBKR statement has no Period line`);
    const period = ibkr?.period ?? { from: minDate(out.rows), to: maxDate(out.rows) };
    parsed.push({ name: f.name, rows: out.rows.map(toStatement), ...period, stated: !!ibkr, csv: imported ? imported.csv : null });
  }
  if (rejected.length) return { rejected };

  parsed.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  // ponytail: every pair is compared (O(n^2)); a handful of files is the expected input.
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const [a, b] = [parsed[i], parsed[j]];
      if (b.from > a.to) continue;
      const to = a.to < b.to ? a.to : b.to;
      const message = `${a.name} and ${b.name} both cover ${b.from} to ${to}. Remove one of them.`;
      return { rejected: [{ line: null, code: 'overlapping_files', message }] };
    }
  }

  // Step 4: a gap between two statements is allowed, with a notice. Canonical files are never checked.
  for (let i = 1; i < parsed.length; i++) {
    const [a, b] = [parsed[i - 1], parsed[i]];
    if (a.stated && b.stated && addDays(a.to, 1) < b.from) {
      notices.push(
        `No statement covers ${addDays(a.to, 1)} to ${addDays(b.from, -1)}, between ${a.name} and ${b.name}. ` +
          `The opening balances of ${b.name} were checked against the earlier files.`,
      );
    }
  }

  // Steps 5 and 6: one line counter; OPENING rows only from the earliest file.
  const rows: LedgerRow[] = [];
  const origin: Origin[] = [];
  const openings: Opening[] = [];
  for (const [i, p] of parsed.entries()) {
    const opening = i > 0 ? p.rows.filter((r) => r.type === 'OPENING') : [];
    if (opening.length) openings.push({ name: p.name, start: p.from, rows: opening });
    for (const r of p.rows) {
      if (opening.includes(r)) continue;
      origin.push({ file: p.name, line: r.line });
      rows.push({ ...r, line: origin.length - 1 });
    }
  }
  const periods = parsed.map(({ name, from, to }) => ({ name, from, to }));
  const converted = parsed.flatMap(({ name, csv }) => (csv === null ? [] : [{ name, csv }]));
  return { rows, origin, periods, notices, openings, converted };
}

// Step 7 and UI decision 2: each later statement's opening positions must match the earlier files within
// POSITION_TOLERANCE; any cash difference is booked as an ADJUST row on the statement's start date.
// ponytail: one valueDaily pass per later statement over the ledger before it (files x days); one pass that
// records each boundary date if this gets slow.
export function reconcile(
  combined: Pick<Combined, 'rows' | 'origin' | 'openings'>,
  prices: PriceSeries,
  fx: FxPoint[],
  flowTiming: FlowTiming,
): { rejected: Rejection[] } | { rows: LedgerRow[]; origin: Origin[]; notices: string[] } {
  const rows = [...combined.rows];
  const origin = [...combined.origin];
  const notices: string[] = [];
  for (const o of combined.openings) {
    const end = addDays(o.start, -1);
    const valued = valueDaily({ ledger: rows.filter((r) => r.date < o.start), prices, fx, endDate: end, flowTiming });
    if (!valued.ok) return { rejected: valued.rejected.map((r) => mapBack(r, origin, true)) };
    const point = valued.series[valued.series.length - 1];

    const opened: Record<string, Decimal> = {};
    for (const r of o.rows) if (r.ticker) opened[r.ticker] = (opened[r.ticker] ?? D(0)).plus(r.quantity!);
    for (const sym of [...new Set([...Object.keys(point.holdings), ...Object.keys(opened)])].sort()) {
      const ledger = point.holdings[sym] ?? D(0);
      const opening = opened[sym] ?? D(0);
      if (ledger.minus(opening).abs().gt(POSITION_TOLERANCE)) {
        const message = `${o.name} opens with ${opening} ${sym}, but the earlier files end with ${ledger} ${sym} on ${end}.`;
        return { rejected: [{ line: null, code: 'reconcile_position', message }] };
      }
    }

    for (const ccy of ['SGD', 'USD'] as const) {
      const opening = o.rows.filter((r) => !r.ticker && r.currency === ccy).reduce((s, r) => s.plus(r.amount), D(0));
      const diff = opening.minus(point.cash[ccy]);
      if (diff.isZero()) continue;
      origin.push({ file: o.name, line: o.rows[0].line });
      rows.push({ line: origin.length - 1, date: o.start, type: 'ADJUST', ticker: null, quantity: null, price: null, currency: ccy, amount: diff, fees: D(0) });
      notices.push(`Cash adjusted by ${diff.toFixed(2)} ${ccy} on ${o.start} to match the statement (interest, fees or options not modelled).`);
    }
  }
  return { rows, origin, notices };
}

// Engine rejections carry merged line numbers; map them back to each file's own line.
export function mapBack(r: Rejection, origin: Origin[], multi: boolean): Rejection {
  if (r.line === null) return r;
  const o = origin[r.line];
  return multi ? { ...r, line: o.line, file: o.file } : { ...r, line: o.line };
}
