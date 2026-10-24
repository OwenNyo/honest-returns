import { describe, expect, test } from 'vitest';
import { parseCsv } from '../shared/csv';
import { detectFormat } from './detect';
import FIXTURE from './fixtures/moomoo-sample.csv?raw';
import EXPECTED from './fixtures/moomoo-sample.expected.csv?raw';
import { importMoomoo } from './moomoo';

// Spec 17.1. UNVERIFIED against a real export: the fixture is synthetic (spec 17.1.9).
const COLS = FIXTURE.split(/\r?\n/, 1)[0].split(',');
const cell = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
type Cells = Record<string, string>;
// A moomoo file from rows keyed by column name. The second Markets and Currency (the fill part) are 'Markets#2'
// and 'Currency#2'. Header is line 1, so rows[i] is on line i + 2.
function file(rows: Cells[], cols: string[] = COLS): string {
  const keys = cols.map((c, i) => (cols.indexOf(c) === i ? c : `${c}#2`));
  return [cols.join(','), ...rows.map((r) => keys.map((k) => cell(r[k] ?? '')).join(','))].join('\n') + '\n';
}
// A filled US buy of 10 AAPL at 150, by default with no fees.
const fill = (o: Cells = {}): Cells => ({
  Side: 'Buy',
  Symbol: 'AAPL',
  Markets: 'US',
  Currency: 'USD',
  'Fill Qty': '10',
  'Fill Price': '150',
  'Fill Amount': '1500',
  'Fill Time': '2024/03/05 22:30:00',
  ...o,
});
const unfilled = (o: Cells = {}): Cells => ({ Side: 'Buy', Symbol: 'TSLA', Markets: 'US', Currency: 'USD', ...o });
const rowsOf = (csv: string) => csv.split(/\r?\n/).slice(1).filter((l) => l !== '');
const FUNDING_1501_99 =
  "This moomoo file lists trades only. USD 1,501.99 was counted as paid in on 1 day, each time the trades needed more USD than the file's own cash. Withdrawals and currency conversions are not in the file, so money from sales stays in the portfolio as cash.";

describe('detectFormat with moomoo', () => {
  test('detectFormat recognises the fixture as moomoo', () => {
    expect(detectFormat(FIXTURE)).toBe('moomoo');
  });

  test('a canonical file and an IBKR statement are still canonical and ibkr', () => {
    expect([
      detectFormat('date,type,ticker,quantity,price,currency,amount,fees\n'),
      detectFormat('Statement,Header,Field Name,Field Value\n'),
    ]).toEqual(['canonical', 'ibkr']);
  });

  test('a header with Side and Symbol but no Fill Qty is unknown', () => {
    expect(detectFormat('Side,Symbol,Fill Price,Fill Time\nBuy,AAPL,150,2024/03/05 22:30:00\n')).toBe('unknown');
  });
});

describe('importMoomoo on the synthetic fixture (spec 17.1.9)', () => {
  test('the fixture converts to the expected canonical CSV', () => {
    expect(importMoomoo(FIXTURE).csv).toBe(EXPECTED);
  });

  test('lines map each output row to its moomoo line: [2, 2, 4, 5, 5, 6, 7, 9, 9]', () => {
    expect(importMoomoo(FIXTURE).lines).toEqual([2, 2, 4, 5, 5, 6, 7, 9, 9]);
  });

  test('the fixture has no rejections', () => {
    expect(importMoomoo(FIXTURE).rejected).toEqual([]);
  });

  test('period is the first and last fill date', () => {
    expect(importMoomoo(FIXTURE).period).toEqual({ from: '2024-03-05', to: '2024-03-12' });
  });

  test('notices name the funding total, the skipped orders and the markets left out', () => {
    expect(importMoomoo(FIXTURE).notices).toEqual([
      "This moomoo file lists trades only. USD 2,820.49 was counted as paid in on 3 days, each time the trades needed more USD than the file's own cash. Withdrawals and currency conversions are not in the file, so money from sales stays in the portfolio as cash.",
      '2 orders with nothing filled were skipped.',
      '1 order on HK market was left out; this report covers US trades only.',
    ]);
  });

  test('a fill after Singapore midnight takes the previous US date', () => {
    const rows = rowsOf(importMoomoo(FIXTURE).csv);
    expect(rows).toContain('2024-03-08,SELL,AAPL,4,160,USD,640,2.03');
    expect(rows).toContain('2024-03-12,BUY,AAPL,2,170,USD,340,1.99');
  });

  test('a fill row with empty Side and Symbol belongs to the order above it', () => {
    expect(rowsOf(importMoomoo(FIXTURE).csv)).toContain('2024-03-06,BUY,VOO,1,400.5,USD,400.5,0');
  });

  test('cancelled, failed and queued orders with no fill are skipped, even on another market', () => {
    const out = importMoomoo(FIXTURE);
    expect(out.csv).not.toMatch(/TSLA|D05/);
    expect(out.rejected).toEqual([]);
  });

  test('a partly filled order counts with what was filled', () => {
    const voo = rowsOf(importMoomoo(FIXTURE).csv).filter((l) => l.startsWith('2024-03-06,BUY,VOO,'));
    expect(voo.reduce((s, l) => s + Number(l.split(',')[3]), 0)).toBe(3);
  });

  test('fills listed newest first give the same CSV', () => {
    // Order blocks (lines) 2, 3, 4-5, 6, 7, 8, 9, 10 reversed; a block keeps its own row order.
    const [header, ...data] = FIXTURE.split(/\r?\n/).filter((l) => l !== '');
    const blocks = [[0], [1], [2, 3], [4], [5], [6], [7], [8]].map((b) => b.map((i) => data[i]));
    const reversed = [header, ...blocks.reverse().flat()].join('\n') + '\n';
    const out = importMoomoo(reversed);
    expect(out.csv).toBe(EXPECTED);
    expect(out.lines).toEqual([10, 10, 7, 8, 8, 6, 5, 3, 3]);
  });

  test('the HK order is not in the output and its fill is not funded', () => {
    const out = importMoomoo(FIXTURE);
    expect(out.csv).not.toContain('00700');
    expect(rowsOf(out.csv).filter((l) => l.includes(',DEPOSIT,')).map((l) => l.split(',')[6])).toEqual(['1501.99', '1202.49', '116.01']);
  });
});

