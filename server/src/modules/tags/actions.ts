import type { FastifyRequest } from 'fastify';
import { allTaggables, taggable, taggables, type TaggableDef } from '../../core/asset-tags.ts';
import { onAnonymize } from '../../core/retention.ts';
import type { Queryable } from '../../core/db.ts';
import { holdsOn } from '../../core/holds.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import type { QuickField, TagAction } from '../../../../shared/asset-tags-api.ts';
import { readSettings as readPortalSettings } from '../portal/settings.ts';
import { openCountsFor } from './counts.ts';

// The actions a person may take from a tag card (E37-06), computed on the server from the person's
// permissions, the switched-on areas, the record's state and its legal holds. Owned by TAGS-LOOKUP.
// The client never decides what is allowed: it draws this list, in this order (spec §4.3 table).
//
// A prefilled new record (report a problem, report a hazard, record condition, start inspection) is
// posted to `prefill.path` through the normal create route, so validation, hooks and audit apply. A
// report about a record the new record has no field for (a ticket about a site or vehicle, a safety
// report about an asset or system) carries `prefill.link`: after creating it, the client links the new
// record to this one (`POST /api/links`). `link` is an addition to the shared TagAction contract.

/** The tag card action as sent: the shared contract, plus the record to link a new record to. */
export type CardAction = TagAction & { prefill: (NonNullable<TagAction['prefill']> & { link?: { type: string; id: string } | null }) | null };

