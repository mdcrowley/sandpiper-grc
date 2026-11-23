// The outbox (wave 14, E38-10; spec §5.6): work saved on the phone, sent to the server once, in order.
//
// - Every item has a UUID made when it was saved; it is the item's idempotency key on the server,
//   which remembers each answer for 7 days. So a send that loses its connection, times out or is cut
//   short by the app closing is simply sent again with the same id, and the server answers from memory:
//   nothing is ever done twice.
// - Items go in the order they were saved. An item that depends on another (a photo on the report it
//   belongs to) waits until that one is done. When the server says to wait (`retry`) or cannot be
//   reached, the run stops and starts again later (network back, app opened, every 30 seconds).
// - A refusal (`rejected`: the record was deleted, permission removed, a field not accepted) keeps the
//   item in "Needs attention" with the server's reason. Nothing is dropped silently: only the person
//   discards an item.
// - Pure logic; the stores and the transport are given (sqlite.ts, transport.ts; memory in tests).
import { SYNC_MAX_ITEMS, type SyncAnswer, type SyncItem } from '../../../shared/mobile-api.ts';
import { ApiError } from '../api/client';
import { isUpload } from './kinds';
import type { OutboxError, OutboxItem, OutboxStore, OutboxTransport } from './types';

/** A finished report (or other group) stays visible this long, so the person sees it arrived. */
export const KEEP_DONE_MS = 24 * 60 * 60_000;

export interface NewOutboxItem {
  /** Made by the outbox when not given. */
  id?: string;
  kind: string;
  label: string;
  payload: Record<string, unknown>;
  /** A file to keep with the item (copied into the protected folder). */
  file?: { uri: string; name: string };
  /** The index (in this call) or id of an item that must be done first. */
  dependsOn?: number | string;
}

export type RunOutcome = 'idle' | 'offline' | 'waiting' | 'busy';

export interface OutboxOptions {
  newId(): string;
  now?(): Date;
  /** Whether a connection is there at all (expo-network); the run does not start without one. */
  online?(): Promise<boolean>;
}

const copy = (items: OutboxItem[]) => items.map((i) => ({ ...i, payload: { ...i.payload }, error: i.error ? { ...i.error } : null, result: i.result ? { ...i.result } : null }));

const offlineError = (message?: string): OutboxError => ({ code: 'offline', message: message ?? 'Waiting for a connection. It is sent on its own.' });

export class Outbox {
  private items: OutboxItem[] = [];
  private loaded: Promise<void> | null = null;
  private running: Promise<RunOutcome> | null = null;
  private listeners = new Set<(items: OutboxItem[]) => void>();
  private seq = 0;

  constructor(private store: OutboxStore, private transport: OutboxTransport, private opts: OutboxOptions) {}

  private now(): Date { return this.opts.now?.() ?? new Date(); }

  private ready(): Promise<void> {
    this.loaded ??= this.store.all().then(async (all) => {
      // An item that was on its way when the app stopped is simply sent again (same id: never twice).
      const stuck = all.filter((i) => i.state === 'sending');
      for (const i of stuck) i.state = 'pending';
      if (stuck.length) await this.store.put(stuck);
      this.items = all.sort((a, b) => a.seq - b.seq);
      this.seq = Math.max(0, ...all.map((i) => i.seq));
    });
    return this.loaded;
  }

  private async save(changed: OutboxItem[]): Promise<void> {
    const at = this.now().toISOString();
    for (const i of changed) i.updatedAt = at;
    if (changed.length) await this.store.put(changed);
    this.emit();
  }

  private emit(): void {
    const view = copy(this.items);
    for (const l of this.listeners) l(view);
  }

  subscribe(fn: (items: OutboxItem[]) => void): () => void {
    this.listeners.add(fn);
    void this.ready().then(() => fn(copy(this.items)));
    return () => { this.listeners.delete(fn); };
  }

  async list(): Promise<OutboxItem[]> {
    await this.ready();
    return copy(this.items);
  }

  /** Groups (a report with its photos counts once) not yet fully sent: for the sign-out warning. */
  async unsent(): Promise<number> {
    await this.ready();
    return new Set(this.items.filter((i) => i.state !== 'done').map((i) => i.group)).size;
  }

  /** Items the server refused, waiting for the person. */
  async needsAttention(): Promise<OutboxItem[]> {
    await this.ready();
    return copy(this.items.filter((i) => i.state === 'rejected'));
  }

  /**
   * Saves work in the outbox (one group: the first item is the group). Files are copied into the
   * protected folder first, so the work is kept even if the originals go. Answers the saved items.
   */
  async add(entries: NewOutboxItem[]): Promise<OutboxItem[]> {
    await this.ready();
    if (!entries.length) return [];
    const at = this.now().toISOString();
    const ids = entries.map((e) => e.id ?? this.opts.newId());
    const group = ids[0];
    const made: OutboxItem[] = [];
    for (const [n, e] of entries.entries()) {
      const dependsOn = typeof e.dependsOn === 'number' ? ids[e.dependsOn] ?? null : e.dependsOn ?? null;
      const file = e.file ? await this.store.keepFile(group, e.file.uri, e.file.name) : null;
      made.push({
        id: ids[n], seq: ++this.seq, kind: e.kind, group, label: e.label, payload: e.payload, file, dependsOn,
        state: 'pending', attempts: 0, error: null, result: null, createdAt: at, updatedAt: at,
      });
    }
    this.items.push(...made);
    await this.save(made);
    return copy(made);
  }

