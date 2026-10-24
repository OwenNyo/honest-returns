import { useId } from 'react';
import type { InputFile } from './combine';

// A file input styled as a button (spec 10.2). On phones it opens Files, iCloud or Drive.
// Spec 15.4.1: several files at once; `label` tells replace ("Check your own broker file") from add.
export function Upload({ onFiles, label = 'Check your own broker file', secondary = false }: { onFiles: (files: InputFile[]) => void; label?: string; secondary?: boolean }) {
  const id = useId();
  return (
    <div className="upload">
      <input
        id={id}
        className="visually-hidden"
        type="file"
        multiple
        accept=".csv,text/csv"
        onChange={async (e) => {
          const chosen = [...(e.target.files ?? [])];
          e.target.value = ''; // so choosing the same file again still fires
          if (chosen.length) onFiles(await Promise.all(chosen.map(async (f) => ({ name: f.name, text: await f.text() }))));
        }}
      />
      <label htmlFor={id} className={secondary ? 'button secondary' : 'button'}>
        {label}
      </label>
    </div>
  );
}
