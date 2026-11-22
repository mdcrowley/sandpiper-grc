import type { Queryable } from '../../core/db.ts';
import { featureState } from '../../core/features.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { AssignmentStatus, TagAssignmentView } from '../../../../shared/asset-tags-api.ts';
import type { TagFormat, TagSource } from '../../../../shared/tag-format.ts';

// Read helpers the parts of the tags module share (E37-01 to E37-03, E37-07). Owned by TAGS-CORE;
// store.ts re-exports them with the signatures the wave 13 contracts fixed.

/** A tag_formats row as the API gives it. */
export function formatFromRow(r: Row): TagFormat {
  return {
    id: r.id, name: r.name, characters: r.characters, pattern: r.pattern ?? null, prefix: r.prefix ?? '',
    lengthMin: r.length_min ?? null, lengthMax: r.length_max ?? null, checkCharacter: r.check_character,
    carrier: r.carrier, extractPattern: r.extract_pattern ?? null,
    recordTypes: Array.isArray(r.record_types) ? r.record_types : [], active: r.active === true,
  };
}

/** Every format that is not deleted (active ones first, then by sort and name). */
export async function loadFormats(db: Queryable, opts: { activeOnly?: boolean } = {}): Promise<TagFormat[]> {
  const rows = await db.query<Row>(
    `select * from tag_formats where deleted_at is null ${opts.activeOnly ? 'and active' : ''} order by active desc, sort, lower(name)`);
  return rows.map(formatFromRow);
}

export interface AssignmentRow {
  id: string; value: string; value_key: string; record_type: string; record_id: string; status: AssignmentStatus;
  is_primary: boolean; source: string | null; format_id: string | null; assigned_at: string; assigned_by: string | null;
  ended_at: string | null; ended_by: string | null; replaced_by: string | null; reason: string | null;
}

/** The active assignment of a value key, if any (at most one: unique index). */
export async function activeByKey(db: Queryable, key: string): Promise<AssignmentRow | undefined> {
  return db.one<AssignmentRow>(`select * from tag_assignments where value_key = $1 and status = 'active'`, [key]);
}

/** Every assignment a value key ever had, newest first. */
export async function historyByKey(db: Queryable, key: string): Promise<AssignmentRow[]> {
  return db.query<AssignmentRow>(`select * from tag_assignments where value_key = $1 order by assigned_at desc`, [key]);
}

/** A record's assignments (active first, then newest first). */
export async function assignmentsOf(db: Queryable, recordType: string, recordId: string): Promise<AssignmentRow[]> {
  return db.query<AssignmentRow>(
    `select * from tag_assignments where record_type = $1 and record_id = $2 order by (status = 'active') desc, is_primary desc, assigned_at desc`,
    [recordType, recordId]);
}

/** Whether the Asset tags area is switched on (cached for a few seconds by core). */
export async function tagsOn(db: Queryable): Promise<boolean> {
  return (await featureState(db)).on.tags !== false;
}

/** 400 `validation` with field messages. */
export function invalid(ctx: ModuleContext, fields: Record<string, string>): never {
  return ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
}

/** Display names of people, by id (missing ids are left out). */
export async function namesOf(db: Queryable, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!wanted.length) return new Map();
  const rows = await db.query<{ id: string; name: string }>(
    `select id, coalesce(nullif(display_name, ''), username) as name from users where id = any($1::uuid[])`, [wanted]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const SOURCES = new Set(['code', 'text', 'typed', 'handheld', 'import', 'system']);

/** Assignment rows as the API gives them (names and replacing values looked up in one go each). */
export async function assignmentViews(db: Queryable, rows: AssignmentRow[]): Promise<TagAssignmentView[]> {
  const names = await namesOf(db, rows.flatMap((r) => [r.assigned_by, r.ended_by]));
  const replacing = rows.map((r) => r.replaced_by).filter((x): x is string => Boolean(x));
  const values = new Map(replacing.length
    ? (await db.query<{ id: string; value: string }>('select id, value from tag_assignments where id = any($1::uuid[])', [replacing])).map((r) => [r.id, r.value])
    : []);
  return rows.map((r) => ({
    id: r.id, value: r.value, key: r.value_key, recordType: r.record_type, recordId: r.record_id, status: r.status,
    primary: r.is_primary === true,
    source: r.source && SOURCES.has(r.source) ? (r.source as TagSource | 'import' | 'system') : null,
    assignedAt: iso(r.assigned_at)!, assignedByName: (r.assigned_by && names.get(r.assigned_by)) || null,
    endedAt: iso(r.ended_at), endedByName: (r.ended_by && names.get(r.ended_by)) || null,
    replacedByValue: (r.replaced_by && values.get(r.replaced_by)) || null,
    reason: r.reason ?? null,
  }));
}

/** Whether a database error is a unique-index violation. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505' || /unique|duplicate key/i.test(String((err as Error)?.message ?? ''));
}

/** Plain-English names of the check schemes and carriers, for messages. */
export const CHECK_NAMES: Record<string, string> = { none: 'none', mod10: 'mod 10', mod11: 'mod 11', mod36: 'mod 36' };
