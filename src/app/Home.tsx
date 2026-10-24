import type { ReactNode } from 'react';
import { LOAD_ERROR, SAMPLE_TITLE } from './Analyse';
import type { SampleState } from './App';
import { EmptyState } from './EmptyState';
import { formatDate, formatPct, formatSgd } from './format';
import { Hero } from './Hero';
import { Link } from './router';
import { Skeleton } from './Skeleton';
import { storyFacts } from './story';

const checkOwn = (
  <Link href="/analyse" className="button">
    Check your own broker file
  </Link>
);

// Spec 15.1.4: the sample told top to bottom. Every figure is generated from the data.
export function Home({ sample }: { sample: SampleState }) {
  if (sample.kind === 'loaded' && !sample.sample.ok) console.error('sample rejected', sample.sample.rejected);
  if (sample.kind !== 'loaded' || !sample.sample.ok) {
    return (
      <main className="page">
        {sample.kind === 'loading' ? <Skeleton /> : sample.kind === 'empty' ? <EmptyState /> : <p role="alert">{LOAD_ERROR}</p>}
      </main>
    );
  }
  const s = sample.sample;
  const f = storyFacts(s);
  const dates = s.ledger.map((r) => r.date).sort();
  const tickers = Object.keys(f.buysByTicker).sort();
  const unit = (annualised: boolean) => (annualised ? 'a year' : 'in total');
  const pct = (d: Parameters<typeof formatPct>[0]) => formatPct(d, 1);
  const maxAbs = Math.max(...f.years.map((y) => Math.abs(y.twr.toNumber())), 0.0001);

  return (
    <main className="page home">
      <Hero title={SAMPLE_TITLE} result={s} ledger={s.ledger}>
        <div className="actions">{checkOwn}</div>
      </Hero>

      <Scene title="What they did" rows={
        <>
          <Row label="Deposits" value={String(f.deposits)} />
          <Row label="Money in" value={formatSgd(f.moneyIn)} />
          <Row label="Conversions to USD" value={String(f.conversions)} />
          {tickers.map((t) => (
            <Row key={t} label={`Purchases of ${t}`} value={String(f.buysByTicker[t])} />
          ))}
        </>
      }>
        <p>
          From {formatDate(dates[0])} to {formatDate(dates[dates.length - 1])}, they paid SGD into the broker every month,
          converted it to USD and bought whole shares, taking turns between {tickers.join(' and ')}.
        </p>
      </Scene>

      <Scene title="Two numbers, two questions">
        <p>
          <span className="twr-term">TWR</span> answers how the investments did, whatever the timing of the deposits. Here
          it is {pct(s.twr.value)} {unit(s.twr.annualised)}.
        </p>
        <p>
          <span className="xirr-term">XIRR</span> answers how the investor's money did, including when it arrived.{' '}
          {s.xirr.kind === 'ok' ? `Here it is ${pct(s.xirr.value)} ${unit(s.xirr.annualised)}.` : 'Here it cannot be calculated.'}
        </p>
      </Scene>

      <Scene title="Why they differ" rows={
        <div className="years" role="table" aria-label="TWR and deposits by year">
          {f.years.map((y) => {
            const note = y.year === f.best ? 'strongest year' : y.year === f.worst ? 'weakest year' : '';
            const w = (Math.abs(y.twr.toNumber()) / maxAbs) * 50;
            return (
              <div className="year" role="row" key={y.year}>
                <span role="rowheader">
                  {y.year}
                  {note && <span className="year-note">{note}</span>}
                </span>
                <span role="cell" className="year-bar" aria-hidden="true">
                  <span className={y.twr.isNeg() ? 'neg' : 'pos'} style={{ width: `${w}%` }} />
                </span>
                <span role="cell" className="num">{pct(y.twr)}</span>
                <span role="cell" className="num">{formatSgd(y.deposited)}</span>
              </div>
            );
          })}
        </div>
      }>
        <p>Money arrived at the same pace every month, but returns came unevenly from year to year.</p>
        {s.explanation && <p>{s.explanation}</p>}
      </Scene>

      <Scene title="What the exchange rate did">
        <p>
          The shares are priced in USD but the result is in SGD, so the USD/SGD rate moves the result. USD/SGD went from{' '}
          {f.fxFrom.rate.toFixed(4)} on {formatDate(f.fxFrom.date)} to {f.fxTo.rate.toFixed(4)} on {formatDate(f.fxTo.date)}.
        </p>
      </Scene>

      <Scene title="Why the method matters">
        {f.split && (
          <p>
            On {formatDate(f.split.date)} {f.split.ticker} split {f.split.after.div(f.split.before).toString()} for 1: the
            holding went from {f.split.before.toString()} to {f.split.after.toString()} shares and the price fell by the same
            factor, so the value did not jump.
          </p>
        )}
        <p>
          <Link href="/methodology">Read the methodology</Link>
        </p>
      </Scene>

      <Scene title="Check your own file">
        <p>Your file is read in this browser and never uploaded or stored.</p>
        <div className="actions">{checkOwn}</div>
      </Scene>
    </main>
  );
}

function Scene({ title, rows, children }: { title: string; rows?: ReactNode; children: ReactNode }) {
  return (
    <section className="scene">
      <h2>{title}</h2>
      <div className="scene-prose">{children}</div>
      {rows && <div className="rows">{rows}</div>}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="row">
      <span>{label}</span>
      <span className="num">{value}</span>
    </p>
  );
}
