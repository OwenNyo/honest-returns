// One-off: writes src/engine/fixtures/sample-market.json (gitignored) in the API tuple format (spec 9.2).
// Run: node scripts/fetch-fixture.ts. Reads TIINGO_TOKEN from .dev.vars and never prints it.
import { readFileSync, writeFileSync } from 'node:fs';

const FROM = '2018-01-01';
const TO = '2025-06-30';
const TICKERS = ['AAPL', 'VOO'];

const token = /^TIINGO_TOKEN=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1].trim();
if (!token) throw new Error('TIINGO_TOKEN missing from .dev.vars');

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}${new URL(url).pathname}`);
  return res.json();
}

type TiingoBar = { date: string; close: number; splitFactor: number; divCash: number };
const prices: Record<string, [string, string, string, string][]> = {};
for (const t of TICKERS) {
  const bars: TiingoBar[] = await getJson(
    `https://api.tiingo.com/tiingo/daily/${t}/prices?startDate=${FROM}&endDate=${TO}`,
    { Authorization: `Token ${token}` },
  );
  prices[t] = bars.map((b) => [b.date.slice(0, 10), String(b.close), String(b.splitFactor), String(b.divCash)]);
}

const fxBody: { rates: Record<string, { SGD: number }> } = await getJson(
  `https://api.frankfurter.dev/v1/${FROM}..${TO}?base=USD&symbols=SGD`,
);
const fx = Object.entries(fxBody.rates)
  .map(([d, r]): [string, string] => [d, String(r.SGD)])
  .sort((a, b) => a[0].localeCompare(b[0]));

writeFileSync('src/engine/fixtures/sample-market.json', JSON.stringify({ prices, fx }));
console.log(Object.entries(prices).map(([t, r]) => `${t} ${r.length} bars`).join(', ') + `, fx ${fx.length} points`);
