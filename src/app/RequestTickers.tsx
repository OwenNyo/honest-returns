import { useEffect, useRef, useState } from 'react';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// The day and month are joined by a non-breaking space, so the date never wraps between them.
const longDate = (d: string) => `${Number(d.slice(8, 10))}\u00a0${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

type Outcome = { messages: string[]; retry: boolean };

// Spec 19.9: re-run the upload when any ticker loaded; otherwise one sentence per status, in this order, each its own
// paragraph. retry: a queued ticker may load if the user asks again; not_found and limit_reached will not.
export function requestOutcome(body: {
  results: { ticker: string; status: string }[];
  availableFrom: string | null;
}): { rerun: true } | Outcome {
  if (body.results.some((r) => r.status === 'added' || r.status === 'already_available')) return { rerun: true };
  const list = (status: string) => body.results.filter((r) => r.status === status).map((r) => r.ticker).join(', ');
  const sentences = [
    list('not_found') && `Tiingo, our price source, has no prices for ${list('not_found')}. Tickers listed outside the US are not covered.`,
    list('queued') && `Prices for ${list('queued')} could not be loaded right now. Try again in an hour.`,
    list('limit_reached') && body.availableFrom && `Ticker request limit reached. Requests open again on ${longDate(body.availableFrom)}.`,
  ];
  return { messages: sentences.filter((m): m is string => !!m), retry: !!list('queued') };
}

// Spec 10.8 and 19.9: a button under an unsupported_tickers rejection. A loaded ticker re-runs the upload through onLoaded.
export function RequestTickers({ tickers, onLoaded }: { tickers: string[]; onLoaded: () => void }) {
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Focus moves to the message when it appears or changes, so keyboard and screen reader users are not left on a
  // button that was removed.
  const message = useRef<HTMLDivElement>(null);
  useEffect(() => {
    message.current?.focus();
  }, [outcome]);
  async function send() {
    setSending(true);
    try {
      const res = await fetch('/api/ticker-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) throw new Error(`/api/ticker-requests answered HTTP ${res.status}`);
      const out = requestOutcome(await res.json());
      if ('rerun' in out) {
        onLoaded();
        return;
      }
      setOutcome(out);
    } catch (e) {
      console.error(e);
      setOutcome({ messages: ['The request could not be sent. Try again in a minute.'], retry: true });
    }
    setSending(false);
  }
  // After a queued answer or a failed POST the button stays under the message, stepped down to secondary.
  return (
    <>
      {outcome && (
        <div role="status" tabIndex={-1} ref={message}>
          {outcome.messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {(!outcome || outcome.retry) && (
        <button type="button" className={outcome ? 'button secondary' : 'button'} disabled={sending} onClick={send}>
          {sending ? 'Requesting.' : 'Request these tickers'}
        </button>
      )}
    </>
  );
}
