import { FOOTNOTES } from './footnotes';

// Interim page (spec 15.1.1): footnotes a to c under the anchors the Hero links to. Task 14 replaces it.
export function Methodology() {
  return (
    <article className="prose">
      <h1 className="hero-title">Methodology</h1>
      <section id="flow-timing">
        <h2>TWR</h2>
        <p>{FOOTNOTES.a('start')}</p>
      </section>
      <section id="xirr">
        <h2>XIRR</h2>
        <p>{FOOTNOTES.b}</p>
      </section>
      <section id="prices">
        <h2>Prices and exchange rates</h2>
        <p>{FOOTNOTES.c}</p>
      </section>
    </article>
  );
}
