import { describe, expect, test } from 'vitest';
import type { LedgerRow } from '../engine/types';
import { ledgerTickers, parseCsv } from './csv';

const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';

// Golden A ledger, spec section 7.
const GOLDEN_A_LINES = [
  HEADER,
  '2020-08-28,DEPOSIT,,,,SGD,1400,0',
  '2020-08-28,FX,USD,1000,,SGD,1360,0',
  '2020-08-28,BUY,AAPL,2,500,USD,1000,0',
  '2020-08-31,DEPOSIT,,,,SGD,600,0',
  '2020-09-01,WITHDRAW,,,,SGD,100,0',
];
const GOLDEN_A = GOLDEN_A_LINES.join('\n');

// Decimal fields as strings so rows compare by value.
const plain = (r: LedgerRow) => ({
  line: r.line,
  date: r.date,
  type: r.type,
  ticker: r.ticker,
  quantity: r.quantity?.toString() ?? null,
  price: r.price?.toString() ?? null,
  currency: r.currency,
  amount: r.amount.toString(),
  fees: r.fees.toString(),
});

// Parse a file made of the header plus the given data lines.
const parse = (...lines: string[]) => parseCsv([HEADER, ...lines].join('\n'));

describe('parseCsv on Golden A', () => {
  test('parses 5 rows with no rejections', () => {
    const { rows, rejected } = parseCsv(GOLDEN_A);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(5);
  });

  test('numbers rows by file line, header is line 1', () => {
    expect(parseCsv(GOLDEN_A).rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6]);
  });

  test('parses the FX row with currency sold and ticker bought', () => {
    expect(plain(parseCsv(GOLDEN_A).rows[1])).toEqual({
      line: 3,
      date: '2020-08-28',
      type: 'FX',
      ticker: 'USD',
      quantity: '1000',
      price: null,
      currency: 'SGD',
      amount: '1360',
      fees: '0',
    });
  });

  test('parses a DEPOSIT row with empty ticker, quantity and price as null', () => {
    expect(plain(parseCsv(GOLDEN_A).rows[0])).toEqual({
      line: 2,
      date: '2020-08-28',
      type: 'DEPOSIT',
      ticker: null,
      quantity: null,
      price: null,
      currency: 'SGD',
      amount: '1400',
      fees: '0',
    });
  });

  test('parses a BUY row', () => {
    expect(plain(parseCsv(GOLDEN_A).rows[2])).toEqual({
      line: 4,
      date: '2020-08-28',
      type: 'BUY',
      ticker: 'AAPL',
      quantity: '2',
      price: '500',
      currency: 'USD',
      amount: '1000',
      fees: '0',
    });
  });
});

