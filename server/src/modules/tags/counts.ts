import type { FastifyRequest } from 'fastify';
import { taggable, taggables, type TaggableDef } from '../../core/asset-tags.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { onAnonymize } from '../../core/retention.ts';
import { dayInZone } from '../../core/timezone.ts';
import type {
  CountFinishResult, CountFoundRequest, CountFoundResult, CountItemView, CountItems, CountResolveRequest,
} from '../../../../shared/asset-tags-api.ts';
import { valueKey } from '../../../../shared/tag-format.ts';
import { registerCountReport } from './counts-report.ts';
import { logLookup, logSourceOf } from './history.ts';

// Inventory counts (E37-09, spec §4.5): record type `inventory_count` (tables inventory_counts and
// inventory_count_items, migration 001_tags.sql) and its routes under /api/inventory-counts. Owned by
// TAGS-COUNTS.
//
// - Starting a count (tags.count) fixes the expected list: every countable record at the site (and,
//   with an area, whose location names it), of the chosen types; retired or disposed ones are left out.
// - Finding (tags.count) a tag, typed or read by a handheld scanner on the web or by the app's camera,
//   marks its record found; a record registered elsewhere is added as unexpected. Several people may
//   count at once and finding twice is harmless: one atomic insert-or-update per find.
// - Finishing (tags.count) marks what was not found missing. Unexpected records may then be moved
//   here, missing ones marked missing (status `missing`) or left; a discrepancy summary can raise a
//   ticket or an action.
// - Every find records the record's last verified date and place (tag_verifications).
// The generated routes check tags.view / create / edit / delete / export; the starting check (tags.count)
// is made in the type's beforeCreate hook as well (HOOK_CHECKS in core/permission-use.ts).

export const COUNT_TYPE = 'inventory_count';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The value status lists of countable types gain, for "mark missing". */
export const MISSING_STATUS = 'missing';
/** Characters valueKey removes, for comparing a record's own tag field in SQL (a fallback; tag_assignments is the source of truth). */
const KEY_STRIP_SQL = `'[[:space:]_‐‑‒–—―−－-]'`;

/** Lists of inventory counts (called from the module's seedDefaults; idempotent). */
export async function seedCountDefaults(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('inventory_count_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'finished', label: 'Finished', color: 'green', sort: 20 },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 30 },
  ], { module: 'tags' });
  // Modules that sort before `tags` (fleet, inventory, risks) have seeded their lists by now.
  const listExists = async (list: string) => Boolean(await ctx.db.one(`select 1 from lookups where list_key = $1 limit 1`, [list]));
  if (await listExists('action_source')) {
    await ctx.lookups.ensure('action_source', [{ value: COUNT_TYPE, label: 'Inventory count', sort: 175 }]);
  }
  for (const list of ['asset_status', 'vehicle_status']) {
    if (await listExists(list)) await ctx.lookups.ensure(list, [{ value: MISSING_STATUS, label: 'Missing', color: 'red', sort: 95 }]);
  }
}

/** The types a count can expect: taggable, in use, and kept at a site. */
export function countableTypes(ctx: ModuleContext): TaggableDef[] {
  return taggables(ctx.app, ctx.resources).filter((t) => t.siteField !== null);
}

const invalid = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

/** Status values that take a record out of the register (retired, disposed): not expected anywhere. */
async function goneStatuses(ctx: ModuleContext, t: TaggableDef): Promise<string[]> {
  const list = t.statusField ? ctx.resources.get(t.type)?.fields[t.statusField]?.list : undefined;
  if (!list) return [];
  return (await ctx.lookups.values(list)).filter((v) => v.meta?.final === true || v.meta?.retired === true).map((v) => v.value);
}

/** SQL selecting the ids of one type's records at a site (and area), for the expected list and the report. */
async function atSiteSql(ctx: ModuleContext, t: TaggableDef, siteParam: string, areaParam: string | null): Promise<string | null> {
  const def = ctx.resources.get(t.type);
  if (!def || !t.siteField) return null;
  if (areaParam && !t.locationField) return null;
  const gone = await goneStatuses(ctx, t);
  const where = [
    'deleted_at is null',
    t.siteField === 'id' ? `id = ${siteParam}` : `${t.siteField} = ${siteParam}`,
    ...(areaParam ? [`${t.locationField} ilike '%' || ${areaParam} || '%'`] : []),
    ...(gone.length && t.statusField ? [`coalesce(${t.statusField}, '') not in (${gone.map((g) => `'${g.replace(/'/g, "''")}'`).join(', ')})`] : []),
  ];
  return `select id from ${def.table} where ${where.join(' and ')}`;
}

