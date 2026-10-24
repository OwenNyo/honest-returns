import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComputeResult, FlowTiming, LedgerRow } from '../engine/types';
import { formatDate } from './format';
import { chartSnapshot } from './printChart';
import { localToday, PrintStatement } from './PrintStatement';

type Ok = ComputeResult & { ok: true };

// Spec 15.3.4: snapshot the chart in light colours, then open the print dialog with the statement title.
export function PrintButton({ result, ledger, timing, isSample }: { result: Ok; ledger: LedgerRow[]; timing: FlowTiming; isSample: boolean }) {
  const [chartImage, setChartImage] = useState<string | null>(null);
  const today = localToday();
  async function print() {
    const url = await chartSnapshot(result.series, ledger);
    setChartImage(url);
    await new Promise(requestAnimationFrame); // let React render the image
    const img = document.querySelector<HTMLImageElement>('.print-statement .ps-chart');
    await img?.decode();
    const title = document.title;
    document.title = `Honest Returns statement ${formatDate(today)}`;
    addEventListener('afterprint', () => (document.title = title), { once: true });
    window.print();
  }
  return (
    <>
      <button type="button" className="button secondary" onClick={() => print().catch((e) => console.error(e))}>
        Print or save as PDF
      </button>
      {/* A child of body, so print CSS can hide #root and show only this. */}
      {createPortal(<PrintStatement result={result} timing={timing} isSample={isSample} chartImage={chartImage} today={today} />, document.body)}
    </>
  );
}
