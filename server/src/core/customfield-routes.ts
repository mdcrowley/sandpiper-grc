import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { Row } from './module.ts';
import {
  CUSTOM_KEY_RE, CUSTOM_TYPES, customFieldDef, customListKey, customName, type CustomField, type CustomFields, type CustomType,
} from './customfields.ts';
import type { makeResources } from './resource.ts';
import { requirePerm, type makeAudit } from './services.ts';

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  res: ReturnType<typeof makeResources>;
  custom: CustomFields;
}

const MAX_PER_TYPE = 50;
const VALUE_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'f_$1').slice(0, 40);

/** Administration of custom field definitions (E14-02). All routes need `admin.administer`. */
export function registerCustomFieldRoutes({ app, db, audit, res, custom }: Deps) {
  const admin = { preHandler: requirePerm('admin.administer') };
  const invalid = (fields: Record<string, string>): never => fail(400, 'validation', 'Check the highlighted fields.', fields);

  const shape = (f: CustomField) => ({ ...f, name: customName(f), field: customFieldDef(f) });
  const one = async (id: string) => {
    const row = UUID_RE.test(id) ? await db.one<CustomField>('select * from custom_fields where id = $1', [id]) : undefined;
    return row ?? fail(404, 'not_found', 'Custom field not found.');
  };

  /** Adds option values that the list does not have yet; existing values are edited under Lists. */
  async function addOptions(list: string, module: string, options: unknown, fields: Record<string, string>): Promise<void> {
    if (!Array.isArray(options)) return;
    const clean: { value: string; label: string; color: string }[] = [];
    for (const o of options) {
      const label = String((typeof o === 'string' ? o : (o as Row)?.label) ?? '').trim();
      const value = String((typeof o === 'string' ? '' : (o as Row)?.value) ?? '').trim() || slug(label).replace(/^f_/, '');
      if (!label || !VALUE_RE.test(value)) { fields.options = 'Each option needs a label; values use lower-case letters, numbers, dashes or underscores.'; return; }
      clean.push({ value, label: label.slice(0, 80), color: String((o as Row)?.color ?? 'gray') });
    }
    await db.query(
      `insert into lookup_lists (list_key, module, public) values ($1, $2, false) on conflict (list_key) do nothing`, [list, module]);
    for (const [i, o] of clean.entries()) {
      await db.query(
        `insert into lookups (list_key, value, label, color, sort) values ($1,$2,$3,$4,$5) on conflict (list_key, value) do nothing`,
        [list, o.value, o.label, o.color, (i + 1) * 10]);
    }
  }

  app.get('/api/admin/custom-fields', admin, async (req) => {
    const type = (req.query as Record<string, string>).record_type;
    const rows = await db.query<CustomField>(
      `select * from custom_fields where ($1::text is null or record_type = $1) order by record_type, active desc, position, label`, [type || null]);
    return {
      fields: rows.map(shape),
      types: CUSTOM_TYPES,
      recordTypes: res.registry.all().map((d) => ({ type: d.type, label: d.label, plural: d.plural })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  });

  app.post('/api/admin/custom-fields', admin, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const def = res.registry.get(String(b.record_type ?? ''));
    if (!def) fields.record_type = 'Choose a record type.';
    const label = String(b.label ?? '').trim();
    if (!label || label.length > 80) fields.label = 'Enter a label of up to 80 characters.';
    const key = String(b.key ?? '').trim() || slug(label);
    if (!CUSTOM_KEY_RE.test(key)) fields.key = 'Use lower-case letters, numbers and underscores, starting with a letter (at most 40).';
    const type = String(b.type ?? '') as CustomType;
    if (!CUSTOM_TYPES.includes(type)) fields.type = `Choose one of: ${CUSTOM_TYPES.join(', ')}.`;
    if (def && !fields.key) {
      if (def.fields[`cf_${key}`]) fields.key = 'That name is already used by a built-in field.';
      else if (await db.one('select 1 from custom_fields where record_type = $1 and key = $2', [def.type, key])) {
        fields.key = 'This record type already has a custom field with that key (it may be inactive: switch it back on instead).';
      } else if ((await db.one<{ c: number }>('select count(*)::int c from custom_fields where record_type = $1 and active', [def.type]))!.c >= MAX_PER_TYPE) {
        fields.record_type = `A record type can have at most ${MAX_PER_TYPE} active custom fields.`;
      }
    }
    const select = type === 'select' || type === 'multiselect';
    let listKey: string | null = null;
    if (select && def) {
      if (b.list) {
        listKey = String(b.list);
        if (!(await db.one('select 1 from lookups where list_key = $1', [listKey]))) fields.list = 'That list does not exist.';
      } else {
        listKey = customListKey(def.type, key);
        if (!Array.isArray(b.options) || !b.options.length) fields.options = 'Add at least one option.';
      }
    }
    const refType = type === 'ref' ? String(b.to ?? '') : null;
    if (type === 'ref' && !res.registry.get(refType!)) fields.to = 'Choose the record type to link to.';
    if (Object.keys(fields).length) invalid(fields);
    if (select && !b.list) await addOptions(listKey!, def!.module, b.options, fields);
    if (Object.keys(fields).length) invalid(fields);

    // A record type whose "table" is a view has nowhere to keep custom values.
    await res.ensureCustomColumn(def!).catch(() => invalid({ record_type: `Custom fields cannot be added to ${def!.plural.toLowerCase()}.` }));
    const row = (await db.one<CustomField>(
      `insert into custom_fields (record_type, key, label, type, required, list_key, ref_type, section, position, help, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning *`,
      [def!.type, key, label, type, b.required === true, listKey, refType, String(b.section ?? '').trim().slice(0, 80) || null,
        Number.isFinite(Number(b.position)) ? Math.trunc(Number(b.position)) : 0, String(b.help ?? '').trim().slice(0, 500) || null, req.user!.id],
    ))!;
    custom.invalidate();
    await res.refreshSearch(def!);
    await audit(req, {
      action: 'custom_field.create', recordType: 'custom_field', recordId: row.id,
      summary: `Custom field "${label}" (${type}) added to ${def!.plural.toLowerCase()}`, after: row,
    });
    reply.code(201);
    return shape(row);
  });

  app.patch('/api/admin/custom-fields/:id', admin, async (req) => {
    const before = await one((req.params as Row).id);
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    if (b.key !== undefined && b.key !== before.key) fields.key = 'The key cannot be changed: existing values are stored under it.';
    if (b.type !== undefined && b.type !== before.type) fields.type = 'The type cannot be changed. Add a new field instead.';
    const label = b.label === undefined ? before.label : String(b.label).trim();
    if (!label || label.length > 80) fields.label = 'Enter a label of up to 80 characters.';
    if (Object.keys(fields).length) invalid(fields);
    const def = res.registry.get(before.record_type);
    if (b.options !== undefined && before.list_key && def) {
      await addOptions(before.list_key, def.module, b.options, fields);
      if (Object.keys(fields).length) invalid(fields);
    }
    const row = (await db.one<CustomField>(
      `update custom_fields set label = $2, required = $3, section = $4, position = $5, help = $6, active = $7, updated_at = now(), updated_by = $8
       where id = $1 returning *`,
      [before.id, label, b.required === undefined ? before.required : b.required === true,
        b.section === undefined ? before.section : String(b.section ?? '').trim().slice(0, 80) || null,
        b.position === undefined || !Number.isFinite(Number(b.position)) ? before.position : Math.trunc(Number(b.position)),
        b.help === undefined ? before.help : String(b.help ?? '').trim().slice(0, 500) || null,
        b.active === undefined ? before.active : b.active === true, req.user!.id],
    ))!;
    custom.invalidate();
    if (def) {
      if (row.active) await res.ensureCustomColumn(def);
      await res.refreshSearch(def);
    }
    await audit(req, {
      action: 'custom_field.update', recordType: 'custom_field', recordId: row.id,
      summary: `Custom field "${row.label}" on ${before.record_type} changed${before.active !== row.active ? (row.active ? ' (switched on)' : ' (switched off)') : ''}`,
      before, after: row,
    });
    return shape(row);
  });

  // Removing a field hides it everywhere; the values already entered stay in the records.
  app.delete('/api/admin/custom-fields/:id', admin, async (req) => {
    const before = await one((req.params as Row).id);
    await db.query('update custom_fields set active = false, updated_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    custom.invalidate();
    const def = res.registry.get(before.record_type);
    if (def) await res.refreshSearch(def);
    await audit(req, {
      action: 'custom_field.retire', recordType: 'custom_field', recordId: before.id,
      summary: `Custom field "${before.label}" on ${before.record_type} switched off (values kept)`, before: { active: before.active }, after: { active: false },
    });
    return { ok: true };
  });
}
