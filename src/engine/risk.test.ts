import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { compute } from './compute';
import { D } from './decimal';
import * as goldenA from './fixtures/golden-a';
import { toFx, toPriceSeries } from './load-market';
import { maxDrawdown, volatility } from './risk';
import type { ComputeInput, FlowTiming, FxPoint, LedgerRow, PriceBar, ValuationPoint } from './types';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}
const lines = (...l: string[]) => ledger([HEADER, ...l].join('\n'));

function ok(input: ComputeInput) {
  const res = compute(input);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return res;
}
const bar = (date: string, close: string): PriceBar => ({ date, close: D(close), splitFactor: D(1), divCash: D(0) });
const fall = (series: ValuationPoint[]) => {
  const m = maxDrawdown(series);
  return { maxDrawdown: m.maxDrawdown.toFixed(10), peakDate: m.peakDate, troughDate: m.troughDate };
};

// Golden G (spec 17.2.2): a withdrawal after a rise, then a real fall and a partial recovery.
const GOLDEN_G_DATES = ['2021-06-01', '2021-06-02', '2021-06-03', '2021-06-04', '2021-06-07'];
const fxG: FxPoint[] = GOLDEN_G_DATES.map((date) => ({ date, sgdPerUsd: D('1.30') }));
const inputG = (flowTiming: FlowTiming = 'start'): ComputeInput => ({
  ledger: lines(
    '2021-06-01,DEPOSIT,,,,SGD,1300,0',
    '2021-06-01,FX,USD,1000,,SGD,1300,0',
    '2021-06-01,BUY,VOO,10,100,USD,1000,0',
    '2021-06-03,SELL,VOO,5,120,USD,600,0',
    '2021-06-03,FX,SGD,780,,USD,600,0',
    '2021-06-03,WITHDRAW,,,,SGD,780,0',
  ),
  prices: { VOO: ['100', '120', '120', '90', '108'].map((c, i) => bar(GOLDEN_G_DATES[i], c)) },
  fx: fxG,
  endDate: '2021-06-07',
  flowTiming,
});
const seriesG = (t: FlowTiming = 'start') => ok(inputG(t)).series;
const G_FALL = { maxDrawdown: '-0.2500000000', peakDate: '2021-06-02', troughDate: '2021-06-04' };

describe('maxDrawdown and volatility on Golden G', () => {
  test('Golden G, start timing: largest fall is -0.25 from 2021-06-02 to 2021-06-04', () => {
    expect(fall(seriesG('start'))).toEqual(G_FALL);
  });

  test('Golden G, end timing: the same largest fall and dates', () => {
    expect(fall(seriesG('end'))).toEqual(G_FALL);
  });

  test('Golden G: the value fell 62.5% but the withdrawal is not a fall', () => {
    const s = seriesG();
    const value = (d: string) => s.find((p) => p.date === d)!.valueSgd.toFixed(10);
    expect([value('2021-06-02'), value('2021-06-04')]).toEqual(['1560.0000000000', '585.0000000000']);
    expect(maxDrawdown(s).maxDrawdown.toFixed(10)).toBe('-0.2500000000');
  });

  test('Golden G: volatility(series) is 2.9108786106', () => {
    expect(volatility(seriesG()).toFixed(10)).toBe('2.9108786106');
  });

  test('Golden G: compute risk.volatility is null under 90 days', () => {
    expect(ok(inputG()).risk?.volatility).toBeNull();
  });

  // Checks the fixture against spec 17.2.2; passes before risk.ts exists.
  test('Golden G: TWR cumulative is 0.08', () => {
    expect(ok(inputG()).twr.value.toFixed(10)).toBe('0.0800000000');
  });
});

