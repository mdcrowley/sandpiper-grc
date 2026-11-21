import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { idParam, label } from './shared.ts';

/**
 * Funding awards (E27-02), what each one paid for (E27-03: assets, vehicles, projects and contracts
 * linked with the relation `funded_by`, contract C7) and the reporting obligations an award creates
 * (E27-04, contract C5: obligations of type `funding_condition` with the award's reporting
 * frequency, made only when the obligations register has those fields).
 */

/** Record types that can be funded by an award, in the order the Funded items tab lists them. */
export const FUNDED_TYPES = ['asset', 'vehicle', 'project', 'contract'] as const;
export const FUNDED_BY = 'funded_by';
/** Relation from an obligation an award created to the award. */
export const CONDITION_OF = 'condition_of';

/** Award statuses under which the funder's reporting runs (obligations are made then). */
const REPORTING_STATUSES = ['awarded', 'active'];

export interface ObligationResult {
  /** False when the obligations register (with type and frequency, contract C5) is not there. */
  available: boolean;
  created: string[];
  reason?: string;
}

/**
 * Makes the award's reporting obligation (every period, at the award's reporting frequency) and its
 * close-out obligation (once, at the close-out date) when they do not exist yet. Never changes an
 * obligation once made: from then on it lives in the obligations register (attested, rolled on).
 * System work: the person who saved the award may not hold obligation permissions themselves.
 */
export async function ensureReportingObligations(ctx: ModuleContext, award: Row): Promise<ObligationResult> {
  const def = ctx.resources.get('obligation');
  if (!def || !def.fields.type || !def.fields.frequency) {
    return { available: false, created: [], reason: 'The obligations register with obligation types and frequencies is not part of this installation.' };
  }
  const types = await ctx.lookups.values(def.fields.type.list ?? 'obligation_type');
  if (!types.some((t) => t.value === 'funding_condition')) {
    return { available: false, created: [], reason: 'The obligation type "Funding condition" is not in the list of obligation types.' };
  }
  const frequencies = (await ctx.lookups.values(def.fields.frequency.list ?? 'obligation_frequency')).map((f) => f.value);
  const present = async (id: string | null) => Boolean(id && await ctx.db.one(`select 1 from ${def.table} where id = $1 and deleted_at is null`, [id]));
  const funder = award.funder_name || 'the funder';
  const created: string[] = [];

  const make = async (column: 'report_obligation_id' | 'closeout_obligation_id', data: Row) => {
    const row = await ctx.resources.create('obligation', data, null);
    await ctx.db.query(`update funding_awards set ${column} = $2 where id = $1`, [award.id, row.id]);
    await ctx.db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation) values ('obligation', $1, 'funding_award', $2, $3)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [row.id, award.id, CONDITION_OF]);
    await ctx.audit(null, {
      action: 'funding_award.obligation', recordType: 'funding_award', recordId: award.id,
      summary: `Obligation ${row.ref ?? row.title} made from ${award.ref}`, after: { obligation_id: row.id, kind: column },
    });
    created.push(row.id);
  };

  if (award.reporting_frequency && frequencies.includes(award.reporting_frequency) && !(await present(award.report_obligation_id))) {
    const freq = label(await ctx.lookups.values('funding_report_frequency'), award.reporting_frequency).toLowerCase();
    await make('report_obligation_id', {
      title: `Funder reporting: ${award.title}`.slice(0, 200),
      source: `${funder}${award.award_number ? `, award ${award.award_number}` : ''}`.slice(0, 200),
      requirement: `Report to ${funder} on award ${award.ref} (${award.title}), ${freq}.`,
      owner_id: award.manager_id ?? null,
      next_due_on: award.next_report_due ?? null,
      type: 'funding_condition',
      frequency: award.reporting_frequency,
    });
  }
  if (award.closeout_due && frequencies.includes('once') && !(await present(award.closeout_obligation_id))) {
    await make('closeout_obligation_id', {
      title: `Close-out: ${award.title}`.slice(0, 200),
      source: `${funder}${award.award_number ? `, award ${award.award_number}` : ''}`.slice(0, 200),
      requirement: `Close out award ${award.ref} (${award.title}) with ${funder}: final report and any return of unspent funds.`,
      owner_id: award.manager_id ?? null,
      next_due_on: award.closeout_due,
      type: 'funding_condition',
      frequency: 'once',
    });
  }
  return { available: true, created };
}

