import { compute } from '../engine/compute';
import { toFx, toPriceSeries } from '../engine/load-market';
import type { ComputeResult, IsoDate, LedgerRow } from '../engine/types';
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

// Spec 10.1: the bundled sample, computed to the fixed end date.
export async function loadSample(fetchFn: typeof fetch = fetch): Promise<Loaded> {
  const { rows, rejected } = parseCsv(sampleCsv);
  if (rejected.length) throw new Error('sample ledger is invalid: ' + JSON.stringify(rejected[0]));
  const body = await fetchPrices(ledgerTickers(rows), firstDate(rows), fetchFn);
  if (body.unavailable.length) throw new Error('sample tickers unavailable: ' + JSON.stringify(body.unavailable));
  const result = compute({ ledger: rows, prices: toPriceSeries(body.prices), fx: toFx(body.fx), endDate: SAMPLE_END });
  return { ...result, asOf: body.asOf, ledger: rows };
}
