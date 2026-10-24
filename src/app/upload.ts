import { compute } from '../engine/compute';
import { toFx, toPriceSeries } from '../engine/load-market';
import type { ComputeResult, FlowTiming, IsoDate, LedgerRow, Rejection } from '../engine/types';
import { ledgerTickers, parseCsv } from '../shared/csv';
import { fetchPrices, firstDate } from './data';

export type UploadOutcome =
  | { kind: 'result'; result: ComputeResult & { ok: true }; asOf: IsoDate; tickers: string[]; ledger: LedgerRow[] }
  | { kind: 'rejected'; rejected: Rejection[] }
  | { kind: 'empty' };

const MAX_TICKERS = 50; // the /api/prices limit (spec 9.2)
const list = (tickers: string[]) => [...tickers].sort().join(', ');

// Spec 10.2: parse, then ticker availability, then compute to asOf. Any rejection means no numbers.
export async function runUpload(text: string, fetchFn: typeof fetch = fetch, timing: FlowTiming = 'start'): Promise<UploadOutcome> {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) return { kind: 'rejected', rejected };

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
      message: `These tickers are not supported yet: ${list(unsupported)}.`,
    });
  if (notLoaded.length)
    availability.push({
      line: null,
      code: 'prices_not_loaded',
      message: `Prices for ${list(notLoaded)} are not loaded yet. Try again tomorrow.`,
    });
  if (availability.length) return { kind: 'rejected', rejected: availability };
  if (body.asOf === null) return { kind: 'empty' }; // spec 15.1.3: nothing is cached yet

  const result = compute({ ledger: rows, prices: toPriceSeries(body.prices), fx: toFx(body.fx), endDate: body.asOf, flowTiming: timing });
  if (!result.ok) return { kind: 'rejected', rejected: result.rejected };
  return { kind: 'result', result, asOf: body.asOf, tickers, ledger: rows };
}