export function registerAwards(ctx: ModuleContext) {
  const { db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  function check(merged: Row) {
    const errors: Record<string, string> = {};
    for (const f of ['amount', 'local_share']) {
      if (merged[f] !== null && merged[f] !== undefined && Number(merged[f]) < 0) errors[f] = 'Give an amount of zero or more.';
    }
    if (merged.period_start && merged.period_end && String(merged.period_end) < String(merged.period_start)) {
      errors.period_end = 'The period cannot end before it starts.';
    }
    if (Object.keys(errors).length) invalid(errors);
  }

  /** Obligations follow the award once it is awarded; a failure there never fails saving the award. */
  async function follow(row: Row) {
    if (!REPORTING_STATUSES.includes(row.status)) return;
    try { await ensureReportingObligations(ctx, row); }
    catch (err) { ctx.app.log.warn({ err, award: row.id }, 'funding: could not make the award\'s reporting obligations'); }
  }

  ctx.defineResource({
    type: 'funding_award', table: 'funding_awards', module: 'funding', label: 'Funding award', plural: 'Funding awards',
    path: '/api/funding-awards', route: '/funding/awards', titleField: 'title',
    ref: { field: 'ref', prefix: 'AWD-' },
    searchable: ['title', 'funder_name', 'program_name', 'award_number', 'notes'],
    defaultSort: { field: 'ref', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Award', type: 'text', required: true },
      funder_name: { label: 'Funder', type: 'text', personal: false },
      program_name: { label: 'Funding program', type: 'text', personal: false },
      award_number: { label: 'Award number', type: 'text' },
      status: { label: 'Status', type: 'lookup', list: 'funding_award_status', default: 'applied' },
      period_start: { label: 'Period starts', type: 'date' },
      period_end: { label: 'Period ends', type: 'date' },
      amount: { label: 'Amount awarded', type: 'currency' },
      local_share: { label: 'Local share', type: 'currency' },
      project_id: { label: 'Project', type: 'ref', to: 'project' },
      manager_id: { label: 'Award manager', type: 'user' },
      reporting_frequency: { label: 'Reporting frequency', type: 'lookup', list: 'funding_report_frequency' },
      next_report_due: { label: 'Next report due', type: 'date' },
      closeout_due: { label: 'Close-out due', type: 'date' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (_req, data) => { check(data); return data; },
      beforeUpdate: (_req, existing, patch) => { check({ ...existing, ...patch }); return patch; },
      afterCreate: (_req, row) => follow(row),
      afterUpdate: (_req, _before, after) => follow(after),
    },
  });

  const view = ctx.requirePerm('funding.view');
  const edit = ctx.requirePerm('funding.edit');

  async function needAward(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('funding_award', idParam(ctx, req), req.user)) ?? ctx.fail(404, 'not_found', 'Funding award not found.');
  }

  /** The records an award paid for that the reader may see, with their type's label and page. */
  async function fundedItems(awardId: string, req: FastifyRequest): Promise<Row[]> {
    const links = await db.query<Row>(
      `select id, from_type, from_id::text as from_id, created_at from record_links
       where to_type = 'funding_award' and to_id = $1 and relation = $2 order by created_at`, [awardId, FUNDED_BY]);
    const out: Row[] = [];
    for (const l of links) {
      const def = ctx.resources.get(l.from_type);
      if (!def || !ctx.can(req.user, `${def.module}.view`)) continue;
      const row = await ctx.resources.find(l.from_type, l.from_id, req.user);
      if (!row) continue;
      out.push({
        link_id: l.id, type: l.from_type, type_label: def.label, id: row.id, route: `${def.route}/${row.id}`,
        ref: def.ref ? row[def.ref.field] ?? null : null, title: row[def.titleField] ?? '', status: row.status ?? null,
        linked_at: l.created_at,
      });
    }
    return out;
  }

  ctx.app.get('/api/funding-awards/:id/funded-items', { preHandler: view }, async (req) => {
    const award = await needAward(req);
    return {
      items: await fundedItems(award.id, req),
      types: FUNDED_TYPES.filter((t) => ctx.resources.get(t)).map((t) => ({ type: t, label: ctx.resources.get(t)!.label })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding-awards/:id/funded-items', tag: 'Funding', permission: 'funding.view',
    summary: 'What an award paid for: the records linked to it as "funded by" (only those the reader may see), and the kinds of record that can be linked',
    response: '{ items: [{ link_id, type, type_label, id, route, ref, title, status, linked_at }], types: [{ type, label }] }',
  });

  ctx.app.post('/api/funding-awards/:id/funded-items', { preHandler: edit }, async (req, reply) => {
    const award = await needAward(req);
    const b = (req.body ?? {}) as Row;
    const type = String(b.type ?? '');
    const id = String(b.id ?? '');
    const def = (FUNDED_TYPES as readonly string[]).includes(type) ? ctx.resources.get(type) : undefined;
    if (!def) ctx.fail(400, 'validation', 'Check the highlighted fields.', { type: `Choose one of: ${FUNDED_TYPES.filter((t) => ctx.resources.get(t)).join(', ')}.` });
    if (!UUID_RE.test(id) || !ctx.can(req.user, `${def!.module}.view`) || !(await ctx.resources.find(type, id, req.user))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { id: `Choose a ${def!.label.toLowerCase()} you can see.` });
    }
    const row = await db.one<Row>(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1,$2,'funding_award',$3,$4,$5)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing returning id`, [type, id, award.id, FUNDED_BY, req.user!.id]);
    if (row) {
      await ctx.audit(req, {
        action: 'funding_award.fund', recordType: 'funding_award', recordId: award.id,
        summary: `${def!.label} ${await ctx.resources.labelFor(type, id) ?? ''} recorded as funded by ${award.ref}`,
        after: { type, id },
      });
    }
    reply.code(row ? 201 : 200);
    return { ok: true, link_id: row?.id ?? null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/funding-awards/:id/funded-items', tag: 'Funding', permission: 'funding.edit',
    summary: 'Record that a record was paid for by the award (a "funded by" link; needs view on that record)',
    body: '{ type: one of the types the GET lists, id: uuid }', response: '{ ok, link_id }',
  });

  ctx.app.delete('/api/funding-awards/:id/funded-items/:linkId', { preHandler: edit }, async (req) => {
    const award = await needAward(req);
    const linkId = idParam(ctx, req, 'linkId');
    const link = await db.one<Row>(
      `select * from record_links where id = $1 and to_type = 'funding_award' and to_id = $2 and relation = $3`, [linkId, award.id, FUNDED_BY]);
    if (!link) ctx.fail(404, 'not_found', 'That item is not linked to this award.');
    await db.query('delete from record_links where id = $1', [linkId]);
    await ctx.audit(req, {
      action: 'funding_award.unfund', recordType: 'funding_award', recordId: award.id,
      summary: `A ${link!.from_type.replace('_', ' ')} is no longer recorded as funded by ${award.ref}`,
      before: { type: link!.from_type, id: link!.from_id },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/funding-awards/:id/funded-items/:linkId', tag: 'Funding', permission: 'funding.edit',
    summary: 'Remove a "funded by" link from the award', response: '{ ok }',
  });

  /** Obligations the award created, as the reader may see them. */
  ctx.app.get('/api/funding-awards/:id/obligations', { preHandler: view }, async (req) => {
    const award = await needAward(req);
    const def = ctx.resources.get('obligation');
    const available = Boolean(def?.fields.type && def?.fields.frequency);
    if (!def || !ctx.can(req.user, 'obligations.view')) return { available, may_view: false, rows: [] };
    const rows = await db.query<Row>(
      `select o.id, o.ref, o.title, o.status, o.owner_id, o.next_due_on::text as next_due_on,
              ${def.fields.frequency ? 'o.frequency' : 'null'} as frequency
       from record_links l join ${def.table} o on o.id = l.from_id
       where l.from_type = 'obligation' and l.to_type = 'funding_award' and l.to_id = $1 and l.relation = $2
         and o.deleted_at is null and ${ctx.resources.visibleWhere('obligation', req.user, 'o')}
       order by o.next_due_on nulls last, o.ref`, [award.id, CONDITION_OF]);
    return { available, may_view: true, rows };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding-awards/:id/obligations', tag: 'Funding', permission: 'funding.view',
    summary: 'The reporting and close-out obligations an award created (needs obligations.view to list them)',
    response: '{ available, may_view, rows: [{ id, ref, title, status, owner_id, next_due_on, frequency }] }',
  });

  ctx.app.post('/api/funding-awards/:id/obligations', { preHandler: edit }, async (req) => {
    const award = await needAward(req);
    if (!ctx.can(req.user, 'obligations.create')) ctx.fail(403, 'forbidden', 'Making obligations also needs permission to create obligations.');
    const result = await ensureReportingObligations(ctx, award);
    if (!result.available) ctx.fail(409, 'obligations_unavailable', result.reason ?? 'Obligations are not available.');
    return result;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/funding-awards/:id/obligations', tag: 'Funding', permission: 'funding.edit',
    summary: 'Make the award\'s reporting and close-out obligations now, when they do not exist yet (also needs obligations.create)',
    response: '{ available, created: [uuid] }',
  });
}
