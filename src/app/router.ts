import { createElement, type MouseEvent, type ReactNode, useSyncExternalStore } from 'react';

// Spec 15.1.1: three fixed paths, so a hand-rolled switch instead of a router library.
const NAVIGATE = 'navigate';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname, () => '/');

// Scrolls to the element named by the hash, else to the top. Also called after a route renders (App).
export function scrollToHash(hash: string) {
  const el = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  if (el) el.scrollIntoView();
  else window.scrollTo(0, 0);
}

export function navigate(to: string) {
  history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE));
  const i = to.indexOf('#');
  scrollToHash(i < 0 ? '' : to.slice(i));
}

type LinkProps = { href: string; children: ReactNode; className?: string; 'aria-current'?: 'page'; 'aria-label'?: string };

// A plain <a href>; a primary click without modifier keys on a same-origin link is handled in the page.
export function Link(props: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.currentTarget.origin !== location.origin) return;
    e.preventDefault();
    navigate(props.href);
  };
  return createElement('a', { ...props, onClick });
}
