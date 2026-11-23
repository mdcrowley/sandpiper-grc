// Offline work on the phone (wave 14, E38-10; spec §5.6): the shapes of the outbox and of the
// stores behind it. Pure types; the server's side of the contract is in shared/mobile-api.ts.
import type { MobilePackage, SyncAnswer, SyncItem, SyncResult } from '../../../shared/mobile-api.ts';

/**
 * - `pending`: waiting to be sent (also after a lost connection: it is sent again with the same id,
 *   and the server answers a repeat from memory, so it is never done twice)
 * - `sending`: on its way now
 * - `done`: the server did it; kept a day so the person sees it arrived, then forgotten
 * - `rejected`: the server refused it; kept in "Needs attention" with the server's reason until the
 *   person sends it again or discards it. Never dropped silently.
 */
export type OutboxState = 'pending' | 'sending' | 'done' | 'rejected';

export interface OutboxError { code: string; message: string; fields?: Record<string, string> }

export interface OutboxItem {
  /** The client-made UUID: the item's idempotency key on the server. */
  id: string;
  /** Order of saving; items are sent in this order. */
  seq: number;
  /** What kind of work (kinds.ts); the server's sync kind. */
  kind: string;
  /** Items that belong together (a report and its photos) share a group: the first item's id. */
  group: string;
  /** What the person sees, for example the report's title or "Photo 2". */
  label: string;
  /** What is sent (JSON). For a file, where it goes: `{ parent | recordType + recordId, name }`. */
  payload: Record<string, unknown>;
  /** A file kept on the phone for this item (a photo), in the app's protected folder. */
  file: string | null;
  /** An item that must be done first (the report a photo belongs to). */
  dependsOn: string | null;
  state: OutboxState;
  attempts: number;
  /** The server's reason (rejected), or why it waits (pending after a `retry`). */
  error: OutboxError | null;
  result: SyncResult | null;
  createdAt: string;
  updatedAt: string;
}

/** Where the outbox lives: SQLite in the app's protected storage (sqlite.ts), or memory in tests. */
export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  /** Inserts or replaces. */
  put(items: OutboxItem[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** Copies a file into the protected folder under the item's group; answers the copy's uri. */
  keepFile(group: string, uri: string, name: string): Promise<string>;
  dropFile(uri: string): Promise<void>;
  /** Removes every item and file. */
  wipe(): Promise<void>;
}

/** How the outbox reaches the server (transport.ts). */
export interface OutboxTransport {
  /** POST /api/mobile/sync: a batch of items, answered each separately. */
  sync(items: SyncItem[]): Promise<SyncAnswer[]>;
  /** PUT /api/mobile/sync/attachment: one file item. */
  upload(item: OutboxItem): Promise<SyncAnswer>;
}

/** Where the offline package is kept. */
export interface PackageStore {
  get(): Promise<MobilePackage | null>;
  set(p: MobilePackage): Promise<void>;
  clear(): Promise<void>;
}
