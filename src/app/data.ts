import { compute } from '../engine/compute';
import { toFx, toPriceSeries } from '../engine/load-market';
import type { ComputeInput, ComputeResult, IsoDate, LedgerRow } from '../engine/types';
import sampleCsv from '../sample/sample-ledger.csv?raw';
import { SAMPLE_END } from '../sample';
import { PricesResponse } from '../shared/api';
import { ledgerTickers, parseCsv } from '../shared/csv';

export async function fetchPrices(tickers: string[], from: IsoDate, fetchFn: typeof fetch = fetch): Promise<PricesResponse> {
  const res = await fetchFn(`/api/prices?tickers=${tickers.join(',')}&from=${from}`);
  if (!res.ok) throw new Error(`/api/prices answered HTTP ${res.status}`);
  return PricesResponse.parse(await res.json());
}

export const firstDate = (rows: LedgerRow[]) => rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);

export type Loaded = ComputeResult & { asOf: IsoDate | null; ledger: LedgerRow[] };
// The compute input is kept so the benchmark and the adjusted-close panel can rerun the engine.
export type SampleLoaded = Loaded & { input: ComputeInput };
// The result fields are declared absent so callers can test `res.ok` on either variant (data.test.ts does).
export type EmptyCache = { kind: 'empty' } & Partial<Record<'ok' | 'asOf' | 'series' | 'rejected', undefined>>;

// Spec 10.1: the bundled sample, computed to the fixed end date. Spec 15.1.3: an empty cache is a state.
export async function loadSample(fetchFn: typeof fetch = fetch): Promise<SampleLoaded | EmptyCache> {
  const { rows, rejected } = parseCsv(sampleCsv);
  if (rejected.length) throw new Error('sample ledger is invalid: ' + JSON.stringify(rejected[0]));
  const body = await fetchPrices(ledgerTickers(rows), firstDate(rows), fetchFn);
  if (body.asOf === null) return { kind: 'empty' };
  if (body.unavailable.length) throw new Error('sample tickers unavailable: ' + JSON.stringify(body.unavailable));
  const input = { ledger: rows, prices: toPriceSeries(body.prices), fx: toFx(body.fx), endDate: SAMPLE_END };
  return { ...compute(input), asOf: body.asOf, ledger: rows, input };
}