  /** Sends what can be sent; one run at a time. Resolves when this run is over. */
  process(): Promise<RunOutcome> {
    if (this.running) return this.running.then(() => 'busy' as const);
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  /** Pending items whose dependency is done, in order. */
  private sendable(): OutboxItem[] {
    const done = new Set(this.items.filter((i) => i.state === 'done').map((i) => i.id));
    return this.items.filter((i) => i.state === 'pending' && (!i.dependsOn || done.has(i.dependsOn)));
  }

  private async run(): Promise<RunOutcome> {
    await this.ready();
    if (!this.sendable().length) return 'idle';
    if (this.opts.online && !(await this.opts.online())) {
      await this.markWaiting(this.sendable(), offlineError());
      return 'offline';
    }
    for (;;) {
      const next = this.sendable();
      if (!next.length) return 'idle';
      const batch = isUpload(next[0]) ? [next[0]] : next.slice(0, next.findIndex(isUpload) === -1 ? undefined : next.findIndex(isUpload)).slice(0, SYNC_MAX_ITEMS);
      for (const i of batch) i.state = 'sending';
      await this.save(batch);
      let answers: SyncAnswer[];
      try {
        answers = isUpload(batch[0])
          ? [await this.transport.upload(batch[0])]
          : await this.transport.sync(batch.map((i): SyncItem => ({ clientId: i.id, kind: i.kind, payload: i.payload })));
      } catch (e) {
        // Not answered: sent again later with the same ids, so it can never be done twice.
        const err = e instanceof ApiError ? e : null;
        const offline = !err || err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429;
        await this.markWaiting(batch, offline ? offlineError() : { code: err!.code, message: err!.message });
        return offline ? 'offline' : 'waiting';
      }
      const waiting = await this.apply(batch, answers);
      if (waiting) return 'waiting';
    }
  }

  private async markWaiting(items: OutboxItem[], error: OutboxError): Promise<void> {
    for (const i of items) { i.state = 'pending'; i.error = error; }
    await this.save(items);
  }

  /** Applies the server's answers; true when the server said to wait. */
  private async apply(batch: OutboxItem[], answers: SyncAnswer[]): Promise<boolean> {
    const byId = new Map(answers.map((a) => [a.clientId?.toLowerCase(), a]));
    let waiting = false;
    for (const item of batch) {
      const a = byId.get(item.id.toLowerCase());
      if (!a || a.status === 'retry') {
        item.state = 'pending';
        item.attempts += 1;
        item.error = a?.error && a.error.code !== 'not_tried' ? a.error : item.error;
        waiting = true;
      } else if (a.status === 'done') {
        item.state = 'done';
        item.result = a.result ?? {};
        item.error = null;
        if (item.file) { await this.store.dropFile(item.file).catch(() => undefined); item.file = null; }
      } else {
        item.state = 'rejected';
        item.attempts += 1;
        item.error = a.error ?? { code: 'rejected', message: 'The server did not accept this.' };
      }
    }
    await this.save(batch);
    return waiting;
  }

  /**
   * Sends a refused item again. `asNew` gives it a new id: for an item the server cannot be sure about
   * ("not sure it arrived") or one whose id was used for something else; the person chose to send it
   * as new work after checking. `payload` replaces what is sent (a corrected report).
   */
  async retry(id: string, opts: { asNew?: boolean; payload?: Record<string, unknown> } = {}): Promise<void> {
    await this.ready();
    const item = this.items.find((i) => i.id === id);
    if (!item || item.state !== 'rejected') return;
    const changed = [item];
    if (opts.asNew) {
      const fresh = this.opts.newId();
      await this.store.remove([item.id]);
      for (const d of this.items.filter((x) => x.dependsOn === item.id)) {
        d.dependsOn = fresh;
        if (d.payload.parent === item.id) d.payload = { ...d.payload, parent: fresh };
        changed.push(d);
      }
      // The group keeps its key (it only ties the report and its photos together).
      item.id = fresh;
    }
    if (opts.payload) item.payload = opts.payload;
    item.state = 'pending';
    item.error = null;
    await this.save(changed);
  }

  /** Removes a whole group (a report with its photos), and its files: only on the person's choice. */
  async discard(group: string): Promise<void> {
    await this.ready();
    const gone = this.items.filter((i) => i.group === group);
    this.items = this.items.filter((i) => i.group !== group);
    for (const i of gone) if (i.file) await this.store.dropFile(i.file).catch(() => undefined);
    await this.store.remove(gone.map((i) => i.id));
    this.emit();
  }

  /** Forgets groups that were fully sent more than KEEP_DONE_MS ago (or now, for one group: Dismiss). */
  async prune(group?: string): Promise<void> {
    await this.ready();
    const now = this.now().getTime();
    const groups = new Map<string, OutboxItem[]>();
    for (const i of this.items) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
    const gone: string[] = [];
    for (const [g, items] of groups) {
      if (!items.every((i) => i.state === 'done')) continue;
      const last = Math.max(...items.map((i) => Date.parse(i.updatedAt)));
      if (g === group || now - last > KEEP_DONE_MS) gone.push(g);
    }
    if (!gone.length) return;
    const ids = this.items.filter((i) => gone.includes(i.group)).map((i) => i.id);
    this.items = this.items.filter((i) => !gone.includes(i.group));
    await this.store.remove(ids);
    this.emit();
  }

  /** Everything goes (signing out, the device signed out). */
  async wipe(): Promise<void> {
    this.items = [];
    this.loaded = Promise.resolve();
    await this.store.wipe();
    this.emit();
  }
}
