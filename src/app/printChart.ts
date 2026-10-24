import type { LedgerRow, ValuationPoint } from '../engine/types';
import { buildChart, type ChartColors } from './ValueChart';

// Spec 15.3.4: the 11.3 light tokens, because the statement prints on white.
const LIGHT: ChartColors = { paper: '#1E2A2F', faded: '#4A5A60', rule: '#BFCBC2', brass: '#1E2A2F', font: "'Archivo', sans-serif" };

// Builds a second chart off screen (not display: none, which has no size), waits one frame, and returns a PNG data URL.
export async function chartSnapshot(series: ValuationPoint[], ledger: LedgerRow[]): Promise<string> {
  const el = document.createElement('div');
  el.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 1000px; height: 400px;';
  document.body.appendChild(el);
  const chart = buildChart(el, series, ledger, LIGHT);
  try {
    await new Promise(requestAnimationFrame);
    return chart.takeScreenshot().toDataURL('image/png');
  } finally {
    chart.remove();
    el.remove();
  }
}
