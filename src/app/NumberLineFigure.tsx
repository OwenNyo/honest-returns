import type Decimal from 'decimal.js';
import { numberLineScale } from './numberline';

type Anchor = 'start' | 'center' | 'end';
const EDGE = 8; // percent of the width within which a centred label would run off the line

// Centred over its mark, except near the ends of the line, where it starts or ends at the mark.
function anchor(x: number): Anchor {
  if (x < EDGE) return 'start';
  if (x > 100 - EDGE) return 'end';
  return 'center';
}

export function NumberLine({ twr, xirr }: { twr: Decimal; xirr: Decimal }) {
  // Display only: percent values as numbers to place marks; the label values come from Decimal.
  const t = twr.times(100).toNumber();
  const x = xirr.times(100).toNumber();
  const { min, max, ticks } = numberLineScale(t, x);
  const pos = (v: number) => ((v - min) / (max - min)) * 100;
  const pt = pos(t);
  const px = pos(x);
  const close = Math.abs(pt - px) < 16;
  // On a tie, TWR counts as the lower mark and reads first.
  const twrLow = pt <= px;
  const left = Math.min(pt, px);
  const gap = xirr.minus(twr).abs().times(100).toFixed(1);
  const mid = (pt + px) / 2;
  const right = Math.max(pt, px);
  const pairAnchor = left < EDGE ? 'start' : right > 100 - EDGE ? 'end' : 'center';
  const pairAt = pairAnchor === 'start' ? left : pairAnchor === 'end' ? right : mid;

  const label = (text: string, at: number, a: Anchor, cls = '') => (
    <span className={`nl-label ${a} ${cls}`} style={{ left: `${at}%` }}>
      {text}
    </span>
  );

  return (
    <figure
      className="numberline"
      style={{ margin: 0 }}
      aria-label={`Number line: TWR at ${t.toFixed(1)}%, XIRR at ${x.toFixed(1)}%, a gap of ${gap} points.`}
    >
      <div className="nl-row" aria-hidden="true">
        {close ? (
          // Close marks share one label, lower name first, so the two names never draw over each other.
          // Centred on the pair; if either mark is near an end, it starts or ends at the outer mark.
          <span className={`nl-label ${pairAnchor}`} style={{ left: `${pairAt}%` }}>
            {(twrLow ? ['twr', 'xirr'] : ['xirr', 'twr']).map((k) => (
              <span key={k} className={k} style={{ padding: '0 3px' }}>
                {k.toUpperCase()}
              </span>
            ))}
          </span>
        ) : (
          <>
            {label('XIRR', px, anchor(px), 'xirr')}
            {label('TWR', pt, anchor(pt), 'twr')}
          </>
        )}
      </div>
      <div className="nl-axis" aria-hidden="true">
        {ticks.map((v) => (
          <span key={v} className="nl-tick" style={{ left: `${pos(v)}%` }} />
        ))}
        <span
          className="nl-band"
          style={{ left: `${left}%`, width: `${Math.abs(pt - px)}%`, transformOrigin: pt <= px ? 'left' : 'right' }}
        />
        <span className="nl-mark xirr" style={{ left: `${px}%` }} />
        <span className="nl-mark twr" style={{ left: `${pt}%` }} />
      </div>
      <div className="nl-row nl-ticks" aria-hidden="true">
        {ticks.map((v, i) => (
          <span key={v}>{label(`${v}%`, pos(v), i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'center')}</span>
        ))}
      </div>
      <figcaption className="nl-row nl-gap">{close ? label(`${gap} points`, pairAt, pairAnchor) : label(`${gap} points`, mid, anchor(mid))}</figcaption>
    </figure>
  );
}
