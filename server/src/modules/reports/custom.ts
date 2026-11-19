// Custom fields (fields an administrator adds to a record type, named `cf_<key>` and kept in the
// record's `custom` JSON column) in the shape the report engine uses. A multi-choice field holds a
// list of values: it can be shown as a column (its labels, joined) and filtered ("has any of",
// "has none of", empty), but not grouped by or totalled, because one record can hold several values.
import { CUSTOM_KEY_RE, CUSTOM_PREFIX, customFieldDef, type CustomField } from '../../core/customfields.ts';
import type { FieldDef, ModuleContext } from '../../core/module.ts';

export type CustomDefs = Record<string, FieldDef>;

export async function customDefs(ctx: ModuleContext, type: string): Promise<CustomDefs> {
  let rows: CustomField[];
  try {
    rows = await ctx.db.query<CustomField>(
      `select id, record_type, key, label, type, required, list_key, ref_type, section, position, help, active
       from custom_fields where record_type = $1 and active order by position, label`, [type]);
  } catch {
    return {}; // an installation without custom fields
  }
  const out: CustomDefs = {};
  for (const f of rows) {
    if (!CUSTOM_KEY_RE.test(f.key)) continue;
    out[`${CUSTOM_PREFIX}${f.key}`] = customFieldDef(f);
  }
  return out;
}

/** The SQL expression for a custom field of the base record. The key is checked, so it is safe as a literal. */
export function customSql(alias: string, name: string, def: FieldDef): string {
  const key = name.slice(CUSTOM_PREFIX.length);
  if (!CUSTOM_KEY_RE.test(key)) throw new Error('bad custom field key');
  // A multi-choice field is a JSON array of values (anything else reads as no values).
  if (def.multiple) return `(case when jsonb_typeof(${alias}.custom->'${key}') = 'array' then ${alias}.custom->'${key}' else '[]'::jsonb end)`;
  const raw = `(${alias}.custom->>'${key}')`;
  switch (def.type) {
  case 'number': case 'currency': return `${raw}::numeric`;
  case 'date': return `${raw}::date`;
  case 'datetime': return `${raw}::timestamptz`;
  case 'boolean': return `${raw}::boolean`;
  default: return raw;
  }
}
