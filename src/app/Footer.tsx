import { REPO_URL } from '../engine/constants';
import { Link } from './router';

// Spec 11c: a quiet footer on every page; the brand, the three links, and the data and charting credits.
export function Footer() {
  return (
    <footer className="footer">
      <p className="footer-brand">Honest Returns</p>
      <nav aria-label="Footer">
        <Link href="/analyse">Analyse</Link>
        <Link href="/methodology">Methodology</Link>
        <a href={REPO_URL}>GitHub</a>
      </nav>
      <p className="footer-credit">
        Prices from Tiingo. Rates from the ECB. Charting by <a href="https://www.tradingview.com/">TradingView</a>.
      </p>
    </footer>
  );
}
