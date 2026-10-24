import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { compute } from './compute';
import { D } from './decimal';
import { entitlements } from './dividends';
import type { ComputeInput, FxPoint, LedgerRow, PriceBar } from './types';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

function ledger(text: string): LedgerRow[] {
  const { rows, rejected } = parseCsv(text);
  if (rejected.length) throw new Error('test ledger invalid: ' + JSON.stringify(rejected));
  return rows;
}

function ok(input: ComputeInput) {
  const res = compute(input);
  if (!res.ok) throw new Error('expected ok, got ' + JSON.stringify(res.rejected));
  return res;
}

// Golden C (spec 7), inline: synthetic data.
const bar = (date: string, close: string, divCash = '0', splitFactor = '1'): PriceBar => ({
  date,
  close: D(close),
  splitFactor: D(splitFactor),
  divCash: D(divCash),
});
const vooC = [
  bar('2021-03-25', '360'),
  bar('2021-03-26', '362', '1.50'),
  bar('2021-03-29', '362'),
  bar('2021-03-30', '362'),
  bar('2021-03-31', '365'),
];
const fxC: FxPoint[] = ['2021-03-25', '2021-03-26', '2021-03-29', '2021-03-30', '2021-03-31', '2021-04-01'].map(
  (date) => ({ date, sgdPerUsd: D('1.30') }),
);
const BASE = [
  '2021-03-25,DEPOSIT,,,,SGD,1300,0',
  '2021-03-25,FX,USD,1000,,SGD,1300,0',
  '2021-03-25,BUY,VOO,2,360,USD,720,0',
];
const inputC = (extra: string[], over: Partial<ComputeInput> = {}): ComputeInput => ({
  ledger: ledger([HEADER, ...BASE, ...extra].join('\n')),
  prices: { VOO: vooC },
  fx: fxC,
  endDate: '2021-03-31',
  ...over,
});
const values = (i: ComputeInput) => ok(i).series.map((p) => p.valueSgd.toFixed(10));
const exDateWarnings = (i: ComputeInput) => ok(i).warnings.filter((w) => w.code === 'dividend_on_ex_date');
const plainDividends = (i: ComputeInput) =>
  ok(i).dividends!.map((d) => ({
    date: d.date,
    ticker: d.ticker,
    exDate: d.exDate,
    gross: d.gross.toString(),
    withheld: d.withheld.toString(),
    net: d.net.toString(),
    source: d.source,
  }));

const C1_ROW = '2021-03-31,DIVIDEND,VOO,2,1.50,USD,3.00,0.90';

describe('Golden C1: pay-date DIVIDEND row present', () => {
  const c1 = () => inputC([C1_ROW]);

  test('value dips on the ex-date and the cash lands on the pay date', () => {
    expect(values(c1())).toEqual([
      '1300.0000000000',
      '1305.2000000000',
      '1305.2000000000',
      '1305.2000000000',
      '1305.2000000000',
      '1305.2000000000',
      '1315.7300000000',
    ]);
  });

  test('TWR cumulative is 0.0121', () => {
    expect(ok(c1()).twr.value.toFixed(10)).toBe('0.0121000000');
  });

  test('XIRR (Y = T = 6) is 0.0121', () => {
    const x = ok(c1()).xirr;
    if (x.kind !== 'ok') throw new Error('expected ok XIRR');
    expect(Math.abs(Number(x.value.toString()) - 0.0121)).toBeLessThan(1e-9);
  });

  test('records the dividend from the row, matched to the 03-26 ex-date', () => {
    expect(plainDividends(c1())).toEqual([
      { date: '2021-03-31', ticker: 'VOO', exDate: '2021-03-26', gross: '3', withheld: '0.9', net: '2.1', source: 'row' },
    ]);
  });

  test('emits no dividend_on_ex_date warning', () => {
    expect(exDateWarnings(c1())).toEqual([]);
  });
});