export interface CardInfo {
  def: ResourceDef;
  tdef: TaggableDef;
  /** Under an active legal hold: actions that would change the record are left out (spec §4.4). */
  held: boolean;
  /** The record has an active tag (Replace) or none (Attach). */
  hasTag: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refOf = (def: ResourceDef, row: Row): string | null => (def.ref ? (row[def.ref.field] as string | null) ?? null : null);
const titleOf = (def: ResourceDef, row: Row): string => String(row[def.titleField] ?? '') || refOf(def, row) || def.label;

/** "Asset AST-00012 Laptop (tag TA-118342)": the record in words, for a report's text. */
function describe(def: ResourceDef, tdef: TaggableDef, row: Row): string {
  const name = [refOf(def, row), titleOf(def, row)].filter((v, i, a) => v && a.indexOf(v) === i).join(' ');
  const tag = row[tdef.field] ? ` (tag ${row[tdef.field]})` : '';
  return `${def.label} ${name}${tag}`;
}

async function hasTable(db: Queryable, table: string): Promise<boolean> {
  return Boolean((await db.one<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`]))?.t);
}

async function lookupHas(ctx: ModuleContext, list: string, value: string): Promise<boolean> {
  return (await ctx.lookups.values(list)).some((v) => v.value === value);
}

/** The site a record is at (its own id when it is a site), for reports. */
function siteOf(tdef: TaggableDef, row: Row): string | null {
  if (tdef.siteField === 'id') return String(row.id);
  return tdef.siteField && typeof row[tdef.siteField] === 'string' ? row[tdef.siteField] : null;
}

async function quickFields(ctx: ModuleContext, def: ResourceDef, tdef: TaggableDef, row: Row): Promise<QuickField[]> {
  const out: QuickField[] = [];
  for (const name of tdef.quickFields ?? []) {
    const f = def.fields[name];
    if (!f || f.readOnly) continue;
    const type = f.type === 'lookup' || f.type === 'user' || f.type === 'ref' ? f.type : f.type === 'text' ? 'text' : null;
    if (!type) continue;
    if (type === 'ref' && (!f.to || !ctx.resources.get(f.to))) continue;
    const value = row[name] ?? null;
    let display: string | null = null;
    if (value !== null && value !== '') {
      if (type === 'lookup' && f.list) display = (await ctx.lookups.values(f.list)).find((v) => v.value === value)?.label ?? String(value);
      else if (type === 'user') display = (await ctx.db.one<{ n: string }>(`select coalesce(nullif(display_name, ''), username) as n from users where id::text = $1`, [String(value)]))?.n ?? null;
      else if (type === 'ref') display = f.to ? await ctx.resources.labelFor(f.to, String(value)) : null;
      else display = String(value);
    }
    out.push({ field: name, label: f.label, type, ...(f.list ? { list: f.list } : {}), ...(f.to ? { to: f.to } : {}), value, display });
  }
  return out;
}

/** Report a problem: a service desk ticket (agents) or the portal's problem form (requesters). */
async function reportProblem(ctx: ModuleContext, req: FastifyRequest, def: ResourceDef, tdef: TaggableDef, row: Row): Promise<CardAction | null> {
  const what = describe(def, tdef, row);
  const title = `Problem with ${titleOf(def, row)}`.slice(0, 200);
  if (ctx.resources.get('ticket') && ctx.can(req.user, 'tickets.create')) {
    const values: Row = { type: 'incident', title, description: `Reported from the tag of ${what}.` };
    if (tdef.type === 'asset') values.asset_id = row.id;
    if (tdef.type === 'system') values.system_id = row.id;
    if (tdef.type === 'asset' && row.system_id && ctx.resources.get('system')) values.system_id = row.system_id;
    const direct = tdef.type === 'asset' || tdef.type === 'system';
    return {
      key: 'report_problem', label: 'Report a problem', webPath: null,
      prefill: { type: 'ticket', path: '/api/tickets', values, link: direct ? null : { type: tdef.type, id: String(row.id) } },
    };
  }
  // Requesters raise it in the portal (portal.create holds only while the portal is switched on).
  if (ctx.resources.get('ticket') && ctx.can(req.user, 'portal.create')) {
    const where = what.slice(0, 200);
    return {
      key: 'report_problem', label: 'Report a problem',
      webPath: `/portal/report?${new URLSearchParams({ what: title, where }).toString()}`,
      prefill: { type: 'ticket', path: '/api/portal/requests', values: { title, where } },
    };
  }
  return null;
}

/** Report a hazard or close call: a safety event at the record's site with the record linked. */
async function reportHazard(ctx: ModuleContext, req: FastifyRequest, def: ResourceDef, tdef: TaggableDef, row: Row): Promise<CardAction | null> {
  const events = ctx.resources.get('safety_event');
  if (!events) return null;
  const what = describe(def, tdef, row);
  const title = `Hazard at ${titleOf(def, row)}`.slice(0, 200);
  if (ctx.can(req.user, 'safety.create')) {
    const values: Row = { title, occurred_at: new Date().toISOString(), location_detail: what.slice(0, 200) };
    if (await lookupHas(ctx, 'safety_event_type', 'unsafe_condition')) values.event_type = 'unsafe_condition';
    if (await lookupHas(ctx, 'safety_event_severity', 'no_harm')) values.severity = 'no_harm';
    const site = siteOf(tdef, row);
    if (site && ctx.resources.get('site')) values.site_id = site;
    if (tdef.type === 'vehicle') values.vehicle_id = row.id;
    const linked = tdef.type !== 'vehicle' && tdef.type !== 'site';
    return {
      key: 'report_hazard', label: 'Report a hazard or close call', webPath: null,
      prefill: { type: 'safety_event', path: events.path, values, link: linked ? { type: tdef.type, id: String(row.id) } : null },
    };
  }
  if (ctx.can(req.user, 'portal.create') && (await readPortalSettings(ctx)).safety_reports) {
    const where = what.slice(0, 200);
    return {
      key: 'report_hazard', label: 'Report a hazard or close call',
      webPath: `/portal/safety?${new URLSearchParams({ where }).toString()}`,
      prefill: { type: 'safety_event', path: '/api/portal/safety-reports', values: { title, where } },
    };
  }
  return null;
}

/** Record condition: a new condition assessment of the record (the Asset condition area). */
async function recordCondition(ctx: ModuleContext, req: FastifyRequest, tdef: TaggableDef, row: Row): Promise<CardAction | null> {
  const res = ctx.resources.get('condition_assessment');
  if (!res || !ctx.can(req.user, `${res.module}.create`)) return null;
  if (!(await lookupHas(ctx, 'condition_target_type', tdef.type))) return null;
  return {
    key: 'record_condition', label: 'Record condition', webPath: null,
    prefill: { type: 'condition_assessment', path: res.path, values: { target_type: tdef.type, target_id: String(row.id), assessed_on: dayInZone() } },
  };
}

/** Start inspection: the record's open inspection, or a new one when an inspection checklist applies. */
async function startInspection(ctx: ModuleContext, req: FastifyRequest, tdef: TaggableDef, row: Row): Promise<CardAction | null> {
  const res = ctx.resources.get('inspection');
  if (!res || !ctx.can(req.user, `${res.module}.view`)) return null;
  if (!(await lookupHas(ctx, 'inspection_target_type', tdef.type))) return null;
  if (ctx.can(req.user, `${res.module}.edit`)) {
    const open = await ctx.db.one<{ id: string }>(
      `select i.id from inspections i where i.deleted_at is null and i.target_type = $1 and i.target_id = $2 and i.status in ('scheduled', 'in_progress')
         and ${ctx.resources.visibleWhere('inspection', req.user, 'i')} order by i.due_on nulls last, i.created_at limit 1`, [tdef.type, String(row.id)]);
    if (open) return { key: 'start_inspection', label: 'Start inspection', webPath: `${res.route}/${open.id}/run`, prefill: null };
  }
  if (!ctx.can(req.user, `${res.module}.create`) || !ctx.resources.get('checklist_template')) return null;
  const templates = await ctx.db.query<{ id: string }>(
    `select id from checklist_templates where deleted_at is null and active is not false and kind = 'inspection' and target_type = $1 order by name limit 2`, [tdef.type]);
  if (!templates.length) return null;
  const values: Row = { target_type: tdef.type, target_id: String(row.id), due_on: dayInZone(), inspector_id: req.user!.id };
  if (templates.length === 1) values.template_id = templates[0].id;
  return { key: 'start_inspection', label: 'Start inspection', webPath: null, prefill: { type: 'inspection', path: res.path, values } };
}

/** Count it: an open inventory count this record is on and still waits to be found. */
async function countIt(ctx: ModuleContext, req: FastifyRequest, tdef: TaggableDef, row: Row): Promise<CardAction | null> {
  // The open counts this record waits in (TAGS-COUNTS decides: tags.count, the type on, item pending).
  const [c] = await openCountsFor(ctx, req, tdef.type, String(row.id));
  if (!c) return null;
  return { key: 'count', label: c.ref ? `Count it in ${c.ref}` : 'Count it', webPath: `/inventory-counts/${c.id}`, prefill: null, countId: c.id };
}

/**
 * The actions for one found record, in display order (spec §4.3 table). `info` is what the card
 * already worked out; without it the definitions and holds are read here.
 */
export async function cardActions(ctx: ModuleContext, req: FastifyRequest, recordType: string, row: Row, info?: CardInfo): Promise<CardAction[]> {
  const def = info?.def ?? ctx.resources.get(recordType);
  const tdef = info?.tdef ?? taggable(ctx.app, ctx.resources, recordType);
  if (!def || !tdef) return [];
  const id = String(row.id);
  const held = info?.held ?? (await holdsOn(ctx.db, recordType, id)).length > 0;
  const hasTag = info?.hasTag ?? Boolean(row[tdef.field]);
  const route = `${def.route}/${id}`;
  const mayEdit = ctx.can(req.user, `${def.module}.edit`);
  const out: CardAction[] = [];
  const push = (a: CardAction | null) => { if (a) out.push(a); };

  push(await reportProblem(ctx, req, def, tdef, row));
  push(await reportHazard(ctx, req, def, tdef, row));
  if (mayEdit && !held) push({ key: 'edit', label: 'Edit', webPath: route, prefill: null });
  if (mayEdit && !held) {
    const fields = await quickFields(ctx, def, tdef, row);
    if (fields.length) push({ key: 'quick_update', label: 'Quick update', webPath: null, prefill: null, fields });
  }
  // Adding a photo or a note adds to the record without changing what it holds, so a hold allows it.
  if (mayEdit && (await hasTable(ctx.db, 'attachments'))) push({ key: 'add_photo', label: 'Add photo', webPath: null, prefill: null });
  push({ key: 'add_note', label: 'Add note', webPath: null, prefill: null });
  push(await recordCondition(ctx, req, tdef, row));
  push(await startInspection(ctx, req, tdef, row));
  push(await countIt(ctx, req, tdef, row));
  if (mayEdit && !held && ctx.can(req.user, 'tags.manage')) {
    push(hasTag
      ? { key: 'replace_tag', label: 'Replace tag', webPath: `${route}?tab=tags`, prefill: null }
      : { key: 'attach', label: 'Attach a tag', webPath: `${route}?tab=tags`, prefill: null });
  }
  push({ key: 'open', label: 'Open full record', webPath: route, prefill: null });
  return out;
}

// ---------- the record's photo (E37-06) ----------

/** Forgets a record's photo (anonymizing or removing the record: TAGS-CORE's retention hook may call it). */
export async function forgetRecordPhoto(db: Queryable, recordType: string, recordId: string): Promise<void> {
  await db.query('delete from tag_record_photos where record_type = $1 and record_id = $2', [recordType, recordId]);
}

/** Routes of the card's actions: the record's photo and the types a tag can be attached to. */
export async function registerActionRoutes(ctx: ModuleContext): Promise<void> {
  const { app } = ctx;

  // Anonymizing or removing a taggable record forgets which of its pictures the tag card shows
  // (the picture itself is handled with the record's files). Registered once every module has
  // defined its types, with its own owner so other modules' hooks on the same types still run.
  app.addHook('onReady', async () => {
    for (const t of allTaggables(app)) {
      onAnonymize(t.type, (tx, id) => forgetRecordPhoto(tx as unknown as Queryable, t.type, id), 'tags.photos');
    }
  });
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (action !== 'purge' || !allTaggables(app).some((t) => t.type === def.type)) return;
    await forgetRecordPhoto(ctx.db, def.type, String(row.id));
  });

  app.put('/api/asset-tags/photo', async (req) => {
    const b = (req.body ?? {}) as Row;
    const type = typeof b.recordType === 'string' ? b.recordType : '';
    const id = typeof b.recordId === 'string' && UUID_RE.test(b.recordId) ? b.recordId : '';
    const tdef = type ? taggable(ctx.app, ctx.resources, type) : undefined;
    const def = tdef ? ctx.resources.get(type) : undefined;
    const row = def && id && ctx.can(req.user, `${def.module}.view`) ? await ctx.resources.find(type, id, req.user) : undefined;
    if (!def || !row) return ctx.fail(404, 'not_found', 'Record not found.');
    if (!ctx.can(req.user, `${def.module}.edit`)) ctx.fail(403, 'forbidden', 'You do not have permission to change this record.');
    const before = await ctx.db.one<{ attachment_id: string }>('select attachment_id from tag_record_photos where record_type = $1 and record_id = $2', [type, id]);
    if (b.attachmentId === null || b.attachmentId === undefined || b.attachmentId === '') {
      await forgetRecordPhoto(ctx.db, type, id);
      if (before) await ctx.audit(req, { action: 'tag.photo', recordType: type, recordId: id, summary: 'Photo on the tag card removed', before: { attachment_id: before.attachment_id } });
      return { photo: null };
    }
    const att = typeof b.attachmentId === 'string' && UUID_RE.test(b.attachmentId) && (await hasTable(ctx.db, 'attachments'))
      ? await ctx.db.one<Row>('select id, file_name, content_type, description from attachments where id = $1 and record_type = $2 and record_id = $3 and deleted_at is null', [b.attachmentId, type, id])
      : undefined;
    if (!att) return ctx.fail(400, 'validation', 'Check the highlighted fields.', { attachmentId: 'Choose a picture attached to this record.' });
    if (!String(att.content_type).startsWith('image/')) ctx.fail(400, 'validation', 'Check the highlighted fields.', { attachmentId: 'Only a picture (an image file) can be the record\'s photo.' });
    await ctx.db.query(
      `insert into tag_record_photos (record_type, record_id, attachment_id, set_by) values ($1, $2, $3, $4)
       on conflict (record_type, record_id) do update set attachment_id = excluded.attachment_id, set_at = now(), set_by = excluded.set_by`,
      [type, id, att.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'tag.photo', recordType: type, recordId: id, summary: `Photo on the tag card set: ${att.file_name}`,
      before: before ? { attachment_id: before.attachment_id } : undefined, after: { attachment_id: att.id },
    });
    return { photo: { attachmentId: att.id, url: `/api/attachments/${att.id}/download`, description: att.description ?? null } };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/asset-tags/photo', tag: 'Asset tags',
    summary: 'Mark one picture attached to an asset, vehicle, site or system as its photo on the tag card (or clear it)',
    description: 'Needs edit permission on the record. Audited as tag.photo.',
    body: '{ recordType, recordId, attachmentId: an image attachment of that record, or null to clear }',
    response: '{ photo: { attachmentId, url, description } | null }',
  });

  app.get('/api/asset-tags/taggables', async (req) => {
    return taggables(ctx.app, ctx.resources)
      .map((t) => ({ t, def: ctx.resources.get(t.type)! }))
      .filter(({ def }) => ctx.can(req.user, `${def.module}.view`))
      .map(({ t, def }) => ({ type: t.type, label: def.label, plural: def.plural, field: t.field, canEdit: ctx.can(req.user, `${def.module}.edit`) }));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/taggables', tag: 'Asset tags',
    summary: 'The record types that carry asset tags and that you may see (for choosing where to attach a tag)',
    response: '[{ type, label, plural, field, canEdit }]',
  });
}
