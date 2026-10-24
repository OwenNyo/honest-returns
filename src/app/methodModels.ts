import type Decimal from 'decimal.js';
import { adjustedCloseTwr, adjustedSeries } from '../engine/adjusted';
import { compute } from '../engine/compute';
import { D } from '../engine/decimal';
import { annualise, dailyReturns, twr } from '../engine/twr';
import type { ComputeInput, FlowTiming, PriceBar, ValuationPoint } from '../engine/types';
import { xirr } from '../engine/xirr';
import { daysBetween } from '../shared/dates';
import { HEADER, parseCsv } from '../shared/csv';

// Models behind the interactive Methodology figures. Inputs are built by hand; every number comes from the engine.

// Only value and flow matter for TWR.
const point = (date: string, value: Decimal, flow: Decimal): ValuationPoint => ({
  date,
  valueSgd: value,
  netFlowSgd: flow,
  netInvestedSgd: D(0),
  dailyReturn: D(0),
  fxRate: D(1),
  fxDate: date,
  cash: { SGD: D(0), USD: D(0) },
  holdings: {},
});

export const YEAR_RETURNS = ['0.10', '-0.05', '0.08'];
const YEAR_STARTS = ['2021-01-01', '2022-01-01', '2023-01-01'];
const END = '2024-01-01';

// Deposits at the start of each year, the value grows by the year's return. A point on each year start carries
// last year's growth plus that day's deposit, so the deposit is counted at the end of that day.
export function twoNumbers(deposits: number[]): { twr: Decimal; xirr: Decimal } {
  let value = D(0);
  const points = YEAR_STARTS.map((date, i) => {
    if (i > 0) value = value.times(D(YEAR_RETURNS[i - 1]).plus(1));
    value = value.plus(deposits[i]);
    return point(date, value, D(deposits[i]));
  });
  value = value.times(D(YEAR_RETURNS[2]).plus(1));
  points.push(point(END, value, D(0)));
  const { series } = dailyReturns(points, 'end');
  const flows = [...YEAR_STARTS.map((date, i) => ({ date, amount: D(-deposits[i]) })), { date: END, amount: value }];
  const x = xirr(flows, END);
  if (x.kind !== 'ok') throw new Error('two numbers: XIRR undefined, ' + x.reason);
  return { twr: annualise(twr(series), daysBetween(YEAR_STARTS[0], END)).value, xirr: x.value };
}

// A 10,000 holding rises 2% and a 1,000 deposit arrives as cash, so the day ends at 11,200.
export const DAY = { holding: 10000, deposit: 1000, end: 11200 };
export function flowTiming(timing: FlowTiming): Decimal {
  const points = [point('2024-03-04', D(DAY.holding), D(0)), point('2024-03-05', D(DAY.end), D(DAY.deposit))];
  return twr(dailyReturns(points, timing).series);
}

// Six trading days; a dividend of 8.80 goes ex on the fifth, so adjusted closes before it are 0.92 of raw.
const bar = (date: string, close: string, divCash = '0'): PriceBar => ({ date, close: D(close), splitFactor: D(1), divCash: D(divCash) });
const BARS = [
  bar('2024-03-04', '98'),
  bar('2024-03-05', '100'),
  bar('2024-03-06', '104'),
  bar('2024-03-07', '110'),
  bar('2024-03-08', '103', '8.80'),
  bar('2024-03-11', '108'),
];
const RAW_INPUT = (): ComputeInput => {
  const { rows, rejected } = parseCsv(
    [
      HEADER,
      '2024-03-04,DEPOSIT,,,,SGD,1350,0',
      '2024-03-04,FX,USD,1000,,SGD,1350,0',
      '2024-03-04,BUY,VOO,10,98,USD,980,0',
      '2024-03-05,DEPOSIT,,,,SGD,1350,0',
      '2024-03-05,FX,USD,1000,,SGD,1350,0',
      '2024-03-05,BUY,VOO,10,100,USD,1000,0',
    ].join('\n'),
  );
  if (rejected.length) throw new Error('raw prices: ledger invalid ' + JSON.stringify(rejected));
  return {
    ledger: rows,
    prices: { VOO: BARS },
    fx: BARS.map((b) => ({ date: b.date, sgdPerUsd: D('1.35') })),
    endDate: '2024-03-11',
  };
};
export const BUY_INDEX = 1;
export const EX_INDEX = 4;
export function rawPrices(kind: 'raw' | 'adjusted'): { twr: Decimal; closes: number[] } {
  if (kind === 'adjusted') {
    return { twr: adjustedCloseTwr(RAW_INPUT()), closes: adjustedSeries(BARS).map((b) => b.close.toNumber()) };
  }
  const res = compute(RAW_INPUT());
  if (!res.ok) throw new Error('raw prices: rejected ' + JSON.stringify(res.rejected));
  return { twr: res.twr.value, closes: BARS.map((b) => b.close.toNumber()) };
}

// 10 shares valued at the USD close, converted at the USD/SGD rate, plus SGD cash.
export const SHARES = 10;
export const SGD_CASH = 600;
export function valuation(priceUsd: number, sgdPerUsd: number): { holdingUsd: Decimal; holdingSgd: Decimal; value: Decimal } {
  const holdingUsd = D(SHARES).times(D(priceUsd));
  const holdingSgd = holdingUsd.times(D(sgdPerUsd.toString()));
  return { holdingUsd, holdingSgd, value: holdingSgd.plus(SGD_CASH) };
}
