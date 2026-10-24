import { describe, expect, test } from 'vitest';
import type { LedgerRow } from '../engine/types';
import { parseCsv } from '../shared/csv';
import { detectFormat } from './detect';
import { importIbkr } from './ibkr';

// Synthetic IBKR Activity Statement snippets in the real format (spec "Task 15 addendum").
// Line numbers in comments are 1-based lines of STATEMENT.
const STATEMENT_LINES = [
  /* 1 */ 'Statement,Header,Field Name,Field Value',
  /* 2 */ 'Statement,Data,BrokerName,"Interactive Brokers Singapore Pte. Ltd., GST 000000000Z"',
  /* 3 */ 'Statement,Data,Title,Activity Statement',
  /* 4 */ 'Statement,Data,Period,"January 1, 2026 - March 31, 2026"',
  /* 5 */ 'Change in NAV,Header,Field Name,Field Value',
  /* 6 */ 'Change in NAV,Data,Starting Value,10605',
  /* 7 */ 'Mark-to-Market Performance Summary,Header,Asset Category,Symbol,Prior Quantity,Current Quantity,Prior Price,Current Price,Mark-to-Market P/L Position,Mark-to-Market P/L Transaction,Mark-to-Market P/L Commissions,Mark-to-Market P/L Other,Mark-to-Market P/L Total,Code',
  /* 8 */ 'Mark-to-Market Performance Summary,Data,Stocks,AAPL,10,6,"1,000.5",250,0,0,0,0,0,',
  /* 9 */ 'Mark-to-Market Performance Summary,Data,Stocks,MSFT,0,5,--,400,0,0,0,0,0,',
  /* 10 */ 'Mark-to-Market Performance Summary,Data,Total,,,,,,0,0,0,0,0,',
  /* 11 */ 'Mark-to-Market Performance Summary,Data,Equity and Index Options,PFE 15MAY26 30 C,1,0,--,--,0,0,0,0,0,',
  /* 12 */ 'Mark-to-Market Performance Summary,Data,Forex,USD,300,1500,1.35,1.3,0,0,0,0,0,',
  /* 13 */ 'Cash Report,Header,Currency Summary,Currency,Total,Securities,Futures,',
  /* 14 */ 'Cash Report,Data,Starting Cash,Base Currency Summary,705,705,0,',
  /* 15 */ 'Cash Report,Data,Ending Cash,Base Currency Summary,900,900,0,',
  /* 16 */ 'Cash Report,Data,Starting Cash,SGD,300,300,0,',
  /* 17 */ 'Cash Report,Data,Ending Cash,SGD,175,175,0,',
  /* 18 */ 'Cash Report,Data,Starting Cash,USD,300,300,0,',
  /* 19 */ 'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code',
  /* 20 */ 'Trades,Data,Order,Stocks,USD,MSFT,"2026-02-02, 10:15:32",5,400,401,-2000,-1,2001,0,5,O',
  /* 21 */ 'Trades,SubTotal,,Stocks,USD,MSFT,,5,,,-2000,-1,2001,0,5,',
  /* 22 */ 'Trades,Data,Order,Stocks,USD,AAPL,"2026-03-02, 11:00:00",-4,250,250,1000,-1.5,-800,198.5,0,C',
  /* 23 */ 'Trades,SubTotal,,Stocks,USD,AAPL,,-4,,,1000,-1.5,-800,198.5,0,',
  /* 24 */ 'Trades,Total,,Stocks,USD,,,,,,-1000,-2.5,1201,198.5,5, ',
  /* 25 */ 'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code',
  /* 26 */ 'Trades,Data,Order,Equity and Index Options,USD,PFE 15MAY26 30 C,"2026-02-03, 09:45:00",1,0.5,0.6,-50,-1,51,0,10,O',
  /* 27 */ 'Trades,Data,Order,Equity and Index Options,USD,PFE 15MAY26 30 C,"2026-02-10, 09:45:00",-1,0.7,0.6,70,-1,-51,18,0,C',
  /* 28 */ 'Trades,Total,,Equity and Index Options,USD,,,,,,20,-2,0,18,10, ',
  /* 29 */ 'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,,Proceeds,Comm in SGD,,,MTM in SGD,Code',
  /* 30 */ 'Trades,Data,Order,Forex,SGD,USD.SGD,"2026-02-01, 20:00:00",1500,1.35,,-2025,0,,,0,',
  /* 31 */ 'Trades,Data,Order,Forex,SGD,USD.SGD,"2026-03-05, 20:00:00",-200,1.3,,260,0,,,0,',
  /* 32 */ 'Trades,SubTotal,,Forex,SGD,USD.SGD,,1300,,,-1765,0,,,0,',
  /* 33 */ 'Trades,Total,,Forex,SGD,,,,,,-1765,0,,,0, ',
  /* 34 */ 'Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount',
  /* 35 */ 'Deposits & Withdrawals,Data,SGD,2026-02-01,Electronic Fund Transfer,2000',
  /* 36 */ 'Deposits & Withdrawals,Data,SGD,2026-03-10,Disbursement Initiated by Owner,-100',
  /* 37 */ 'Deposits & Withdrawals,Data,USD,2026-03-11,Electronic Fund Transfer,500',
  /* 38 */ 'Deposits & Withdrawals,Data,Total,,,2400',
  /* 39 */ 'Dividends,Header,Currency,Date,Description,Amount',
  /* 40 */ 'Dividends,Data,USD,2026-03-12,MSFT(US5949181045) Cash Dividend USD 0.91 per Share (Ordinary Dividend),4.55',
  /* 41 */ 'Dividends,Data,USD,2026-03-20,MSFT(US5949181045) Cash Dividend USD 0.20 per Share (Ordinary Dividend),1',
  /* 42 */ 'Dividends,Data,Total,,,5.55',
  /* 43 */ 'Dividends,Data,Total in SGD,,,7.2',
  /* 44 */ 'Withholding Tax,Header,Currency,Date,Description,Amount,Code',
  /* 45 */ 'Withholding Tax,Data,USD,2026-03-20,MSFT(US5949181045) Cash Dividend USD 0.20 per Share - US Tax,-0.3,',
  /* 46 */ 'Withholding Tax,Data,USD,2026-03-12,MSFT(US5949181045) Cash Dividend USD 0.91 per Share - US Tax,-1.365,',
  /* 47 */ 'Withholding Tax,Data,Total,,,-1.665,',
];
const STATEMENT = STATEMENT_LINES.join('\n') + '\n';

