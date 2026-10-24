import { D } from './decimal';

// Published conventions. The methodology page prints these, so the text and the engine cannot drift.
export const US_WITHHOLDING = D('0.30'); // Singapore residents on US dividends (spec 10.6)
export const XIRR_GUESS = 0.1; // Newton starting rate (spec 6.7)
export const XIRR_RANGE = [-0.99, 10] as const; // bracket for the solver and the bisection fallback
export const DAYS_PER_YEAR = 365;
export const MONTHLY_NEW_TICKERS = 90; // spec 10.8
// Tiingo's free plan allows 500 distinct symbols a month and every listed ticker is fetched nightly, so the list itself is capped.
export const TOTAL_TICKERS = 500;
export const REPO_URL = 'https://github.com/OwenNyo/honest-returns';
