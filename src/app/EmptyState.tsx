// Spec 15.1.3: shown when /api/prices answers asOf null. No upload: it would fail with prices_not_loaded.
export function EmptyState() {
  return (
    <section className="empty-state">
      <h1 className="hero-title">Prices are not loaded yet</h1>
      <p className="lede">
        Prices load every night after the US market closes, between 6 am and 3 pm Singapore time. Come back after 3 pm
        Singapore time to see the numbers.
      </p>
    </section>
  );
}