/** Writes the expected list of a new count (once, when it starts). */
async function fixExpected(ctx: ModuleContext, count: Row): Promise<void> {
  const chosen: string[] = Array.isArray(count.record_types) ? count.record_types : [];
  const types = countableTypes(ctx).filter((t) => !chosen.length || chosen.includes(t.type));
  const area = typeof count.area === 'string' && count.area.trim() ? count.area.trim() : null;
  for (const t of types) {
    const sql = await atSiteSql(ctx, t, '$2::uuid', area ? '$3::text' : null);
    if (!sql) continue;
    await ctx.db.query(
      `insert into inventory_count_items (count_id, record_type, record_id, expected)
       select $1::uuid, '${t.type}', id, true from (${sql}) s on conflict do nothing`,
      area ? [count.id, count.site_id, area.replace(/[%_\\]/g, (c) => `\\${c}`)] : [count.id, count.site_id]);
  }
}

/** Describes items for one person: labels and links of records they may see, a neutral text otherwise. */
export async function itemViews(ctx: ModuleContext, req: FastifyRequest, rows: Row[]): Promise<CountItemView[]> {
  const byType = new Map<string, string[]>();
  for (const r of rows) byType.set(r.record_type, [...(byType.get(r.record_type) ?? []), r.record_id]);
  const info = new Map<string, Row>();
  for (const [type, ids] of byType) {
    const def = ctx.resources.get(type);
    const t = taggable(ctx.app, ctx.resources, type);
    if (!def || !t) continue;
    const refCol = def.ref?.field ? `x.${def.ref.field}` : 'null';
    const found = await ctx.db.query<Row>(
      `select x.id, x.${def.titleField} as label, ${refCol} as ref, x.${t.field} as tag,
              (${ctx.resources.visibleWhere(type, req.user, 'x')}) as visible
         from ${def.table} x where x.id = any($1::uuid[])`, [ids]);
    for (const f of found) info.set(`${type}:${f.id}`, { ...f, route: `${def.route}/${f.id}`, typeLabel: def.label });
  }
  const viewable = (type: string) => {
    const def = ctx.resources.get(type);
    return Boolean(def && ctx.can(req.user!, `${def.module}.view`));
  };
  return rows.map((r) => {
    const i = info.get(`${r.record_type}:${r.record_id}`);
    const shown = Boolean(i && i.visible && viewable(r.record_type));
    return {
      id: r.id, recordType: r.record_type, recordId: r.record_id,
      label: shown ? String(i!.label ?? i!.ref ?? i!.typeLabel) : i ? 'A record you may not see' : 'A record no longer in the register',
      ref: shown ? (i!.ref ?? null) : null,
      route: shown ? i!.route : '',
      tagValue: shown ? (i!.tag ?? null) : null,
      expected: r.expected === true,
      state: r.state,
      foundAt: r.found_at ? new Date(r.found_at).toISOString() : null,
      foundByName: r.found_by_name ?? null,
      resolution: r.resolution ?? null,
    };
  });
}

const ITEM_SELECT = `select i.*, u.display_name as found_by_name from inventory_count_items i left join users u on u.id = i.found_by`;

/** Totals of one count; figures, so the same for everyone. */
export async function countTotals(ctx: ModuleContext, countId: string): Promise<CountItems['totals']> {
  const t = await ctx.db.one<Row>(
    `select count(*) filter (where expected)::int as expected,
            count(*) filter (where expected and state = 'found')::int as found,
            count(*) filter (where not expected)::int as unexpected,
            count(*) filter (where expected and state = 'pending')::int as pending,
            count(*) filter (where expected and state = 'missing')::int as missing
       from inventory_count_items where count_id = $1`, [countId]);
  return { expected: t?.expected ?? 0, found: t?.found ?? 0, unexpected: t?.unexpected ?? 0, pending: t?.pending ?? 0, missing: t?.missing ?? 0 };
}

/** The count, when it exists and the person may see it. */
async function visibleCount(ctx: ModuleContext, req: FastifyRequest): Promise<Row> {
  const { id } = req.params as { id: string };
  const row = UUID_RE.test(id) ? await ctx.resources.find(COUNT_TYPE, id, req.user) : undefined;
  return row ?? ctx.fail(404, 'not_found', 'Inventory count not found.');
}

interface Resolved { type: string; id: string; outcome: 'current' | 'replaced' | 'identifier' }

/**
 * The record a value found during a count stands for: an active tag, then a replaced one (the tag
 * should be swapped, but the thing is there), then the record's own tag field, then an exact match on
 * another identifier (serial, fleet number). Only records of types in use that the person may see;
 * anything else answers as not found, the same whether it exists or not.
 */
