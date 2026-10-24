import type { ReactNode } from 'react';

// Spec 15.1.4: a heading, prose left and rows or a figure right from 960 px. Shared by Home, Analyse and Methodology.
// `below` spans both columns under them, for a chart.
export function Scene({ id, title, rows, below, children }: { id?: string; title: string; rows?: ReactNode; below?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scene">
      <h2>{title}</h2>
      <div className="scene-prose">{children}</div>
      {rows && <div className="rows">{rows}</div>}
      {below && <div className="scene-below">{below}</div>}
    </section>
  );
}
