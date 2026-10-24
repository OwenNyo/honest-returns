import { useId } from 'react';

// A file input styled as a button (spec 10.2). On phones it opens Files, iCloud or Drive.
export function Upload({ onFile }: { onFile: (name: string, text: string) => void }) {
  const id = useId();
  return (
    <div className="upload">
      <input
        id={id}
        className="visually-hidden"
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // so choosing the same file again still fires
          if (file) onFile(file.name, await file.text());
        }}
      />
      <label htmlFor={id} className="button">
        Check your own broker file
      </label>
    </div>
  );
}