// Canonical rows without the line number, Decimals as strings, in a stable order.
const plain = (r: LedgerRow) => ({
  date: r.date,
  type: r.type,
  ticker: r.ticker,
  quantity: r.quantity?.toString() ?? null,
  price: r.price?.toString() ?? null,
  currency: r.currency,
  amount: r.amount.toString(),
  fees: r.fees.toString(),
});
const sorted = <T>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const row = (
  date: string,
  type: string,
  ticker: string | null,
  quantity: string | null,
  price: string | null,
  currency: string,
  amount: string,
  fees: string,
) => ({ date, type, ticker, quantity, price, currency, amount, fees });

function convertedRows(text: string) {
  const { csv } = importIbkr(text);
  const parsed = parseCsv(csv);
  if (parsed.rejected.length) throw new Error('importer output does not parse: ' + JSON.stringify(parsed.rejected));
  return parsed.rows.map(plain);
}

describe('detectFormat', () => {
  test('canonical header is canonical', () => {
    expect(detectFormat('date,type,ticker,quantity,price,currency,amount,fees\n')).toBe('canonical');
  });

  test('a file starting with Statement,Header, is ibkr', () => {
    expect(detectFormat(STATEMENT)).toBe('ibkr');
  });

  test('an IBKR file with a UTF-8 BOM is ibkr', () => {
    expect(detectFormat('﻿' + STATEMENT)).toBe('ibkr');
  });

  test('anything else is unknown', () => {
    expect(detectFormat('Date,Symbol,Qty\n2026-01-01,AAPL,1\n')).toBe('unknown');
  });
});

