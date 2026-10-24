import type { Risk } from '../engine/types';
import { formatPct } from './format';

// Spec 17.2.3: largest fall and volatility as rows; the volatility row is absent under 90 days.
export function RiskRows({ risk }: { risk: Risk }) {
  return (
    <>
      <p className="row">
        <span>Largest fall</span>
        <span className="num">{risk.maxDrawdown.isZero() ? 'None' : formatPct(risk.maxDrawdown, 1)}</span>
      </p>
      {risk.volatility && (
        <p className="row">
          <span>Volatility</span>
          <span className="num">{risk.volatility.times(100).toFixed(1)}% a year</span>
        </p>
      )}
    </>
  );
}
