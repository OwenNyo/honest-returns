import { useId, useState } from 'react';
import type { InputFile } from './combine';

// Shared by the file input and the drop zone.
const readFiles = (files: File[]): Promise<InputFile[]> => Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));

// A file input styled as a button (spec 10.2). On phones it opens Files, iCloud or Drive.
// Spec 15.4.1: several files at once; `label` tells replace ("Choose another file") from add.
export function Upload({ onFiles, label, secondary = false }: { onFiles: (files: InputFile[]) => void; label: string; secondary?: boolean }) {
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
          if (chosen.length) onFiles(await readFiles(chosen));
        }}
      />
      <label htmlFor={id} className={secondary ? 'button secondary' : 'button'}>
        {label}
      </label>
    </div>
  );
}

// Drop target around the upload control; the file input inside stays the keyboard path.
export function DropZone({ onFiles }: { onFiles: (files: InputFile[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={over ? 'dropzone over' : 'dropzone'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const dropped = [...e.dataTransfer.files];
        if (dropped.length) onFiles(await readFiles(dropped));
      }}
    >
      <p>Drop your file here</p>
      <Upload onFiles={onFiles} label="Choose a file" />
    </div>
  );
}
