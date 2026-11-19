// Ready-made saved views, added once per browser to a list's View menu (the core keeps saved
// views in localStorage under grc.views.<type>). People can then rename or delete them.
export interface StarterView { name: string; filters: Record<string, string>; labels?: Record<string, string>; sort?: string; dir?: 'asc' | 'desc' }

export function ensureStarterViews(type: string, starters: StarterView[], version = '1'): void {
  const key = `grc.views.${type}`;
  try {
    if (localStorage.getItem(`${key}.starter`) === version) return;
    const existing: { name: string }[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    const added = starters.filter((s) => !existing.some((e) => e.name === s.name)).map((s) => ({
      name: s.name,
      view: {
        q: '', sort: s.sort ?? '', dir: s.dir ?? 'asc',
        filters: Object.fromEntries(Object.entries(s.filters).map(([k, v]) => [k, v.split(',')])),
        labels: s.labels ?? {},
      },
    }));
    localStorage.setItem(key, JSON.stringify([...existing, ...added]));
    localStorage.setItem(`${key}.starter`, version);
  } catch {
    // Storage unavailable: the tiles above the list lead to the same records.
  }
}
