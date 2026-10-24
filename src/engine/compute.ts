import type Decimal from 'decimal.js';
import { daysBetween } from '../shared/dates';
import { D } from './decimal';
import { MIN_VOLATILITY_DAYS } from './constants';
import { decompose } from './decompose';
import { explainGap, yearlyTwr } from './explain';
import { maxDrawdown, volatility } from './risk';
import { annualise, dailyReturns, twr } from './twr';
import type { ComputeInput, ComputeResult, IsoDate, LedgerRow, ValuationPoint, Warning } from './types';
import { valueDaily } from './valuation';
import { xirr } from './xirr';

// Spec 6.9: valuation, TWR, XIRR. Any engine rejection means no numbers.
export function compute(input: ComputeInput): ComputeResult {
  const valued = valueDaily(input);
  if (!valued.ok) return valued;
  const { series, warnings: twrWarnings } = dailyReturns(valued.series, input.flowTiming ?? 'start');
  const first = series[0].date;
  const last = series[series.length - 1];

  // Investor side: deposits negative, withdrawals positive, terminal value positive.
  const flows = series.filter((p) => !p.netFlowSgd.isZero()).map((p) => ({ date: p.date, amount: p.netFlowSgd.neg() }));
  flows.push({ date: input.endDate, amount: last.valueSgd });
  const x = xirr(flows, input.endDate);

  const warnings: Warning[] = [...valued.warnings, ...twrWarnings];
  if (x.kind === 'ok' && x.multipleRoots) {
    warnings.push({
      code: 'xirr_multiple_roots',
      message:
        'More than one rate between -99% and 1000% balances these cash flows; showing the one found from a 10% starting guess.',
    });
  }
  const t = annualise(twr(series), daysBetween(first, input.endDate));
  const yearReturns = yearlyTwr(series);
  const deposits = explanationDeposits(input.ledger, series, input.originalLedger ?? input.ledger);
  const explanation = explainGap({ twr: t, xirr: x, yearReturns, deposits });
  const { dividends } = valued;
  const decomposition = decompose(series, input.ledger, input.fx, dividends);
  const risk = { ...maxDrawdown(series), volatility: series.length >= MIN_VOLATILITY_DAYS ? volatility(series) : null };
  return { ok: true, series, twr: t, xirr: x, warnings, yearReturns, explanation, dividends, decomposition, risk };
}

// Spec 17.1.8: the investor's deposits for the explanation. Every DEPOSIT row of the ledger before exclusion, USD at the
// day's rate, so synthetic deposits from excluded sales and dividends never count; plus each opening value
// (decision 2): that day's net flow less its DEPOSIT and WITHDRAW rows of the reduced ledger.
export function explanationDeposits(
  ledger: LedgerRow[],
  series: ValuationPoint[],
  original: LedgerRow[] = ledger,
): { date: IsoDate; amount: Decimal }[] {
  const point = (date: IsoDate) => series.find((p) => p.date === date)!;
  const sgd = (r: LedgerRow) => (r.currency === 'SGD' ? r.amount : r.amount.times(point(r.date).fxRate));
  const deposits = original.filter((r) => r.type === 'DEPOSIT').map((r) => ({ date: r.date, amount: sgd(r) }));
  for (const date of new Set(ledger.filter((r) => r.type === 'OPENING').map((r) => r.date))) {
    const rowFlow = ledger
      .filter((r) => r.date === date && (r.type === 'DEPOSIT' || r.type === 'WITHDRAW'))
      .reduce((s, r) => (r.type === 'DEPOSIT' ? s.plus(sgd(r)) : s.minus(sgd(r))), D(0));
    deposits.push({ date, amount: point(date).netFlowSgd.minus(rowFlow) });
  }
  return deposits;
}
