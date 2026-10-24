import type { ReactNode } from 'react';
import type { ComputeResult, LedgerRow } from '../engine/types';
import { formatDate, formatPct } from './format';
import { NumberLine } from './NumberLineFigure';
import { ValueChart } from './ValueChart';

type Ok = ComputeResult & { ok: true };

const XIRR_UNDEFINED = 'Cannot be calculated';

export function Hero({ title, result, ledger, children }: { title: ReactNode; result: Ok; ledger: LedgerRow[]; children?: ReactNode }) {
  const { twr, xirr, series } = result;
  const unit = (annualised: boolean) => <span className="rate-unit">{annualised ? 'a year' : 'in total'}</span>;
  const end = series[series.length - 1].date;
  return (
    <section className="hero">
      <div className="hero-main">
        <h1 className="hero-title">{title}</h1>
        <div className="rates">
          <p className="twr">
            <span className="rate-label">
              TWR
              <a className="ref" href="/methodology#flow-timing" aria-label="How TWR is calculated">a</a>
            </span>
            <span className="rate-value">{formatPct(twr.value, 1)}</span>
            {unit(twr.annualised)}
          </p>
          <p className="xirr">
            <span className="rate-label">
              XIRR
              <a className="ref" href="/methodology#xirr" aria-label="How XIRR is calculated">b</a>
            </span>
            {xirr.kind === 'ok' ? (
              <>
                <span className="rate-value">{formatPct(xirr.value, 1)}</span>
                {unit(xirr.annualised)}
              </>
            ) : (
              <span className="rate-undefined">{XIRR_UNDEFINED}</span>
            )}
          </p>
        </div>
        {xirr.kind === 'ok' && <NumberLine twr={twr.value} xirr={xirr.value} />}
        <div className="hero-aside">
          {result.explanation && <p className="explanation">{result.explanation}</p>}
          {children}
        </div>
      </div>
      <div className="hero-side">
        <ValueChart series={series} ledger={ledger} />
        <p className="as-of">
          Prices as of {formatDate(end)}
          <a className="ref" href="/methodology#prices" aria-label="Where prices come from">c</a>
        </p>
      </div>
    </section>
  );
}
