import {
  AreaSeries,
  createChart,
  createSeriesMarkers,
  LineSeries,
  LineStyle,
  LineType,
  TickMarkType,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import type { LedgerRow, ValuationPoint } from '../engine/types';
import { formatDate, formatSgd } from './format';

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Display only: the chart library takes numbers; values are rounded to cents first.
const num = (d: { toFixed(dp: number): string }) => Number(d.toFixed(2));

export function ValueChart({
  series,
  ledger,
  benchmark,
}: {
  series: ValuationPoint[];
  ledger: LedgerRow[];
  benchmark?: { ticker: string; series: ValuationPoint[] };
}) {
  const el = useRef<HTMLDivElement>(null);
  const last = series[series.length - 1];
  const [readout, setReadout] = useState(last);

  useEffect(() => {
    const paper = cssVar('--paper');
    const faded = cssVar('--faded');
    const rule = cssVar('--rule');
    // A light textColor also makes the library pick its light TradingView logo, which must stay visible.
    const chart = createChart(el.current!, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: faded, fontFamily: cssVar('--sans'), fontSize: 13 },
      grid: { vertLines: { visible: false }, horzLines: { color: rule } },
      crosshair: { vertLine: { color: faded, labelBackgroundColor: rule }, horzLine: { color: faded, labelBackgroundColor: rule } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0 } }, // no bottom margin: a value axis never dips below 0
      timeScale: {
        borderVisible: false,
        minBarSpacing: 0.01, // fit every calendar day, even at 360 px
        // Month ticks carry the year ('Feb 2025'), so a month after the last year label is not read as a year.
        tickMarkFormatter: (t: Time, type: TickMarkType) => (type === TickMarkType.Month ? formatDate(t as string).replace(/^\d+ /, '') : null),
      },
      localization: { priceFormatter: (v: number) => Math.round(v).toLocaleString('en-SG') },
      handleScroll: false,
      handleScale: false,
    });
    const value = chart.addSeries(AreaSeries, {
      lineColor: paper,
      lineWidth: 2,
      topColor: `${paper}38`, // ~22% alpha
      bottomColor: `${paper}00`,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const moneyIn = chart.addSeries(LineSeries, {
      color: faded,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    value.setData(series.map((p) => ({ time: p.date as Time, value: num(p.valueSgd) })));
    moneyIn.setData(series.map((p) => ({ time: p.date as Time, value: num(p.netInvestedSgd) })));

    // FX conversions as small dots: series markers have an 11 px minimum, too heavy for monthly conversions.
    const fxDates = new Set(ledger.filter((r) => r.type === 'FX').map((r) => r.date));
    const fxDots = chart.addSeries(LineSeries, {
      color: faded,
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    fxDots.setData(series.filter((p) => fxDates.has(p.date)).map((p) => ({ time: p.date as Time, value: num(p.valueSgd) })));
    const markers: SeriesMarker<Time>[] = series
      .filter((p) => p.netFlowSgd.lt(0))
      .map((p) => ({ time: p.date as Time, position: 'aboveBar', shape: 'arrowDown', color: cssVar('--brass') }));
    createSeriesMarkers(value, markers);
    // Inline label under the money-in line, 85% along so it is not clipped at the right edge (an axis label hid the tick under it).
    const labelAt = series[Math.floor(series.length * 0.85)];
    createSeriesMarkers(moneyIn, [{ time: labelAt.date as Time, position: 'belowBar', shape: 'circle', size: 0.5, color: faded, text: 'Money in' }], { autoScale: false });
    // Spec 10.14: the benchmark's value, dotted, labelled with its ticker.
    if (benchmark) {
      const bench = chart.addSeries(LineSeries, {
        color: `${paper}b3`, // ~70% alpha
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bench.setData(benchmark.series.map((p) => ({ time: p.date as Time, value: num(p.valueSgd) })));
      const at = benchmark.series[Math.floor(benchmark.series.length * 0.7)];
      createSeriesMarkers(bench, [{ time: at.date as Time, position: 'aboveBar', shape: 'circle', size: 0.5, color: paper, text: benchmark.ticker }], { autoScale: false });
    }
    chart.timeScale().fitContent();

    const byDate = new Map(series.map((p) => [p.date, p]));
    chart.subscribeCrosshairMove((param) => setReadout((param.time && byDate.get(param.time as string)) || last));
    return () => chart.remove();
  }, [series, ledger, last, benchmark]);

  const first = series[0];
  return (
    <div>
      <p className="chart-readout" aria-live="polite">
        {formatDate(readout.date)}: value {formatSgd(readout.valueSgd)}, money in {formatSgd(readout.netInvestedSgd)}
      </p>
      <div
        ref={el}
        className="chart"
        role="img"
        aria-label={`Portfolio value from ${formatSgd(first.valueSgd)} on ${formatDate(first.date)} to ${formatSgd(last.valueSgd)} on ${formatDate(last.date)}, with ${formatSgd(last.netInvestedSgd)} of money in.`}
      />
    </div>
  );
}
