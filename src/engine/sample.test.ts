import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { daysBetween } from '../shared/dates';
import { compute } from './compute';
import { D } from './decimal';
import { toFx, toPriceSeries } from './load-market';
import type { LedgerRow } from './types';

// Real Tiingo-derived data is a gitignored local fixture (Checkpoint 1 decision 2).
// import.meta.glob returns {} when the file is absent, so these tests skip instead of failing.
type RawMarket = { prices: Record<string, [string, string, string, string][]>; fx: [string, string][] };
const marketFiles = import.meta.glob<RawMarket>('./fixtures/sample-market.json', { eager: true, import: 'default' });
const ledgerFiles = import.meta.glob<string>('../sample/sample-ledger.csv', { eager: true, query: '?raw', import: 'default' });
const rawMarket = marketFiles['./fixtures/sample-market.json'];
const sampleCsv = ledgerFiles['../sample/sample-ledger.csv'];
const haveSample = rawMarket !== undefined && sampleCsv !== undefined;

function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('ledger invalid: ' + JSON.stringify(rejected.slice(0, 3)));
  return rows;
}

describe('load-market', () => {
  test('toPriceSeries turns API string tuples into Decimal price bars', () => {
    const s = toPriceSeries({ AAPL: [['2020-08-31', '129.04', '4', '0']] });
    const b = s.AAPL[0];
    expect([b.date, b.close.toString(), b.splitFactor.toString(), b.divCash.toString()]).toEqual([
      '2020-08-31',
      '129.04',
      '4',
      '0',
    ]);
  });

  test('toPriceSeries keeps every ticker and bar order', () => {
    const s = toPriceSeries({
      AAPL: [
        ['2020-08-28', '499.23', '1', '0'],
        ['2020-08-31', '129.04', '4', '0'],
      ],
      VOO: [],
    });
    expect(Object.keys(s).sort()).toEqual(['AAPL', 'VOO']);
    expect(s.AAPL.map((b) => b.date)).toEqual(['2020-08-28', '2020-08-31']);
  });

  test('toFx turns API string tuples into Decimal rates', () => {
    const fx = toFx([
      ['2020-08-28', '1.3612'],
      ['2020-08-31', '1.3605'],
    ]);
    expect(fx.map((p) => [p.date, p.sgdPerUsd.toString()])).toEqual([
      ['2020-08-28', '1.3612'],
      ['2020-08-31', '1.3605'],
    ]);
  });
});

describe.skipIf(!haveSample)('sample portfolio (needs local fixture)', () => {
  const market = () => ({ prices: toPriceSeries(rawMarket.prices), fx: toFx(rawMarket.fx) });

  async function run() {
    const { SAMPLE_END } = await import('../sample');
    const rows = ledger(sampleCsv);
    return { SAMPLE_END, rows, res: compute({ ledger: rows, ...market(), endDate: SAMPLE_END }) };
  }

  test('SAMPLE_END is fixed at 2025-06-30', async () => {
    expect((await run()).SAMPLE_END).toBe('2025-06-30');
  });

  test('compute is ok with one point per calendar day', async () => {
    const { SAMPLE_END, rows, res } = await run();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.series).toHaveLength(daysBetween(rows[0].date, SAMPLE_END) + 1);
  });

  test('AAPL holding at the end of 2020-08-31 is 4 x the holding at the end of 2020-08-30', async () => {
    const { res } = await run();
    if (!res.ok) throw new Error('sample should compute');
    const at = (d: string) => res.series.find((p) => p.date === d)!.holdings.AAPL;
    expect(at('2020-08-31').toString()).toBe(at('2020-08-30').times(4).toString());
  });

  test('buy-and-hold across the split equals the split-adjusted price return', () => {
    const { prices } = market();
    const close = (d: string) => prices.AAPL.find((b) => b.date === d)!.close;
    const c = close('2020-08-03').toString();
    const rows = ledger(
      [
        'date,type,ticker,quantity,price,currency,amount,fees',
        `2020-08-03,DEPOSIT,,,,SGD,${c},0`,
        `2020-08-03,FX,USD,${c},,SGD,${c},0`,
        `2020-08-03,BUY,AAPL,1,${c},USD,${c},0`,
      ].join('\n'),
    );
    const res = compute({
      ledger: rows,
      prices: { AAPL: prices.AAPL },
      fx: [{ date: '2020-08-03', sgdPerUsd: D(1) }],
      endDate: '2020-09-30',
    });
    if (!res.ok) throw new Error('buy-and-hold should compute: ' + JSON.stringify(res.rejected));
    const expected = D(4).times(close('2020-09-30')).div(close('2020-08-03')).minus(1);
    expect(res.twr.value.toFixed(10)).toBe(expected.toFixed(10));
  });
});
