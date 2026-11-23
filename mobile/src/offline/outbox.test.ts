// The outbox (E38-10): sent once, in order; a lost answer is sent again with the same id and the
// server answers from memory; refusals wait under Needs attention with the server's reason; nothing
// is dropped without the person's choice; signing out wipes it. Also the offline package's expiry and
// how reports are saved in the outbox.
import type { MobilePackage, SyncAnswer, SyncItem } from '../../../shared/mobile-api.ts';
import { reportItems, reportViews } from '../camera/reports';
import { KEEP_DONE_MS, Outbox } from './outbox';
import { PackageCache, packageList, packageSites, REFRESH_AFTER_MS } from './package';
import type { OutboxItem, OutboxStore, OutboxTransport, PackageStore } from './types';

jest.mock('../api/client', () => {
  class ApiError extends Error {
    status: number; code: string; fields: Record<string, string>;
    constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) { super(message); this.status = status; this.code = code; this.fields = fields; }
  }
  return { ApiError };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApiError } = require('../api/client') as { ApiError: new (s: number, c: string, m: string) => Error };

/** The phone's storage, in memory (it survives "restarts": a new Outbox on the same store). */
function memoryStore(): OutboxStore & { rows: Map<string, OutboxItem>; files: Set<string>; wiped: number } {
  const s = {
    rows: new Map<string, OutboxItem>(), files: new Set<string>(), wiped: 0,
    async all() { return [...s.rows.values()].map((r) => JSON.parse(JSON.stringify(r))); },
    async put(items: OutboxItem[]) { for (const i of items) s.rows.set(i.id, JSON.parse(JSON.stringify(i))); },
    async remove(ids: string[]) { for (const id of ids) s.rows.delete(id); },
    async keepFile(group: string, _uri: string, name: string) { const f = `file:///offline/${group}/${name}`; s.files.add(f); return f; },
    async dropFile(uri: string) { s.files.delete(uri); },
    async wipe() { s.rows.clear(); s.files.clear(); s.wiped++; },
  };
  return s;
}

/**
 * A server that keeps answers by id, as POST /api/mobile/sync does: an item seen before is answered
 * from memory. `lose` drops the next answer on the way back (the connection broke after the server did it).
 */
function fakeServer() {
  const srv = {
    records: [] as { id: string; title: string }[],
    photos: [] as { record: string; name: string }[],
    answers: new Map<string, SyncAnswer>(),
    batches: [] as string[][],
    lose: 0,
    offline: false,
    refuse: null as null | ((i: SyncItem) => SyncAnswer['error'] | 'retry' | null),
  };
  const finish = (answers: SyncAnswer[]) => {
    if (srv.lose > 0) { srv.lose--; throw new ApiError(0, 'offline', 'The server cannot be reached.'); }
    return answers;
  };
  const transport: OutboxTransport = {
    async sync(items) {
      if (srv.offline) throw new ApiError(0, 'offline', 'The server cannot be reached.');
      srv.batches.push(items.map((i) => i.clientId));
      const out: SyncAnswer[] = [];
      let stop = false;
      for (const i of items) {
        if (stop) { out.push({ clientId: i.clientId, status: 'retry', error: { code: 'not_tried', message: 'later' } }); continue; }
        const known = srv.answers.get(i.clientId);
        if (known) { out.push({ ...known, replayed: true }); continue; }
        const r = srv.refuse?.(i);
        if (r === 'retry') { out.push({ clientId: i.clientId, status: 'retry', error: { code: 'idempotency_in_progress', message: 'busy' } }); stop = true; continue; }
        if (r) { out.push({ clientId: i.clientId, status: 'rejected', error: r }); continue; }
        const rec = { id: `rec-${srv.records.length + 1}`, title: String((i.payload as { body: { title: string } }).body.title) };
        srv.records.push(rec);
        const a: SyncAnswer = { clientId: i.clientId, status: 'done', result: { recordType: 'ticket', id: rec.id, ref: `TKT-0000${srv.records.length}` } };
        srv.answers.set(i.clientId, a);
        out.push(a);
      }
      return finish(out);
    },
    async upload(item) {
      if (srv.offline) throw new ApiError(0, 'offline', 'The server cannot be reached.');
      const known = srv.answers.get(item.id);
      if (known) return finish([{ ...known, replayed: true }])[0];
      const parent = srv.answers.get(String(item.payload.parent ?? item.dependsOn));
      if (!parent?.result?.id) return { clientId: item.id, status: 'rejected', error: { code: 'parent_missing', message: 'The report has not arrived.' } };
      srv.photos.push({ record: parent.result.id, name: String(item.payload.name) });
      const a: SyncAnswer = { clientId: item.id, status: 'done', result: { recordType: 'ticket', id: parent.result.id, attachmentId: `att-${srv.photos.length}` } };
      srv.answers.set(item.id, a);
      return finish([a])[0];
    },
  };
  return { srv, transport };
}

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const report = (title: string, photos = 0) => reportItems(
  { kind: 'problem', path: '/api/tickets', recordType: 'ticket', body: { title }, title },
  Array.from({ length: photos }, (_, i) => ({ uri: `file:///cache/p${i + 1}.jpg`, name: `photo-${i + 1}.jpg` })),
);

