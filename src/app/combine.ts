import type { IsoDate, LedgerRow, Rejection } from '../engine/types';
import { detectFormat } from '../importers/detect';
import { importIbkr } from '../importers/ibkr';
import { parseCsv } from '../shared/csv';

export type InputFile = { name: string; text: string };
export type Origin = { file: string; line: number };
export interface Combined {
  rows: LedgerRow[];
  origin: Origin[]; // indexed by the new row line
  periods: { name: string; from: IsoDate; to: IsoDate }[]; // earliest first
  notices: string[];
}

const minDate = (rows: LedgerRow[]) => rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
const maxDate = (rows: LedgerRow[]) => rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);

// Spec 15.4.2: convert each file, order by period, reject overlaps, merge with one line counter.
export function combineFiles(files: InputFile[]): Combined | { rejected: Rejection[] } {
  const multi = files.length > 1;
  const tag = (r: Rejection): Rejection => (multi ? { ...r, file: name } : r);
  let name = '';
  const rejected: Rejection[] = [];
  const notices: string[] = [];
  const parsed: { name: string; rows: LedgerRow[]; from: IsoDate; to: IsoDate }[] = [];

  for (const f of files) {
    name = f.name;
    const ibkr = detectFormat(f.text) === 'ibkr' ? importIbkr(f.text) : null;
    if (ibkr?.rejected.length) {
      rejected.push(...ibkr.rejected.map(tag));
      continue;
    }
    notices.push(...(ibkr?.notices ?? []));
    const out = parseCsv(ibkr ? ibkr.csv : f.text);
    if (out.rejected.length) {
      rejected.push(...out.rejected.map(tag));
      continue;
    }
    parsed.push({ name: f.name, rows: out.rows, from: minDate(out.rows), to: maxDate(out.rows) });
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

  const rows: LedgerRow[] = [];
  const origin: Origin[] = [];
  for (const p of parsed) {
    for (const r of p.rows) {
      origin.push({ file: p.name, line: r.line });
      rows.push({ ...r, line: origin.length - 1 });
    }
  }
  return { rows, origin, periods: parsed.map(({ name, from, to }) => ({ name, from, to })), notices };
}

// Engine rejections carry merged line numbers; map them back to each file's own line.
export function mapBack(r: Rejection, origin: Origin[], multi: boolean): Rejection {
  if (r.line === null) return r;
  const o = origin[r.line];
  return multi ? { ...r, line: o.line, file: o.file } : { ...r, line: o.line };
}
