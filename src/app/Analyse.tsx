import type { ReactNode } from 'react';
import type { FlowTiming } from '../engine/types';
import type { FileState, SampleState } from './App';
import { BrokerPicker, type Broker } from './BrokerPicker';
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

  let returns: ReactNode;
  let present = SECTIONS.filter((s) => s.id === 'returns');
  if (tab === 'file' && file.kind === 'result') {
    returns = (
      <Hero title={fileTitle} titleAs="p" result={file.out.result} ledger={file.out.ledger}>
        <TimingToggle value={file.timing} onChange={onTiming} />
        {actions}
      </Hero>
    );
  } else if (tab === 'file' && file.kind !== 'none') {
    returns = (
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
    present = [];
  } else if (sample.kind === 'loaded' && sample.sample.ok) {
    returns = (
      <Hero title={SAMPLE_TITLE} titleAs="p" result={sample.sample} ledger={sample.sample.ledger}>
        {actions}
      </Hero>
    );
  } else {
    present = [];
    if (sample.kind === 'loaded' && !sample.sample.ok) console.error('sample rejected', sample.sample.rejected);
    returns =
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

  return (
    <main className="page">
      <h1 className="visually-hidden">Analyse</h1>
      <div className="analyse-bar">
        <ResultTabs tab={tab} fileEnabled={file.kind !== 'none'} onChange={onTab} />
        <SectionList sections={present} />
      </div>
      <div id="analyse-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <section id="returns" className="analyse-section">
          <h2 className="visually-hidden">Returns</h2>
          {returns}
        </section>
      </div>
    </main>
  );
}
