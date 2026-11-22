import type { Queryable } from './db.ts';
import { fail, UUID_RE } from './errors.ts';

/**
 * Legal holds (wave 11 contract C1, E34). A record under an active legal hold must not be deleted,
 * removed for good, anonymized or lose its files, whatever area is switched on or off: a hold never
 * lapses because a part of the application was switched off. The hold points are wired into core
 * (generic delete, purge, the retention review's anonymize and delete, the retention sweep, file
 * removal and purge in the attachments module, and merging duplicate vulnerabilities). The holds
 * are read here from the core tables of `core/migrations/025_legal_holds.sql` (`legal_holds`,
 * `legal_hold_records`), which exist whether or not the holds module is loaded.
 *
 * Every function takes the database (or a transaction) and works as system work: a hold applies to
 * everyone, so it is checked whether or not the caller may see the hold itself. An active hold is
 * itself held: it cannot be deleted, removed or anonymized until it is released.
 */

export interface HoldInfo {
  /** The hold's id (`legal_holds.id`). */
  holdId: string;
  /** Its reference, for example `LGH-00001`. */
  ref: string;
  /** The matter it was placed for. */
  matter: string;
}

/** What is being refused, for the error message. */
export type HeldAction = 'delete' | 'anonymize' | 'remove' | 'remove_file';

const REFUSED: Record<HeldAction, string> = {
  delete: 'be deleted',
  anonymize: 'be anonymized',
  remove: 'be removed for good',
  remove_file: 'have its files removed',
};

/** The record type of a hold itself (module `holds`). */
export const HOLD_TYPE = 'legal_hold';

const ACTIVE = `h.status = 'active' and h.deleted_at is null`;

/** The active holds on one record (empty when it is not held). An active hold is held by itself. */
export async function holdsOn(db: Queryable, type: string, id: string): Promise<HoldInfo[]> {
  if (!UUID_RE.test(String(id ?? ''))) return [];
  if (type === HOLD_TYPE) {
    const own = await db.one<HoldInfo>(
      `select h.id as "holdId", coalesce(h.ref, '') as ref, h.matter from legal_holds h where h.id = $1 and ${ACTIVE}`, [id]);
    return own ? [own] : [];
  }
  return db.query<HoldInfo>(
    `select h.id as "holdId", coalesce(h.ref, '') as ref, h.matter
     from legal_hold_records r join legal_holds h on h.id = r.hold_id
     where r.record_type = $1 and r.record_id = $2::uuid and r.released_at is null and ${ACTIVE}
     order by h.ref`, [type, id]);
}

/**
 * Refuses, with 409 `on_hold`, to delete, anonymize, remove for good or remove the files of a record
 * under an active legal hold. The message names the hold's reference only, never its matter.
 */
export async function assertNotHeld(db: Queryable, type: string, id: string, what: HeldAction): Promise<void> {
  const holds = await holdsOn(db, type, id);
  if (!holds.length) return;
  const refs = holds.map((h) => h.ref).join(', ');
  if (type === HOLD_TYPE) fail(409, 'on_hold', `This legal hold (${refs}) is active and cannot ${REFUSED[what]}. Release it first.`);
  fail(409, 'on_hold', `This record is under a legal hold (${refs}) and cannot ${REFUSED[what]}.`);
}

/** The ids of every record of a type under an active hold (for sweeps that skip held records). */
export async function heldIdsOf(db: Queryable, type: string): Promise<Set<string>> {
  const rows = type === HOLD_TYPE
    ? await db.query<{ id: string }>(`select h.id::text as id from legal_holds h where ${ACTIVE}`)
    : await db.query<{ id: string }>(
      `select distinct r.record_id::text as id from legal_hold_records r join legal_holds h on h.id = r.hold_id
       where r.record_type = $1 and r.released_at is null and ${ACTIVE}`, [type]);
  return new Set(rows.map((r) => r.id));
}

/** The active holds' references on many records of one type at once (for review lists). */
export async function holdRefsOf(db: Queryable, type: string, ids: string[]): Promise<Map<string, string[]>> {
  const clean = ids.filter((i) => UUID_RE.test(String(i)));
  const out = new Map<string, string[]>();
  if (!clean.length) return out;
  const rows = type === HOLD_TYPE
    ? await db.query<{ id: string; ref: string }>(`select h.id::text as id, coalesce(h.ref, '') as ref from legal_holds h where h.id = any($1::uuid[]) and ${ACTIVE}`, [clean])
    : await db.query<{ id: string; ref: string }>(
      `select r.record_id::text as id, coalesce(h.ref, '') as ref from legal_hold_records r join legal_holds h on h.id = r.hold_id
       where r.record_type = $1 and r.record_id = any($2::uuid[]) and r.released_at is null and ${ACTIVE} order by h.ref`, [type, clean]);
  for (const r of rows) (out.get(r.id) ?? out.set(r.id, []).get(r.id)!).push(r.ref);
  return out;
}