describe('the outbox', () => {
  it('sends in order: reports in one batch, each photo after its report, and forgets the files once sent', async () => {
    const store = memoryStore();
    const { srv, transport } = fakeServer();
    const box = new Outbox(store, transport, { newId });
    await box.add(report('Leaking pump', 2));
    await box.add(report('Broken door'));
    expect(store.files.size).toBe(2);
    expect(await box.unsent()).toBe(2);
    expect(await box.process()).toBe('idle');
    // The first report alone (a photo follows it), then its photos, then the next report.
    expect(srv.records.map((r) => r.title)).toEqual(['Leaking pump', 'Broken door']);
    expect(srv.photos).toEqual([{ record: 'rec-1', name: 'photo-1.jpg' }, { record: 'rec-1', name: 'photo-2.jpg' }]);
    expect((await box.list()).every((i) => i.state === 'done')).toBe(true);
    expect(store.files.size).toBe(0);
    expect(await box.unsent()).toBe(0);
  });

  it('a lost answer is sent again with the same id and arrives once', async () => {
    const store = memoryStore();
    const { srv, transport } = fakeServer();
    const box = new Outbox(store, transport, { newId });
    await box.add(report('Cracked step', 1));
    srv.lose = 1; // the server made the report, the answer never came back
    expect(await box.process()).toBe('offline');
    expect((await box.list())[0]).toMatchObject({ state: 'pending', error: { code: 'offline' } });
    expect(srv.records).toHaveLength(1);
    // The app closes and opens again: a new outbox on the same storage.
    const again = new Outbox(store, transport, { newId });
    srv.lose = 0;
    await again.process();
    expect(srv.records).toHaveLength(1);
    expect(srv.photos).toHaveLength(1);
    expect(srv.batches[0]).toEqual(srv.batches[1]);
    expect((await again.list()).map((i) => i.state)).toEqual(['done', 'done']);
    // A photo whose answer was lost is attached once too.
    await again.add(report('Second', 1));
    await again.process();
    expect(srv.photos).toHaveLength(2);
  });

  it('waits without a connection, and sends on its own once there is one', async () => {
    const { srv, transport } = fakeServer();
    let online = false;
    const box = new Outbox(memoryStore(), transport, { newId, online: async () => online });
    await box.add(report('Written in a tunnel', 2));
    expect(await box.process()).toBe('offline');
    expect(srv.batches).toHaveLength(0);
    expect((await box.list())[0].error?.code).toBe('offline');
    online = true;
    await box.process();
    expect(srv.records).toHaveLength(1);
    expect(srv.photos).toHaveLength(2);
  });

  it('an item stuck "sending" when the app stopped is sent again, never twice', async () => {
    const store = memoryStore();
    const { srv, transport } = fakeServer();
    const box = new Outbox(store, transport, { newId });
    const [r] = await box.add(report('Mid-send'));
    // The app was killed while the item was on its way, after the server had done it.
    await transport.sync([{ clientId: r.id, kind: r.kind, payload: r.payload }]);
    await store.put([{ ...(await store.all())[0], state: 'sending' }]);
    const after = new Outbox(store, transport, { newId });
    await after.process();
    expect(srv.records).toHaveLength(1);
    expect((await after.list())[0]).toMatchObject({ state: 'done', result: { id: 'rec-1' } });
  });

  it('stops when the server says to wait, keeping the order', async () => {
    const { srv, transport } = fakeServer();
    const box = new Outbox(memoryStore(), transport, { newId });
    await box.add(report('First'));
    await box.add(report('Second'));
    srv.refuse = (i) => ((i.payload as { body: { title: string } }).body.title === 'First' ? 'retry' : null);
    expect(await box.process()).toBe('waiting');
    expect(srv.records).toHaveLength(0);
    expect((await box.list()).map((i) => i.state)).toEqual(['pending', 'pending']);
    srv.refuse = null;
    await box.process();
    expect(srv.records.map((r) => r.title)).toEqual(['First', 'Second']);
  });

  it('keeps a refused report under Needs attention with the server\'s reason; its photos wait; others go on', async () => {
    const { srv, transport } = fakeServer();
    const box = new Outbox(memoryStore(), transport, { newId });
    const [refused] = await box.add(report('No permission', 1));
    await box.add(report('Allowed'));
    srv.refuse = (i) => ((i.payload as { body: { title: string } }).body.title === 'No permission'
      ? { code: 'forbidden', message: 'You do not have permission to do that.' } : null);
    await box.process();
    const attention = await box.needsAttention();
    expect(attention).toHaveLength(1);
    expect(attention[0]).toMatchObject({ id: refused.id, state: 'rejected', error: { code: 'forbidden', message: 'You do not have permission to do that.' } });
    expect(srv.records.map((r) => r.title)).toEqual(['Allowed']);
    const photo = (await box.list()).find((i) => i.kind === 'attachment')!;
    expect(photo.state).toBe('pending');
    expect(await box.unsent()).toBe(1);
    // Nothing is dropped: more runs leave it as it is.
    await box.process();
    expect(await box.needsAttention()).toHaveLength(1);
    // Permission is back: Send again (the same id: the server kept no answer for a refusal).
    srv.refuse = null;
    await box.retry(refused.id);
    await box.process();
    expect(srv.records.map((r) => r.title)).toEqual(['Allowed', 'No permission']);
    expect(srv.photos).toEqual([{ record: 'rec-2', name: 'photo-1.jpg' }]);
    expect(await box.unsent()).toBe(0);
  });

  it('"not sure it arrived" is sent again only as new work, and its photos follow the new id', async () => {
    const { srv, transport } = fakeServer();
    const box = new Outbox(memoryStore(), transport, { newId });
    const [r] = await box.add(report('Uncertain', 1));
    srv.refuse = () => ({ code: 'uncertain', message: 'The server stopped while doing this.' });
    await box.process();
    srv.refuse = null;
    await box.retry(r.id, { asNew: true });
    await box.process();
    const items = await box.list();
    expect(items[0].id).not.toBe(r.id);
    expect(items[1]).toMatchObject({ dependsOn: items[0].id, state: 'done' });
    expect(srv.records).toHaveLength(1);
  });

  it('discards only on the person\'s choice, with the photos; forgets sent work after a day', async () => {
    const store = memoryStore();
    const { srv, transport } = fakeServer();
    let now = new Date('2026-11-22T10:00:00Z');
    const box = new Outbox(store, transport, { newId, now: () => now });
    const [bad] = await box.add(report('Discard me', 2));
    srv.refuse = () => ({ code: 'validation', message: 'Check the highlighted fields.' });
    await box.process();
    await box.discard(bad.group);
    expect(await box.list()).toEqual([]);
    expect(store.files.size).toBe(0);
    srv.refuse = null;
    await box.add(report('Sent'));
    await box.process();
    await box.prune();
    expect(await box.list()).toHaveLength(1);
    now = new Date(now.getTime() + KEEP_DONE_MS + 1000);
    await box.prune();
    expect(await box.list()).toEqual([]);
  });

  it('wipes everything on sign-out', async () => {
    const store = memoryStore();
    const { transport } = fakeServer();
    const box = new Outbox(store, transport, { newId, online: async () => false });
    await box.add(report('Unsent', 1));
    expect(await box.unsent()).toBe(1);
    await box.wipe();
    expect(await box.list()).toEqual([]);
    expect(store.rows.size).toBe(0);
    expect(store.files.size).toBe(0);
    expect(await box.unsent()).toBe(0);
  });
});