describe('Golden C2: no DIVIDEND row, booked on the ex-date', () => {
  const c2 = () => inputC([]);

  test('net 2.10 USD is credited on the ex-date', () => {
    expect(values(c2())).toEqual([
      '1300.0000000000',
      '1307.9300000000',
      '1307.9300000000',
      '1307.9300000000',
      '1307.9300000000',
      '1307.9300000000',
      '1315.7300000000',
    ]);
  });

  test('TWR cumulative is 0.0121', () => {
    expect(ok(c2()).twr.value.toFixed(10)).toBe('0.0121000000');
  });

  test('XIRR (Y = T = 6) is 0.0121', () => {
    const x = ok(c2()).xirr;
    if (x.kind !== 'ok') throw new Error('expected ok XIRR');
    expect(Math.abs(Number(x.value.toString()) - 0.0121)).toBeLessThan(1e-9);
  });

  test('records the dividend with 30% withholding and source ex_date', () => {
    expect(plainDividends(c2())).toEqual([
      { date: '2021-03-26', ticker: 'VOO', exDate: '2021-03-26', gross: '3', withheld: '0.9', net: '2.1', source: 'ex_date' },
    ]);
  });

  test('emits one dividend_on_ex_date warning with the count', () => {
    expect(exDateWarnings(c2()).map((w) => w.message)).toEqual([
      '1 dividends were booked on the ex-date because no pay-date row was found.',
    ]);
  });
});

describe('DIVIDEND row withholding', () => {
  test('fees on the row are the actual withholding, not 30%', () => {
    const i = inputC(['2021-03-31,DIVIDEND,VOO,2,1.50,USD,3.00,0.45']);
    // (730 + 280 + 2.55) x 1.30
    expect(values(i).at(-1)).toBe('1316.3150000000');
    expect(plainDividends(i)[0]).toMatchObject({ withheld: '0.45', net: '2.55', source: 'row' });
  });

  test('a row with empty fees applies 30% withholding', () => {
    const i = inputC(['2021-03-31,DIVIDEND,VOO,2,1.50,USD,3.00,']);
    expect(values(i).at(-1)).toBe('1315.7300000000');
    expect(plainDividends(i)[0]).toMatchObject({ gross: '3', withheld: '0.9', net: '2.1', source: 'row' });
  });
});

describe('ex-date entitlement', () => {
  test('uses the holding before the day rows: a BUY on the ex-date is not entitled', () => {
    const i = inputC(['2021-03-26,BUY,VOO,1,362,USD,362,0']);
    expect(plainDividends(i)[0]).toMatchObject({ exDate: '2021-03-26', gross: '3' });
  });

  test('uses the post-split holding when the split and ex-date fall on the same day', () => {
    const voo = [bar('2021-03-25', '360'), bar('2021-03-26', '181', '0.75', '2'), bar('2021-03-31', '182')];
    // 2 shares become 4 before entitlement: 4 x 0.75 = 3.00 gross.
    const i = inputC([], { prices: { VOO: voo } });
    expect(plainDividends(i)[0]).toMatchObject({ exDate: '2021-03-26', gross: '3', net: '2.1' });
  });

  test('entitlements() lists the ex-date entitlement from the holdings pass', () => {
    const ents = entitlements(ledger([HEADER, ...BASE].join('\n')), { VOO: vooC });
    expect(ents).toHaveLength(1);
    expect(ents[0]).toMatchObject({ ticker: 'VOO', exDate: '2021-03-26' });
    expect(ents[0].gross.toString()).toBe('3');
  });
});

describe('dividend matching rejections', () => {
  test('C3: a DIVIDEND row with no ex-date in the 90 days up to its date is dividend_unmatched', () => {
    const res = compute(inputC(['2021-03-24,DIVIDEND,VOO,,,USD,3.00,0.90']));
    expect(res).toEqual({
      ok: false,
      rejected: [{ line: 5, code: 'dividend_unmatched', message: 'No VOO ex-dividend date in the 90 days up to 2021-03-24.' }],
    });
  });

  test('C4: a second row matching the same ex-date is dividend_duplicate', () => {
    const res = compute(
      inputC([C1_ROW, '2021-04-01,DIVIDEND,VOO,2,1.50,USD,3.00,0.90'], {
        prices: { VOO: [...vooC, bar('2021-04-01', '365')] },
        endDate: '2021-04-01',
      }),
    );
    expect(res).toEqual({
      ok: false,
      rejected: [
        { line: 6, code: 'dividend_duplicate', message: 'Another DIVIDEND row already matches the VOO ex-date 2021-03-26.' },
      ],
    });
  });
});
