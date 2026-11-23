// Counting on the phone, with or without signal (wave 15, E38-12; spec §4.5): what a tag read during an
// inventory count is, worked out against the offline package, so found and unexpected records show as
// they happen. The server decides again when the find arrives (POST /api/inventory-counts/:id/found,
// through the outbox); finds from several phones merge there. Pure.
import { valueKey } from '../../../shared/tag-format.ts';
import type { PackageCount, PackageCountItem, PackageTag, SyncCountFound } from '../../../shared/mobile-api.ts';
import type { NewOutboxItem } from '../offline/outbox';

/**
 * - `found`: a record this count expects
 * - `found_before`: expected, and already found (by someone else before the package was downloaded)
 * - `unexpected`: a record known to the package that this count does not expect (registered elsewhere)
 * - `not_covered`: a kind of record this count does not cover (not sent)
 * - `unknown`: not in the package: sent, and the server says what it is
 */
export type FindKind = 'found' | 'found_before' | 'unexpected' | 'not_covered' | 'unknown';

export interface LocalFind {
  /** The outbox item's id (its idempotency key on the server). */
  clientId: string;
  key: string;
  value: string;
  source: 'code' | 'text' | 'typed';
  kind: FindKind;
  label: string | null;
  recordKey: string | null;
  at: string;
}

/** The finds made on this phone, kept until the count is over (drafts `count:<id>`). */
export interface CountSession { countId: string; joinedAt: string; finds: LocalFind[] }

export const sessionKey = (countId: string) => `count:${countId}`;

const recordKeyOf = (r: { recordType: string; recordId: string }) => `${r.recordType}:${r.recordId}`;

/** Works out what a value read is for this count. */
export function classify(count: PackageCount, tags: PackageTag[] | null | undefined, value: string): { kind: FindKind; item: PackageCountItem | null; label: string | null; recordKey: string | null } {
  const key = valueKey(value);
  const item = count.items.find((i) => i.tagValue && valueKey(i.tagValue) === key) ?? null;
  if (item) {
    const kind: FindKind = item.expected ? (item.state === 'found' ? 'found_before' : 'found') : 'unexpected';
    return { kind, item, label: item.label, recordKey: recordKeyOf(item) };
  }
  const tag = (tags ?? []).find((t) => t.valueKey === key);
  if (tag) {
    if (count.recordTypes.length && !count.recordTypes.includes(tag.recordType)) return { kind: 'not_covered', item: null, label: tag.label, recordKey: recordKeyOf(tag) };
    const expected = count.items.find((i) => i.expected && recordKeyOf(i) === recordKeyOf(tag));
    if (expected) return { kind: expected.state === 'found' ? 'found_before' : 'found', item: expected, label: expected.label, recordKey: recordKeyOf(tag) };
    return { kind: 'unexpected', item: null, label: tag.label, recordKey: recordKeyOf(tag) };
  }
  return { kind: 'unknown', item: null, label: null, recordKey: null };
}

/** The outbox item of one find. */
export function findItem(countId: string, f: Pick<LocalFind, 'clientId' | 'value' | 'source'>): NewOutboxItem {
  const payload: SyncCountFound = { countId, value: f.value, source: f.source };
  return { id: f.clientId, kind: 'count.found', label: f.value, payload: payload as unknown as Record<string, unknown> };
}

/** Whether a value was already counted on this phone (the camera keeps reading the same tag). */
export const alreadyCounted = (session: CountSession, value: string) => session.finds.some((f) => f.key === valueKey(value));

/** A new find for a value read; null when it was counted already. */
export function newFind(session: CountSession, count: PackageCount, tags: PackageTag[] | null | undefined, value: string, source: LocalFind['source'], clientId: string, now = new Date()): LocalFind | null {
  if (alreadyCounted(session, value)) return null;
  const c = classify(count, tags, value);
  return { clientId, key: valueKey(value), value, source, kind: c.kind, label: c.label, recordKey: c.recordKey, at: now.toISOString() };
}

/** Progress: what the count expects, and how much of it was found (before and on this phone). */
export function progress(count: PackageCount, session: CountSession | null): { expected: number; found: number; unexpected: LocalFind[]; unknown: LocalFind[] } {
  const expected = count.items.filter((i) => i.expected);
  const found = new Set(expected.filter((i) => i.state === 'found').map(recordKeyOf));
  for (const f of session?.finds ?? []) if ((f.kind === 'found' || f.kind === 'found_before') && f.recordKey) found.add(f.recordKey);
  return {
    expected: count.totals?.expected ?? expected.length,
    found: Math.max(found.size, 0),
    unexpected: (session?.finds ?? []).filter((f) => f.kind === 'unexpected'),
    unknown: (session?.finds ?? []).filter((f) => f.kind === 'unknown'),
  };
}

/** What the server said about a find once it arrived (the outbox item's result), in words. */
export const OUTCOME_TEXT: Record<string, string> = {
  found: 'Found', already_found: 'Already found', unexpected: 'Unexpected: registered somewhere else', not_found: 'Not found',
};