describe('maxDrawdown on other goldens', () => {
  test('Golden A: no fall, peakDate and troughDate null', () => {
    const s = ok({ ledger: ledger(goldenA.csv), prices: goldenA.prices, fx: goldenA.fx, endDate: goldenA.endDate }).series;
    expect(fall(s)).toEqual({ maxDrawdown: '0.0000000000', peakDate: null, troughDate: null });
  });

  test('Golden D1: a first-day fall is measured from the start: -0.0259285714 on 2021-06-01', () => {
    const s = ok({
      ledger: lines(
        '2021-06-01,DEPOSIT,,,,SGD,1400,0',
        '2021-06-01,FX,USD,1050,,SGD,1400,0',
        '2021-06-01,BUY,VOO,10,100,USD,1000,1',
      ),
      prices: { VOO: [bar('2021-06-01', '100'), bar('2021-06-02', '110')] },
      fx: [
        { date: '2021-06-01', sgdPerUsd: D('1.30') },
        { date: '2021-06-02', sgdPerUsd: D('1.40') },
      ],
      endDate: '2021-06-02',
    }).series;
    expect(fall(s)).toEqual({ maxDrawdown: '-0.0259285714', peakDate: '2021-06-01', troughDate: '2021-06-01' });
  });

  test('ties keep the earliest trough', () => {
    // Hand-built: only dailyReturn matters. Index 0.5, 1, 0.5; day 3 ties day 1 and does not replace it.
    const pt = (date: string, r: string): ValuationPoint => ({
      date,
      valueSgd: D(0),
      netFlowSgd: D(0),
      netInvestedSgd: D(0),
      dailyReturn: D(r),
      fxRate: D(1),
      fxDate: date,
      cash: { SGD: D(0), USD: D(0) },
      holdings: {},
    });
    const s = [pt('2021-01-01', '-0.5'), pt('2021-01-02', '1'), pt('2021-01-03', '-0.5')];
    expect(fall(s)).toEqual({ maxDrawdown: '-0.5000000000', peakDate: '2021-01-01', troughDate: '2021-01-01' });
  });

  test('a tie decided by Decimal noise keeps the earliest trough', () => {
    // 2 VOO and USD 200: value 1000, 920, 1000, 920, so the index returns to 1 only up to Decimal rounding.
    const dates = ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07'];
    const s = ok({
      ledger: lines('2024-03-04,DEPOSIT,,,,SGD,1300,0', '2024-03-04,FX,USD,1000,,SGD,1300,0', '2024-03-04,BUY,VOO,2,400,USD,800,0'),
      prices: { VOO: ['400', '360', '400', '360'].map((c, i) => bar(dates[i], c)) },
      fx: dates.map((date) => ({ date, sgdPerUsd: D('1.30') })),
      endDate: '2024-03-07',
    }).series;
    expect(fall(s)).toEqual({ maxDrawdown: '-0.0800000000', peakDate: '2024-03-04', troughDate: '2024-03-05' });
  });
});

// Real Tiingo-derived data is a gitignored local fixture; skip when absent (as in sample.test.ts).
type RawMarket = { prices: Record<string, [string, string, string, string][]>; fx: [string, string][] };
const marketFiles = import.meta.glob<RawMarket>('./fixtures/sample-market.json', { eager: true, import: 'default' });
const ledgerFiles = import.meta.glob<string>('../sample/sample-ledger.csv', { eager: true, query: '?raw', import: 'default' });
const rawMarket = marketFiles['./fixtures/sample-market.json'];
const sampleCsv = ledgerFiles['../sample/sample-ledger.csv'];

describe.skipIf(rawMarket === undefined || sampleCsv === undefined)('risk on the sample (needs local fixture)', () => {
  const series = (flowTiming: FlowTiming) =>
    ok({
      ledger: ledger(sampleCsv),
      prices: toPriceSeries(rawMarket.prices),
      fx: toFx(rawMarket.fx),
      endDate: '2025-06-30',
      flowTiming,
    }).series;

  test('start timing: largest fall -0.2892571569 from 2020-02-14 to 2020-03-23', () => {
    expect(fall(series('start'))).toEqual({ maxDrawdown: '-0.2892571569', peakDate: '2020-02-14', troughDate: '2020-03-23' });
  });

  test('start timing: volatility 0.2496930424', () => {
    expect(volatility(series('start')).toFixed(10)).toBe('0.2496930424');
  });

  test('end timing: largest fall -0.2867883528, same dates', () => {
    expect(fall(series('end'))).toEqual({ maxDrawdown: '-0.2867883528', peakDate: '2020-02-14', troughDate: '2020-03-23' });
  });

  test('end timing: volatility 0.2501337305', () => {
    expect(volatility(series('end')).toFixed(10)).toBe('0.2501337305');
  });
});
