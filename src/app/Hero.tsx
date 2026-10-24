import type { ReactNode } from 'react';
import type { ComputeResult, LedgerRow } from '../engine/types';
import { formatDate, formatPct } from './format';
import { NumberLine } from './NumberLineFigure';
import { Link } from './router';
import { ValueChart } from './ValueChart';

type Ok = ComputeResult & { ok: true };

const XIRR_UNDEFINED = 'Cannot be calculated';

// titleAs: Home opens with the title as its h1; on Analyse the page heading is 'Analyse', so the title is a plain line.
export function Hero({
  title,
  titleAs: Title = 'h1',
  result,
  ledger,
  children,
}: {
  title: ReactNode;
  titleAs?: 'h1' | 'p';
  result: Ok;
  ledger: LedgerRow[];
  children?: ReactNode;
}) {
  const { twr, xirr, series } = result;
  const unit = (annualised: boolean) => <span className="rate-unit">{annualised ? 'a year' : 'in total'}</span>;
  const end = series[series.length - 1].date;
  return (
    <section className="hero">
      <div className="hero-main">
        <Title className="hero-title">{title}</Title>
        <div className="rates">
          <p className="twr">
            <span className="rate-label">
              TWR
              <Link className="ref" href="/methodology#flow-timing" aria-label="How TWR is calculated">a</Link>
            </span>
            <span className="rate-value">{formatPct(twr.value, 1)}</span>
            {unit(twr.annualised)}
          </p>
          <p className="xirr">
            <span className="rate-label">
              XIRR
              <Link className="ref" href="/methodology#xirr" aria-label="How XIRR is calculated">b</Link>
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
        <div className="hero-aside">{result.explanation && <p className="explanation">{result.explanation}</p>}</div>
        {children && <div className="hero-tools">{children}</div>}
      </div>
      <div className="hero-side">
        <ValueChart series={series} ledger={ledger} />
        <p className="as-of">
          Prices as of {formatDate(end)}
          <Link className="ref" href="/methodology#prices" aria-label="Where prices come from">c</Link>
          <a className="credit" href="https://www.tradingview.com/">Charting by TradingView</a>
        </p>
      </div>
    </section>
  );
}
