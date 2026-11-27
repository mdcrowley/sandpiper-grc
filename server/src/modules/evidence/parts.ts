// Parts of a record that evidence can be linked to (E45-06): a funder review's areas and document
// requests, an obligation's periods. A part is not a record type of its own, so the module that owns
// it says what its parts are called and whether one exists. A link to a part is stored with the
// record's type and id and `part` = '<prefix>:<key>', for example 'area:FM' or 'request:<uuid>'.
//
// A module defines its parts in `register`:
//   defineEvidencePart(ctx.app, { recordType: 'compliance_review', prefix: 'area', label: 'Review area',
//     describe: async (db, recordId, key) => 'FM Financial management' | null });
// The evidence module calls `describe` before it stores a link to a part (null: no such part, 400),
// and `mayChange` (when given) before it stores or removes one (a reason: 409 part_locked).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../../core/db.ts';

export interface EvidencePartDef {
  /** The record type the parts belong to. */
  recordType: string;
  /** The part kind, lower case letters only: `area`, `request`, `period`. */
  prefix: string;
  /** What one part is called ("Review area"). */
  label: string;
  /** The part's name (for lists), or null when the record has no such part. */
  describe: (db: Db, recordId: string, key: string) => Promise<string | null>;
  /**
   * Whether this person may link and unlink evidence on the part although they may not edit the record
   * (a document request's assignee answers it with files). The record is already known to be visible.
   */
  mayLink?: (req: FastifyRequest, recordId: string, key: string) => Promise<boolean>;
  /**
   * Whether the part's evidence may change now (E45-19): null when it may, otherwise why not (409
   * `part_locked`). Checked when a link to the part is added and when one is removed, so a locked part
   * (a reviewed workpaper step) keeps the evidence it was reviewed with.
   */
  mayChange?: (db: Db, recordId: string, key: string) => Promise<string | null>;
  /** Names of many parts of one record at once, keyed by key (lists); falls back to `describe`. */
  names?: (db: Db, recordId: string) => Promise<Map<string, string>>;
}

export const PART_RE = /^([a-z]{1,20}):([A-Za-z0-9._-]{1,60})$/;

const registry = new WeakMap<FastifyInstance, Map<string, EvidencePartDef>>();

export function defineEvidencePart(app: FastifyInstance, def: EvidencePartDef): void {
  if (!/^[a-z]{1,20}$/.test(def.prefix)) throw new Error(`Evidence part prefix "${def.prefix}" must be lower-case letters`);
  const map = registry.get(app) ?? new Map<string, EvidencePartDef>();
  map.set(`${def.recordType}:${def.prefix}`, def);
  registry.set(app, map);
}

export function evidencePart(app: FastifyInstance, recordType: string, prefix: string): EvidencePartDef | undefined {
  return registry.get(app)?.get(`${recordType}:${prefix}`);
}

/** `{ prefix, key }` of a stored part, or null for the record itself ('') and anything malformed. */
export function splitPart(part: string): { prefix: string; key: string } | null {
  const m = PART_RE.exec(part);
  return m ? { prefix: m[1], key: m[2] } : null;
}
