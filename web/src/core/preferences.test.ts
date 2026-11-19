import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// preferences.ts keeps module state (what was read, whether the server has the service), so each
// test loads a fresh copy.
type Prefs = typeof import('./preferences');
async function fresh(): Promise<Prefs> {
  vi.resetModules();
  return import('./preferences');
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('the browser copy of preferences', () => {
  it('writes JSON, removes on null and falls back when unreadable', async () => {
    const p = await fresh();
    p.writeLocal('k', { a: 1 });
    expect(p.readLocal('k', null)).toEqual({ a: 1 });
    p.writeLocal('k', null);
    expect(localStorage.getItem('k')).toBeNull();
    expect(p.readLocal('k', 'fallback')).toBe('fallback');
    localStorage.setItem('bad', '{oops');
    expect(p.readLocal('bad', 7)).toBe(7);
  });

  it('works when storage is blocked', async () => {
    const p = await fresh();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(p.readLocal('k', 'x')).toBe('x');
    expect(() => p.writeLocal('k', 1)).not.toThrow();
  });
});

describe('preferences on the server', () => {
  it('reads every preference once and answers from memory', async () => {
    const p = await fresh();
    const fetch = vi.fn(async () => json(200, { 'list.density': 'compact' }));
    vi.stubGlobal('fetch', fetch);
    await p.loadPreferences();
    await p.loadPreferences();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(p.serverPreference('list.density')).toBe('compact');
    expect(p.serverPreference('missing')).toBeUndefined();
  });

  it('saves a value with PUT and forgets one set to null', async () => {
    const p = await fresh();
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url === '/api/me/preferences' ? json(200, {}) : new Response(null, { status: 204 });
    });
    await p.loadPreferences();
    expect(await p.savePreference('views:ticket', [{ name: 'Mine' }])).toBe(true);
    expect(p.serverPreference('views:ticket')).toEqual([{ name: 'Mine' }]);
    expect(calls[1]).toMatchObject({ url: '/api/me/preferences/views%3Aticket', init: { method: 'PUT', body: '{"value":[{"name":"Mine"}]}' } });
    expect(await p.savePreference('views:ticket', null)).toBe(true);
    expect(p.serverPreference('views:ticket')).toBeUndefined();
    expect(calls[2].init.body).toBe('{"value":null}');
  });

  it('stops asking a server that has no preferences service', async () => {
    const p = await fresh();
    const fetch = vi.fn(async () => json(404, { error: { code: 'not_found', message: 'Not found' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await p.loadPreferences()).toBeNull();
    expect(await p.savePreference('a', 1)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('tries again later after a failure other than "not found", and forgets on sign-out', async () => {
    const p = await fresh();
    let status = 500;
    vi.stubGlobal('fetch', async () => (status === 500 ? json(500, {}) : json(200, { a: 1 })));
    expect(await p.loadPreferences()).toBeNull();
    status = 200;
    expect(await p.loadPreferences()).toEqual({ a: 1 });
    p.resetPreferences();
    expect(p.serverPreference('a')).toBeUndefined();
  });
});
