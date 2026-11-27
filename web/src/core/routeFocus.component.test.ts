// @vitest-environment happy-dom
import { act, createElement as h, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, Link, Navigate, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { noteSignedIn, resetRouteFocusForTests, useRouteFocus } from './routeFocus';

// E16-15: after a change of page without a page load, the focus goes to the new page's heading, so a
// screen reader says where the person is; not on the first page of a load, and not when the new page
// put the focus somewhere itself.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

function Layout({ children }: { children: React.ReactNode }) {
  const main = useRef<HTMLElement>(null);
  useRouteFocus(main);
  return h('div', null,
    h('nav', null, h(Link, { to: '/tickets', id: 'to-tickets' }, 'Tickets'), h(Link, { to: '/search', id: 'to-search' }, 'Search')),
    h('main', { ref: main }, children));
}

function Search() {
  return h('div', null, h('h1', null, 'Search'), h('input', { id: 'box', autoFocus: true, 'aria-label': 'Find' }));
}

let root: Root | null = null;
let el: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); el?.remove(); root = null; });

async function start(path = '/') {
  const router = createMemoryRouter([
    { path: '/', element: h(Layout, null, h('h1', null, 'Overview')) },
    { path: '/tickets', element: h(Layout, null, h('h1', null, 'Tickets')) },
    { path: '/search', element: h(Layout, null, h(Search)) },
    // An old address that moved (E43-13): replaced at once by its new one.
    { path: '/old', element: h(Layout, null, h(Navigate, { replace: true, to: '/tickets' })) },
  ], { initialEntries: [path] });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(h(RouterProvider, { router })); });
  await wait(200);
  return router;
}

describe('useRouteFocus', () => {

  it('leaves the focus alone on the first page of a load', async () => {
    await start('/');
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
  });

  it('moves the focus to the new page heading after a link in the navigation is used', async () => {
    const router = await start('/');
    (document.getElementById('to-tickets') as HTMLElement).focus();
    await act(async () => { await router.navigate('/tickets'); });
    await wait(300);
    const focused = document.activeElement as HTMLElement;
    expect(focused.tagName).toBe('H1');
    expect(focused.textContent).toBe('Tickets');
    expect(focused.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps the focus where the new page put it', async () => {
    const router = await start('/');
    await act(async () => { await router.navigate('/search'); });
    await wait(300);
    expect((document.activeElement as HTMLElement).id).toBe('box');
  });

  it('moves the focus on the first page after signing in on the form', async () => {
    noteSignedIn();
    await start('/tickets');
    expect((document.activeElement as HTMLElement).textContent).toBe('Tickets');
  });

  // Last: a page load that starts at another address leaves the module state of an earlier load behind.
  it('treats an old address that redirects at once as the page load: the focus stays at the top', async () => {
    resetRouteFocusForTests();
    const router = await start('/old');
    expect(router.state.location.pathname).toBe('/tickets');
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
  });
});
