import type Decimal from 'decimal.js';
import type { Dividend } from './dividends';

export type Ccy = 'SGD' | 'USD';
export type RowType = 'DEPOSIT' | 'WITHDRAW' | 'FX' | 'BUY' | 'SELL' | 'DIVIDEND' | 'OPENING';
export type IsoDate = string; // 'YYYY-MM-DD', calendar date, never a timestamp

export interface LedgerRow {
  line: number;
  date: IsoDate;
  type: RowType;
  ticker: string | null;
  quantity: Decimal | null;
  price: Decimal | null;
  currency: Ccy;
  amount: Decimal;
  fees: Decimal; // 0 when empty; on DIVIDEND, empty means 30% of amount (tax withheld)
}
export interface PriceBar { date: IsoDate; close: Decimal; splitFactor: Decimal; divCash: Decimal } // unadjusted
export type PriceSeries = Record<string, PriceBar[]>; // trading days only, ascending
export interface FxPoint { date: IsoDate; sgdPerUsd: Decimal } // ECB days only, ascending
export type FlowTiming = 'start' | 'end';

export interface ComputeInput {
  ledger: LedgerRow[];
  prices: PriceSeries;
  fx: FxPoint[];
  endDate: IsoDate; // last valuation date, inclusive
  flowTiming?: FlowTiming; // default 'start'
}
export interface ValuationPoint {
  date: IsoDate;
  valueSgd: Decimal; // end-of-day value, SGD
  netFlowSgd: Decimal; // deposits - withdrawals on this date
  netInvestedSgd: Decimal; // running sum of netFlowSgd
  dailyReturn: Decimal; // r_d, spec 6.6
  fxRate: Decimal;
  fxDate: IsoDate; // ECB date the rate came from (fxDate < date means carried)
  cash: Record<Ccy, Decimal>;
  holdings: Record<string, Decimal>; // end of day
}
export interface RateResult { value: Decimal; annualised: boolean; days: number }
export type XirrResult =
  | { kind: 'ok'; value: Decimal; annualised: boolean; multipleRoots: boolean }
  | { kind: 'undefined'; reason: 'no_sign_change' | 'no_root_in_range' | 'period_too_short' };

export type RejectionCode =
  | 'empty_file' | 'bad_header' | 'too_many_rows'
  | 'wrong_column_count' | 'bad_date' | 'bad_type' | 'bad_currency' | 'bad_number' | 'missing_field'
  | 'unexpected_field' | 'not_positive' | 'negative_fees' | 'flow_currency' | 'trade_currency' | 'fx_pair'
  | 'bad_ticker' | 'amount_mismatch' | 'fees_on_flow'
  | 'unsupported_tickers' | 'prices_not_loaded' | 'too_many_tickers'
  | 'after_as_of' | 'no_market_data' | 'not_trading_day' | 'negative_cash' | 'oversell'
  | 'dividend_unmatched' | 'dividend_duplicate';
export interface Rejection { line: number | null; code: RejectionCode; message: string }

export interface Warning {
  code: 'fx_carried' | 'twr_negative_base' | 'xirr_multiple_roots' | 'dividend_on_ex_date';
  date?: IsoDate;
  message: string;
}
export interface YearReturn { year: number; twr: Decimal; days: number }
export type ComputeResult =
  | {
      ok: true;
      series: ValuationPoint[];
      twr: RateResult;
      xirr: XirrResult;
      warnings: Warning[];
      yearReturns?: YearReturn[]; // full scope 7
      explanation?: string; // full scope 7
      dividends?: Dividend[]; // full scope 6
    }
  | { ok: false; rejected: Rejection[] };
