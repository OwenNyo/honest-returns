import { expect, test } from 'vitest';
import { compute } from '../engine/compute';
import { D } from '../engine/decimal';
import * as goldenA from '../engine/fixtures/golden-a';
import { parseCsv } from '../shared/csv';
import { cardData } from './shareCard';

// Task 27, spec 15.2: the card data holds no ticker, no ledger and no SGD amount unless opted in.
// drawCard (canvas) is not tested here.
function goldenResult() {
  const result = compute({ ledger: parseCsv(goldenA.csv).rows, prices: goldenA.prices, fx: goldenA.fx, endDate: goldenA.endDate });
  if (!result.ok) throw new Error('Golden A did not compute');
  return result;
}
const json = (includeSgd: boolean) => JSON.stringify(cardData(goldenResult(), includeSgd));

test('card data never holds a ticker', () => {
  expect(json(true)).not.toContain('AAPL');
});

test('card data has no ledger field', () => {
  // @ts-expect-error CardData must not carry the ledger
  expect(cardData(goldenResult(), true).ledger).toBeUndefined();
});

test('without the SGD option, neither the end value nor the money in is in the card data', () => {
  const s = json(false);
  expect(s).not.toMatch(/1,?998/);
  expect(s).not.toMatch(/1,?900/);
});

test('with the SGD option, the end value and the money in are in the card data', () => {
  const s = json(true);
  expect(s).toMatch(/1,?998/);
  expect(s).toMatch(/1,?900/);
});

test('card data holds the period dates', () => {
  const s = json(false);
  expect(s).toMatch(/2020-08-28|28 Aug 2020/);
  expect(s).toMatch(/2020-09-01|1 Sep 2020/);
});

// Task 33, spec 16.6: the card names the count of excluded holdings, never the tickers.
const share = D('0.5004995005');

test('with one excluded ticker, the explanation ends with the count sentence', () => {
  const r = goldenResult();
  expect(cardData(r, false, { tickers: ['ZZZ'], share }).explanation).toBe(
    `${r.explanation} Excludes 1 holding, 50% of what was bought.`,
  );
});

test('with two excluded tickers, the sentence says 2 holdings', () => {
  expect(cardData(goldenResult(), false, { tickers: ['YYY', 'ZZZ'], share }).explanation).toMatch(
    / Excludes 2 holdings, 50% of what was bought\.$/,
  );
});

test('card data never holds an excluded ticker', () => {
  const s = JSON.stringify(cardData(goldenResult(), true, { tickers: ['YYY', 'ZZZ'], share }));
  expect(s).not.toMatch(/YYY|ZZZ/);
});

test('with excluded null, the explanation is unchanged', () => {
  const r = goldenResult();
  expect(cardData(r, false, null).explanation).toBe(r.explanation);
});
