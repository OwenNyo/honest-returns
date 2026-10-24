import type { KeyboardEvent } from 'react';

export type Tab = 'sample' | 'file';

// Spec 15.1.5: Sample and Your file; Your file is disabled until a file has been chosen.
export function ResultTabs({ tab, fileEnabled, onChange }: { tab: Tab; fileEnabled: boolean; onChange: (t: Tab) => void }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next: Tab = tab === 'sample' ? 'file' : 'sample';
    if (next === 'file' && !fileEnabled) return;
    e.preventDefault();
    onChange(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  const button = (t: Tab, text: string, disabled = false) => (
    <button
      type="button"
      role="tab"
      id={`tab-${t}`}
      className="tab"
      aria-selected={tab === t}
      aria-controls="analyse-panel"
      tabIndex={tab === t ? 0 : -1}
      disabled={disabled}
      onClick={() => onChange(t)}
    >
      {text}
    </button>
  );
  return (
    <div role="tablist" aria-label="Result" className="tabs" onKeyDown={onKeyDown}>
      {button('sample', 'Sample')}
      {button('file', 'Your file', !fileEnabled)}
    </div>
  );
}
