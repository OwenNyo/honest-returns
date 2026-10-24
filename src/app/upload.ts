import { compute } from '../engine/compute';
import { toFx, toPriceSeries } from '../engine/load-market';
import type { ComputeInput, ComputeResult, FlowTiming, IsoDate, LedgerRow, Rejection } from '../engine/types';
import { ledgerTickers } from '../shared/csv';
import { combineFiles, type InputFile, mapBack } from './combine';
import { fetchPrices, firstDate } from './data';

export type UploadOutcome =
  | { kind: 'result'; result: ComputeResult & { ok: true }; asOf: IsoDate; tickers: string[]; ledger: LedgerRow[]; notices: string[]; input: ComputeInput; periods: { name: string; from: IsoDate; to: IsoDate }[] }
  | { kind: 'rejected'; rejected: Rejection[] }
  | { kind: 'empty' };

const MAX_TICKERS = 50; // the /api/prices limit (spec 9.2)
const list = (tickers: string[]) => [...tickers].sort().join(', ');
export const UNSUPPORTED_PREFIX = 'These tickers are not supported yet: ';

// Spec 10.2 and 15.4: combine the files, then ticker availability, then compute to asOf. Any rejection means
// no numbers. A single CSV string is one file (decision 2 of the UI batch rulings).
export async function runUpload(
  input: string | InputFile[],
  fetchFn: typeof fetch = fetch,
  timing: FlowTiming = 'start',
): Promise<UploadOutcome> {
  const files = typeof input === 'string' ? [{ name: '', text: input }] : input;
  const combined = combineFiles(files);
  if ('rejected' in combined) return { kind: 'rejected', rejected: combined.rejected };
  const { rows, origin, periods, notices } = combined;

  const tickers = ledgerTickers(rows);
  if (tickers.length > MAX_TICKERS) {
    const message = `A file can hold at most ${MAX_TICKERS} different tickers; this one has ${tickers.length}.`;
    return { kind: 'rejected', rejected: [{ line: null, code: 'too_many_tickers', message }] };
  }
  const body = await fetchPrices(tickers, firstDate(rows), fetchFn);
  const unsupported = body.unavailable.filter((u) => u.reason === 'not_on_allowlist').map((u) => u.ticker);
  const notLoaded = body.unavailable.filter((u) => u.reason === 'no_data_yet').map((u) => u.ticker);
  const availability: Rejection[] = [];
  if (unsupported.length)
    availability.push({
      line: null,
      code: 'unsupported_tickers',
      message: `${UNSUPPORTED_PREFIX}${list(unsupported)}.`,
    });
  if (notLoaded.length)
    availability.push({
      line: null,
      code: 'prices_not_loaded',
      message: `Prices for ${list(notLoaded)} are not loaded yet. Try again tomorrow.`,
    });
  if (availability.length) return { kind: 'rejected', rejected: availability };
  if (body.asOf === null) return { kind: 'empty' }; // spec 15.1.3: nothing is cached yet

  const computeInput = { ledger: rows, prices: toPriceSeries(body.prices), fx: toFx(body.fx), endDate: body.asOf, flowTiming: timing };
  const result = compute(computeInput);
  if (!result.ok) return { kind: 'rejected', rejected: result.rejected.map((r) => mapBack(r, origin, files.length > 1)) };
  return { kind: 'result', result, asOf: body.asOf, tickers, ledger: rows, notices, input: computeInput, periods };
}
