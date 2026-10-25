import { expect, test } from 'vitest';
import { requestOutcome } from './RequestTickers';

// Task 47, spec 19.9: what the page does with a /api/ticker-requests answer.
const answer = (results: [ticker: string, status: string][], availableFrom: string | null = null) => ({
  results: results.map(([ticker, status]) => ({ ticker, status })),
  availableFrom,
});

test('added re-runs', () => {
  expect(requestOutcome(answer([['ABC', 'added']]))).toEqual({ rerun: true });
});

test('already_available re-runs', () => {
  expect(requestOutcome(answer([['ABC', 'already_available']]))).toEqual({ rerun: true });
});

test('any loaded ticker re-runs', () => {
  expect(requestOutcome(answer([['ABC', 'added'], ['DEF', 'queued']]))).toEqual({ rerun: true });
});

test('queued says try again in an hour and keeps the button', () => {
  expect(requestOutcome(answer([['ABC', 'queued'], ['DEF', 'queued']]))).toEqual({
    messages: ['Prices for ABC, DEF could not be loaded right now. Try again in an hour.'],
    retry: true,
  });
});

test('not_found names the tickers and removes the button', () => {
  expect(requestOutcome(answer([['XYZ', 'not_found']]))).toEqual({
    messages: ['Tiingo, our price source, has no prices for XYZ. Tickers listed outside the US are not covered.'],
    retry: false,
  });
});

test('limit_reached gives the date requests open again and removes the button', () => {
  expect(requestOutcome(answer([['ABC', 'limit_reached']], '2026-11-01'))).toEqual({
    messages: ['Ticker request limit reached. Requests open again on 1\u00a0November 2026.'],
    retry: false,
  });
});

test("limit_reached from the client cap gives tomorrow's date", () => {
  expect(requestOutcome(answer([['ABC', 'limit_reached']], '2026-10-27'))).toEqual({
    messages: ['Ticker request limit reached. Requests open again on 27\u00a0October 2026.'],
    retry: false,
  });
});

test('mixed answers give one sentence each in the order not_found, queued, limit', () => {
  expect(requestOutcome(answer([['DEF', 'limit_reached'], ['ABC', 'queued'], ['XYZ', 'not_found']], '2026-11-01'))).toEqual({
    messages: [
      'Tiingo, our price source, has no prices for XYZ. Tickers listed outside the US are not covered.',
      'Prices for ABC could not be loaded right now. Try again in an hour.',
      'Ticker request limit reached. Requests open again on 1\u00a0November 2026.',
    ],
    retry: true,
  });
});
