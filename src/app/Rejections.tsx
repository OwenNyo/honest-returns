import type { Rejection } from '../engine/types';

// Spec 10.2: one line per rejection, file-level ones without the line prefix.
export function Rejections({ rejected }: { rejected: Rejection[] }) {
  return (
    <div className="rejections" role="alert">
      <ul>
        {rejected.map((r, i) => (
          <li key={i}>{r.line === null ? r.message : `Line ${r.line}: ${r.message}`}</li>
        ))}
      </ul>
      <p>No results were calculated.</p>
    </div>
  );
}
