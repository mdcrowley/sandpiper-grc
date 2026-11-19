// Where each person's Overview layout is kept: on the server as the preference
// `overview.layout` (GET/PUT /api/me/preferences/:key), so it follows the person to any
// browser, with a copy in this browser's localStorage. The copy draws the page at once, before
// the server answers, and stands in when the server has no preferences service.
import { api, ApiError } from '../../core/api';

export const PREFERENCE_KEY = 'overview.layout';

export interface OverviewLayout {
  /** Widget ids in the order the person chose. May hold ids this build no longer has. */
  order: string[];
  /** Widget ids the person switched off. */
  hidden: string[];
}

export const EMPTY_LAYOUT: OverviewLayout = { order: [], hidden: [] };

const keyFor = (userId: string) => `grc.u.${userId}.overview`;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))] : [];

/** A stored value as a layout; anything unreadable gives the empty layout. */
export function parseLayout(value: unknown): OverviewLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_LAYOUT;
  const v = value as Partial<OverviewLayout>;
  return { order: strings(v.order), hidden: strings(v.hidden) };
}

/** The copy kept in this browser, or an empty layout when there is none. Synchronous, for the first render. */
export function loadLayout(userId: string): OverviewLayout {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    return raw ? parseLayout(JSON.parse(raw)) : EMPTY_LAYOUT;
  } catch {
    return EMPTY_LAYOUT;
  }
}

/**
 * The layout saved on the server, which then also becomes this browser's copy. Undefined when
 * the server cannot say (no preferences service, or offline): keep the browser's copy then.
 */
export async function fetchLayout(userId: string): Promise<OverviewLayout | undefined> {
  try {
    const res = await api.get<{ value: unknown }>(`/api/me/preferences/${PREFERENCE_KEY}`);
    const layout = parseLayout(res.value);
    if (res.value === null) clearLayout(userId);
    else saveLayout(userId, layout);
    return layout;
  } catch {
    return undefined;
  }
}

/**
 * Saves the layout (null: back to the default) on the server and in this browser. Says where it
 * was kept: 'server' (follows the person), 'browser' (this browser only) or 'none'.
 */
export async function storeLayout(userId: string, layout: OverviewLayout | null): Promise<'server' | 'browser' | 'none'> {
  const local = layout ? saveLayout(userId, layout) : (clearLayout(userId), true);
  try {
    await api.put(`/api/me/preferences/${PREFERENCE_KEY}`, { value: layout ? { order: strings(layout.order), hidden: strings(layout.hidden) } : null });
    return 'server';
  } catch (err) {
    if (err instanceof ApiError && err.status !== 404) console.warn('The Overview layout was not saved on the server.', err);
    return local ? 'browser' : 'none';
  }
}

/** Returns false when the browser refused to store it (private window, storage full). */
export function saveLayout(userId: string, layout: OverviewLayout): boolean {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify({ order: strings(layout.order), hidden: strings(layout.hidden) }));
    return true;
  } catch {
    return false;
  }
}

export function clearLayout(userId: string): void {
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/**
 * The order to show: the saved order, without ids that no longer exist, and with every widget
 * the saved order does not mention put back at its default position (straight after the
 * nearest earlier default widget).
 */
export function resolveOrder(saved: string[], defaults: string[]): string[] {
  const known = new Set(defaults);
  const out = saved.filter((id, i) => known.has(id) && saved.indexOf(id) === i);
  defaults.forEach((id, index) => {
    if (out.includes(id)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i--) {
      const before = out.indexOf(defaults[i]);
      if (before >= 0) { at = before + 1; break; }
    }
    out.splice(at, 0, id);
  });
  return out;
}
