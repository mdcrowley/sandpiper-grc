// Component tests of the generic list, form and record page (E18-43). Only test files import this.
// Each test file that uses it runs in a browser-like document (`// @vitest-environment happy-dom`,
// the happy-dom development package) and renders a component inside the application's own
// providers (Mantine, router, sign-in state, metadata) against a stand-in server: `fetch` answers
// from handlers given by the test, and every call is recorded.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth';
import { UiProvider } from './mantine';
import { MetaProvider, type Meta } from './meta';
import { ToastProvider } from './overlay';
import { UnsavedChangesHost } from './unsaved';

/** One recorded request. */
export interface Call { method: string; path: string; query: URLSearchParams; body: unknown }

/** A stand-in route: answers a request whose method and path match, `null` passes it on. */
export type Handler = (call: Call) => unknown | Promise<unknown>;
export interface Reply { status: number; body: unknown }
export const reply = (status: number, body: unknown): Reply => ({ status, body });
const isReply = (v: unknown): v is Reply => !!v && typeof v === 'object' && 'status' in v && 'body' in v && Object.keys(v as object).length === 2;

export interface Harness {
  container: HTMLElement;
  calls: Call[];
  /** The router's current address (path and query). */
  location: () => string;
  unmount: () => void;
}

const signedIn = (permissions: string[]) => ({
  appName: 'Sandpiper GRC', timeZone: 'America/New_York', currency: 'USD', setupRequired: false, pilot: false,
  user: { id: '00000000-0000-4000-8000-000000000001', username: 'pat', displayName: 'Pat Example', email: 'pat@example.test' },
  permissions, features: {}, areasOff: [],
});

/** Answers the calls every signed-in screen makes, unless a test handles them itself. */
function defaults(meta: Meta, permissions: string[]): Record<string, Handler> {
  return {
    'GET /api/auth/state': () => signedIn(permissions),
    'GET /api/meta': () => meta,
    'GET /api/views': () => [],
    'GET /api/comments': () => [],
    'GET /api/links': () => [],
    'GET /api/history': () => [],
    'GET /api/tags': () => [],
    'GET /api/watchers': () => ({ watching: false, count: 0, watchers: [] }),
  };
}

let lastLocation = '';
function LocationProbe() {
  const loc = useLocation();
  lastLocation = `${loc.pathname}${loc.search}`;
  return null;
}

/**
 * Renders `ui` at `route` (the page address) with `routePattern` as its route. `handlers` are keyed
 * `"METHOD /api/path"` (no query); preferences are kept in memory.
 */
export async function render(ui: ReactNode, opts: {
  meta: Meta; route?: string; routePattern?: string; permissions?: string[]; handlers?: Record<string, Handler>;
}): Promise<Harness> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const calls: Call[] = [];
  const prefs = new Map<string, unknown>();
  const routes: Record<string, Handler> = { ...defaults(opts.meta, opts.permissions ?? ['*']), ...opts.handlers };
  const fetchStub = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const call: Call = { method, path: url.pathname, query: url.searchParams, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    let result: unknown;
    const pref = /^\/api\/me\/preferences\/(.+)$/.exec(url.pathname);
    if (pref) {
      if (method === 'PUT') prefs.set(pref[1], (call.body as { value?: unknown })?.value ?? call.body);
      result = { value: prefs.get(pref[1]) ?? null };
    } else {
      const handler = routes[`${method} ${url.pathname}`];
      result = handler ? await handler(call) : reply(404, { error: { code: 'not_found', message: `No stand-in for ${method} ${url.pathname}` } });
    }
    const { status, body } = isReply(result) ? result : { status: 200, body: result };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  globalThis.fetch = fetchStub as typeof fetch;

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <UiProvider>
        <RouterProvider router={createMemoryRouter([{
          path: '*',
          element: (
            <ToastProvider>
              <AuthProvider>
                <UnsavedChangesHost />
                <MetaProvider>
                  <LocationProbe />
                  <Routes><Route path={opts.routePattern ?? '*'} element={ui} /></Routes>
                </MetaProvider>
              </AuthProvider>
            </ToastProvider>
          ),
        }], { initialEntries: [opts.route ?? '/'] })} />
      </UiProvider>,
    );
  });
  return {
    container, calls,
    location: () => lastLocation,
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
}

/** Lets effects, timers and stand-in answers run until `check` passes (or fails after `ms`). */
export async function waitFor(check: () => void, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() > until) throw err;
      await act(() => new Promise((r) => setTimeout(r, 15)));
    }
  }
}

/** The visible text of an element, with runs of white space made single. */
export const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Clicks an element as a person would (pointer and mouse events, then click). */
export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('Nothing to click.');
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    (el as HTMLElement).click();
  });
}

/** Types into a text box (React reads the value through the element's own setter). */
export async function typeInto(input: Element | null | undefined, value: string): Promise<void> {
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) throw new Error('Not a text box.');
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The first element matching `selector` whose text includes `text`. */
export function byText(root: ParentNode, selector: string, text: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(selector)].find((el) => textOf(el).includes(text)) ?? null;
}

/** The control a visible label names (through `for`, `aria-labelledby` or nesting). */
export function byLabel(root: ParentNode, label: string): HTMLElement | null {
  for (const l of root.querySelectorAll('label')) {
    if (!textOf(l).replace(/\s*\*$/, '').startsWith(label)) continue;
    const id = l.getAttribute('for');
    const found = (id && (l.ownerDocument.getElementById(id) as HTMLElement | null)) || l.querySelector<HTMLElement>('input, textarea, select');
    if (found) return found;
  }
  return root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}
