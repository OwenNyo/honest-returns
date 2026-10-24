import type { Rejection } from '../engine/types';
import { RequestTickers, unsupportedTickers } from './RequestTickers';

// Spec 10.2 and 15.4.2: one line per rejection, file-level ones without the line prefix; with several files,
// each names its file.
const prefix = (r: Rejection) =>
  r.file ? (r.line === null ? `${r.file}: ` : `${r.file}, line ${r.line}: `) : r.line === null ? '' : `Line ${r.line}: `;

export function Rejections({ rejected }: { rejected: Rejection[] }) {
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
          <RequestTickers key={r.message} tickers={unsupportedTickers(r.message)} />
        ))}
    </div>
  );
}