async function resolveValue(ctx: ModuleContext, req: FastifyRequest, value: string): Promise<Resolved | null> {
  const key = valueKey(value);
  const inUse = taggables(ctx.app, ctx.resources);
  const usable = async (type: string, id: string) => {
    const def = ctx.resources.get(type);
    return Boolean(def && inUse.some((t) => t.type === type) && ctx.can(req.user!, `${def.module}.view`)
      && (await ctx.resources.find(type, id, req.user)));
  };
  const assigned = await ctx.db.one<Row>(
    `select record_type, record_id, status from tag_assignments where value_key = $1 and status in ('active', 'replaced')
      order by (status = 'active') desc, assigned_at desc limit 1`, [key]);
  if (assigned) {
    return (await usable(assigned.record_type, assigned.record_id))
      ? { type: assigned.record_type, id: assigned.record_id, outcome: assigned.status === 'active' ? 'current' : 'replaced' } : null;
  }
  for (const t of inUse) {
    const def = ctx.resources.get(t.type)!;
    const hit = await ctx.db.one<Row>(
      `select id from ${def.table} where deleted_at is null and ${t.field} is not null
          and upper(regexp_replace(${t.field}, ${KEY_STRIP_SQL}, '', 'g')) = $1 limit 1`, [key]);
    if (hit) return (await usable(t.type, hit.id)) ? { type: t.type, id: hit.id, outcome: 'current' } : null;
  }
  const exact = value.trim().toLowerCase();
  const hits: { type: string; id: string }[] = [];
  for (const t of inUse) {
    const def = ctx.resources.get(t.type)!;
    for (const i of t.identifiers) {
      if (!def.fields[i.field] && i.field !== 'ref') continue;
      const rows = await ctx.db.query<Row>(
        `select id from ${def.table} where deleted_at is null and lower(trim(${i.field})) = $1 and ${ctx.resources.visibleWhere(t.type, req.user)} limit 2`, [exact]);
      for (const r of rows) if (!hits.some((h) => h.type === t.type && h.id === r.id)) hits.push({ type: t.type, id: r.id });
    }
  }
  if (hits.length === 1 && (await usable(hits[0].type, hits[0].id))) return { ...hits[0], outcome: 'identifier' };
  return null;
}

/** Records a find: one atomic insert-or-update, so two people finding the same record at once agree. */
async function markFound(ctx: ModuleContext, req: FastifyRequest, count: Row, type: string, id: string, value: string | null, source: string | null): Promise<CountFoundResult> {
  const result = await ctx.db.tx(async (tx) => {
    // A shared lock: finds go side by side, finishing waits for them (and they for it).
    const c = await tx.one<Row>(`select status from inventory_counts where id = $1 and deleted_at is null for share`, [count.id]);
    if (c?.status !== 'open') return { closed: true as const };
    const row = await tx.one<Row>(
      `insert into inventory_count_items (count_id, record_type, record_id, expected, state, found_at, found_by, found_value, found_source)
       values ($1, $2, $3, false, 'found', now(), $4, $5, $6)
       on conflict (count_id, record_type, record_id) do update
          set state = 'found', found_at = now(), found_by = excluded.found_by, found_value = excluded.found_value, found_source = excluded.found_source
        where inventory_count_items.state <> 'found'
       returning *`, [count.id, type, id, req.user!.id, value, source]);
    if (row) {
      await tx.query(
        `insert into tag_verifications (record_type, record_id, verified_at, site_id, count_id, verified_by) values ($1, $2, now(), $3, $4, $5)
         on conflict (record_type, record_id) do update set verified_at = excluded.verified_at, site_id = excluded.site_id,
           count_id = excluded.count_id, verified_by = excluded.verified_by`, [type, id, count.site_id, count.id, req.user!.id]);
    }
    const item = row ?? (await tx.one<Row>(`select * from inventory_count_items where count_id = $1 and record_type = $2 and record_id = $3`, [count.id, type, id]));
    return { closed: false as const, fresh: Boolean(row), item: item! };
  });
  if (result.closed) ctx.fail(409, 'not_open', 'This count is no longer open.');
  const { fresh, item } = result as { fresh: boolean; item: Row };
  const full = await ctx.db.one<Row>(`${ITEM_SELECT} where i.id = $1`, [item.id]);
  const [view] = await itemViews(ctx, req, [full!]);
  if (!fresh) return { outcome: 'already_found', item: view, message: `${view.label} was already found.` };
  await ctx.audit(req, {
    action: `${COUNT_TYPE}.found`, recordType: COUNT_TYPE, recordId: count.id,
    summary: `${item.expected ? 'Found' : 'Found (unexpected)'}: ${view.label}`, after: { record_type: type, record_id: id, value, source },
  });
  return item.expected
    ? { outcome: 'found', item: view, message: `${view.label} found.` }
    : { outcome: 'unexpected', item: view, message: `${view.label} is registered somewhere else. It was added to this count as unexpected.` };
}

