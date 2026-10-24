import { useState } from 'react';
import { UNSUPPORTED_PREFIX } from './upload';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

// ponytail: the tickers are read back from our own unsupported_tickers message (upload.ts builds it),
// because the outcome shape is pinned by tests; carry them on the rejection if a second consumer appears.
export const unsupportedTickers = (message: string) => message.slice(UNSUPPORTED_PREFIX.length, -1).split(', ');

// Spec 10.8: a button under an unsupported_tickers rejection.
export function RequestTickers({ tickers }: { tickers: string[] }) {
  const [state, setState] = useState<'idle' | 'sending' | string>('idle');
  async function send() {
    setState('sending');
    try {
      const res = await fetch('/api/ticker-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      if (res.status === 429) return setState('This connection has sent too many requests today. Try again tomorrow.');
      if (!res.ok) throw new Error(`/api/ticker-requests answered HTTP ${res.status}`);
      const body = (await res.json()) as { results: { status: string }[]; availableFrom: string | null };
      setState(
        body.availableFrom
          ? `Monthly ticker limit reached. Requests open again on ${longDate(body.availableFrom)}.`
          : body.results.some((r) => r.status === 'list_full')
            ? 'The ticker list is full for now. More cannot be added until some are retired.'
            : 'Requested. New tickers usually load overnight.',
      );
    } catch (e) {
      console.error(e);
      setState('The request could not be sent. Try again in a minute.');
    }
  }
  if (state !== 'idle' && state !== 'sending') return <p role="status">{state}</p>;
  return (
    <button type="button" className="button" disabled={state === 'sending'} onClick={send}>
      Request these tickers
    </button>
  );
}
