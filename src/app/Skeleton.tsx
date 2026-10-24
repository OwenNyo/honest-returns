// Spec 15.1.3: blocks in the Hero's shape while prices load. No shimmer.
export function Skeleton() {
  return (
    <section className="hero skeleton" aria-busy="true">
      <span className="visually-hidden">Loading prices.</span>
      <div className="hero-main" aria-hidden="true">
        <div className="sk sk-title" />
        <div className="rates">
          <div className="sk sk-rate" />
          <div className="sk sk-rate" />
        </div>
        <div className="sk sk-line" />
      </div>
      <div className="hero-side" aria-hidden="true">
        <div className="sk sk-chart" />
      </div>
    </section>
  );
}