/** Finishes a count: what was not found is missing; the summary is kept on the count. */
async function finish(ctx: ModuleContext, req: FastifyRequest, count: Row): Promise<CountFinishResult> {
  const summary = await ctx.db.tx(async (tx) => {
    const c = await tx.one<Row>(
      `update inventory_counts set status = 'finished', finished_at = now(), finished_by = $2, updated_at = now(), updated_by = $2
        where id = $1 and status = 'open' and deleted_at is null returning id`, [count.id, req.user!.id]);
    if (!c) return null;
    await tx.query(`update inventory_count_items set state = 'missing' where count_id = $1 and expected and state = 'pending'`, [count.id]);
    const t = await tx.one<Row>(
      `select count(*) filter (where expected)::int as expected, count(*) filter (where expected and state = 'found')::int as found,
              count(*) filter (where not expected)::int as unexpected, count(*) filter (where expected and state = 'missing')::int as missing
         from inventory_count_items where count_id = $1`, [count.id]);
    const s = { expected: t!.expected, found: t!.found, unexpected: t!.unexpected, missing: t!.missing };
    await tx.query('update inventory_counts set summary = $2 where id = $1', [count.id, JSON.stringify(s)]);
    return s;
  });
  if (!summary) ctx.fail(409, 'not_open', 'This count is no longer open.');
  await ctx.audit(req, {
    action: `${COUNT_TYPE}.finish`, recordType: COUNT_TYPE, recordId: count.id,
    summary: `Inventory count finished: ${summary!.found} of ${summary!.expected} found, ${summary!.unexpected} unexpected, ${summary!.missing} missing`,
    before: { status: 'open' }, after: { status: 'finished', summary },
  });
  const rows = await ctx.db.query<Row>(`${ITEM_SELECT} where i.count_id = $1 and (i.state = 'missing' or not i.expected) order by i.record_type, i.found_at`, [count.id]);
  const views = await itemViews(ctx, req, rows);
  return { summary: summary!, missing: views.filter((v) => v.expected), unexpected: views.filter((v) => !v.expected) };
}

/** After finishing: move unexpected records here, mark missing ones missing, or leave them. */
async function resolve(ctx: ModuleContext, req: FastifyRequest, count: Row, body: CountResolveRequest) {
  const fields: Record<string, string> = {};
  if (!Array.isArray(body.itemIds) || !body.itemIds.length || body.itemIds.length > 500 || !body.itemIds.every((x) => typeof x === 'string' && UUID_RE.test(x))) fields.itemIds = 'Choose between 1 and 500 items.';
  if (!['moved', 'marked_missing', 'left'].includes(body.resolution)) fields.resolution = 'Choose move here, mark missing or leave as it is.';
  if (Object.keys(fields).length) invalid(ctx, fields);
  if (count.status !== 'finished') ctx.fail(409, 'not_finished', 'Finish the count before deciding what to do with its differences.');
  const rows = await ctx.db.query<Row>(`${ITEM_SELECT} where i.count_id = $1 and i.id = any($2::uuid[])`, [count.id, body.itemIds]);
  const views = new Map((await itemViews(ctx, req, rows)).map((v) => [v.id, v]));
  const refused: { itemId: string; label: string; message: string }[] = [];
  let resolved = 0;
  for (const r of rows) {
    const view = views.get(r.id)!;
    const refuse = (message: string) => { refused.push({ itemId: r.id, label: view.label, message }); };
    const t = taggable(ctx.app, ctx.resources, r.record_type);
    const def = ctx.resources.get(r.record_type);
    if (body.resolution !== 'left') {
      if (!t || !def || !view.route) { refuse('You may not change this record.'); continue; }
      if (!ctx.can(req.user!, `${def.module}.edit`)) { refuse(`You may not edit ${def.plural.toLowerCase()}.`); continue; }
    }
    try {
      if (body.resolution === 'moved') {
        if (r.expected) { refuse('Only unexpected records can be moved here.'); continue; }
        if (t!.siteField === 'id' || !t!.siteField) { refuse(`A ${def!.label.toLowerCase()} cannot be moved.`); continue; }
        const patch: Row = { [t!.siteField]: count.site_id };
        if (t!.locationField && count.area) patch[t!.locationField] = count.area;
        await ctx.resources.update(r.record_type, r.record_id, patch, req);
      } else if (body.resolution === 'marked_missing') {
        if (!r.expected || r.state !== 'missing') { refuse('Only missing records can be marked missing.'); continue; }
        const list = t!.statusField ? def!.fields[t!.statusField]?.list : undefined;
        if (list && (await ctx.lookups.values(list)).some((v) => v.value === MISSING_STATUS)) {
          await ctx.resources.update(r.record_type, r.record_id, { [t!.statusField!]: MISSING_STATUS }, req);
        }
      } else if (r.expected && r.state !== 'missing') {
        refuse('Only missing or unexpected records need a decision.'); continue;
      }
    } catch (err) {
      refuse(err instanceof Error ? err.message : 'The record could not be changed.');
      continue;
    }
    await ctx.db.query(`update inventory_count_items set resolution = $2, resolved_at = now(), resolved_by = $3 where id = $1`, [r.id, body.resolution, req.user!.id]);
    resolved += 1;
  }
  if (resolved) {
    const words = { moved: 'moved here', marked_missing: 'marked missing', left: 'left as they are' }[body.resolution];
    await ctx.audit(req, { action: `${COUNT_TYPE}.resolve`, recordType: COUNT_TYPE, recordId: count.id, summary: `${resolved} record(s) ${words}`, after: { resolution: body.resolution, items: resolved } });
  }
  return { resolved, refused };
}

