import type Decimal from 'decimal.js';
import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { compute } from './compute';
import { D } from './decimal';
import { decompose } from './decompose';
import { toFx, toPriceSeries } from './load-market';
import type { ComputeInput, FxPoint, LedgerRow, PriceSeries } from './types';

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

// Golden D (spec 7), inline: synthetic data.
const bar = (date: string, close: string, divCash = '0') => ({
  date,
  close: D(close),
  splitFactor: D(1),
  divCash: D(divCash),
});
const fxD: FxPoint[] = [
  { date: '2021-06-01', sgdPerUsd: D('1.30') },
  { date: '2021-06-02', sgdPerUsd: D('1.40') },
];
const ledgerD = () =>
  lines(
    '2021-06-01,DEPOSIT,,,,SGD,1400,0',
    '2021-06-01,FX,USD,1050,,SGD,1400,0',
    '2021-06-01,BUY,VOO,10,100,USD,1000,1',
  );
const inputD = (prices: PriceSeries): ComputeInput => ({ ledger: ledgerD(), prices, fx: fxD, endDate: '2021-06-02' });
const d1 = () => inputD({ VOO: [bar('2021-06-01', '100'), bar('2021-06-02', '110')] });
const d2 = () => inputD({ VOO: [bar('2021-06-01', '100'), bar('2021-06-02', '110', '0.50')] });

const identity = (p: Record<'local' | 'fx' | 'conversionCost' | 'dividends' | 'totalGain', Decimal>) =>
  p.local.plus(p.fx).minus(p.conversionCost).plus(p.dividends).eq(p.totalGain);

describe('decompose on Golden D1 (no dividends)', () => {
  const run = () => {
    const i = d1();
    return decompose(ok(i).series, i.ledger, i.fx);
  };

  test('local price effect is 138.7 SGD (includes the 1.3 SGD trade fee)', () => {
    expect(run().local.toFixed(10)).toBe('138.7000000000');
  });

  test('FX effect is 104.9 SGD', () => {
    expect(run().fx.toFixed(10)).toBe('104.9000000000');
  });

  test('conversion cost is 35 SGD, positive as a cost', () => {
    expect(run().conversionCost.toFixed(10)).toBe('35.0000000000');
  });

  test('dividends and withholding are 0', () => {
    const r = run();
    expect([r.dividends.toFixed(10), r.withholding.toFixed(10)]).toEqual(['0.0000000000', '0.0000000000']);
  });

  test('total gain is 208.6 SGD (V_end - net flows)', () => {
    expect(run().totalGain.toFixed(10)).toBe('208.6000000000');
  });

  test('local + fx - conversionCost + dividends equals totalGain exactly', () => {
    expect(identity(run())).toBe(true);
  });

  test('TWR is 0.149', () => {
    expect(ok(d1()).twr.value.toFixed(10)).toBe('0.1490000000');
  });

  test('compute attaches the decomposition to the result', () => {
    const res = ok(d1());
    expect(res.decomposition!.totalGain.toFixed(10)).toBe('208.6000000000');
  });
});

describe('decompose on a USD-to-SGD conversion', () => {
  // 06-01: 1300 SGD to 1000 USD at the reference rate (no cost).
  // 06-02: sell 100 USD for 135 SGD at reference 1.40: 135 - 100 x 1.40 = -5.
  const run = () => {
    const i: ComputeInput = {
      ledger: lines(
        '2021-06-01,DEPOSIT,,,,SGD,1300,0',
        '2021-06-01,FX,USD,1000,,SGD,1300,0',
        '2021-06-02,FX,SGD,135,,USD,100,0',
      ),
      prices: {},
      fx: fxD,
      endDate: '2021-06-02',
    };
    return decompose(ok(i).series, i.ledger, i.fx);
  };

  test('conversion cost is 5 SGD', () => {
    expect(run().conversionCost.toFixed(10)).toBe('5.0000000000');
  });

  test('FX effect is 100 SGD and the local residual is 0', () => {
    const r = run();
    expect([r.fx.toFixed(10), r.local.toFixed(10)]).toEqual(['100.0000000000', '0.0000000000']);
  });

  test('total gain is 95 SGD and the identity holds', () => {
    const r = run();
    expect(r.totalGain.toFixed(10)).toBe('95.0000000000');
    expect(identity(r)).toBe(true);
  });
});

// Task 18 extension: Golden D2, 06-02 is a 0.50 ex-date with no DIVIDEND row.
describe('decomposition on Golden D2 (dividend on the ex-date)', () => {
  const run = () => ok(d2()).decomposition!;

  test('dividends after tax are 4.9 SGD (10 x 0.50 x 0.7 x 1.40)', () => {
    expect(run().dividends.toFixed(10)).toBe('4.9000000000');
  });

  test('local, FX and conversion are unchanged from D1', () => {
    const r = run();
    expect([r.local.toFixed(10), r.fx.toFixed(10), r.conversionCost.toFixed(10)]).toEqual([
      '138.7000000000',
      '104.9000000000',
      '35.0000000000',
    ]);
  });

  test('total gain is 213.5 SGD and the identity holds', () => {
    const r = run();
    expect(r.totalGain.toFixed(10)).toBe('213.5000000000');
    expect(identity(r)).toBe(true);
  });

  test('withholding is shown separately: 1.5 USD x 1.40 = 2.1 SGD', () => {
    expect(run().withholding.toFixed(10)).toBe('2.1000000000');
  });

  test('TWR is 0.1525', () => {
    expect(ok(d2()).twr.value.toFixed(10)).toBe('0.1525000000');
  });
});

// Real Tiingo-derived data is a gitignored local fixture; skip when absent (as in sample.test.ts).
type RawMarket = { prices: Record<string, [string, string, string, string][]>; fx: [string, string][] };
const marketFiles = import.meta.glob<RawMarket>('./fixtures/sample-market.json', { eager: true, import: 'default' });
const ledgerFiles = import.meta.glob<string>('../sample/sample-ledger.csv', { eager: true, query: '?raw', import: 'default' });
const rawMarket = marketFiles['./fixtures/sample-market.json'];
const sampleCsv = ledgerFiles['../sample/sample-ledger.csv'];

describe.skipIf(rawMarket === undefined || sampleCsv === undefined)('decompose on the sample (needs local fixture)', () => {
  test('local + fx - conversionCost + dividends equals totalGain exactly', () => {
    const i: ComputeInput = {
      ledger: ledger(sampleCsv),
      prices: toPriceSeries(rawMarket.prices),
      fx: toFx(rawMarket.fx),
      endDate: '2025-06-30',
    };
    expect(identity(decompose(ok(i).series, i.ledger, i.fx))).toBe(true);
  });
});
