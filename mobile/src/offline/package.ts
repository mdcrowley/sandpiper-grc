// The offline package on the phone (wave 14, E38-10; spec §5.6): what GET /api/mobile/package gave,
// kept in the app's protected storage until it expires (the administrator's "Days offline work is
// kept", default 7), the person signs out, or the device is signed out. An expired package is deleted
// the moment it is noticed; nothing outside the package is available offline.
import type { MobilePackage, PackageOption } from '../../../shared/mobile-api.ts';
import type { PackageStore } from './types';

/** A package older than this is downloaded again when there is a connection. */
export const REFRESH_AFTER_MS = 60 * 60_000;

export class PackageCache {
  private cached: MobilePackage | null | undefined = undefined;
  private listeners = new Set<(p: MobilePackage | null) => void>();
  private fetching: Promise<MobilePackage> | null = null;

  constructor(private store: PackageStore, private fetcher: () => Promise<MobilePackage>, private opts: { now?(): Date } = {}) {}

  private now(): number { return (this.opts.now?.() ?? new Date()).getTime(); }

  private emit(p: MobilePackage | null) { for (const l of this.listeners) l(p); }

  subscribe(fn: (p: MobilePackage | null) => void): () => void {
    this.listeners.add(fn);
    void this.current().then(fn, () => fn(null));
    return () => { this.listeners.delete(fn); };
  }

  /** The package, or null when there is none, it expired (then it is deleted) or it is another person's. */
  async current(userId?: string): Promise<MobilePackage | null> {
    if (this.cached === undefined) this.cached = await this.store.get().catch(() => null);
    const p = this.cached;
    if (!p) return null;
    if (Date.parse(p.expiresAt) <= this.now() || (userId && p.user.id !== userId)) {
      await this.clear();
      return null;
    }
    return p;
  }

  /** Downloads a new package and keeps it. */
  refresh(): Promise<MobilePackage> {
    this.fetching ??= this.fetcher().then(async (p) => {
      await this.store.set(p);
      this.cached = p;
      this.emit(p);
      return p;
    }).finally(() => { this.fetching = null; });
    return this.fetching;
  }

  /** Downloads again when there is none or it is older than REFRESH_AFTER_MS; a failure keeps the old one. */
  async refreshIfStale(userId?: string): Promise<void> {
    const p = await this.current(userId);
    if (p && this.now() - Date.parse(p.generatedAt) < REFRESH_AFTER_MS) return;
    await this.refresh().catch(() => undefined);
  }

  async clear(): Promise<void> {
    this.cached = null;
    await this.store.clear();
    this.emit(null);
  }
}

// ---------- what the forms read offline ----------

/** A list's choices from the package (empty when the package does not have it). */
export const packageList = (p: MobilePackage | null, list: string): { id: string; label: string }[] =>
  (p?.lookups[list] ?? []).map((o) => ({ id: o.value, label: o.label }));

/** Sites from the package matching typed words (as the server's record search would). */
export function packageSites(p: MobilePackage | null, q: string, limit = 25): { id: string; label: string; ref: string | null }[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (o: PackageOption) => words.every((w) => `${o.label} ${o.ref ?? ''}`.toLowerCase().includes(w));
  return (p?.sites ?? []).filter(match).slice(0, limit).map((o) => ({ id: o.value, label: o.label, ref: o.ref ?? null }));
}