describe('importIbkr on a synthetic statement', () => {
  test('output starts with the canonical header', () => {
    expect(importIbkr(STATEMENT).csv.split(/\r?\n/)[0]).toBe('date,type,ticker,quantity,price,currency,amount,fees');
  });

  test('converts every supported row, and the output parses with no rejections', () => {
    expect(sorted(convertedRows(STATEMENT))).toEqual(
      sorted([
        // Opening position from Mark-to-Market (Prior Quantity, Prior Price with a thousands separator), dated the period start.
        row('2026-01-01', 'OPENING', 'AAPL', '10', '1000.5', 'USD', '10005', '0'),
        // Opening cash per currency from Cash Report Starting Cash (Base Currency Summary skipped).
        row('2026-01-01', 'OPENING', null, null, null, 'SGD', '300', '0'),
        row('2026-01-01', 'OPENING', null, null, null, 'USD', '300', '0'),
        // Stocks: quoted Date/Time, positive quantity BUY, negative SELL, amount |Proceeds|, fees |Comm/Fee|.
        row('2026-02-02', 'BUY', 'MSFT', '5', '400', 'USD', '2000', '1'),
        row('2026-03-02', 'SELL', 'AAPL', '4', '250', 'USD', '1000', '1.5'),
        // Forex USD.SGD: USD bought with SGD, then USD sold for SGD.
        row('2026-02-01', 'FX', 'USD', '1500', null, 'SGD', '2025', '0'),
        row('2026-03-05', 'FX', 'SGD', '260', null, 'USD', '200', '0'),
        // SGD deposit and withdrawal.
        row('2026-02-01', 'DEPOSIT', null, null, null, 'SGD', '2000', '0'),
        row('2026-03-10', 'WITHDRAW', null, null, null, 'SGD', '100', '0'),
        // Dividends joined to withholding by symbol and date: amount gross, fees |withholding|.
        row('2026-03-12', 'DIVIDEND', 'MSFT', null, null, 'USD', '4.55', '1.365'),
        row('2026-03-20', 'DIVIDEND', 'MSFT', null, null, 'USD', '1', '0.3'),
      ]),
    );
  });

  test('a USD deposit is rejected with flow_currency on its statement line', () => {
    expect(importIbkr(STATEMENT).rejected).toEqual([
      { line: 37, code: 'flow_currency', message: 'DEPOSIT and WITHDRAW must be in SGD.' },
    ]);
  });

  test('options trades are skipped with one notice giving the count', () => {
    expect(importIbkr(STATEMENT).notices).toEqual([
      'Options trades were skipped: 2 rows. Results are approximate because option premiums also moved your cash.',
    ]);
  });

  test('reports converted, skipped and rejected counts per section (Total and SubTotal rows not counted)', () => {
    const { sections } = importIbkr(STATEMENT);
    expect(sections['Trades']).toEqual({ converted: 4, skipped: 2, rejected: 0 });
    expect(sections['Deposits & Withdrawals']).toEqual({ converted: 2, skipped: 0, rejected: 1 });
    expect(sections['Dividends']).toMatchObject({ converted: 2, rejected: 0 });
  });

  test('a statement with a UTF-8 BOM converts the same rows', () => {
    expect(sorted(convertedRows('﻿' + STATEMENT))).toEqual(sorted(convertedRows(STATEMENT)));
  });

  test('a statement with CRLF line endings converts the same rows', () => {
    expect(sorted(convertedRows(STATEMENT.replace(/\n/g, '\r\n')))).toEqual(sorted(convertedRows(STATEMENT)));
  });

  test('a statement with no opening balances emits no OPENING rows', () => {
    const text = [
      'Statement,Header,Field Name,Field Value',
      'Statement,Data,Period,"February 1, 2026 - February 28, 2026"',
      'Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount',
      'Deposits & Withdrawals,Data,SGD,2026-02-02,Electronic Fund Transfer,1000',
      'Deposits & Withdrawals,Data,Total,,,1000',
    ].join('\n');
    expect(convertedRows(text)).toEqual([row('2026-02-02', 'DEPOSIT', null, null, null, 'SGD', '1000', '0')]);
  });
});

// Owen's real statement is a gitignored local fixture; skip when absent (as in src/engine/sample.test.ts).
const realFiles = import.meta.glob<string>('./fixtures/ibkr-real.csv', { eager: true, query: '?raw', import: 'default' });
const realCsv = realFiles['./fixtures/ibkr-real.csv'];

describe.skipIf(realCsv === undefined)('importIbkr on the real statement (needs local fixture)', () => {
  test('converts without throwing', () => {
    expect(() => importIbkr(realCsv)).not.toThrow();
  });

  test('reports counts for the Trades, Deposits & Withdrawals and Dividends sections', () => {
    const { sections } = importIbkr(realCsv);
    for (const name of ['Trades', 'Deposits & Withdrawals', 'Dividends']) {
      expect(sections[name]).toEqual({
        converted: expect.any(Number),
        skipped: expect.any(Number),
        rejected: expect.any(Number),
      });
    }
    expect(sections['Trades'].converted).toBeGreaterThan(0);
  });

  test('produces at least one OPENING row', () => {
    const { csv } = importIbkr(realCsv);
    expect(csv.split(/\r?\n/).some((l) => l.split(',')[1] === 'OPENING')).toBe(true);
  });
});
