import { z } from 'zod';
import { isIsoDate } from './dates';

const TICKER = /^[A-Z0-9.\-]{1,10}$/;

// Spec 9.2: GET /api/prices query.
export const PricesQuery = z.object({
  tickers: z
    .string()
    .transform((s) => [...new Set(s.split(',').map((t) => t.trim().toUpperCase()))])
    .pipe(z.array(z.string().regex(TICKER, 'each ticker must be 1 to 10 characters A to Z, 0 to 9, dot or hyphen')).min(1).max(50)),
  from: z.string().refine(isIsoDate, 'from must be a real date written as YYYY-MM-DD'),
});
export type PricesQuery = z.infer<typeof PricesQuery>;

const IsoDate = z.string().refine(isIsoDate);
const Bar = z.tuple([IsoDate, z.string(), z.string(), z.string()]);

export const PricesResponse = z.object({
  asOf: IsoDate.nullable(),
  prices: z.record(z.string(), z.array(Bar)),
  fx: z.array(z.tuple([IsoDate, z.string()])),
  unavailable: z.array(z.object({ ticker: z.string(), reason: z.enum(['not_on_allowlist', 'no_data_yet']) })),
});
export type PricesResponse = z.infer<typeof PricesResponse>;
