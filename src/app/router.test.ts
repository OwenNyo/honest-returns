import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Link, navigate } from './router';

// Spec 15.1.1: hand-rolled router. Node has no DOM, so window, history, location and document are fakes.
let win: ReturnType<typeof fakeWindow>;

function fakeWindow() {
  const location = { pathname: '/', hash: '', origin: 'http://localhost', href: 'http://localhost/' };
  const target = { scrollIntoView: vi.fn() };
  const w = {
    location,
    history: { pushState: vi.fn() },
    dispatchEvent: vi.fn(() => true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    scrollTo: vi.fn(),
    target,
    document: { getElementById: vi.fn((id: string) => (id === 'xirr' ? target : null)) },
  };
  vi.stubGlobal('window', w);
  vi.stubGlobal('location', w.location);
  vi.stubGlobal('history', w.history);
  vi.stubGlobal('document', w.document);
  vi.stubGlobal('scrollTo', w.scrollTo);
  vi.stubGlobal('dispatchEvent', w.dispatchEvent);
  return w;
}

beforeEach(() => {
  win = fakeWindow();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const click = (over: Record<string, unknown> = {}) => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  preventDefault: vi.fn(),
  currentTarget: { href: 'http://localhost/analyse', origin: 'http://localhost', getAttribute: () => '/analyse' },
  ...over,
});
// Link is a plain <a href>; its onClick is called directly because there is no DOM to click in.
const linkTo = (href: string) => (Link as any)({ href, children: 'Analyse' });

test('navigate pushes the path onto the history', () => {
  navigate('/analyse');
  expect(win.history.pushState.mock.calls[0][2]).toBe('/analyse');
});

test('navigate dispatches an event so usePath re-renders', () => {
  navigate('/analyse');
  expect(win.dispatchEvent).toHaveBeenCalled();
});

test('navigate to a path with a hash scrolls to the element with that id', () => {
  navigate('/methodology#xirr');
  expect(win.target.scrollIntoView).toHaveBeenCalled();
});

test('navigate to a path without a hash scrolls to the top', () => {
  navigate('/analyse');
  expect(win.scrollTo).toHaveBeenCalled();
});

test('Link renders an <a> with the href', () => {
  const el = linkTo('/analyse');
  expect(el.type).toBe('a');
  expect(el.props.href).toBe('/analyse');
});

test('a plain primary click on Link is handled by navigate', () => {
  const e = click();
  linkTo('/analyse').props.onClick(e);
  expect(e.preventDefault).toHaveBeenCalled();
  expect(win.history.pushState).toHaveBeenCalled();
});

test.each([
  ['metaKey', { metaKey: true }],
  ['ctrlKey', { ctrlKey: true }],
  ['shiftKey', { shiftKey: true }],
  ['middle button', { button: 1 }],
])('a click with %s on Link is not intercepted', (_name, over) => {
  const e = click(over);
  linkTo('/analyse').props.onClick(e);
  expect(e.preventDefault).not.toHaveBeenCalled();
  expect(win.history.pushState).not.toHaveBeenCalled();
});
