import type { Queryable } from './db.ts';
import { fail } from './errors.ts';

/**
 * Legal holds (wave 11 contract C1, E34). A record under an active legal hold must not be deleted,
 * removed for good, anonymized or lose its files, whatever area is switched on or off: a hold never
 * lapses because a part of the application was switched off. The hold points are wired into core
 * now (generic delete, purge, the retention review's anonymize and delete, the retention sweep, and
 * file removal and purge in the attachments module); the records and privacy work fills in the
 * lookups below from `core/migrations/025_legal_holds.sql` (tables `legal_holds`,
 * `legal_hold_records`, `legal_hold_queries`). Until then nothing is ever held.
 *
 * Every function takes the database (or a transaction) and works as system work: a hold applies to
 * everyone, so it is checked whether or not the caller may see the hold itself.
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

/** The active holds on one record (empty when it is not held). */
export async function holdsOn(db: Queryable, type: string, id: string): Promise<HoldInfo[]> {
  void db; void type; void id;
  return [];
}

/**
 * Refuses, with 409 `on_hold`, to delete, anonymize, remove for good or remove the files of a record
 * under an active legal hold. The message names the hold's reference only, never its matter.
 */
export async function assertNotHeld(db: Queryable, type: string, id: string, what: HeldAction): Promise<void> {
  const holds = await holdsOn(db, type, id);
  if (!holds.length) return;
  const refs = holds.map((h) => h.ref).join(', ');
  fail(409, 'on_hold', `This record is under a legal hold (${refs}) and cannot ${REFUSED[what]}.`);
}

/** The ids of every record of a type under an active hold (for sweeps that skip held records). */
export async function heldIdsOf(db: Queryable, type: string): Promise<Set<string>> {
  void db; void type;
  return new Set();
}
