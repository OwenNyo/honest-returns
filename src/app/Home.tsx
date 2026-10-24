import { LOAD_ERROR, SAMPLE_TITLE } from './Analyse';
import type { SampleState } from './App';
import { Decomposition } from './Decomposition';
import { DividendRows, WITHHOLDING_PCT } from './Dividends';
import { EmptyState } from './EmptyState';
import { formatDate, formatPct, formatSgd } from './format';
import { Hero } from './Hero';
import { RawPricesPanel } from './RawPricesPanel';
import { Scene } from './Scene';
import { Link } from './router';
import { Skeleton } from './Skeleton';
import { storyFacts } from './story';

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
      <Hero title={SAMPLE_TITLE} result={s} ledger={s.ledger} />

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

      <Scene title="What the exchange rate did" rows={s.decomposition && <Decomposition d={s.decomposition} />}>
        <p>
          The shares are priced in USD but the result is in SGD, so the USD/SGD rate moves the result. USD/SGD went from{' '}
          {f.fxFrom.rate.toFixed(4)} on {formatDate(f.fxFrom.date)} to {f.fxTo.rate.toFixed(4)} on {formatDate(f.fxTo.date)}.
        </p>
      </Scene>

      {!!s.dividends?.length && s.decomposition && (
        <Scene title="What dividends added" rows={<DividendRows d={s.decomposition} />}>
          <p>
            {[...new Set(s.dividends.map((d) => d.ticker))].sort().join(' and ')} paid dividends. A Singapore resident has {WITHHOLDING_PCT} of US dividends withheld as tax, so only the rest was
            added to the cash.
          </p>
        </Scene>
      )}

      <Scene title="Why the method matters" rows={
        <div className="actions">
          <Link href="/methodology" className="button secondary">
            Read the methodology
          </Link>
        </div>
      }>
        <RawPricesPanel input={s.input} twr={s.twr} />
        <p>
          Most charting sites use adjusted close, which folds later dividends and splits back into old prices. Honest Returns
          values each day at the price that actually traded, converts it at that day's exchange rate, and books dividends as
          cash rather than hiding them in the price. The methodology page lists every rule, with a figure for each.
        </p>
      </Scene>

      <Scene title="Check your own file" rows={
        <div className="actions">
          <Link href="/analyse" className="button">
            Check your own broker file
          </Link>
        </div>
      }>
        <p>
          Export an activity statement from your broker and drop it here. The whole calculation runs in this browser: your
          file is never uploaded and nothing about it is stored. Only the list of tickers and the first date leave your
          device, to fetch prices. You get the same two numbers, the same breakdown, and a card or PDF to keep.
        </p>
      </Scene>
    </main>
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