/** The discrepancy summary as text (labels only of records the person may see). */
async function discrepancyText(ctx: ModuleContext, req: FastifyRequest, count: Row): Promise<string> {
  const rows = await ctx.db.query<Row>(`${ITEM_SELECT} where i.count_id = $1 and (i.state = 'missing' or not i.expected) order by i.record_type`, [count.id]);
  const views = await itemViews(ctx, req, rows);
  const totals = await countTotals(ctx, count.id);
  const site = (await ctx.resources.labelFor('site', count.site_id)) ?? 'the site';
  const line = (v: CountItemView) => `- ${v.label}${v.ref ? ` (${v.ref})` : ''}${v.resolution ? ` [${{ moved: 'moved here', marked_missing: 'marked missing', left: 'left' }[v.resolution]}]` : ''}`;
  const missing = views.filter((v) => v.expected);
  const unexpected = views.filter((v) => !v.expected);
  return [
    `Inventory count ${count.ref ?? ''} at ${site}${count.area ? `, ${count.area}` : ''}: ${totals.found} of ${totals.expected} expected records found, ${totals.missing} missing, ${totals.unexpected} unexpected.`,
    ...(missing.length ? ['', 'Missing:', ...missing.map(line)] : []),
    ...(unexpected.length ? ['', 'Found here but registered elsewhere:', ...unexpected.map(line)] : []),
  ].join('\n');
}

