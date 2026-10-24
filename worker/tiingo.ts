// Spec 9.3 step 6.
export type Bar = [date: string, close: string, splitFactor: string, divCash: string];
type Item = { date: string; close: number; splitFactor: number; divCash: number };

export function tiingoRequest(ticker: string, startDate: string, token: string): Request {
  return new Request(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${startDate}`, {
    headers: { Authorization: `Token ${token}` },
  });
}

export const toBars = (items: Item[]): Bar[] =>
  items.map((i) => [i.date.slice(0, 10), String(i.close), String(i.splitFactor), String(i.divCash)]);
