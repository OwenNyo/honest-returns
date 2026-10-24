import { US_WITHHOLDING } from '../engine/constants';
import type { Decomposition } from '../engine/types';
import { formatSgd } from './format';

// Spec 10.6 and 15.1.4 scene 6: dividends after US tax, in SGD at the rate of the day they were paid.
export function DividendRows({ d }: { d: Decomposition }) {
  return (
    <div className="rows">
      <p className="row">
        <span>Dividends after tax</span>
        <span className="num">{formatSgd(d.dividends)}</span>
      </p>
      <p className="row">
        <span>US tax withheld</span>
        <span className="num">{formatSgd(d.withholding)}</span>
      </p>
    </div>
  );
}

export const WITHHOLDING_PCT = `${US_WITHHOLDING.times(100).toFixed(0)}%`;
