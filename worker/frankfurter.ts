// Spec 9.3 step 2. ECB reference rates, SGD per USD.
export type FxRow = [date: string, sgdPerUsd: string];

export const frankfurterUrl = (from: string, to: string) =>
  `https://api.frankfurter.dev/v1/${from}..${to}?base=USD&symbols=SGD`;

export const toFxRows = (body: { rates: Record<string, { SGD: number }> }): FxRow[] =>
  Object.entries(body.rates)
    .map(([d, r]): FxRow => [d, String(r.SGD)])
    .sort((a, b) => a[0].localeCompare(b[0]));
