import { describe, expect, test, vi } from 'vitest';
import type { LedgerRow, Rejection } from '../engine/types';
import MOOMOO from '../importers/fixtures/moomoo-sample.csv?raw';
import { combineFiles } from './combine';
import { runUpload } from './upload';

const stubFetch = (body: unknown) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body));

type Combined = Exclude<ReturnType<typeof combineFiles>, { rejected: Rejection[] }>;
function combined(files: { name: string; text: string }[]): Combined {
  const out = combineFiles(files);
  if ('rejected' in out) throw new Error('expected rows, got ' + JSON.stringify(out.rejected));
  return out;
}
function rejectedBy(files: { name: string; text: string }[]): Rejection[] {
  const out = combineFiles(files);
  if (!('rejected' in out)) throw new Error('expected a rejection, got rows');
  return out.rejected;
}

// ---------------------------------------------------------------------------
// Task 29: canonical files (spec 15.4.2 steps 1, 2, 3, 5; decision: canonical gaps are never flagged).
// ---------------------------------------------------------------------------

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');
const GOLDEN_A = csv(
  '2020-08-28,DEPOSIT,,,,SGD,1400,0',
  '2020-08-28,FX,USD,1000,,SGD,1360,0',
  '2020-08-28,BUY,AAPL,2,500,USD,1000,0',
  '2020-08-31,DEPOSIT,,,,SGD,600,0',
  '2020-09-01,WITHDRAW,,,,SGD,100,0',
);
// Golden A split in two: a.csv up to 2020-08-28, b.csv the rest.
const A = { name: 'a.csv', text: csv('2020-08-28,DEPOSIT,,,,SGD,1400,0', '2020-08-28,FX,USD,1000,,SGD,1360,0', '2020-08-28,BUY,AAPL,2,500,USD,1000,0') };
const B = { name: 'b.csv', text: csv('2020-08-31,DEPOSIT,,,,SGD,600,0', '2020-09-01,WITHDRAW,,,,SGD,100,0') };

const goldenBody = {
  asOf: '2020-09-01',
  prices: {
    AAPL: [
      ['2020-08-28', '500', '1', '0'],
      ['2020-08-31', '130', '4', '0'],
      ['2020-09-01', '135', '1', '0'],
    ],
  },
  fx: [
    ['2020-08-28', '1.36'],
    ['2020-08-31', '1.37'],
    ['2020-09-01', '1.35'],
  ],
  unavailable: [],
};

describe('combineFiles, canonical files', () => {
  test('rows are merged in order of file period, whatever the selection order', () => {
    expect(combined([B, A]).rows.map((r) => `${r.date} ${r.type}`)).toEqual([
      '2020-08-28 DEPOSIT',
      '2020-08-28 FX',
      '2020-08-28 BUY',
      '2020-08-31 DEPOSIT',
      '2020-09-01 WITHDRAW',
    ]);
  });

  test('periods are each file\'s first and last row dates, earliest first', () => {
    expect(combined([B, A]).periods).toEqual([
      { name: 'a.csv', from: '2020-08-28', to: '2020-08-28' },
      { name: 'b.csv', from: '2020-08-31', to: '2020-09-01' },
    ]);
  });

  test('line numbers are unique across the set', () => {
    const lines = combined([A, B]).rows.map((r) => r.line);
    expect(new Set(lines).size).toBe(lines.length);
  });

  test('origin maps each new line back to its file and its own line', () => {
    const { rows, origin } = combined([B, A]);
    const withdraw = rows.find((r) => r.type === 'WITHDRAW')!;
    const buy = rows.find((r) => r.type === 'BUY')!;
    expect(origin[withdraw.line]).toEqual({ file: 'b.csv', line: 3 });
    expect(origin[buy.line]).toEqual({ file: 'a.csv', line: 4 });
  });

  test('files sharing a date are rejected with overlapping_files naming both files and the shared dates', () => {
    const a = { name: 'a.csv', text: csv('2020-08-28,DEPOSIT,,,,SGD,1400,0', '2020-08-31,DEPOSIT,,,,SGD,600,0') };
    const b = { name: 'b.csv', text: csv('2020-08-31,DEPOSIT,,,,SGD,50,0', '2020-09-01,WITHDRAW,,,,SGD,100,0') };
    expect(rejectedBy([b, a])).toEqual([
      expect.objectContaining({ line: null, code: 'overlapping_files', message: 'a.csv and b.csv both cover 2020-08-31 to 2020-08-31. Remove one of them.' }),
    ]);
  });

  test('the same file selected twice is rejected as overlapping', () => {
    expect(rejectedBy([A, A])[0]).toMatchObject({
      code: 'overlapping_files',
      message: 'a.csv and a.csv both cover 2020-08-28 to 2020-08-28. Remove one of them.',
    });
  });

  test('canonical files with days between them get no gap notice', () => {
    expect(combined([A, B]).notices).toEqual([]);
  });

  test('a parse error in the second file carries that file name and its own line', () => {
    const bad = { name: 'b.csv', text: csv('2020-08-31,DEPOSIT,,,,SGD,600,0', '2020-09-01,WITHDRAW,,,,SGD,abc,0') };
    expect(rejectedBy([A, bad])).toEqual([expect.objectContaining({ file: 'b.csv', line: 3, code: 'bad_number' })]);
  });
});

