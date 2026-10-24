import type Decimal from 'decimal.js';
import { D } from '../engine/decimal';
import type { Ccy, LedgerRow, Rejection, RejectionCode, RowType } from '../engine/types';
import { isIsoDate } from './dates';

export const HEADER = 'date,type,ticker,quantity,price,currency,amount,fees';
const MAX_ROWS = 10000;
const TYPES: RowType[] = ['DEPOSIT', 'WITHDRAW', 'FX', 'BUY', 'SELL', 'DIVIDEND', 'OPENING'];
const NUMBER = /^-?\d+(\.\d+)?$/;
const TICKER = /^[A-Z0-9.\-]{1,10}$/;

type Field = 'ticker' | 'quantity' | 'price' | 'amount';
// OPENING is checked with the BUY rules (a position) or the DEPOSIT rules (cash), see ruleType.
const REQUIRED: Record<Exclude<RowType, 'OPENING'>, Field[]> = {
  DEPOSIT: ['amount'],
  WITHDRAW: ['amount'],
  FX: ['ticker', 'quantity', 'amount'],
  BUY: ['ticker', 'quantity', 'price', 'amount'],
  SELL: ['ticker', 'quantity', 'price', 'amount'],
  DIVIDEND: ['ticker', 'amount'],
};
const MUST_BE_EMPTY: Record<Exclude<RowType, 'OPENING'>, Field[]> = {
  DEPOSIT: ['ticker', 'quantity', 'price'],
  WITHDRAW: ['ticker', 'quantity', 'price'],
  FX: ['price'],
  BUY: [],
  SELL: [],
  DIVIDEND: [],
};

const fileReject = (code: RejectionCode, message: string) => ({
  rows: [],
  rejected: [{ line: null, code, message }],
});

export function parseCsv(text: string): { rows: LedgerRow[]; rejected: Rejection[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return fileReject('empty_file', 'The file has no data rows.');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase()).join(',');
  if (header !== HEADER) return fileReject('bad_header', `The first line must be: ${HEADER}`);
  if (lines.length === 1) return fileReject('empty_file', 'The file has no data rows.');
  if (lines.length - 1 > MAX_ROWS) return fileReject('too_many_rows', `The file has more than ${MAX_ROWS} rows.`);

  const rows: LedgerRow[] = [];
  const rejected: Rejection[] = [];
  lines.slice(1).forEach((text, i) => {
    const line = i + 2;
    const res = parseRow(text, line);
    if ('code' in res) rejected.push({ line, ...res });
    else rows.push(res);
  });
  return { rows, rejected };
}

// Returns the row, or the first failing check in spec 5.1 table order.
function parseRow(text: string, line: number): LedgerRow | { code: RejectionCode; message: string } {
  const cells = text.split(',').map((c) => c.trim());
  if (cells.length !== 8) return { code: 'wrong_column_count', message: `Row has ${cells.length} columns; expected 8.` };
  const [date, rawType, rawTicker, quantityS, priceS, rawCurrency, amountS, feesS] = cells;
  const type = rawType.toUpperCase() as RowType;
  const ticker = rawTicker.toUpperCase();
  const currency = rawCurrency.toUpperCase() as Ccy;

  if (!isIsoDate(date)) return { code: 'bad_date', message: 'date must be a real date written as YYYY-MM-DD.' };
  if (!TYPES.includes(type)) return { code: 'bad_type', message: `type must be one of ${TYPES.join(', ')}.` };
  if (currency !== 'SGD' && currency !== 'USD') return { code: 'bad_currency', message: 'currency must be SGD or USD.' };

  // An OPENING row is a position when it names a ticker, otherwise cash (spec Task 15 addendum).
  const rule = type === 'OPENING' ? (ticker === '' ? 'DEPOSIT' : 'BUY') : type;
  const raw: Record<Field | 'fees', string> = { ticker, quantity: quantityS, price: priceS, amount: amountS, fees: feesS };
  for (const col of ['quantity', 'price', 'amount', 'fees'] as const) {
    if (raw[col] !== '' && !NUMBER.test(raw[col])) {
      return { code: 'bad_number', message: `${col} must be a plain number like 1234.56.` };
    }
  }
  for (const col of REQUIRED[rule]) {
    if (raw[col] === '') return { code: 'missing_field', message: `${col} is required for ${type}.` };
  }
  for (const col of MUST_BE_EMPTY[rule]) {
    if (raw[col] !== '') return { code: 'unexpected_field', message: `${col} must be empty for ${type}.` };
  }

  const num = (s: string): Decimal | null => (s === '' ? null : D(s));
  const quantity = num(quantityS);
  const price = num(priceS);
  const amount = D(amountS);
  const fees = num(feesS) ?? D(0);

  for (const [col, v] of [['quantity', quantity], ['price', price], ['amount', amount]] as const) {
    if (v !== null && !v.gt(0)) return { code: 'not_positive', message: `${col} must be greater than zero.` };
  }
  if (fees.lt(0)) return { code: 'negative_fees', message: 'fees cannot be negative.' };

  const isFlow = type === 'DEPOSIT' || type === 'WITHDRAW';
  const isTrade = rule === 'BUY' || rule === 'SELL' || rule === 'DIVIDEND';
  if (isFlow && currency !== 'SGD') return { code: 'flow_currency', message: 'DEPOSIT and WITHDRAW must be in SGD.' };
  if (isTrade && currency !== 'USD') return { code: 'trade_currency', message: `${type} must be in USD.` };
  if (type === 'FX' && ((ticker !== 'SGD' && ticker !== 'USD') || ticker === currency)) {
    return {
      code: 'fx_pair',
      message: 'FX must convert between SGD and USD: put the currency sold in currency and the currency bought in ticker.',
    };
  }
  if (isTrade && !TICKER.test(ticker)) {
    return { code: 'bad_ticker', message: 'ticker must be 1 to 10 characters using A to Z, 0 to 9, dot or hyphen.' };
  }
  if (isTrade && quantity && price) {
    const product = quantity.times(price);
    if (amount.minus(product).abs().gt('0.01')) {
      return {
        code: 'amount_mismatch',
        message: `amount ${amount} does not equal quantity x price (${quantity} x ${price} = ${product}).`,
      };
    }
  }
  if ((isFlow || type === 'OPENING') && !fees.isZero()) return { code: 'fees_on_flow', message: `fees must be empty or 0 for ${type}.` };

  return { line, date, type, ticker: ticker === '' ? null : ticker, quantity, price, currency, amount, fees };
}

// Sorted distinct tickers that need prices (BUY, SELL, DIVIDEND, OPENING); FX tickers are currencies.
export function ledgerTickers(rows: LedgerRow[]): string[] {
  const set = new Set(rows.filter((r) => r.type !== 'FX' && r.ticker).map((r) => r.ticker!));
  return [...set].sort();
}
