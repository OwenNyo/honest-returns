import { useEffect, useState } from 'react';
import { BENCHMARKS } from '../engine/benchmark';
import type { ComputeInput, ComputeResult, LedgerRow, ValuationPoint } from '../engine/types';
import { loadBenchmark } from './data';
import { formatPct, formatSgd } from './format';
import { ValueChart } from './ValueChart';

export type BenchmarkState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'done'; result: ComputeResult };

// Loads the benchmark for the chosen fund whenever the result or the fund changes.
export function useBenchmark(ticker: string, input: ComputeInput | null): BenchmarkState {
  const [state, setState] = useState<BenchmarkState>({ kind: 'loading' });
  useEffect(() => {
    if (!input) return;
    let live = true;
    setState({ kind: 'loading' });
    loadBenchmark(ticker, input).then(
      (s) => live && setState(s),
      (e) => {
        console.error(e);
        if (live) setState({ kind: 'error' });
      },
    );
    return () => {
      live = false;
    };
  }, [ticker, input]);
  return state;
}

// Spec 10.14 UI: the select, the benchmark's TWR, XIRR and end value, and a chart of the portfolio with the fund's value line.
export function Benchmark({ ticker, onTicker, state, series, ledger }: {
  ticker: string;
  onTicker: (t: string) => void;
  state: BenchmarkState;
  series: ValuationPoint[];
  ledger: LedgerRow[];
}) {
  const unit = (annualised: boolean) => (annualised ? 'a year' : 'in total');
  let body;
  if (state.kind === 'loading') body = <p>Loading {ticker} prices.</p>;
  else if (state.kind === 'error') body = <p role="alert">Prices could not be loaded. Try again in a minute.</p>;
  else if (state.kind === 'unavailable') body = <p>Prices for {ticker} are not loaded yet. Try again tomorrow.</p>;
  else if (!state.result.ok) body = <p>{state.result.rejected[0].message}</p>;
  else {
    const { twr, xirr, series } = state.result;
    const last = series[series.length - 1];
    body = (
      <div className="rows">
        <p className="row">
          <span>TWR</span>
          <span className="num">
            {formatPct(twr.value, 1)} {unit(twr.annualised)}
          </span>
        </p>
        <p className="row">
          <span>XIRR</span>
          <span className="num">{xirr.kind === 'ok' ? `${formatPct(xirr.value, 1)} ${unit(xirr.annualised)}` : 'Cannot be calculated'}</span>
        </p>
        <p className="row">
          <span>End value</span>
          <span className="num">{formatSgd(last.valueSgd)}</span>
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="section-body">
        <p className="section-intro">
          The same deposits and withdrawals, on the same days, put into one fund instead, converted at the reference rate
          with no cost. Its value is the dotted line on the chart below.
        </p>
        <label className="select">
          <span>Fund</span>
          <select value={ticker} onChange={(e) => onTicker(e.target.value)}>
            {BENCHMARKS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <div aria-live="polite">{body}</div>
      </div>
      {state.kind === 'done' && state.result.ok && (
        <ValueChart series={series} ledger={ledger} benchmark={{ ticker, series: state.result.series }} />
      )}
    </>
  );
}