describe('parseCsv input tolerance', () => {
  // Review Focus 1
  test('CRLF line endings, a UTF-8 BOM and a trailing blank line parse like a clean file', () => {
    const messy = '﻿' + GOLDEN_A_LINES.join('\r\n') + '\r\n\r\n';
    const clean = parseCsv(GOLDEN_A);
    const result = parseCsv(messy);
    expect(result.rejected).toEqual([]);
    expect(result.rows.map(plain)).toEqual(clean.rows.map(plain));
  });

  // Review Focus 5
  test('ticker with spaces and lower case is trimmed and upper-cased', () => {
    const { rows, rejected } = parse('2020-08-28,BUY, voo ,2,500,USD,1000,0');
    expect(rejected).toEqual([]);
    expect(rows[0].ticker).toBe('VOO');
  });

  // Review Focus 5
  test('lower-case type and currency are upper-cased', () => {
    const { rows, rejected } = parse('2020-08-28,buy,AAPL,2,500,usd,1000,0');
    expect(rejected).toEqual([]);
    expect(rows[0].type).toBe('BUY');
    expect(rows[0].currency).toBe('USD');
  });

  test('header is case-insensitive and whitespace-trimmed', () => {
    const text = ' DATE, Type ,ticker,QUANTITY,price,currency,amount,fees \n2020-08-28,DEPOSIT,,,,SGD,1400,0';
    const { rows, rejected } = parseCsv(text);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  test('empty fees parse as 0', () => {
    const { rows, rejected } = parse('2020-08-28,DEPOSIT,,,,SGD,1400,');
    expect(rejected).toEqual([]);
    expect(rows[0].fees.toString()).toBe('0');
  });

  test('amount within 0.01 of quantity x price is accepted', () => {
    expect(parse('2020-08-28,BUY,AAPL,2,500,USD,1000.01,0').rejected).toEqual([]);
  });

  test('10000 data rows are accepted', () => {
    const lines = Array.from({ length: 10000 }, () => '2020-08-28,DEPOSIT,,,,SGD,1,0');
    const { rows, rejected } = parse(...lines);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(10000);
  });
});

describe('parseCsv file-level rejections', () => {
  test('empty_file: header only', () => {
    expect(parseCsv(HEADER + '\n')).toEqual({
      rows: [],
      rejected: [{ line: null, code: 'empty_file', message: 'The file has no data rows.' }],
    });
  });

  test('bad_header: wrong first line', () => {
    expect(parseCsv('date,type,ticker\n2020-08-28,DEPOSIT,')).toEqual({
      rows: [],
      rejected: [
        {
          line: null,
          code: 'bad_header',
          message: 'The first line must be: date,type,ticker,quantity,price,currency,amount,fees',
        },
      ],
    });
  });

  test('too_many_rows: more than 10000 data rows', () => {
    const lines = Array.from({ length: 10001 }, () => '2020-08-28,DEPOSIT,,,,SGD,1,0');
    expect(parse(...lines)).toEqual({
      rows: [],
      rejected: [{ line: null, code: 'too_many_rows', message: 'The file has more than 10000 rows.' }],
    });
  });
});

describe('parseCsv row-level rejections', () => {
  const cases: [string, string, string][] = [
    ['wrong_column_count', '2020-08-28,DEPOSIT,,,,SGD,1400', 'Row has 7 columns; expected 8.'],
    ['bad_date', '2021-02-30,DEPOSIT,,,,SGD,100,0', 'date must be a real date written as YYYY-MM-DD.'],
    ['bad_type', '2020-08-28,TRANSFER,,,,SGD,100,0', 'type must be one of DEPOSIT, WITHDRAW, FX, BUY, SELL, DIVIDEND, OPENING.'],
    ['bad_currency', '2020-08-28,DEPOSIT,,,,EUR,100,0', 'currency must be SGD or USD.'],
    ['bad_number', '2020-08-28,DEPOSIT,,,,SGD,1e3,0', 'amount must be a plain number like 1234.56.'],
    ['missing_field', '2020-08-28,BUY,AAPL,2,,USD,1000,0', 'price is required for BUY.'],
    ['unexpected_field', '2020-08-28,DEPOSIT,AAPL,,,SGD,100,0', 'ticker must be empty for DEPOSIT.'],
    ['not_positive', '2020-08-28,DEPOSIT,,,,SGD,0,0', 'amount must be greater than zero.'],
    ['negative_fees', '2020-08-28,BUY,AAPL,2,500,USD,1000,-1', 'fees cannot be negative.'],
    ['trade_currency', '2020-08-28,BUY,AAPL,2,500,SGD,1000,0', 'BUY must be in USD.'],
    [
      'fx_pair',
      '2020-08-28,FX,SGD,1000,,SGD,1360,0',
      'FX must convert between SGD and USD: put the currency sold in currency and the currency bought in ticker.',
    ],
    ['bad_ticker', '2020-08-28,BUY,AAPL!,2,500,USD,1000,0', 'ticker must be 1 to 10 characters using A to Z, 0 to 9, dot or hyphen.'],
    ['amount_mismatch', '2020-08-28,BUY,AAPL,2,500,USD,999,0', 'amount 999 does not equal quantity x price (2 x 500 = 1000).'],
    ['fees_on_flow', '2020-08-28,DEPOSIT,,,,SGD,100,1', 'fees must be empty or 0 for DEPOSIT.'],
  ];

  test.each(cases)('%s', (code, line, message) => {
    expect(parse(line).rejected).toEqual([{ line: 2, code, message }]);
  });

  test('a row with two failures reports only the first in table order', () => {
    expect(parse('2021-02-30,DEPOSIT,,,,EUR,100,0').rejected).toEqual([
      { line: 2, code: 'bad_date', message: 'date must be a real date written as YYYY-MM-DD.' },
    ]);
  });

  test('every failing row is reported with its own line', () => {
    const { rejected } = parse(
      '2020-08-28,DEPOSIT,,,,SGD,1400,0',
      '2020-08-28,DEPOSIT,,,,EUR,100,0',
      '2020-08-28,DEPOSIT,,,,SGD,0,0',
    );
    expect(rejected.map((r) => [r.line, r.code])).toEqual([
      [3, 'bad_currency'],
      [4, 'not_positive'],
    ]);
  });
});

describe('ledgerTickers', () => {
  test('returns sorted distinct BUY/SELL tickers and ignores the FX ticker', () => {
    const { rows } = parse(
      '2020-08-28,DEPOSIT,,,,SGD,1400,0',
      '2020-08-28,FX,USD,1000,,SGD,1360,0',
      '2020-08-28,BUY,VOO,1,300,USD,300,0',
      '2020-08-28,BUY,AAPL,1,500,USD,500,0',
      '2020-08-31,SELL,VOO,1,310,USD,310,0',
    );
    expect(ledgerTickers(rows)).toEqual(['AAPL', 'VOO']);
  });
});

// Task 15 addendum: OPENING rows carry a period statement's opening positions and cash.
describe('parseCsv OPENING rows', () => {
  test('accepts an opening position with ticker, quantity, price and USD amount', () => {
    const { rows, rejected } = parse('2026-01-01,OPENING,AAPL,10,100,USD,1000,0');
    expect(rejected).toEqual([]);
    expect(plain(rows[0])).toEqual({
      line: 2,
      date: '2026-01-01',
      type: 'OPENING',
      ticker: 'AAPL',
      quantity: '10',
      price: '100',
      currency: 'USD',
      amount: '1000',
      fees: '0',
    });
  });

  test('accepts opening SGD cash with empty ticker, quantity and price', () => {
    const { rows, rejected } = parse('2026-01-01,OPENING,,,,SGD,300,0');
    expect(rejected).toEqual([]);
    expect(plain(rows[0])).toMatchObject({ type: 'OPENING', ticker: null, quantity: null, price: null, currency: 'SGD', amount: '300' });
  });

  test('accepts opening USD cash, unlike DEPOSIT', () => {
    const { rows, rejected } = parse('2026-01-01,OPENING,,,,USD,300,0');
    expect(rejected).toEqual([]);
    expect(plain(rows[0])).toMatchObject({ type: 'OPENING', ticker: null, currency: 'USD', amount: '300' });
  });

  test('rejects an opening position in SGD with trade_currency', () => {
    expect(parse('2026-01-01,OPENING,AAPL,10,100,SGD,1000,0').rejected).toEqual([
      { line: 2, code: 'trade_currency', message: 'OPENING must be in USD.' },
    ]);
  });

  test('ledgerTickers includes tickers from opening positions', () => {
    const { rows } = parse('2026-01-01,OPENING,MSFT,1,400,USD,400,0', '2026-01-01,OPENING,,,,SGD,300,0');
    expect(ledgerTickers(rows)).toEqual(['MSFT']);
  });
});

// Spec 18.1.1: plain files accept USD DEPOSIT and WITHDRAW; every other check stays.
test('USD DEPOSIT and WITHDRAW rows in a plain file parse', () => {
  const { rows, rejected } = parse('2024-01-02,DEPOSIT,,,,USD,100,0', '2024-01-03,WITHDRAW,,,,USD,40,0');
  expect(rejected).toEqual([]);
  expect(rows.map((r) => [r.type, r.currency, r.amount.toString()])).toEqual([
    ['DEPOSIT', 'USD', '100'],
    ['WITHDRAW', 'USD', '40'],
  ]);
});

test('a USD DEPOSIT with fees is still rejected with fees_on_flow', () => {
  expect(parse('2024-01-02,DEPOSIT,,,,USD,100,1').rejected).toEqual([
    { line: 2, code: 'fees_on_flow', message: 'fees must be empty or 0 for DEPOSIT.' },
  ]);
});
