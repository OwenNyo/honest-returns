import { daysBetween } from '../shared/dates';
import { explainGap, yearlyTwr } from './explain';
import { annualise, dailyReturns, twr } from './twr';
import type { ComputeInput, ComputeResult, Warning } from './types';
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
  const deposits = input.ledger.filter((r) => r.type === 'DEPOSIT').map((r) => ({ date: r.date, amount: r.amount }));
  const explanation = explainGap({ twr: t, xirr: x, yearReturns, deposits });
  return { ok: true, series, twr: t, xirr: x, warnings, yearReturns, explanation, dividends: valued.dividends };
}