/** Defines the `inventory_count` record type and its routes (TAGS-COUNTS). */
export async function registerCounts(ctx: ModuleContext): Promise<void> {
  ctx.defineResource({
    type: COUNT_TYPE, table: 'inventory_counts', module: 'tags', label: 'Inventory count', plural: 'Inventory counts',
    path: '/api/inventory-counts', route: '/inventory-counts', titleField: 'title',
    ref: { field: 'ref', prefix: 'CNT-' },
    searchable: ['title', 'area', 'notes'],
    defaultSort: { field: 'started_at', dir: 'desc' },
    evidence: false,
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text' },
      site_id: { label: 'Site', type: 'ref', to: 'site', required: true },
      area: { label: 'Room or area', type: 'text', personal: false, help: 'Only records whose location names it are expected.' },
      record_types: { label: 'Record types', type: 'json', default: [], help: 'Empty means every kind of record kept at a site.' },
      status: { label: 'Status', type: 'lookup', list: 'inventory_count_status', default: 'open', readOnly: true },
      started_at: { label: 'Started', type: 'datetime', readOnly: true },
      started_by: { label: 'Started by', type: 'user', readOnly: true },
      finished_at: { label: 'Finished', type: 'datetime', readOnly: true },
      finished_by: { label: 'Finished by', type: 'user', readOnly: true },
      summary: { label: 'Summary', type: 'json', readOnly: true },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: async (req, data) => {
        if (req && !ctx.can(req.user!, 'tags.count')) ctx.fail(403, 'forbidden', 'Starting an inventory count needs permission to count (Asset tags, count).');
        const countable = countableTypes(ctx).map((t) => t.type);
        const chosen = data.record_types === null || data.record_types === undefined ? [] : data.record_types;
        if (!Array.isArray(chosen) || !chosen.every((x) => typeof x === 'string' && countable.includes(x))) {
          invalid(ctx, { record_types: `Choose from: ${countable.join(', ')} (or none, for every kind).` });
        }
        data.record_types = [...new Set(chosen as string[])];
        data.area = typeof data.area === 'string' && data.area.trim() ? data.area.trim().slice(0, 200) : null;
        if (data.area && !countableTypes(ctx).some((t) => t.locationField && (!data.record_types.length || data.record_types.includes(t.type)))) {
          invalid(ctx, { area: 'None of the chosen kinds of record has a location, so a room or area cannot be counted.' });
        }
        const site = await ctx.resources.find('site', String(data.site_id ?? ''), req?.user ?? null);
        if (!site) invalid(ctx, { site_id: 'Site not found.' });
        if (!data.title) data.title = `${site!.name}${data.area ? `, ${data.area}` : ''}: ${dayInZone()}`;
        data.status = 'open';
        data.started_at = new Date().toISOString();
        data.started_by = req?.user?.id ?? data.started_by ?? null;
        data.finished_at = null;
        data.finished_by = null;
        data.summary = null;
        return data;
      },
      beforeUpdate: (_req, existing, patch) => {
        // The expected list is fixed at the start: what is counted, and where, never changes.
        for (const f of ['site_id', 'area', 'record_types']) {
          if (patch[f] !== undefined && JSON.stringify(patch[f] ?? null) !== JSON.stringify(existing[f] ?? null)) {
            invalid(ctx, { [f]: 'What a count covers is fixed when it starts. Start a new count instead.' });
          }
        }
        return patch;
      },
      afterCreate: async (_req, row) => { await fixExpected(ctx, row); },
    },
  });

  // Who found what and who decided are people's names: anonymizing the count clears them.
  onAnonymize(COUNT_TYPE, async (tx, id) => {
    await tx.query('update inventory_count_items set found_by = null, resolved_by = null where count_id = $1', [id]);
  });

  const base = '/api/inventory-counts';
  const tag = 'Inventory counts';

  // Start a count with tags.count (the generated create needs tags.create too).
  ctx.app.post(`${base}/start`, { preHandler: ctx.requirePerm('tags.count') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const row = await ctx.resources.create(COUNT_TYPE, {
      title: b.title, site_id: b.site_id ?? b.siteId, area: b.area, record_types: b.record_types ?? b.recordTypes ?? [], notes: b.notes,
    }, req);
    reply.code(201);
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/start`, tag, permission: 'tags.count',
    summary: 'Start an inventory count (fixes the expected list)',
    description: 'Creates an `inventory_count` like `POST /api/inventory-counts`, with `tags.count` alone: every countable record at the site (and, with `area`, whose location contains it) of the chosen types is expected. Retired and disposed records are left out.',
    body: '{ site_id, area?, record_types?: [asset | site | vehicle], title?, notes? }', response: 'The new count (201)',
  });

  ctx.app.get(`${base}/countable`, { preHandler: ctx.requirePerm('tags.view') }, async () => ({
    types: countableTypes(ctx).map((t) => ({ type: t.type, label: ctx.resources.get(t.type)!.plural, hasLocation: Boolean(t.locationField) })),
  }));
  ctx.describeRoute({
    method: 'GET', path: `${base}/countable`, tag, permission: 'tags.view',
    summary: 'Kinds of record a count can cover', response: '{ types: [{ type, label, hasLocation }] }',
  });

  ctx.app.get(`${base}/:id/items`, { preHandler: ctx.requirePerm('tags.view') }, async (req): Promise<CountItems> => {
    const count = await visibleCount(ctx, req);
    const q = req.query as { state?: string; expected?: string };
    const where = ['i.count_id = $1'];
    if (q.state && ['pending', 'found', 'missing'].includes(q.state)) where.push(`i.state = '${q.state}'`);
    if (q.expected === 'true' || q.expected === 'false') where.push(`i.expected = ${q.expected}`);
    const rows = await ctx.db.query<Row>(`${ITEM_SELECT} where ${where.join(' and ')} order by i.found_at desc nulls last, i.record_type, i.id limit 5000`, [count.id]);
    return { rows: await itemViews(ctx, req, rows), totals: await countTotals(ctx, count.id) };
  });
  ctx.describeRoute({
    method: 'GET', path: `${base}/:id/items`, tag, permission: 'tags.view',
    summary: 'What a count expects and what was found',
    description: 'Newest finds first. Records the caller may not see are listed without their name. Totals count every item.',
    query: { state: 'pending | found | missing', expected: 'true (expected) | false (unexpected)' },
    response: '{ rows: [CountItemView], totals: { expected, found, unexpected, pending, missing } }',
  });

  ctx.app.post(`${base}/:id/found`, { preHandler: ctx.requirePerm('tags.count') }, async (req): Promise<CountFoundResult> => {
    const count = await visibleCount(ctx, req);
    if (count.status !== 'open') ctx.fail(409, 'not_open', 'This count is no longer open.');
    const b = (req.body ?? {}) as CountFoundRequest;
    const source = typeof b.source === 'string' && ['code', 'text', 'typed', 'handheld'].includes(b.source) ? b.source : 'typed';
    let target: Resolved | null = null;
    let value: string | null = null;
    if (typeof b.value === 'string' && b.value.trim()) {
      value = b.value.trim().slice(0, 200);
      if (!valueKey(value)) invalid(ctx, { value: 'Type or scan a tag number.' });
      target = await resolveValue(ctx, req, value);
      await logLookup(ctx, {
        key: valueKey(value), personId: req.user!.id, source: logSourceOf(source, req), outcome: target?.outcome ?? 'nothing',
        recordType: target?.type ?? null, recordId: target?.id ?? null, action: 'count',
      });
      if (!target) return { outcome: 'not_found', item: null, message: `Nothing found for ${value}.` };
    } else if (typeof b.recordType === 'string' && typeof b.recordId === 'string') {
      const def = ctx.resources.get(b.recordType);
      const ok = def && taggable(ctx.app, ctx.resources, b.recordType) && ctx.can(req.user!, `${def.module}.view`)
        && UUID_RE.test(b.recordId) && (await ctx.resources.find(b.recordType, b.recordId, req.user));
      if (!ok) return { outcome: 'not_found', item: null, message: 'Nothing found.' };
      target = { type: b.recordType, id: b.recordId, outcome: 'current' };
    } else {
      invalid(ctx, { value: 'Type or scan a tag number.' });
    }
    const chosen: string[] = Array.isArray(count.record_types) ? count.record_types : [];
    const t = taggable(ctx.app, ctx.resources, target!.type);
    if (!t?.siteField || (chosen.length && !chosen.includes(target!.type))) {
      const def = ctx.resources.get(target!.type)!;
      return { outcome: 'not_found', item: null, message: `${value ?? 'That'} is ${/^[aeiou]/i.test(def.label) ? 'an' : 'a'} ${def.label.toLowerCase()}, which this count does not cover.` };
    }
    return markFound(ctx, req, count, target!.type, target!.id, value, value ? source : 'list');
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/found`, tag, permission: 'tags.count',
    summary: 'Count a tag (or a record) as found',
    description: 'Give `value` (typed, a handheld scanner, or read by the app: `source` code | text | typed | handheld) or `recordType` and `recordId`. An expected record is marked found; one registered elsewhere is added as unexpected. Finding twice answers `already_found`; several people may count at once. Records the caller may not see, and unknown values, answer `not_found` alike. Every find sets the record\'s last verified date and place and is logged as a lookup (action `count`). 409 `not_open` once the count is finished or canceled.',
    body: '{ value?, source?, recordType?, recordId?, clientId? }',
    response: '{ outcome: found | already_found | unexpected | not_found, item: CountItemView | null, message }',
  });

  ctx.app.post(`${base}/:id/finish`, { preHandler: ctx.requirePerm('tags.count') }, async (req) => finish(ctx, req, await visibleCount(ctx, req)));
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/finish`, tag, permission: 'tags.count',
    summary: 'Finish a count: what was not found is missing',
    response: '{ summary: { expected, found, unexpected, missing }, missing: [CountItemView], unexpected: [CountItemView] }',
  });

  ctx.app.post(`${base}/:id/cancel`, { preHandler: ctx.requirePerm('tags.count') }, async (req) => {
    const count = await visibleCount(ctx, req);
    const done = await ctx.db.one<Row>(
      `update inventory_counts set status = 'canceled', finished_at = now(), finished_by = $2, updated_at = now(), updated_by = $2
        where id = $1 and status = 'open' returning id`, [count.id, req.user!.id]);
    if (!done) ctx.fail(409, 'not_open', 'This count is no longer open.');
    await ctx.audit(req, { action: `${COUNT_TYPE}.cancel`, recordType: COUNT_TYPE, recordId: count.id, summary: 'Inventory count canceled', before: { status: 'open' }, after: { status: 'canceled' } });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/cancel`, tag, permission: 'tags.count',
    summary: 'Cancel an open count (what was found keeps its last verified date)', response: '{ ok: true }',
  });

  ctx.app.post(`${base}/:id/resolve`, { preHandler: ctx.requirePerm('tags.count') }, async (req) => {
    const count = await visibleCount(ctx, req);
    return resolve(ctx, req, count, (req.body ?? {}) as CountResolveRequest);
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/resolve`, tag, permission: 'tags.count',
    summary: 'Decide what to do with a finished count\'s differences',
    description: '`moved`: unexpected records move to the count\'s site (and area, as their location); `marked_missing`: missing records get the status Missing (types with a status); `left`: recorded only. Changing a record needs edit permission on it and goes through the normal update (validation, audit). Items that cannot be resolved are listed in `refused` with the reason.',
    body: '{ itemIds: [uuid], resolution: moved | marked_missing | left }',
    response: '{ resolved: number, refused: [{ itemId, label, message }] }',
  });

  ctx.app.post(`${base}/:id/raise`, { preHandler: ctx.requirePerm('tags.count') }, async (req, reply) => {
    const count = await visibleCount(ctx, req);
    const b = (req.body ?? {}) as Row;
    const kind = b.kind === 'ticket' ? 'ticket' : b.kind === 'action' ? 'action' : null;
    if (!kind) invalid(ctx, { kind: 'Choose a ticket or an action.' });
    if (count.status !== 'finished') ctx.fail(409, 'not_finished', 'Finish the count first.');
    if (!ctx.resources.get(kind!)) ctx.fail(404, 'not_found', kind === 'ticket' ? 'Tickets are not available.' : 'Actions are not available.');
    if (kind === 'ticket' && !ctx.can(req.user!, 'tickets.create')) ctx.fail(403, 'forbidden', 'You may not create tickets.');
    if (kind === 'action' && !ctx.can(req.user!, 'actions.create')) ctx.fail(403, 'forbidden', 'You may not create actions.');
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 300) : `Inventory count differences: ${count.title}`;
    const description = await discrepancyText(ctx, req, count);
    const owner = typeof b.ownerId === 'string' && UUID_RE.test(b.ownerId) ? b.ownerId : null;
    const created = kind === 'ticket'
      ? await ctx.resources.create('ticket', { title, description, ...(owner ? { assignee_id: owner } : {}) }, req)
      : await ctx.resources.create('action', { title, description, owner_id: owner, source: COUNT_TYPE, source_type: COUNT_TYPE, source_id: count.id }, req);
    if (kind === 'ticket') {
      await ctx.db.query(
        `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1, $2, $3, $4, 'related', $5)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [COUNT_TYPE, count.id, 'ticket', created.id, req.user!.id]);
    }
    const raised = [...(Array.isArray(count.summary?.raised) ? count.summary.raised : []), { type: kind, id: created.id, ref: created.ref ?? null }];
    await ctx.db.query(`update inventory_counts set summary = coalesce(summary, '{}'::jsonb) || jsonb_build_object('raised', $2::jsonb) where id = $1`, [count.id, JSON.stringify(raised)]);
    await ctx.audit(req, { action: `${COUNT_TYPE}.raise`, recordType: COUNT_TYPE, recordId: count.id, summary: `${kind === 'ticket' ? 'Ticket' : 'Action'} raised from the differences: ${created.ref ?? title}`, after: { type: kind, id: created.id } });
    reply.code(201);
    return { type: kind, id: created.id, ref: created.ref ?? null, route: `${ctx.resources.get(kind!)!.route}/${created.id}` };
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/raise`, tag, permission: 'tags.count',
    summary: 'Raise a ticket or an action from a finished count\'s discrepancy summary',
    description: 'The description lists the missing and unexpected records (names only of records the caller may see). A ticket is linked to the count; an action has the count as its source (source "Inventory count"). Needs `tickets.create` or `actions.create` as well.',
    body: '{ kind: ticket | action, title?, ownerId? }', response: '{ type, id, ref, route } (201)',
  });

  await registerCountReport(ctx, { countableTypes: () => countableTypes(ctx), goneStatuses: (t) => goneStatuses(ctx, t) });
}

/** Open counts that expect a record or cover its site (for the tag card's "Count it" action, TAGS-LOOKUP). */
export async function openCountsFor(ctx: ModuleContext, req: FastifyRequest, recordType: string, recordId: string): Promise<{ id: string; ref: string | null; title: string }[]> {
  if (!ctx.resources.get(COUNT_TYPE) || !ctx.can(req.user!, 'tags.count')) return [];
  return ctx.db.query<{ id: string; ref: string | null; title: string }>(
    `select c.id, c.ref, c.title from inventory_counts c join inventory_count_items i on i.count_id = c.id
      where c.status = 'open' and c.deleted_at is null and i.record_type = $1 and i.record_id = $2 and i.state = 'pending'
      order by c.started_at desc`, [recordType, recordId]);
}

/** When and where a record was last verified in a count (for the Tags panel, RecordTags.lastVerified). */
export async function lastVerified(ctx: ModuleContext, recordType: string, recordId: string): Promise<{ at: string; siteLabel: string | null; countId: string | null } | null> {
  const v = await ctx.db.one<Row>('select verified_at, site_id, count_id from tag_verifications where record_type = $1 and record_id = $2', [recordType, recordId]);
  if (!v) return null;
  return {
    at: new Date(v.verified_at).toISOString(),
    siteLabel: v.site_id && ctx.resources.get('site') ? await ctx.resources.labelFor('site', v.site_id) : null,
    countId: v.count_id ?? null,
  };
}
