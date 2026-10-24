import type { ComputeResult, FlowTiming } from '../engine/types';
import { FOOTNOTES } from './footnotes';
import { formatDate, formatPct } from './format';
import { NumberLine } from './NumberLineFigure';

type Ok = ComputeResult & { ok: true };

// Spec 15.3.2: today's local calendar date, not toISOString (which is UTC).
export const localToday = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Spec 15.3: the one-page statement. Hidden on screen; the only thing printed. Never names the file or a ticker.
export function PrintStatement({ result, timing, chartImage, today }: { result: Ok; timing: FlowTiming; chartImage: string | null; today: string }) {
  const { twr, xirr, series } = result;
  const unit = (annualised: boolean) => (annualised ? 'a year' : 'in total');
  const first = series[0].date;
  const last = series[series.length - 1].date;
  return (
    <section className="print-statement">
      <h1>Honest Returns statement</h1>
      <p className="ps-sub">
        {formatDate(first)} to {formatDate(last)}
      </p>
      <div className="ps-rates">
        <p className="twr">
          TWR<sup>a</sup> <strong>{formatPct(twr.value, 1)}</strong> {unit(twr.annualised)}
        </p>
        <p className="xirr">
          XIRR<sup>b</sup>{' '}
          {xirr.kind === 'ok' ? (
            <>
              <strong>{formatPct(xirr.value, 1)}</strong> {unit(xirr.annualised)}
            </>
          ) : (
            'Cannot be calculated'
          )}
        </p>
        {xirr.kind === 'ok' && <p>Gap: {xirr.value.minus(twr.value).abs().times(100).toFixed(1)} points</p>}
      </div>
      {xirr.kind === 'ok' && <NumberLine twr={twr.value} xirr={xirr.value} />}
      {result.explanation && <p className="ps-explanation">{result.explanation}</p>}
      {chartImage && <img className="ps-chart" src={chartImage} alt="Portfolio value and money in over the period." />}
      <p>
        Prices as of {formatDate(last)}
        <sup>c</sup>. Charting by TradingView.
      </p>
      <p>Deposits and withdrawals counted at the {timing} of the day.</p>
      <ol className="ps-notes" type="a">
        <li>{FOOTNOTES.a(timing)}</li>
        <li>{FOOTNOTES.b}</li>
        <li>{FOOTNOTES.c}</li>
      </ol>
      <p>Generated on {formatDate(today)}</p>
      <p>Nothing was stored. Your file was read in this browser and was not uploaded.</p>
    </section>
  );
}