describe('importMoomoo funding (spec 17.1.6)', () => {
  test('a sale and a buy on the same day net before funding', () => {
    const text = file([
      fill({ Commission: '0.99', 'Platform Fees': '1.00' }),
      fill({ Side: 'Sell', 'Fill Qty': '4', 'Fill Price': '160', 'Fill Amount': '640', 'Fill Time': '2024/03/07 22:00:00', Commission: '0.99', 'Platform Fees': '1.00', 'Trading Activity Fee': '0.01', 'SEC Fee': '0.03' }),
      fill({ Symbol: 'VOO', 'Fill Qty': '1', 'Fill Price': '410', 'Fill Amount': '410', 'Fill Time': '2024/03/07 22:30:00', Commission: '0.99', 'Platform Fees': '1.00' }),
    ]);
    const deposits = rowsOf(importMoomoo(text).csv).filter((l) => l.includes(',DEPOSIT,'));
    expect(deposits).toEqual(['2024-03-05,DEPOSIT,,,,USD,1501.99,0']);
  });

  test('one funded day reads 1 day in the notice', () => {
    expect(importMoomoo(file([fill({ Commission: '0.99', 'Platform Fees': '1.00' })])).notices).toEqual([FUNDING_1501_99]);
  });
});

describe('importMoomoo columns (spec 17.1.3)', () => {
  test('columns are found by name', () => {
    const cells = fill({ Commission: '0.99' });
    const cols = ['Fill Time', 'Commission', 'Fill Amount', 'Fill Price', 'Fill Qty', 'Currency', 'Markets', 'Symbol', 'Side'];
    expect(importMoomoo(file([cells], cols)).csv).toBe(importMoomoo(file([cells])).csv);
  });

  test('missing fee columns count as 0', () => {
    const cols = ['Side', 'Symbol', 'Markets', 'Currency', 'Fill Qty', 'Fill Price', 'Fill Time', 'Commission'];
    expect(rowsOf(importMoomoo(file([fill({ Commission: '0.99' })], cols)).csv)[0]).toBe('2024-03-05,BUY,AAPL,10,150,USD,1500,0.99');
  });

  test('the fill part of Markets and Currency is used when the order part is empty', () => {
    const out = importMoomoo(file([fill({ Markets: '', Currency: '', 'Markets#2': 'US', 'Currency#2': 'USD' })]));
    expect(out.rejected).toEqual([]);
    expect(rowsOf(out.csv)[0]).toBe('2024-03-05,BUY,AAPL,10,150,USD,1500,0');
  });

  test('a missing required column rejects the file', () => {
    const cols = COLS.filter((c) => c !== 'Fill Price');
    expect(importMoomoo(file([fill()], cols)).rejected).toEqual([
      { line: null, code: 'bad_header', message: 'This moomoo file is missing these columns: Fill Price.' },
    ]);
  });
});

describe('importMoomoo markets (spec 17.1.4 item 4)', () => {
  const other = (market: string, ccy: string, o: Cells = {}) =>
    fill({ Symbol: 'X' + market, Markets: market, Currency: ccy, 'Fill Time': '2024/03/06 10:00:00', ...o });

  test('filled orders on two other markets are counted per order in one notice', () => {
    const out = importMoomoo(file([fill(), other('SG', 'SGD'), other('SG', 'SGD'), other('HK', 'HKD')]));
    expect(out.notices).toContain('3 orders on HK and SG markets were left out; this report covers US trades only.');
  });

  test('one filled order on one other market reads 1 order on SG market', () => {
    expect(importMoomoo(file([fill(), other('SG', 'SGD')])).notices).toContain(
      '1 order on SG market was left out; this report covers US trades only.',
    );
  });

  test('an order with both Markets cells empty or -- is left out as unknown', () => {
    const out = importMoomoo(file([fill(), other('--', 'USD', { 'Markets#2': '' })]));
    expect(out.rejected).toEqual([]);
    expect(out.notices).toContain('1 order on unknown market was left out; this report covers US trades only.');
  });

  test('a left-out order is never checked', () => {
    expect(importMoomoo(file([fill(), other('SG', 'SGD', { 'Fill Qty': 'abc' })])).rejected).toEqual([]);
  });

  test('a US order not in USD is rejected', () => {
    expect(importMoomoo(file([fill({ Currency: 'HKD' })])).rejected).toEqual([
      { line: 2, code: 'trade_currency', message: 'Only US trades in USD can be measured; this order is in HKD.' },
    ]);
  });
});

