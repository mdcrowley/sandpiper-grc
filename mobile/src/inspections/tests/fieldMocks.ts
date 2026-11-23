// Test doubles for the field work screens (wave 15): the offline module (package, outbox, drafts in
// memory) and the photo helpers. Each test file declares
// `jest.mock('../../offline', () => require('../../inspections/tests/fieldMocks').offlineMock())`.
import type { OutboxItem } from '../../offline/types';

export const field = {
  pkg: null as unknown,
  added: [] as unknown[][],
  items: [] as OutboxItem[],
  drafts: new Map<string, unknown>(),
  removed: [] as string[],
  sent: 0,
  reset() {
    this.pkg = null; this.added = []; this.items = []; this.drafts = new Map(); this.removed = []; this.sent = 0;
  },
};

export function offlineMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = jest.requireActual('../../offline/package');
  return {
    packageList: real.packageList,
    packageSites: real.packageSites,
    useOfflinePackage: () => field.pkg,
    useOutbox: () => field.items,
    offlinePackage: () => ({ refresh: jest.fn(async () => field.pkg), current: async () => field.pkg }),
    sendNow: jest.fn(() => { field.sent += 1; }),
    outbox: () => ({
      add: jest.fn(async (entries: { id?: string }[]) => {
        field.added.push(entries);
        return entries.map((e, n) => ({ ...e, id: e.id ?? `auto-${n}` }));
      }),
    }),
    orOffline: async (fromServer: () => Promise<unknown>, fromPackage: (p: unknown) => unknown) => {
      try { return await fromServer(); } catch (e) { const v = field.pkg ? fromPackage(field.pkg) : null; if (v) return v; throw e; }
    },
    drafts: () => ({
      get: async (k: string) => field.drafts.get(k) ?? null,
      set: async (k: string, v: unknown) => { field.drafts.set(k, JSON.parse(JSON.stringify(v))); },
      remove: async (k: string) => { field.drafts.delete(k); field.removed.push(k); },
      keys: async (prefix: string) => [...field.drafts.keys()].filter((k) => k.startsWith(prefix)),
      keepFile: async (folder: string, _uri: string, name: string) => `file:///drafts/${folder}/${name}`,
      dropFile: async () => {},
      dropFolder: async () => {},
      writeFile: async (folder: string, name: string) => `file:///drafts/${folder}/${name}`,
    }),
  };
}

export function photosMock() {
  return {
    attachmentLimits: jest.fn(async () => ({ maxBytes: 5_000_000, allowedExtensions: ['jpg'] })),
    fitPhoto: jest.fn(async (uri: string) => ({ uri: `${uri}.fitted.jpg`, bytes: 1000 })),
    photoName: (_d: Date, n: number) => `photo-${n}.jpg`,
    PhotoError: class extends Error {},
  };
}
