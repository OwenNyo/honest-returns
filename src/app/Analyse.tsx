import type { ReactNode } from 'react';
import type { ComputeInput, ComputeResult, FlowTiming, LedgerRow } from '../engine/types';
import type { FileState, SampleState } from './App';
import { BrokerPicker, type Broker } from './BrokerPicker';
import { Decomposition } from './Decomposition';
import { EmptyState } from './EmptyState';
import { Hero } from './Hero';
import { Rejections } from './Rejections';
import { ResultTabs, type Tab } from './ResultTabs';
import { SectionList } from './SectionList';
import { SECTIONS } from './sections';
import { Skeleton } from './Skeleton';
import { TimingToggle } from './TimingToggle';
import { Upload } from './UploadButton';

export const SAMPLE_TITLE = 'A Singapore investor put SGD 1,000 a month into VOO and AAPL, January 2019 to June 2025.';
export const LOAD_ERROR = 'Prices could not be loaded. Try again in a minute.';

type Ok = ComputeResult & { ok: true };
type Props = {
  sample: SampleState;
  file: FileState;
  tab: Tab;
  onTab: (t: Tab) => void;
  broker: Broker;
  onBroker: (b: Broker) => void;
  onFile: (name: string, text: string) => void;
  onTiming: (t: FlowTiming) => void;
};

// Spec 15.1.5: tabs, then the result in sections. Sections render only when their data exists.
export function Analyse({ sample, file, tab, onTab, broker, onBroker, onFile, onTiming }: Props) {
  const actions = (
    <div className="upload-block">
      <BrokerPicker value={broker} onChange={onBroker} />
      <div className="actions">
        <Upload onFile={onFile} />
      </div>
    </div>
  );
  const fileTitle = file.kind === 'none' ? '' : `Your file (${file.name})`;

  let shown: { title: string; result: Ok; ledger: LedgerRow[]; input: ComputeInput; extra: ReactNode } | null = null;
  let status: ReactNode = null;
  if (tab === 'file' && file.kind === 'result') {
    const { result, ledger, input, notices } = file.out;
    const extra = (
      <>
        {notices.map((n) => (
          <p key={n} className="notice">
            {n}
          </p>
        ))}
        <TimingToggle value={file.timing} onChange={onTiming} />
      </>
    );
    shown = { title: fileTitle, result, ledger, input, extra };
  } else if (tab === 'file' && file.kind !== 'none') {
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
  } else if (sample.kind === 'loaded' && sample.sample.ok) {
    const { input, ledger } = sample.sample;
    shown = { title: SAMPLE_TITLE, result: sample.sample, ledger, input, extra: null };
  } else {
    if (sample.kind === 'loaded' && !sample.sample.ok) console.error('sample rejected', sample.sample.rejected);
    status =
      sample.kind === 'loading' ? (
        <Skeleton />
      ) : sample.kind === 'empty' ? (
        <EmptyState />
      ) : (
        <div className="file-status">
          <p role="alert">{LOAD_ERROR}</p>
          {actions}
        </div>
      );
  }

  // Each section's body, or null when its data is absent. The order comes from SECTIONS.
  const bodies: Record<string, ReactNode> = shown
    ? {
        returns: (
          <>
            {actions}
            <Hero title={shown.title} titleAs="p" result={shown.result} ledger={shown.ledger}>
              {shown.extra}
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
      }
    : { returns: status };
  const present = SECTIONS.filter((s) => bodies[s.id]);

  return (
    <main className="page">
      <h1 className="visually-hidden">Analyse</h1>
      <div className="analyse-bar">
        <ResultTabs tab={tab} fileEnabled={file.kind !== 'none'} onChange={onTab} />
        <SectionList sections={shown ? present : []} />
      </div>
      <div id="analyse-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {present.map((s) => (
          <section key={s.id} id={s.id} className="analyse-section">
            <h2 className={s.id === 'returns' ? 'visually-hidden' : 'section-title'}>{s.title}</h2>
            {bodies[s.id]}
          </section>
        ))}
      </div>
    </main>
  );
}
