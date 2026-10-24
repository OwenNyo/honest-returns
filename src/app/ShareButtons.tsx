import { useState } from 'react';
import type { ComputeResult } from '../engine/types';
import { type CardSize, downloadCard, FONT_ERROR } from './shareCard';

// Spec 15.2: two downloads and the SGD option (off by default, not remembered).
export function ShareButtons({ result }: { result: ComputeResult & { ok: true } }) {
  const [includeSgd, setIncludeSgd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = (size: CardSize) => {
    setError(null);
    downloadCard(result, size, includeSgd).catch((e: Error) => {
      console.error(e);
      setError(e.message === FONT_ERROR ? FONT_ERROR : 'The image could not be drawn. Try again.');
    });
  };
  return (
    <div className="share">
      <label className="choice">
        <input type="checkbox" checked={includeSgd} onChange={(e) => setIncludeSgd(e.target.checked)} />
        Include SGD values
      </label>
      <div className="actions">
        <button type="button" className="button secondary" onClick={() => download('1200x630')}>
          Download image
        </button>
        <button type="button" className="button secondary" onClick={() => download('1080x1080')}>
          Download square image
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
