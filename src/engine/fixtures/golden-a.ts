// Golden A (spec 7): synthetic split, FX change and short-period XIRR case.
import { D } from '../decimal';
import type { FxPoint, PriceSeries } from '../types';

export const csv = `date,type,ticker,quantity,price,currency,amount,fees
2020-08-28,DEPOSIT,,,,SGD,1400,0
2020-08-28,FX,USD,1000,,SGD,1360,0
2020-08-28,BUY,AAPL,2,500,USD,1000,0
2020-08-31,DEPOSIT,,,,SGD,600,0
2020-09-01,WITHDRAW,,,,SGD,100,0
`;

const bar = (date: string, close: string, splitFactor: string) => ({
  date,
  close: D(close),
  splitFactor: D(splitFactor),
  divCash: D(0),
});

export const prices: PriceSeries = {
  AAPL: [bar('2020-08-28', '500', '1'), bar('2020-08-31', '130', '4'), bar('2020-09-01', '135', '1')],
};

export const fx: FxPoint[] = [
  { date: '2020-08-28', sgdPerUsd: D('1.36') },
  { date: '2020-08-31', sgdPerUsd: D('1.37') },
  { date: '2020-09-01', sgdPerUsd: D('1.35') },
];

export const endDate = '2020-09-01';
