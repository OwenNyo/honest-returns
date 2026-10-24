import { type ReactNode, useState } from 'react';
import type { ComputeInput, ComputeResult, FlowTiming, LedgerRow } from '../engine/types';
import type { FileState } from './App';
import type { InputFile } from './combine';
import { Benchmark, useBenchmark } from './BenchmarkSelect';
import { BrokerPicker, type Broker } from './BrokerPicker';
import { Decomposition } from './Decomposition';
import { DividendRows, WITHHOLDING_PCT } from './Dividends';
import { EmptyState } from './EmptyState';
import { FileList } from './FileList';
import { Hero } from './Hero';
import { PrintButton } from './PrintButton';
import { RawPricesPanel } from './RawPricesPanel';
import { Rejections } from './Rejections';
import { SectionList } from './SectionList';
import { ShareButtons } from './ShareButtons';
import { SECTIONS } from './sections';
import { TimingToggle } from './TimingToggle';
import { Upload } from './UploadButton';

export const SAMPLE_TITLE = 'A Singapore investor put SGD 1,000 a month into VOO and AAPL, January 2019 to June 2025.';
export const LOAD_ERROR = 'Prices could not be loaded. Try again in a minute.';

type Ok = ComputeResult & { ok: true };
type Props = {
  file: FileState;
  broker: Broker;
  onBroker: (b: Broker) => void;
  onFiles: (files: InputFile[]) => void;
  onAddFiles: (files: InputFile[]) => void;
  onTiming: (t: FlowTiming) => void;
};

// Decision "Analyse page is for your own file": no sample here. Sections render only when their data exists.
export function Analyse({ file, broker, onBroker, onFiles, onAddFiles, onTiming }: Props) {
  const actions = (
    <div className="upload-block">
      <BrokerPicker value={broker} onChange={onBroker} />
      <div className="actions">
        <Upload onFiles={onFiles} />
        {file.kind !== 'none' && <Upload onFiles={onAddFiles} label="Add another file" secondary />}
      </div>
    </div>
  );
  const fileTitle =
    file.kind === 'none' ? '' : file.files.length > 1 ? `Your files (${file.files.length})` : `Your file (${file.files[0].name})`;

  let shown: { title: string; result: Ok; ledger: LedgerRow[]; input: ComputeInput; extra: ReactNode; timing: FlowTiming } | null = null;
  let status: ReactNode = null;
  if (file.kind === 'result') {
    const { result, ledger, input, notices } = file.out;
    const extra = (
      <>
        {file.files.length > 1 && <FileList periods={file.out.periods} />}
        {notices.map((n) => (
          <p key={n} className="notice">
            {n}
          </p>
        ))}
        <TimingToggle value={file.timing} onChange={onTiming} />
      </>
    );
    shown = { title: fileTitle, result, ledger, input, extra, timing: file.timing };
  } else if (file.kind !== 'none') {
    status = (
      <div className="file-status">
        <p className="hero-title">{fileTitle}</p>
        {file.kind === 'running' && <p>Calculating.</p>}
        {file.kind === 'error' && <p role="alert">{LOAD_ERROR}</p>}
        {file.kind === 'mismatch' && <p role="alert">{file.message}</p>}
        {file.kind === 'empty' && <EmptyState />}
        {file.kind === 'rejected' && <Rejections rejected={file.rejected} />}
        {actions}
      </div>
    );
  } else {
    status = (
      <div className="file-status">
        <p className="lede">Pick your broker, then upload its activity statement. The file is read in this browser and never uploaded or stored.</p>
        {actions}
      </div>
    );
  }

  const [benchTicker, setBenchTicker] = useState<string>('VOO');
  const bench = useBenchmark(benchTicker, shown?.input ?? null);

  // Each section's body, or null when its data is absent. The order comes from SECTIONS.
  const bodies: Record<string, ReactNode> = shown
    ? {
        returns: (
          <>
            {actions}
            <Hero title={shown.title} titleAs="p" result={shown.result} ledger={shown.ledger}>
              {shown.extra}
              <ShareButtons result={shown.result}>
                <PrintButton result={shown.result} ledger={shown.ledger} timing={shown.timing} />
              </ShareButtons>
            </Hero>
          </>
        ),
        decomposition: shown.result.decomposition && (
          <div className="section-body">
            <p className="section-intro">
              The total gain in SGD, split into what the share prices did, what the exchange rate did and what the
              currency conversions cost.
            </p>
            <Decomposition d={shown.result.decomposition} />
          </div>
        ),
        dividends: !!shown.result.dividends?.length && shown.result.decomposition && (
          <div className="section-body">
            <p className="section-intro">
              Dividends after US tax. A dividend row from the broker counts with its own tax; without one, the dividend is
              booked on the ex-date with {WITHHOLDING_PCT} withheld.
            </p>
            <DividendRows d={shown.result.decomposition} />
            {shown.result.warnings
              .filter((w) => w.code === 'dividend_on_ex_date')
              .map((w) => (
                <p key={w.code} className="notice">
                  {w.message}
                </p>
              ))}
          </div>
        ),
        benchmark: <Benchmark ticker={benchTicker} onTicker={setBenchTicker} state={bench} series={shown.result.series} ledger={shown.ledger} />,
        'raw-prices': (
          <div className="section-body">
            <RawPricesPanel input={shown.input} twr={shown.result.twr} />
          </div>
        ),
      }
    : { returns: status };
  const present = SECTIONS.filter((s) => bodies[s.id]);

  return (
    <main className="page">
      <h1 className="visually-hidden">Analyse</h1>
      <div className="analyse-bar">
        <SectionList sections={shown ? present : []} />
      </div>
      {present.map((s) => (
        <section key={s.id} id={s.id} className="analyse-section">
          <h2 className={s.id === 'returns' ? 'visually-hidden' : 'section-title'}>{s.title}</h2>
          {bodies[s.id]}
        </section>
      ))}
    </main>
  );
}