describe('runUpload with several canonical files', () => {
  test('Golden A split in two gives the same TWR and XIRR as one file', async () => {
    const one = await runUpload([{ name: 'golden.csv', text: GOLDEN_A }], stubFetch(goldenBody));
    const two = await runUpload([A, B], stubFetch(goldenBody));
    if (one.kind !== 'result' || two.kind !== 'result') throw new Error('expected results: ' + JSON.stringify([one, two]));
    expect(two.result.twr.value.toString()).toBe(one.result.twr.value.toString());
    expect(JSON.stringify(two.result.xirr)).toBe(JSON.stringify(one.result.xirr));
  });

  test('selection order does not change the result', async () => {
    const ab = await runUpload([A, B], stubFetch(goldenBody));
    const ba = await runUpload([B, A], stubFetch(goldenBody));
    if (ab.kind !== 'result' || ba.kind !== 'result') throw new Error('expected results');
    expect(ba.result.twr.value.toString()).toBe(ab.result.twr.value.toString());
  });

  test('an engine rejection in the merged ledger is mapped back to its file and line', async () => {
    const oversell = { name: 'b.csv', text: csv('2020-08-31,DEPOSIT,,,,SGD,600,0', '2020-09-01,SELL,AAPL,20,135,USD,2700,0') };
    const out = await runUpload([A, oversell], stubFetch(goldenBody));
    if (out.kind !== 'rejected') throw new Error('expected a rejection, got ' + out.kind);
    expect(out.rejected).toContainEqual(expect.objectContaining({ file: 'b.csv', line: 3, code: 'oversell' }));
  });

  test('with one file, rejections carry no file name', async () => {
    const out = await runUpload([{ name: 'a.csv', text: csv('2020-08-28,DEPOSIT,,,,SGD,abc,0') }], stubFetch(goldenBody));
    if (out.kind !== 'rejected') throw new Error('expected a rejection, got ' + out.kind);
    expect(out.rejected[0]).not.toHaveProperty('file');
  });
});

// ---------------------------------------------------------------------------
// Task 30: IBKR period statements (spec 15.4.2 steps 2, 4, 6, 7; UI batch decision 2).
// ---------------------------------------------------------------------------

const MTM_HEADER =
  'Mark-to-Market Performance Summary,Header,Asset Category,Symbol,Prior Quantity,Current Quantity,Prior Price,Current Price,Mark-to-Market P/L Position,Mark-to-Market P/L Transaction,Mark-to-Market P/L Commissions,Mark-to-Market P/L Other,Mark-to-Market P/L Total,Code';
