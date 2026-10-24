import type { ReactNode } from 'react';

// Spec 15.1.4: a heading, prose left and rows or a figure right from 960 px. Shared by Home and Methodology.
export function Scene({ id, title, rows, children }: { id?: string; title: string; rows?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scene">
      <h2>{title}</h2>
      <div className="scene-prose">{children}</div>
      {rows && <div className="rows">{rows}</div>}
    </section>
  );
}
