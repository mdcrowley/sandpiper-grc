import type { Db } from './db.ts';
import type { FieldDef, FieldType } from './module.ts';

/**
 * Custom fields (E14-02): fields an administrator adds to a record type.
 *
 * Storage: one `custom jsonb` column per record table, added by the resource engine when the
 * type's first field is defined. Chosen over a values table because a record and its custom
 * values are then read, written, audited, exported and restricted together as one row; filters
 * and sorting are plain expressions (`custom->>'key'`); and removing a field hides it without
 * touching data. A values table would need a join or pivot per field on every list.
 *
 * To clients a custom field looks like any other field, named `cf_<key>`: it is in `/api/meta`
 * (marked `custom: true`), in rows, in `_display`, in create and update bodies, in filters
 * (`f.cf_<key>=`), sorting, grouping and CSV export.
 */

export const CUSTOM_PREFIX = 'cf_';
export const CUSTOM_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const CUSTOM_TYPES = ['text', 'longtext', 'number', 'currency', 'date', 'boolean', 'select', 'multiselect', 'user', 'ref'] as const;
export type CustomType = typeof CUSTOM_TYPES[number];

export interface CustomField {
  id: string;
  record_type: string;
  key: string;
  label: string;
  type: CustomType;
  required: boolean;
  list_key: string | null;
  ref_type: string | null;
  section: string | null;
  position: number;
  help: string | null;
  active: boolean;
}

/** The name clients use for a custom field. */
export const customName = (f: Pick<CustomField, 'key'>) => `${CUSTOM_PREFIX}${f.key}`;

/** The list that holds the options of a select field, unless an existing list was chosen. */
export const customListKey = (recordType: string, key: string) => `${CUSTOM_PREFIX}${recordType}_${key}`;

/** A custom field in the shape of a built-in one, so generic lists and forms need no special case. */
export function customFieldDef(f: CustomField): FieldDef {
  const type: FieldType = f.type === 'select' || f.type === 'multiselect' ? 'lookup' : f.type;
  return {
    label: f.label, type, custom: true, position: f.position,
    ...(f.required ? { required: true } : {}),
    ...(type === 'lookup' ? { list: f.list_key ?? customListKey(f.record_type, f.key) } : {}),
    ...(f.type === 'multiselect' ? { multiple: true } : {}),
    ...(f.type === 'ref' ? { to: f.ref_type ?? '' } : {}),
    ...(f.help ? { help: f.help } : {}),
    ...(f.section ? { section: f.section } : {}),
  };
}

/**
 * How long one process trusts the definitions it read (E40-01): a change made in this process applies
 * at once (`invalidate`), one made by another server process on the same database within this time.
 */
const DEFS_TTL_MS = 5_000;

export function makeCustomFields(db: Db) {
  let cache: Map<string, CustomField[]> | null = null;
  let readAt = 0;

  async function load(): Promise<Map<string, CustomField[]>> {
    if (cache && Date.now() - readAt < DEFS_TTL_MS) return cache;
    const rows = await db.query<CustomField>(
      `select id, record_type, key, label, type, required, list_key, ref_type, section, position, help, active
       from custom_fields where active order by record_type, position, label`);
    const map = new Map<string, CustomField[]>();
    for (const r of rows) (map.get(r.record_type) ?? map.set(r.record_type, []).get(r.record_type)!).push(r);
    cache = map;
    readAt = Date.now();
    return map;
  }

  return {
    /** Active custom fields of one record type, in display order. */
    async active(type: string): Promise<CustomField[]> {
      return (await load()).get(type) ?? [];
    },
    /** Active custom fields of one type as field definitions keyed by `cf_<key>`. */
    async defs(type: string): Promise<Record<string, FieldDef>> {
      return Object.fromEntries(((await load()).get(type) ?? []).map((f) => [customName(f), customFieldDef(f)]));
    },
    /** Record types that have at least one active custom field. */
    async types(): Promise<string[]> {
      return [...(await load()).keys()];
    },
    /** Call after any change to the definitions. */
    invalidate() {
      cache = null;
    },
  };
}

export type CustomFields = ReturnType<typeof makeCustomFields>;