const mtm = (sym: string, prior: string, price: string) =>
  `Mark-to-Market Performance Summary,Data,Stocks,${sym},${prior},${prior},${price},${price},0,0,0,0,0,`;
const CASH_HEADER = 'Cash Report,Header,Currency Summary,Currency,Total,Securities,Futures,';
const startCash = (ccy: string, amount: string) => `Cash Report,Data,Starting Cash,${ccy},${amount},${amount},0,`;
const STOCK_HEADER =
  'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code';
const buy = (sym: string, date: string, qty: number, price: number) =>
  `Trades,Data,Order,Stocks,USD,${sym},"${date}, 10:00:00",${qty},${price},${price},-${qty * price},0,${qty * price},0,0,O`;
const FX_HEADER =
  'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,,Proceeds,Comm in SGD,,,MTM in SGD,Code';
const usdBought = (date: string, usd: number, sgd: number, rate: string) =>
  `Trades,Data,Order,Forex,SGD,USD.SGD,"${date}, 20:00:00",${usd},${rate},,-${sgd},0,,,0,`;
const DW_HEADER = 'Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount';
const deposit = (date: string, amount: number) => `Deposits & Withdrawals,Data,SGD,${date},Electronic Fund Transfer,${amount}`;
const statement = (period: string, lines: string[]) =>
  ['Statement,Header,Field Name,Field Value', 'Statement,Data,Period,"' + period + '"', ...lines].join('\n') + '\n';

// H1 opens with 1 VOO and SGD 500, deposits SGD 1,000, buys USD 1,000 for SGD 1,350, buys 2 VOO at 400.
// It ends with 3 VOO, USD 200 and SGD 150.
const H1_LINES = [
  MTM_HEADER, mtm('VOO', '1', '400'),
  CASH_HEADER, startCash('SGD', '500'),
  STOCK_HEADER, buy('VOO', '2026-01-05', 2, 400),
  FX_HEADER, usdBought('2026-01-02', 1000, 1350, '1.35'),
  DW_HEADER, deposit('2026-01-02', 1000),
];
const h1 = { name: 'h1.csv', text: statement('January 1, 2026 - March 31, 2026', H1_LINES) };
const h2With = (period: string, voo: string, sgd: string, usd: string, depositDate = '2026-04-02') => ({
  name: 'h2.csv',
  text: statement(period, [
    MTM_HEADER, mtm('VOO', voo, '400'),
    CASH_HEADER, startCash('SGD', sgd), startCash('USD', usd),
    DW_HEADER, deposit(depositDate, 100),
  ]),
});
const h2 = h2With('April 1, 2026 - June 30, 2026', '3', '150', '200');
const whole = {
  name: 'whole.csv',
  text: statement('January 1, 2026 - June 30, 2026', [...H1_LINES, deposit('2026-04-02', 100)]),
};

// VOO 400 to the end of March, 440 from April; USD/SGD 1.35 every day.
function ibkrBody() {
  const bars: [string, string, string, string][] = [];
  const fx: [string, string][] = [];
  for (let t = Date.parse('2025-12-31'); t <= Date.parse('2026-06-30'); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    bars.push([d, d < '2026-04-01' ? '400' : '440', '1', '0']);
    fx.push([d, '1.35']);
  }
  return { asOf: '2026-06-30', prices: { VOO: bars }, fx, unavailable: [] };
}
const plain = (r: LedgerRow) => ({ date: r.date, type: r.type, ticker: r.ticker, currency: r.currency, amount: r.amount.toString() });

