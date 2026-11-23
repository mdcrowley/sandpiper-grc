// Kinds of outbox item (wave 14, E38-10). The extension point for later offline work: an inspection
// completed offline (E38-11), a condition assessment, an inventory count's finds (E38-12) are each a
// new kind here, a matching server kind (server/src/modules/mobile/sync.ts `defineSyncKind`) and a
// screen that calls `outbox().add(...)`. The outbox itself (ordering, retries, Needs attention, wipe)
// needs no change. See docs/mobile.md, "Offline work".
import type { OutboxItem } from './types';

export interface OutboxKind {
  kind: string;
  /**
   * `batch`: sent in POST /api/mobile/sync with its neighbors (JSON payload).
   * `upload`: sent alone with its file (PUT /api/mobile/sync/attachment).
   */
  send: 'batch' | 'upload';
  /** Says what the item is, for lists ("Report", "Photo"). */
  noun: string;
}

const registry = new Map<string, OutboxKind>();

export function defineOutboxKind(k: OutboxKind): void {
  registry.set(k.kind, k);
}

export function outboxKind(kind: string): OutboxKind | undefined {
  return registry.get(kind);
}

/** A record made through its normal create route (reports: tickets, safety events, portal reports). */
defineOutboxKind({ kind: 'record.create', send: 'batch', noun: 'Report' });
/** A photo attached to a record, or to the record an earlier item makes (`payload.parent`). */
defineOutboxKind({ kind: 'attachment', send: 'upload', noun: 'Photo' });

/** Whether an item is sent alone with a file. */
export const isUpload = (item: Pick<OutboxItem, 'kind'>) => outboxKind(item.kind)?.send === 'upload';
