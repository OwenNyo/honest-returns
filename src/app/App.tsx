import { useEffect, useState } from 'react';
import type { FlowTiming, Rejection } from '../engine/types';
import { detectFormat } from '../importers/detect';
import { Analyse } from './Analyse';
import type { Converted, InputFile } from './combine';
import type { Broker } from './BrokerPicker';
import { loadSample, type SampleLoaded } from './data';
import { Footer } from './Footer';
import { Home } from './Home';
import { Methodology } from './Methodology';
import { Navbar } from './Navbar';
import { Link, scrollToHash, usePath } from './router';
import { clearLedger, loadLedger, saveLedger } from './saved';
import { runUpload, type UploadOutcome } from './upload';

export type SampleState = { kind: 'loading' } | { kind: 'error' } | { kind: 'empty' } | { kind: 'loaded'; sample: SampleLoaded };
export type FileState =
  | { kind: 'none' }
  | { kind: 'running'; files: InputFile[] }
  | { kind: 'error'; files: InputFile[] }
  | { kind: 'empty'; files: InputFile[] }
  | { kind: 'mismatch'; files: InputFile[]; message: string }
  | { kind: 'rejected'; files: InputFile[]; rejected: Rejection[]; timing: FlowTiming; exclude: string[]; converted?: Converted[] }
  | { kind: 'result'; files: InputFile[]; timing: FlowTiming; out: UploadOutcome & { kind: 'result' }; saved?: boolean };

// Decision "broker picker": a file whose detected format differs from the pick is not computed.
const FORMAT_NAME = { canonical: 'a plain CSV', ibkr: 'an Interactive Brokers activity statement', moomoo: 'a moomoo order history' };
function mismatch(files: InputFile[], picked: Broker): string | null {
  for (const f of files) {
    const detected = detectFormat(f.text);
    if (detected === 'unknown' || detected === picked) continue;
    const message = `This looks like ${FORMAT_NAME[detected]} file, not ${FORMAT_NAME[picked]} file.`;
    return files.length > 1 ? `${f.name}: ${message}` : message;
  }
  return null;
}

const TITLES: Record<string, string> = {
  '/': 'Honest Returns',
  '/analyse': 'Analyse - Honest Returns',
  '/methodology': 'Methodology - Honest Returns',
};

// Reading localStorage throws when storage is disabled and does not exist outside a browser: both mean no storage.
let storage: Storage | null = null;
try {
  storage = localStorage;
} catch {}

export function App() {
  const path = usePath();
  const [sample, setSample] = useState<SampleState>({ kind: 'loading' });
  const [file, setFile] = useState<FileState>({ kind: 'none' });
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

  // Spec 10.12: a saved ledger runs again with fresh prices, on any route.
  useEffect(() => {
    const saved = storage && loadLedger(storage);
    if (!saved) return;
    setBroker(saved.broker);
    check(saved.files, saved.timing, saved.broker, true, saved.exclude);
  }, []);

  // A direct load or a route change with a hash scrolls once the page has rendered.
  useEffect(() => {
    if (location.hash) scrollToHash(location.hash);
  }, [path]);

  // Tabs, history and screen readers tell the routes apart by the title.
  useEffect(() => {
    document.title = TITLES[path] ?? 'Page not found - Honest Returns';
  }, [path]);

  async function check(files: InputFile[], timing: FlowTiming = 'start', picked = broker, saved = false, exclude: string[] = []) {
    const wrong = mismatch(files, picked);
    if (wrong) return setFile({ kind: 'mismatch', files, message: wrong });
    setFile({ kind: 'running', files });
    try {
      const out = await runUpload(files, fetch, timing, exclude);
      if (out.kind === 'result') {
        if (storage) saveLedger(storage, { files, broker: picked, timing, exclude });
        setFile({ kind: 'result', files, timing, out, saved });
      }
      else if (out.kind === 'empty') setFile({ kind: 'empty', files });
      else setFile({ kind: 'rejected', files, rejected: out.rejected, timing, exclude, converted: out.converted });
    } catch (e) {
      console.error(e);
      setFile({ kind: 'error', files });
    }
  }

  function removeSaved() {
    if (storage) clearLedger(storage);
    setFile({ kind: 'none' });
  }

  let page;
  if (path === '/') page = <Home sample={sample} />;
  else if (path === '/analyse')
    page = (
      <Analyse
        file={file}
        broker={broker}
        onBroker={setBroker}
        onFiles={(files) => check(files)}
        onAddFiles={(files) => file.kind !== 'none' && check([...file.files, ...files])}
        onTiming={(t) => file.kind === 'result' && check(file.files, t, broker, file.saved, file.out.excluded?.tickers ?? [])}
        // Keeps an earlier exclusion, so continuing past a second rejection does not bring the first back.
        onExclude={(tickers) => file.kind === 'rejected' && check(file.files, file.timing, broker, false, [...file.exclude, ...tickers])}
        onRetry={() => file.kind === 'rejected' && check(file.files, file.timing, broker, false, file.exclude)}
        onRemove={removeSaved}
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
      <Footer />
    </>
  );
}
