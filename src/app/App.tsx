import { useEffect, useState } from 'react';
import type { FlowTiming, Rejection } from '../engine/types';
import { loadSample, type Loaded } from './data';
import { Hero } from './Hero';
import { Rejections } from './Rejections';
import { TimingToggle } from './TimingToggle';
import { runUpload, type UploadOutcome } from './upload';
import { Upload } from './UploadButton';

const SAMPLE_TITLE = 'A Singapore investor put SGD 1,000 a month into VOO and AAPL, January 2019 to June 2025.';
const LOAD_ERROR = 'Prices could not be loaded. Try again in a minute.';

type SampleState = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; sample: Loaded };
type FileState =
  | { kind: 'none' }
  | { kind: 'running'; name: string }
  | { kind: 'error'; name: string }
  | { kind: 'rejected'; name: string; rejected: Rejection[] }
  | { kind: 'result'; name: string; text: string; timing: FlowTiming; out: UploadOutcome & { kind: 'result' } };

export function App() {
  const [sample, setSample] = useState<SampleState>({ kind: 'loading' });
  const [file, setFile] = useState<FileState>({ kind: 'none' });

  useEffect(() => {
    loadSample().then(
      (s) => setSample({ kind: 'loaded', sample: s }),
      (e) => {
        console.error(e);
        setSample({ kind: 'error' });
      },
    );
  }, []);

  async function check(name: string, text: string, timing: FlowTiming = 'start') {
    setFile({ kind: 'running', name });
    try {
      const out = await runUpload(text, fetch, timing);
      setFile(out.kind === 'result' ? { kind: 'result', name, text, timing, out } : { kind: 'rejected', name, rejected: out.rejected });
    } catch (e) {
      console.error(e);
      setFile({ kind: 'error', name });
    }
  }

  const upload = <Upload onFile={(name, text) => check(name, text)} />;
  const backToSample = (
    <button type="button" className="link-button" onClick={() => setFile({ kind: 'none' })}>
      Show the sample again
    </button>
  );
  const fileTitle = file.kind === 'none' ? '' : `Your file (${file.name})`;

  let body;
  if (file.kind === 'result') {
    body = (
      <Hero title={fileTitle} result={file.out.result} ledger={file.out.ledger}>
        <TimingToggle value={file.timing} onChange={(t) => check(file.name, file.text, t)} />
        <div className="actions">
          {upload}
          {backToSample}
        </div>
      </Hero>
    );
  } else if (file.kind !== 'none') {
    body = (
      <section className="file-status">
        <h1 className="hero-title">{fileTitle}</h1>
        {file.kind === 'running' && <p>Calculating.</p>}
        {file.kind === 'error' && <p role="alert">{LOAD_ERROR}</p>}
        {file.kind === 'rejected' && <Rejections rejected={file.rejected} />}
        <div className="actions">
          {upload}
          {backToSample}
        </div>
      </section>
    );
  } else if (sample.kind === 'loaded' && sample.sample.ok) {
    body = (
      <Hero title={SAMPLE_TITLE} result={sample.sample} ledger={sample.sample.ledger}>
        <div className="actions">{upload}</div>
      </Hero>
    );
  } else {
    if (sample.kind === 'loaded' && !sample.sample.ok) console.error('sample rejected', sample.sample.rejected);
    body = (
      <section className="file-status">
        {sample.kind === 'loading' ? <p>Loading prices.</p> : <p role="alert">{LOAD_ERROR}</p>}
        <div className="actions">{upload}</div>
      </section>
    );
  }

  return (
    <main className="page">
      <header className="site-header">
        <span className="brand">Honest Returns</span>
        <a href="/methodology">Methodology</a>
      </header>
      {body}
    </main>
  );
}
