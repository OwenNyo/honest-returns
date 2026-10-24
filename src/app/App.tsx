import { useEffect, useState } from 'react';
import { loadSample, type Loaded } from './data';
import { Hero } from './Hero';

const SAMPLE_TITLE = 'A Singapore investor put SGD 1,000 a month into VOO and AAPL, January 2019 to June 2025.';
const LOAD_ERROR = 'Prices could not be loaded. Try again in a minute.';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; sample: Loaded };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    loadSample().then(
      (sample) => setState({ kind: 'loaded', sample }),
      (e) => {
        console.error(e);
        setState({ kind: 'error' });
      },
    );
  }, []);

  return (
    <main className="page">
      <header className="site-header">
        <span className="brand">Honest Returns</span>
        <a href="/methodology">Methodology</a>
      </header>
      {state.kind === 'loading' && <p className="status">Loading prices.</p>}
      {state.kind === 'error' && <p className="status" role="alert">{LOAD_ERROR}</p>}
      {state.kind === 'loaded' &&
        (state.sample.ok ? (
          <Hero title={SAMPLE_TITLE} result={state.sample} ledger={state.sample.ledger} />
        ) : (
          <p className="status" role="alert">{LOAD_ERROR}</p>
        ))}
    </main>
  );
}
