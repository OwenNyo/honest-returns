import type Decimal from 'decimal.js';
import type { HoldingRow } from '../engine/holdings';
import type { IsoDate } from '../engine/types';
import { signedSgd } from './Decomposition';
import { formatDate, formatSgd } from './format';

type Line = { label: string; note: string | null; gain: string | null; total?: true };

const pct = (w: Decimal | null) => (w === null ? [] : [`${w.times(100).toFixed(1)}%`]);

// Spec 18.2.3: one line per row; shares, value and weight go in the faded second line, the gain on the right.
export function holdingLines(rows: HoldingRow[]): Line[] {
  return rows.map((r): Line => {
    switch (r.kind) {
      case 'ticker': {
        const shares = `${r.shares.toFixed()} ${r.shares.eq(1) ? 'share' : 'shares'}`;
        return { label: r.ticker, note: [shares, formatSgd(r.valueSgd), ...pct(r.weight)].join(', '), gain: signedSgd(r.gainSgd) };
      }
      case 'cash':
        return { label: `${r.currency} cash`, note: [formatSgd(r.valueSgd), ...pct(r.weight)].join(', '), gain: null };
      case 'rest':
        return { label: 'Cash and exchange on cash', note: null, gain: signedSgd(r.gainSgd) };
      case 'total':
        return { label: 'Total', note: formatSgd(r.valueSgd), gain: signedSgd(r.gainSgd), total: true };
    }
  });
}

export function HoldingRows({ rows, from }: { rows: HoldingRow[]; from: IsoDate }) {
  return (
    <>
      <p className="row holdings-head">
        <span>Holding</span>
        <span className="num">Gain since {formatDate(from)}</span>
      </p>
      {holdingLines(rows).map((l) => (
        <p key={l.label} className={l.total ? 'row total' : 'row'}>
          <span>
            {l.label}
            {l.note && <span className="row-note">{l.note}</span>}
          </span>
          <span className="num">{l.gain}</span>
        </p>
      ))}
    </>
  );
}
