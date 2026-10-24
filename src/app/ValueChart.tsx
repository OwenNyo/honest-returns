import {
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

export function ValueChart({ series, ledger }: { series: ValuationPoint[]; ledger: LedgerRow[] }) {
  const el = useRef<HTMLDivElement>(null);
  const last = series[series.length - 1];
  const [readout, setReadout] = useState(last);

  useEffect(() => {
    const graphite = cssVar('--graphite');
    const ruling = cssVar('--ruling');
    const chart = createChart(el.current!, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: graphite, fontFamily: cssVar('--sans'), fontSize: 13 },
      grid: { vertLines: { color: ruling }, horzLines: { color: ruling } },
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
    const value = chart.addSeries(LineSeries, { color: graphite, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    const moneyIn = chart.addSeries(LineSeries, {
      color: graphite,
      lineWidth: 1,
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
      color: graphite,
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
      .map((p) => ({ time: p.date as Time, position: 'aboveBar', shape: 'arrowDown', color: graphite }));
    createSeriesMarkers(value, markers);
    chart.timeScale().fitContent();

    const byDate = new Map(series.map((p) => [p.date, p]));
    chart.subscribeCrosshairMove((param) => setReadout((param.time && byDate.get(param.time as string)) || last));
    return () => chart.remove();
  }, [series, ledger, last]);

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
