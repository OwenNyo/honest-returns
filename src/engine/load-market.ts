import { D } from './decimal';
import type { FxPoint, PriceSeries } from './types';

// API string tuples (spec 9.2) to engine types.
export function toPriceSeries(raw: Record<string, [string, string, string, string][]>): PriceSeries {
  return Object.fromEntries(
    Object.entries(raw).map(([t, rows]) => [
      t,
      rows.map(([date, close, splitFactor, divCash]) => ({
        date,
        close: D(close),
        splitFactor: D(splitFactor),
        divCash: D(divCash),
      })),
    ]),
  );
}

export function toFx(raw: [string, string][]): FxPoint[] {
  return raw.map(([date, rate]) => ({ date, sgdPerUsd: D(rate) }));
}