describe('combineFiles, IBKR statements', () => {
  test('OPENING rows are kept only from the earliest statement', () => {
    const opening = combined([h2, h1]).rows.filter((r) => r.type === 'OPENING');
    expect(opening.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-01']);
  });

  test('periods come from the Statement Period field', () => {
    expect(combined([h2, h1]).periods).toEqual([
      { name: 'h1.csv', from: '2026-01-01', to: '2026-03-31' },
      { name: 'h2.csv', from: '2026-04-01', to: '2026-06-30' },
    ]);
  });

  test('consecutive statements get no gap notice', () => {
    expect(combined([h1, h2]).notices).toEqual([]);
  });

  test('a gap between statement periods is allowed with the gap notice', () => {
    const later = h2With('April 11, 2026 - June 30, 2026', '3', '150', '200', '2026-04-12');
    expect(combined([h1, later]).notices).toContain(
      'No statement covers 2026-04-01 to 2026-04-10, between h1.csv and h2.csv. The opening balances of h2.csv were checked against the earlier files.',
    );
  });

  test('overlapping statement periods are rejected with overlapping_files', () => {
    const later = h2With('March 15, 2026 - June 30, 2026', '3', '150', '200');
    expect(rejectedBy([h1, later])[0]).toMatchObject({
      code: 'overlapping_files',
      message: 'h1.csv and h2.csv both cover 2026-03-15 to 2026-03-31. Remove one of them.',
    });
  });
});

describe('runUpload reconciles later IBKR statements', () => {
  test('two consecutive statements give the same result as one statement over the whole period', async () => {
    const two = await runUpload([h1, h2], stubFetch(ibkrBody()));
    const one = await runUpload([whole], stubFetch(ibkrBody()));
    if (one.kind !== 'result' || two.kind !== 'result') throw new Error('expected results: ' + JSON.stringify([one, two]));
    expect(two.result.twr.value.toString()).toBe(one.result.twr.value.toString());
    expect(two.result.series.at(-1)!.valueSgd.toString()).toBe(one.result.series.at(-1)!.valueSgd.toString());
  });

  test('an opening position that differs from the earlier files is rejected with reconcile_position', async () => {
    const out = await runUpload([h1, h2With('April 1, 2026 - June 30, 2026', '5', '150', '200')], stubFetch(ibkrBody()));
    if (out.kind !== 'rejected') throw new Error('expected a rejection, got ' + out.kind);
    expect(out.rejected[0]).toMatchObject({
      code: 'reconcile_position',
      message: 'h2.csv opens with 5 VOO, but the earlier files end with 3 VOO on 2026-03-31.',
    });
  });

  test('an opening position within 0.0001 shares is accepted', async () => {
    const out = await runUpload([h1, h2With('April 1, 2026 - June 30, 2026', '3.00005', '150', '200')], stubFetch(ibkrBody()));
    expect(out.kind).toBe('result');
  });

  test('an opening position off by 0.0002 shares is rejected', async () => {
    const out = await runUpload([h1, h2With('April 1, 2026 - June 30, 2026', '3.0002', '150', '200')], stubFetch(ibkrBody()));
    if (out.kind !== 'rejected') throw new Error('expected a rejection, got ' + out.kind);
    expect(out.rejected[0].code).toBe('reconcile_position');
  });

  test('matching opening cash books no ADJUST row', async () => {
    const out = await runUpload([h1, h2], stubFetch(ibkrBody()));
    if (out.kind !== 'result') throw new Error('expected a result, got ' + JSON.stringify(out));
    expect(out.ledger.filter((r) => r.type === 'ADJUST')).toEqual([]);
  });

  describe('opening USD cash 5.00 above the earlier files', () => {
    const run = async () => {
      const out = await runUpload([h1, h2With('April 1, 2026 - June 30, 2026', '3', '150', '205')], stubFetch(ibkrBody()));
      if (out.kind !== 'result') throw new Error('expected a result, got ' + JSON.stringify(out));
      return out;
    };

    test('is booked as an ADJUST cash row dated the later statement start', async () => {
      expect((await run()).ledger.filter((r) => r.type === 'ADJUST').map(plain)).toEqual([
        { date: '2026-04-01', type: 'ADJUST', ticker: null, currency: 'USD', amount: '5' },
      ]);
    });

    test('comes with the cash adjusted notice', async () => {
      expect((await run()).notices).toContain(
        'Cash adjusted by 5.00 USD on 2026-04-01 to match the statement (interest, fees or options not modelled).',
      );
    });

    test('is not an external flow', async () => {
      const point = (await run()).result.series.find((p) => p.date === '2026-04-01')!;
      expect(point.netFlowSgd.toString()).toBe('0');
    });
  });

  test('opening cash below the earlier files gives a negative adjustment notice', async () => {
    const out = await runUpload([h1, h2With('April 1, 2026 - June 30, 2026', '3', '150', '195')], stubFetch(ibkrBody()));
    if (out.kind !== 'result') throw new Error('expected a result, got ' + JSON.stringify(out));
    expect(out.notices).toContain(
      'Cash adjusted by -5.00 USD on 2026-04-01 to match the statement (interest, fees or options not modelled).',
    );
  });
});

// ---------------------------------------------------------------------------
// Task 38: moomoo order history files (spec 17.1.8).
// ---------------------------------------------------------------------------

const moomoo = { name: 'moomoo.csv', text: MOOMOO };
const MOOMOO_HEADER = MOOMOO.split(/\r?\n/, 1)[0];

describe('combineFiles, moomoo files', () => {
  test('a moomoo file converts with its USD deposits and its own period', () => {
    const out = combined([moomoo]);
    expect(out.periods).toEqual([{ name: 'moomoo.csv', from: '2024-03-05', to: '2024-03-12' }]);
    expect(out.rows.filter((r) => r.type === 'DEPOSIT' && r.currency === 'USD')).toHaveLength(3);
  });

  test('two moomoo files are rejected with moomoo_files', () => {
    expect(rejectedBy([moomoo, { ...moomoo, name: 'moomoo2.csv' }])).toEqual([
      {
        line: null,
        code: 'moomoo_files',
        message:
          "Use one moomoo file that covers all your trades. Cash is worked out from each file's own trades, so moomoo files cannot be combined.",
      },
    ]);
  });

  test('a plain CSV with a USD DEPOSIT is still rejected with flow_currency', () => {
    expect(rejectedBy([{ name: 'usd.csv', text: csv('2024-01-02,DEPOSIT,,,,USD,1000,0') }])).toEqual([
      expect.objectContaining({ line: 2, code: 'flow_currency' }),
    ]);
  });

  test('a moomoo file and a canonical file with separate periods combine', () => {
    const canonical = { name: 'early.csv', text: csv('2024-01-02,DEPOSIT,,,,SGD,1350,0', '2024-01-02,FX,USD,1000,,SGD,1350,0') };
    expect(combined([moomoo, canonical]).periods).toEqual([
      { name: 'early.csv', from: '2024-01-02', to: '2024-01-02' },
      { name: 'moomoo.csv', from: '2024-03-05', to: '2024-03-12' },
    ]);
  });
});

describe('runUpload with a moomoo file', () => {
  test('an engine rejection maps back to the moomoo file line', async () => {
    // The only fill is a SELL on moomoo line 2, so the engine rejects it with oversell.
    const cols = MOOMOO_HEADER.split(',');
    const cells: Record<string, string> = {
      Side: 'Sell',
      Symbol: 'AAPL',
      Markets: 'US',
      Currency: 'USD',
      'Fill Qty': '4',
      'Fill Price': '160',
      'Fill Amount': '640',
      'Fill Time': '2024/03/08 22:00:00',
    };
    const seen = new Set<string>();
    const line = cols.map((c) => (seen.has(c) ? '' : (seen.add(c), cells[c] ?? ''))).join(',');
    const body = { asOf: '2024-03-08', prices: { AAPL: [['2024-03-08', '160', '1', '0']] }, fx: [['2024-03-08', '1.35']], unavailable: [] };
    const out = await runUpload([{ name: 'moomoo.csv', text: `${MOOMOO_HEADER}\n${line}\n` }], stubFetch(body));
    if (out.kind !== 'rejected') throw new Error('expected a rejection, got ' + out.kind);
    expect(out.rejected).toContainEqual(expect.objectContaining({ line: 2, code: 'oversell' }));
  });
});
