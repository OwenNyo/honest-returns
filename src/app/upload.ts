import type Decimal from 'decimal.js';
import { compute } from '../engine/compute';
import { excludedShare, excludeTickers } from '../engine/exclude';
import { toFx, toPriceSeries } from '../engine/load-market';
import type { ComputeInput, ComputeResult, FlowTiming, IsoDate, LedgerRow, Rejection } from '../engine/types';
import { ledgerTickers } from '../shared/csv';
import { combineFiles, type Converted, type InputFile, mapBack, reconcile } from './combine';
import { fetchPrices, firstDate } from './data';

export type Excluded = { tickers: string[]; share: Decimal }; // spec 16.5: tickers sorted, share of what was bought
export type UploadOutcome =
  | { kind: 'result'; result: ComputeResult & { ok: true }; asOf: IsoDate; excluded: Excluded | null; tickers: string[]; ledger: LedgerRow[]; notices: string[]; input: ComputeInput; periods: { name: string; from: IsoDate; to: IsoDate }[]; converted: Converted[] }
  | { kind: 'rejected'; rejected: Rejection[]; converted?: Converted[] } // converted: set on valuation and compute rejections only (spec 18.1.2)
  | { kind: 'empty' };

const MAX_TICKERS = 50; // the /api/prices limit (spec 9.2)
const list = (tickers: string[]) => tickers.join(', ');

// Spec 10.2 and 15.4: combine the files, then ticker availability, then compute to asOf. Any rejection means
// no numbers. A single CSV string is one file (decision 2 of the UI batch rulings). Spec 16.5: `exclude` lists
// unavailable tickers the user chose to leave out; they become cash flows before reconciliation.
export async function runUpload(
  input: string | InputFile[],
  fetchFn: typeof fetch = fetch,
  timing: FlowTiming = 'start',
  exclude: string[] = [],
): Promise<UploadOutcome> {
  const files = typeof input === 'string' ? [{ name: '', text: input }] : input;
  const combined = combineFiles(files);
  if ('rejected' in combined) return { kind: 'rejected', rejected: combined.rejected };
  const { periods, converted } = combined;

  const tickers = ledgerTickers(combined.rows);
  if (tickers.length > MAX_TICKERS) {
    const message = `A file can hold at most ${MAX_TICKERS} different tickers; this one has ${tickers.length}.`;
    return { kind: 'rejected', rejected: [{ line: null, code: 'too_many_tickers', message }] };
  }
  const body = await fetchPrices(tickers, firstDate(combined.rows), fetchFn);
  const unavailable = (reason: string) =>
    body.unavailable.filter((u) => u.reason === reason && !exclude.includes(u.ticker)).map((u) => u.ticker).sort();
  const unsupported = unavailable('not_on_allowlist');
  const notLoaded = unavailable('no_data_yet');
  const availability: Rejection[] = [];
  if (unsupported.length)
    availability.push({
      line: null,
      code: 'unsupported_tickers',
      message: `These tickers are not supported yet: ${list(unsupported)}.`,
      tickers: unsupported,
    });
  if (notLoaded.length)
    availability.push({
      line: null,
      code: 'prices_not_loaded',
      message: `Prices for ${list(notLoaded)} are not loaded yet. Try again tomorrow.`,
      tickers: notLoaded,
    });
  if (availability.length) return { kind: 'rejected', rejected: availability };
  if (body.asOf === null) return { kind: 'empty' }; // spec 15.1.3: nothing is cached yet

  const prices = toPriceSeries(body.prices);
  const fx = toFx(body.fx);
  // Spec 15.4.2 step 7: reconciliation runs before compute, so its rejection wins over any engine rejection.
  const excluded = tickers.filter((t) => exclude.includes(t)); // ledgerTickers is sorted
  const openings = combined.openings
    .map((o) => ({ ...o, rows: excludeTickers(o.rows, excluded) }))
    .filter((o) => o.rows.length);
  const reduced = excludeTickers(combined.rows, excluded);
  // Valuation and reconciliation start from the earliest file's rows, so excluding all of them leaves nothing.
  if (!reduced.some((r) => !openings.length || r.date < openings[0].start)) {
    const message = 'Excluding these holdings leaves nothing to measure.';
    return { kind: 'rejected', rejected: [{ line: null, code: 'nothing_left', message }] };
  }
  const reconciled = reconcile({ ...combined, rows: reduced, openings }, prices, fx, timing);
  if ('rejected' in reconciled) {
    // Every reconcile rejection but reconcile_position comes from its valueDaily pass, so it is an engine rejection.
    const engine = reconciled.rejected[0].code !== 'reconcile_position';
    return { kind: 'rejected', rejected: reconciled.rejected, ...(engine && { converted }) };
  }
  const { rows, origin } = reconciled;
  const notices = [...combined.notices, ...reconciled.notices];
  const computeInput = { ledger: rows, prices, fx, endDate: body.asOf, flowTiming: timing, originalLedger: combined.rows };
  const result = compute(computeInput);
  if (!result.ok) return { kind: 'rejected', rejected: result.rejected.map((r) => mapBack(r, origin, files.length > 1)), converted };
  const share = excluded.length ? { tickers: excluded, share: excludedShare(combined.rows, excluded, fx) } : null;
  return { kind: 'result', result, asOf: body.asOf, excluded: share, tickers, ledger: rows, notices, input: computeInput, periods, converted };
}