describe('reports in the outbox', () => {
  it('a report is its record and its photos, shown as one', () => {
    const items = report('Pump', 2);
    expect(items.map((i) => [i.kind, i.dependsOn])).toEqual([['record.create', undefined], ['attachment', 0], ['attachment', 0]]);
    const at = '2026-11-22T10:00:00Z';
    const saved: OutboxItem[] = [
      { id: 'r1', seq: 1, kind: 'record.create', group: 'r1', label: 'Pump', payload: { ...items[0].payload }, file: null, dependsOn: null, state: 'done', attempts: 0, error: null, result: { ref: 'TKT-00009' }, createdAt: at, updatedAt: at },
      { id: 'p1', seq: 2, kind: 'attachment', group: 'r1', label: 'Photo 1', payload: { name: 'a.jpg', parent: 'r1' }, file: 'f', dependsOn: 'r1', state: 'done', attempts: 0, error: null, result: {}, createdAt: at, updatedAt: at },
      { id: 'p2', seq: 3, kind: 'attachment', group: 'r1', label: 'Photo 2', payload: { name: 'b.jpg', parent: 'r1' }, file: 'f', dependsOn: 'r1', state: 'pending', attempts: 0, error: { code: 'offline', message: 'Waiting for a connection.' }, result: null, createdAt: at, updatedAt: at },
    ];
    expect(reportViews(saved)).toEqual([expect.objectContaining({ group: 'r1', title: 'Pump', state: 'waiting', ref: 'TKT-00009', photos: 2, photosSent: 1 })]);
  });
});

