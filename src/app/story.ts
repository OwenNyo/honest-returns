import type Decimal from 'decimal.js';
import { D } from '../engine/decimal';
import type { IsoDate } from '../engine/types';
import type { Loaded } from './data';

export interface StoryFacts {
  deposits: number;
  moneyIn: Decimal;
  conversions: number;
  buysByTicker: Record<string, number>;
  years: { year: number; twr: Decimal; deposited: Decimal }[];
  best: number | null; // null when no year has 90 days
  worst: number | null;
  fxFrom: { rate: Decimal; date: IsoDate };
  fxTo: { rate: Decimal; date: IsoDate };
  split?: { ticker: string; date: IsoDate; before: Decimal; after: Decimal };
}

// Spec 15.1.4: every figure on Home comes from the sample's result and ledger.
export function storyFacts(loaded: Loaded): StoryFacts {
  if (!loaded.ok) throw new Error('storyFacts needs a computed result');
  const { ledger, series } = loaded;
  const first = series[0];
  const last = series[series.length - 1];
  const buysByTicker: Record<string, number> = {};
  for (const r of ledger) if (r.type === 'BUY') buysByTicker[r.ticker!] = (buysByTicker[r.ticker!] ?? 0) + 1;

  const years = (loaded.yearReturns ?? [])
    .filter((y) => y.days >= 90)
    .map((y) => ({
      year: y.year,
      twr: y.twr,
      deposited: ledger
        .filter((r) => r.type === 'DEPOSIT' && Number(r.date.slice(0, 4)) === y.year)
        .reduce((s, r) => s.plus(r.amount), D(0)),
    }));
  // Strict comparisons keep the earlier year on a tie.
  const pick = (better: (a: Decimal, b: Decimal) => boolean) =>
    years.reduce<(typeof years)[number] | null>((m, y) => (m === null || better(y.twr, m.twr) ? y : m), null)?.year ?? null;

  // A split is the first day a holding changes with no trade row for that ticker that day.
  let split: StoryFacts['split'];
  for (let i = 1; i < series.length && !split; i++) {
    for (const [t, q] of Object.entries(series[i].holdings)) {
      const before = series[i - 1].holdings[t];
      if (!before || before.eq(q)) continue;
      const traded = ledger.some((r) => r.date === series[i].date && r.ticker === t && r.type !== 'DIVIDEND');
      if (!traded) {
        split = { ticker: t, date: series[i].date, before, after: q };
        break;
      }
    }
  }

  return {
    deposits: ledger.filter((r) => r.type === 'DEPOSIT').length,
    moneyIn: last.netInvestedSgd,
    conversions: ledger.filter((r) => r.type === 'FX').length,
    buysByTicker,
    years,
    best: pick((a, b) => a.gt(b)),
    worst: pick((a, b) => a.lt(b)),
    fxFrom: { rate: first.fxRate, date: first.fxDate },
    fxTo: { rate: last.fxRate, date: last.fxDate },
    split,
  };
}
