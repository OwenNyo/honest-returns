import { D } from './decimal';
import type { Dividend } from './dividends';
import type { Decomposition, FxPoint, LedgerRow, ValuationPoint } from './types';

// Spec 10.5, in SGD over the period. The day's rate f_d is the series fxRate (the same fx(d) as the fx points).
// `dividends` defaults to none only for callers without dividends; compute() always passes them.
export function decompose(series: ValuationPoint[], ledger: LedgerRow[], _fx: FxPoint[], dividends: Dividend[] = []): Decomposition {
  let fx = D(0);
  let conversion = D(0); // received - given, negative is a cost
  let divs = D(0);
  let withholding = D(0);
  let fees = D(0);
  let flows = D(0);
  series.forEach((p, i) => {
    const f = p.fxRate;
    if (i > 0) fx = fx.plus(series[i - 1].valueUsd!.times(f.minus(series[i - 1].fxRate)));
    for (const r of ledger) {
      if (r.date !== p.date) continue;
      if (r.type === 'BUY' || r.type === 'SELL') fees = fees.plus(r.fees.times(f));
      if (r.type !== 'FX') continue;
      const given = r.amount.plus(r.fees);
      conversion = conversion.plus(r.ticker === 'USD' ? r.quantity!.times(f).minus(given) : r.quantity!.minus(given.times(f)));
    }
    for (const d of dividends) {
      if (d.date !== p.date) continue;
      divs = divs.plus(d.net.times(f));
      withholding = withholding.plus(d.withheld.times(f));
    }
    flows = flows.plus(p.netFlowSgd);
  });
  const totalGain = series[series.length - 1].valueSgd.minus(flows);
  const conversionCost = conversion.neg();
  // Spec 17.3.1: the local price effect is the residual (trade-versus-close included), so the identity holds exactly.
  const local = totalGain.minus(fx).plus(conversionCost).plus(fees).minus(divs);
  return { local, fx, conversionCost, fees, dividends: divs, withholding, totalGain };
}
