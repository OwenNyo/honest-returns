import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { ComputeResult, FlowTiming, LedgerRow } from '../engine/types';
import { formatDate } from './format';
import { chartSnapshot } from './printChart';
import { localToday, PrintStatement } from './PrintStatement';
import type { Excluded } from './upload';

type Ok = ComputeResult & { ok: true };

// Spec 15.3.4: on beforeprint, snapshot the chart in light colours and set the statement title (the PDF file name),
// so the button and the browser's own print both get them; afterprint restores the title.
export function PrintButton({ result, ledger, timing, excluded }: { result: Ok; ledger: LedgerRow[]; timing: FlowTiming; excluded: Excluded | null }) {
  const [chartImage, setChartImage] = useState<string | null>(null);
  const today = localToday();
  useEffect(() => {
    let title = document.title;
    const before = () => {
      title = document.title;
      document.title = `Honest Returns statement ${formatDate(today)}`;
      // flushSync renders the image before the browser lays out the page for print; a data URL image loads at once.
      flushSync(() => setChartImage(chartSnapshot(result.series, ledger)));
    };
    const after = () => (document.title = title);
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    return () => {
      removeEventListener('beforeprint', before);
      removeEventListener('afterprint', after);
    };
  }, [result, ledger, today]);
  return (
    <>
      <button type="button" className="button secondary" onClick={() => window.print()}>
        Print or save as PDF
      </button>
      {/* A child of body, so print CSS can hide #root and show only this. */}
      {createPortal(<PrintStatement result={result} timing={timing} excluded={excluded} chartImage={chartImage} today={today} />, document.body)}
    </>
  );
}