describe('importMoomoo row checks (spec 17.1.7)', () => {
  test('Side other than Buy or Sell is rejected', () => {
    expect(importMoomoo(file([fill({ Side: 'Short Sell' })])).rejected).toEqual([
      { line: 2, code: 'bad_type', message: 'Side must be Buy or Sell.' },
    ]);
  });

  test('a fill row before any order row is rejected with bad_type', () => {
    expect(importMoomoo(file([fill({ Side: '', Symbol: '' })])).rejected).toEqual([
      { line: 2, code: 'bad_type', message: 'Side must be Buy or Sell.' },
    ]);
  });

  test.each([
    ['2024/03/15 08:59:59', '2024-03-14', 'before the boundary'],
    ['2024/03/15 09:00:00', '2024-03-15', 'on the boundary'],
    ['2024/03/15 03:15:00', '2024-03-14', 'after Singapore midnight'],
    ['2024-03-01 02:00:00', '2024-02-29', 'month and leap-day rollover'],
    ['Mar 15, 2024 3:15 AM', '2024-03-14', '12-hour AM'],
    ['Mar 15, 2024 9:00 PM', '2024-03-15', '12-hour PM'],
    ['2024-03-15 21:30:00 ET', '2024-03-15', 'zone label ignored'],
    ['2025/01/01 08:59:59', '2024-12-31', 'year rollover'],
    ['Mar 15, 2024 12:30 AM', '2024-03-14', '12-hour midnight'],
  ])('Fill Time is Singapore time with a 09:00 cutoff: %s gives %s (%s)', (time, date) => {
    expect(rowsOf(importMoomoo(file([fill({ 'Fill Time': time })])).csv)[0].split(',')[0]).toBe(date);
  });

  test.each(['05/03/2024 10:00', '2024/03/15', '2024/03/15 25:00'])(
    'a Fill Time without a valid date and time is rejected: %s',
    (time) => {
      expect(importMoomoo(file([fill({ 'Fill Time': time })])).rejected).toEqual([
        { line: 2, code: 'bad_date', message: 'Fill Time must be a date and time like 2024/03/05 21:30:00 or Mar 5, 2024 21:30:00.' },
      ]);
    },
  );

  test('a non-number is rejected', () => {
    expect(importMoomoo(file([fill({ 'Fill Qty': 'abc' })])).rejected).toEqual([
      { line: 2, code: 'bad_number', message: 'Fill Qty must be a number.' },
    ]);
  });

  test('fills that differ from Filled@Avg Price are rejected', () => {
    const order = fill({ Symbol: 'VOO', 'Filled@Avg Price': '3@400.17', 'Fill Qty': '2', 'Fill Price': '400', 'Fill Amount': '800' });
    expect(importMoomoo(file([order])).rejected).toEqual([
      { line: 2, code: 'fill_mismatch', message: 'Fills add up to 2 shares, but the order shows 3 filled.' },
    ]);
  });

  test('a file with no filled orders at all is rejected with empty_file', () => {
    expect(importMoomoo(file([unfilled()])).rejected).toEqual([
      { line: null, code: 'empty_file', message: 'The file has no filled orders on the US market.' },
    ]);
  });

  test('a file with filled HK orders only is rejected with empty_file', () => {
    expect(importMoomoo(file([fill({ Symbol: '00700', Markets: 'HK', Currency: 'HKD' })])).rejected).toEqual([
      { line: null, code: 'empty_file', message: 'The file has no filled orders on the US market.' },
    ]);
  });
});

describe('importMoomoo output and parseCsv (spec 17.1.8, 18.1.1)', () => {
  test('the output parses as a plain CSV, with three USD DEPOSIT rows', () => {
    const out = parseCsv(importMoomoo(FIXTURE).csv);
    expect(out.rejected).toEqual([]);
    expect(out.rows.filter((r) => r.type === 'DEPOSIT' && r.currency === 'USD')).toHaveLength(3);
  });
});

// A real anonymised export is a gitignored local fixture; skip when absent (as in ibkr.test.ts).
const realFiles = import.meta.glob<string>('./fixtures/moomoo-real.csv', { eager: true, query: '?raw', import: 'default' });
const realCsv = realFiles['./fixtures/moomoo-real.csv'];

describe.skipIf(realCsv === undefined)('importMoomoo on a real export (needs local fixture)', () => {
  test('a real export converts without rejections', () => {
    expect(importMoomoo(realCsv).rejected).toEqual([]);
  });

  test('its output parses with no rejections', () => {
    expect(parseCsv(importMoomoo(realCsv).csv).rejected).toEqual([]);
  });
});
