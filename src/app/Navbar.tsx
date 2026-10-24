import { Link } from './router';

export const REPO_URL = 'https://github.com/OwenNyo/honest-returns';

// Spec 15.1.2 and UI decision 5: the brand is the home link; then Analyse, Methodology, GitHub.
export function Navbar({ path }: { path: string }) {
  const item = (href: string, text: string) => (
    <Link href={href} className="nav-item" aria-current={path === href ? 'page' : undefined}>
      {text}
    </Link>
  );
  return (
    <header className="navbar">
      <Link href="/" className="brand">
        Honest Returns
      </Link>
      <nav aria-label="Main">
        {item('/analyse', 'Analyse')}
        {item('/methodology', 'Methodology')}
        <a href={REPO_URL} className="nav-item">
          GitHub
        </a>
      </nav>
    </header>
  );
}