describe('the offline package', () => {
  const pkg = (over: Partial<MobilePackage> = {}): MobilePackage => ({
    id: 'p', generatedAt: '2026-11-22T08:00:00Z', expiresAt: '2026-11-29T08:00:00Z', user: { id: 'u1', displayName: 'Pat' },
    work: { sections: [], unreadNotifications: 0, generatedAt: '2026-11-22T08:00:00Z' },
    lookups: { safety_event_type: [{ value: 'near_miss', label: 'Near miss' }] },
    sites: [{ value: 's1', label: 'North depot', ref: 'SITE-1' }, { value: 's2', label: 'South yard', ref: 'SITE-2' }],
    portal: null, attachments: { maxBytes: 1000, allowedExtensions: ['jpg'] }, tags: null, parts: {}, ...over,
  });
  const memory = (): PackageStore & { value: MobilePackage | null } => {
    const s = { value: null as MobilePackage | null, async get() { return s.value; }, async set(p: MobilePackage) { s.value = p; }, async clear() { s.value = null; } };
    return s;
  };

  it('is deleted when it expires, and is never another person\'s', async () => {
    const store = memory();
    let now = new Date('2026-11-23T08:00:00Z');
    const cache = new PackageCache(store, async () => pkg(), { now: () => now });
    await cache.refresh();
    expect((await cache.current('u1'))?.id).toBe('p');
    expect(await cache.current('someone-else')).toBeNull();
    expect(store.value).toBeNull();
    await cache.refresh();
    now = new Date('2026-11-29T08:00:01Z');
    expect(await cache.current('u1')).toBeNull();
    expect(store.value).toBeNull();
  });

  it('is downloaded again when old, and kept when the download fails', async () => {
    const store = memory();
    let now = new Date('2026-11-22T08:30:00Z');
    let fail = false;
    const fetcher = jest.fn(async () => { if (fail) throw new Error('offline'); return pkg({ generatedAt: now.toISOString() }); });
    const cache = new PackageCache(store, fetcher, { now: () => now });
    await cache.refreshIfStale('u1');
    await cache.refreshIfStale('u1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + REFRESH_AFTER_MS + 1);
    fail = true;
    await cache.refreshIfStale('u1');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await cache.current('u1')).not.toBeNull();
  });

  it('answers the forms offline', () => {
    expect(packageList(pkg(), 'safety_event_type')).toEqual([{ id: 'near_miss', label: 'Near miss' }]);
    expect(packageList(pkg(), 'missing')).toEqual([]);
    expect(packageSites(pkg(), 'north')).toEqual([{ id: 's1', label: 'North depot', ref: 'SITE-1' }]);
    expect(packageSites(pkg(), 'site-2')).toEqual([{ id: 's2', label: 'South yard', ref: 'SITE-2' }]);
    expect(packageSites(null, '')).toEqual([]);
  });
});
