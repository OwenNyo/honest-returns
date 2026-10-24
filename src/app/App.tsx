import { useEffect, useState } from 'react';
import type { FlowTiming, Rejection } from '../engine/types';
import { detectFormat } from '../importers/detect';
import { Analyse } from './Analyse';
import type { Broker } from './BrokerPicker';
import { loadSample, type SampleLoaded } from './data';
import { Home } from './Home';
import { Methodology } from './Methodology';
import { Navbar } from './Navbar';
import type { Tab } from './ResultTabs';
import { Link, scrollToHash, usePath } from './router';
import { runUpload, type UploadOutcome } from './upload';

export type SampleState = { kind: 'loading' } | { kind: 'error' } | { kind: 'empty' } | { kind: 'loaded'; sample: SampleLoaded };
export type FileState =
  | { kind: 'none' }
  | { kind: 'running'; name: string }
  | { kind: 'error'; name: string }
  | { kind: 'empty'; name: string }
  | { kind: 'mismatch'; name: string; message: string }
  | { kind: 'rejected'; name: string; rejected: Rejection[] }
  | { kind: 'result'; name: string; text: string; timing: FlowTiming; out: UploadOutcome & { kind: 'result' } };

// Decision "broker picker": a file whose detected format differs from the pick is not computed.
const FORMAT_NAME = { canonical: 'a plain CSV', ibkr: 'an Interactive Brokers activity statement' };
function mismatch(text: string, picked: Broker): string | null {
  const detected = detectFormat(text);
  if (detected === 'unknown' || detected === picked) return null;
  return `This looks like ${FORMAT_NAME[detected]} file, not ${FORMAT_NAME[picked]} file.`;
}

export function App() {
  const path = usePath();
  const [sample, setSample] = useState<SampleState>({ kind: 'loading' });
  const [file, setFile] = useState<FileState>({ kind: 'none' });
  const [tab, setTab] = useState<Tab>('sample');
  const [broker, setBroker] = useState<Broker>('ibkr');

  useEffect(() => {
    loadSample().then(
      (s) => setSample('kind' in s ? { kind: 'empty' } : { kind: 'loaded', sample: s }),
      (e) => {
        console.error(e);
        setSample({ kind: 'error' });
      },
    );
  }, []);

  // A direct load or a route change with a hash scrolls once the page has rendered.
  useEffect(() => {
    if (location.hash) scrollToHash(location.hash);
  }, [path]);

  async function check(name: string, text: string, timing: FlowTiming = 'start') {
    setTab('file');
    const wrong = mismatch(text, broker);
    if (wrong) return setFile({ kind: 'mismatch', name, message: wrong });
    setFile({ kind: 'running', name });
    try {
      const out = await runUpload(text, fetch, timing);
      if (out.kind === 'result') setFile({ kind: 'result', name, text, timing, out });
      else if (out.kind === 'empty') setFile({ kind: 'empty', name });
      else setFile({ kind: 'rejected', name, rejected: out.rejected });
    } catch (e) {
      console.error(e);
      setFile({ kind: 'error', name });
    }
  }

  let page;
  if (path === '/') page = <Home sample={sample} />;
  else if (path === '/analyse')
    page = (
      <Analyse
        sample={sample}
        file={file}
        tab={tab}
        onTab={setTab}
        broker={broker}
        onBroker={setBroker}
        onFile={(name, text) => check(name, text)}
        onTiming={(t) => file.kind === 'result' && check(file.name, file.text, t)}
      />
    );
  else if (path === '/methodology')
    page = (
      <main className="page">
        <Methodology />
      </main>
    );
  else
    page = (
      <main className="page not-found">
        <h1 className="hero-title">Page not found</h1>
        <p>This page does not exist.</p>
        <div className="actions">
          <Link href="/" className="button">
            Home
          </Link>
          <Link href="/analyse" className="button secondary">
            Analyse
          </Link>
        </div>
      </main>
    );

  return (
    <>
      <Navbar path={path} />
      {page}
    </>
  );
}
