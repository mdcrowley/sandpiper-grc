// Hands data between screens without putting it in the address (lookup answers, a picture waiting
// to be attached or deleted, a report's prefill, a value read for another screen). In memory only:
// nothing here survives the app being closed, and signing out clears it.
import type { ReadingAnswer } from './lookup';
import type { TagAction, TagCard } from '../../../shared/asset-tags-api.ts';
import { discardPicture } from '../camera/still';
import { onWipe } from '../auth/session';

export interface ReportStart {
  kind: 'problem' | 'hazard';
  /** From a tag card: the server's prefill (path, type, values) and the record it is about. */
  prefill: TagAction['prefill'];
  record: { type: string; id: string; label: string; siteId: string | null; siteLabel: string | null } | null;
}

type Item =
  | { kind: 'answer'; answer: ReadingAnswer; picture: string | null }
  | { kind: 'card'; card: TagCard; picture: string | null }
  | { kind: 'report'; start: ReportStart }
  | { kind: 'pick'; value: string | null };

const items = new Map<string, Item>();
let next = 1;

export function put(item: Item): string {
  const id = String(next++);
  items.set(id, item);
  return id;
}

export function get<K extends Item['kind']>(id: string | undefined, kind: K): Extract<Item, { kind: K }> | null {
  const it = id ? items.get(id) : undefined;
  return it && it.kind === kind ? (it as Extract<Item, { kind: K }>) : null;
}

export function update(id: string, item: Item): void {
  items.set(id, item);
}

/** Forgets an item; a picture it held is deleted unless `keepPicture`. */
export function release(id: string | undefined, keepPicture = false): void {
  if (!id) return;
  const it = items.get(id);
  if (it && (it.kind === 'answer' || it.kind === 'card') && it.picture && !keepPicture) discardPicture(it.picture);
  items.delete(id);
}

/** Forgets everything (sign-out), deleting pictures. */
export function clearAll(): void {
  for (const id of [...items.keys()]) release(id);
}

// Signing out forgets everything held here.
onWipe(clearAll);
