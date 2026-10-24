import type { Rejection } from '../engine/types';
import { RequestTickers } from './RequestTickers';

// Spec 10.2 and 15.4.2: one line per rejection, file-level ones without the line prefix; with several files,
// each names its file.
const prefix = (r: Rejection) =>
  r.file ? (r.line === null ? `${r.file}: ` : `${r.file}, line ${r.line}: `) : r.line === null ? '' : `Line ${r.line}: `;

// Spec 16.6: only availability rejections carry tickers; when all do, the user can leave those holdings out.
export function Rejections({ rejected, onContinue }: { rejected: Rejection[]; onContinue?: (tickers: string[]) => void }) {
  return (
    <div className="rejections" role="alert">
      <ul>
        {rejected.map((r, i) => (
          <li key={i}>{prefix(r) + r.message}</li>
        ))}
      </ul>
      <p>No results were calculated.</p>
      {rejected
        .filter((r) => r.code === 'unsupported_tickers')
        .map((r) => (
          <RequestTickers key={r.message} tickers={r.tickers!} />
        ))}
      {onContinue && rejected.every((r) => r.tickers) && (
        <>
          <p>
            You can see a report for the rest of the portfolio instead. Buying these holdings then counts as money taken
            out, and their sales and dividends as money put in.
          </p>
          <button type="button" className="button secondary" onClick={() => onContinue(rejected.flatMap((r) => r.tickers!))}>
            Continue without these holdings
          </button>
        </>
      )}
    </div>
  );
}
