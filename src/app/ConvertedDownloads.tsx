import type { Converted } from './combine';
import { saveBlob } from './shareCard';

export const NOTICES_NOTE = 'The notices above do not travel with the converted file.';
export const LINES_NOTE = 'Line numbers above count lines in your original file, not in the converted file.';

export const convertedName = (name: string) => `${name.replace(/\.[^.]*$/, '')}-converted.csv`;

// Spec 18.1.3: one button per IBKR or moomoo file, saving the importer's canonical CSV. Nothing for plain files.
export function ConvertedDownloads({ files, note }: { files: Converted[]; note: string | null }) {
  if (!files.length) return null;
  return (
    <div className="converted">
      <div className="actions">
        {files.map((f, i) => (
          <button
            key={i}
            type="button"
            className="button secondary"
            onClick={() => saveBlob(new Blob([f.csv], { type: 'text/csv;charset=utf-8' }), convertedName(f.name))}
          >
            {files.length > 1 ? `Download the converted ${f.name}` : 'Download the converted file'}
          </button>
        ))}
      </div>
      {note && <p className="saved-note">{note}</p>}
    </div>
  );
}
