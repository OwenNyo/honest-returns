// One-off: writes src/sample/sample-ledger.csv from the local market fixture by the rule in spec 8.
// Run: node scripts/make-sample.ts (after scripts/fetch-fixture.ts). The output is committed; do not regenerate silently.
import { readFileSync, writeFileSync } from 'node:fs';
import { D } from '../src/engine/decimal.ts';

type Raw = { prices: Record<string, [string, string, string, string][]>; fx: [string, string][] };
const market: Raw = JSON.parse(readFileSync('src/engine/fixtures/sample-market.json', 'utf8'));
const close = (t: string) => new Map(market.prices[t].map(([d, c]) => [d, c]));
const closes = { VOO: close('VOO'), AAPL: close('AAPL') };
const ecb = new Map(market.fx);

const lines = ['date,type,ticker,quantity,price,currency,amount,fees'];
let usd = D(0);
for (let y = 2019; y <= 2025; y++) {
  for (let m = 1; m <= (y === 2025 ? 6 : 12); m++) {
    const prefix = `${y}-${String(m).padStart(2, '0')}-`;
    const date = [...closes.VOO.keys()].find((d) => d.startsWith(prefix) && ecb.has(d));
    if (!date) throw new Error(`no VOO trading day with an ECB fixing in ${prefix}`);
    const brokerRate = D(ecb.get(date)!).times('1.002').toDecimalPlaces(4, D.ROUND_HALF_EVEN);
    const bought = D(1000).div(brokerRate).toDecimalPlaces(2, D.ROUND_DOWN);
    usd = usd.plus(bought);
    const ticker = m % 2 === 1 ? 'VOO' : 'AAPL';
    const price = closes[ticker].get(date);
    if (!price) throw new Error(`no ${ticker} close on ${date}`);
    const quantity = usd.div(price).floor();
    if (quantity.isZero()) throw new Error(`not enough USD for one ${ticker} share on ${date}`);
    const amount = quantity.times(price);
    usd = usd.minus(amount);
    lines.push(
      `${date},DEPOSIT,,,,SGD,1000,0`,
      `${date},FX,USD,${bought},,SGD,1000,0`,
      `${date},BUY,${ticker},${quantity},${price},USD,${amount},0`,
    );
  }
}
writeFileSync('src/sample/sample-ledger.csv', lines.join('\n') + '\n');
console.log(`${lines.length - 1} data rows`);
