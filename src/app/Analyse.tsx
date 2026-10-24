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
import { formatDate, formatSgd } from './format';
import { Hero } from './Hero';
import { PrintButton } from './PrintButton';
import { RawPricesPanel } from './RawPricesPanel';
import { Rejections } from './Rejections';
import { SectionList } from './SectionList';
import { ShareButtons } from './ShareButtons';
import { SECTIONS } from './sections';
import { TimingToggle } from './TimingToggle';
import { DropZone, Upload } from './UploadButton';

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
  onRemove: () => void;
};

// Decision "Analyse page is for your own file": no sample here. Sections render only when their data exists.
export function Analyse({ file, broker, onBroker, onFiles, onAddFiles, onTiming, onRemove }: Props) {
  const actions = (
    <div className="upload-block">
      <BrokerPicker value={broker} onChange={onBroker} />
      <div className="actions">
        {/* One brass button per page: under a ticker request it steps down to secondary. */}
        <Upload
          onFiles={onFiles}
          label="Choose another file"
          secondary={file.kind === 'rejected' && file.rejected.some((r) => r.code === 'unsupported_tickers')}
        />
        {file.kind !== 'none' && <Upload onFiles={onAddFiles} label="Add another file" secondary />}
        {/* A failed upload can be cleared too; the saved set, if any, goes with it so nothing comes back on reload.
            Not while running: check() would still save and show the result when the prices arrive. */}
        {file.kind !== 'none' && file.kind !== 'running' && (
          <button type="button" className="button secondary" onClick={onRemove}>
            {file.kind === 'result' ? 'Remove saved file' : 'Remove file'}
          </button>
        )}
      </div>
    </div>
  );
  const fileTitle =
    file.kind === 'none' ? '' : file.files.length > 1 ? `Your files (${file.files.length})` : `Your file (${file.files[0].name})`;

  let shown: { title: ReactNode; result: Ok; ledger: LedgerRow[]; input: ComputeInput; extra: ReactNode; timing: FlowTiming } | null = null;
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
    // Same money-in figure as storyFacts: the last point's net invested SGD.
    const last = result.series[result.series.length - 1];
    const names = file.files.map((f) => f.name);
    const title = (
      <>
        {formatSgd(last.netInvestedSgd)} in, {formatDate(result.series[0].date)} to {formatDate(last.date)}
        <span className="hero-files">
          {file.saved
            ? `Saved on this device: ${names.join(', ')}`
            : names.length > 1
              ? `Your files (${names.length}): ${names.join(', ')}`
              : `Your file: ${names[0]}`}
        </span>
      </>
    );
    shown = { title, result, ledger, input, extra, timing: file.timing };
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
      <div className="intro">
        <div className="intro-main">
          <h1 className="hero-title">Check your own broker file</h1>
          <p className="lede">Choose the format of your file, then add it below.</p>
          <BrokerPicker value={broker} onChange={onBroker} />
          <DropZone onFiles={onFiles} />
          <p className="privacy">
            Your file is read in this browser and never uploaded. A copy stays on this device until you remove it. Only the
            tickers and the first date are sent, to fetch prices.
          </p>
        </div>
        <div className="intro-side">
          <ul className="gets">
            <li>TWR and XIRR side by side, in SGD</li>
            <li>The gain split into price, exchange rate, conversion cost and dividends</li>
            <li>The same deposits put into one fund, for comparison</li>
          </ul>
          <div className="ghost">
            <p className="ghost-caption">Your result appears here</p>
            <ResultPreview />
          </div>
        </div>
      </div>
    );
  }

  const [benchTicker, setBenchTicker] = useState<string>('VOO');
  const bench = useBenchmark(benchTicker, shown?.input ?? null);

  // Each section's body, or null when its data is absent. The order comes from SECTIONS.
  const bodies: Record<string, ReactNode> = shown
    ? {
        returns: (
          <Hero title={shown.title} titleAs="p" result={shown.result} ledger={shown.ledger}>
            {shown.extra}
            <ShareButtons result={shown.result}>
              <PrintButton result={shown.result} ledger={shown.ledger} timing={shown.timing} />
            </ShareButtons>
          </Hero>
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
      {file.kind !== 'none' && <h1 className="visually-hidden">Analyse</h1>}
      <div className="analyse-bar">
        <SectionList sections={shown ? present : []} />
      </div>
      {present.map((s) => (
        <section key={s.id} id={s.id} className="analyse-section">
          {file.kind !== 'none' && <h2 className={s.id === 'returns' ? 'visually-hidden' : 'section-title'}>{s.title}</h2>}
          {bodies[s.id]}
        </section>
      ))}
      {shown && (
        <section id="another-file" className="analyse-section">
          <h2 className="section-title">Check another file</h2>
          <div className="section-body">
            <p className="section-intro">Choose the format, then start a new report from another file or add a file to this one.</p>
            {actions}
            <p className="saved-note">Saved on this device only. Clearing browser data removes it.</p>
          </div>
        </section>
      )}
    </main>
  );
}

// A muted outline of the result: rate slots, an empty number line from 0 to 25%, an empty chart frame. No data.
const PREVIEW_TICKS = [0, 5, 10, 15, 20, 25];
function ResultPreview() {
  const slot = (label: string) => (
    <p>
      <span className="rate-label">{label}</span>
      <span className="rate-value">
        <span className="ghost-dash" />
      </span>
      <span className="rate-unit">
        <span className="ghost-dash" />
      </span>
    </p>
  );
  return (
    <div className="ghost-drawing" aria-hidden="true">
      <div className="rates">
        {slot('TWR')}
        {slot('XIRR')}
      </div>
      <div className="numberline">
        <div className="nl-axis">
          {PREVIEW_TICKS.map((v) => (
            <span key={v} className="nl-tick" style={{ left: `${v * 4}%` }} />
          ))}
        </div>
        <div className="nl-row nl-ticks">
          {PREVIEW_TICKS.map((v, i) => (
            <span key={v} className={`nl-label ${i === 0 ? 'start' : i === PREVIEW_TICKS.length - 1 ? 'end' : 'center'}`} style={{ left: `${v * 4}%` }}>
              {v}%
            </span>
          ))}
        </div>
      </div>
      <div className="ghost-chart" />
    </div>
  );
}
