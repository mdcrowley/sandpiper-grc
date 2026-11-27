// Records retention schedule and destruction log (E41-15): the organization's own business records,
// paper and electronic, grouped into record series, each kept for a period after a trigger event
// (created, closed, end of the fiscal year, an employee leaving...) and then destroyed, transferred
// to an archive or reviewed; and the log of each batch of records destroyed, approved first through
// the "Records destruction" approval workflow and recorded with its certificate afterwards.
//
// This is not the application's own data retention (core/retention.ts, Administration > Retention).
// Legal holds apply: a series (or a destruction entry) placed under an active hold cannot be
// submitted, approved or carried out until the hold is released (core/holds.ts).
//
// Permission module `records` (shared with records requests); feature area `recordsretention`, which
// needs the records area. Record types `record_series` and `records_destruction`.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { routePattern } from '../../core/api/versioning.ts';
import { defineCalendarSource } from '../../core/calendar.ts';
import { UUID_RE } from '../../core/errors.ts';
import { assertNotHeld, holdsOn } from '../../core/holds.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { notePermission } from '../../core/permission-use.ts';
import { dayInZone } from '../../core/timezone.ts';
import { seedRetention } from './seed.ts';
import { eligibleOn, periodText } from './periods.ts';

export const SERIES = 'record_series';
export const DESTRUCTION = 'records_destruction';
export const DESTRUCTION_KIND = 'records_destruction';

/** Statuses of a destruction entry that are part of the log for good (never deleted, details fixed). */
const LOCKED = new Set(['pending_approval', 'approved', 'done']);
/** What may still change on a locked entry. */
const ALWAYS_EDITABLE = new Set(['notes', 'custom', 'tags']);

export const DEFAULT_DESTRUCTION_WORKFLOW = {
  name: 'Records destruction',
  description: 'Destroying or transferring a batch of records at the end of its retention period. Someone who may approve records work decides.',
  steps: [{ key: 'records-approver', name: 'Records approver', approvers: { kind: 'permission', permission: 'records.approve' }, quorum: 'any', due_hours: 240 }],
};

const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'records' };
  await ctx.lookups.ensure('record_series_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'active', label: 'Active', color: 'green', sort: 20 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 30 },
  ], own);
  await ctx.lookups.ensure('record_series_category', [
    { value: 'administration', label: 'Administration', sort: 10 },
    { value: 'finance', label: 'Finance and procurement', sort: 20 },
    { value: 'operations', label: 'Operations and service', sort: 30 },
    { value: 'maintenance', label: 'Vehicle and facility maintenance', sort: 40 },
    { value: 'safety', label: 'Safety and security', sort: 50 },
    { value: 'personnel', label: 'Personnel', sort: 60 },
    { value: 'legal', label: 'Legal and governance', sort: 70 },
    { value: 'technology', label: 'Information technology', sort: 80 },
  ], own);
  await ctx.lookups.ensure('record_medium', [
    { value: 'paper', label: 'Paper', color: 'amber', sort: 10 },
    { value: 'electronic', label: 'Electronic', color: 'blue', sort: 20 },
    { value: 'both', label: 'Paper and electronic', color: 'teal', sort: 30 },
  ], own);
  await ctx.lookups.ensure('retention_unit', [
    { value: 'days', label: 'Days', sort: 10 },
    { value: 'months', label: 'Months', sort: 20 },
    { value: 'years', label: 'Years', sort: 30 },
  ], own);
  await ctx.lookups.ensure('retention_trigger', [
    { value: 'created', label: 'Created or received', sort: 10 },
    { value: 'closed', label: 'File or case closed', sort: 20 },
    { value: 'fiscal_year_end', label: 'End of the fiscal year', sort: 30 },
    { value: 'calendar_year_end', label: 'End of the calendar year', sort: 40 },
    { value: 'superseded', label: 'Superseded or replaced', sort: 50 },
    { value: 'contract_end', label: 'Contract or grant ends', sort: 60 },
    { value: 'separation', label: 'Employee leaves', sort: 70 },
    { value: 'asset_disposed', label: 'Asset or vehicle disposed of', sort: 80 },
    { value: 'event', label: 'Other event (see the note)', sort: 90 },
  ], own);
  await ctx.lookups.ensure('record_disposition', [
    { value: 'destroy', label: 'Destroy', color: 'red', sort: 10 },
    { value: 'transfer', label: 'Transfer to an archive', color: 'blue', sort: 20 },
    { value: 'review', label: 'Review, then decide', color: 'amber', sort: 30 },
  ], own);
  await ctx.lookups.ensure('destruction_status', [
    { value: 'proposed', label: 'Proposed', color: 'gray', sort: 10 },
    { value: 'pending_approval', label: 'Waiting for approval', color: 'amber', sort: 20 },
    { value: 'approved', label: 'Approved', color: 'blue', sort: 30 },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 40 },
    { value: 'done', label: 'Carried out', color: 'green', sort: 50 },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 60 },
  ], own);
  await ctx.lookups.ensure('destruction_method', [
    { value: 'shredding', label: 'Shredding', sort: 10 },
    { value: 'pulping', label: 'Pulping', sort: 20 },
    { value: 'incineration', label: 'Incineration', sort: 30 },
    { value: 'secure_deletion', label: 'Secure deletion (electronic)', sort: 40 },
    { value: 'media_destruction', label: 'Destruction of the storage media', sort: 50 },
    { value: 'transfer', label: 'Transfer to an archive', sort: 60 },
  ], own);
}

async function register(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  // ---------------------------------------------------------------- the schedule

  const checkSeries = (row: Row) => {
    if (row.permanent) return;
    const v = row.retention_value === null || row.retention_value === undefined || row.retention_value === '' ? null : Number(row.retention_value);
    if (v === null) invalid({ retention_value: 'Say how long the records are kept, or mark the series as kept permanently.' });
    if (!Number.isFinite(v) || v! <= 0 || v! > 1000) invalid({ retention_value: 'Give a period greater than zero.' });
  };

  ctx.defineResource({
    type: SERIES, table: 'record_series', module: 'records', label: 'Record series', plural: 'Record series',
    path: '/api/record-series', route: '/retention-schedule', titleField: 'title',
    ref: { field: 'ref', prefix: 'RS-' },
    searchable: ['title', 'code', 'description', 'authority', 'location'],
    defaultSort: { field: 'title', dir: 'asc' },
    scope: { department: 'department_id' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      code: { label: 'Schedule number', type: 'text', personal: false },
      title: { label: 'Title', type: 'text', required: true, personal: false },
      description: { label: 'What the records are', type: 'longtext', personal: false },
      category: { label: 'Category', type: 'lookup', list: 'record_series_category' },
      medium: { label: 'Kept on', type: 'lookup', list: 'record_medium', default: 'paper', required: true },
      status: { label: 'Status', type: 'lookup', list: 'record_series_status', default: 'active', required: true },
      owner_id: { label: 'Records owner', type: 'user' },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      location: { label: 'Where they are kept', type: 'text', personal: false },
      system_id: { label: 'System holding them', type: 'ref', to: 'system' },
      retention_value: { label: 'Keep for', type: 'number' },
      retention_unit: { label: 'Unit', type: 'lookup', list: 'retention_unit', default: 'years', required: true },
      permanent: { label: 'Kept permanently', type: 'boolean', default: false },
      trigger_event: { label: 'Counted from', type: 'lookup', list: 'retention_trigger', default: 'created', required: true },
      trigger_note: { label: 'About the trigger', type: 'text', personal: false },
      disposition: { label: 'At the end', type: 'lookup', list: 'record_disposition', default: 'destroy', required: true },
      authority: { label: 'Authority', type: 'text', personal: false },
      vital: { label: 'Vital record', type: 'boolean', default: false },
      personal_data: { label: 'Holds personal data', type: 'boolean', default: false },
      review_on: { label: 'Next review', type: 'date' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: async (_req, data) => {
        if (data.permanent) data.retention_value = null;
        checkSeries(data);
        return data;
      },
      beforeUpdate: async (_req, existing, patch) => {
        if (patch.permanent === true) patch.retention_value = null;
        checkSeries({ ...existing, ...patch });
        return patch;
      },
    },
  });

  // ---------------------------------------------------------------- the destruction log

  const seriesOf = async (id: unknown): Promise<Row | undefined> =>
    typeof id === 'string' && UUID_RE.test(id) ? db.one<Row>('select * from record_series where id = $1 and deleted_at is null', [id]) : undefined;

  /** Fills the dates the series decides, and refuses what the series does not allow. */
  const prepareDestruction = async (merged: Row, out: Row) => {
    const series = await seriesOf(merged.series_id);
    if (!series) invalid({ series_id: 'Choose a record series.' });
    if (series!.permanent) invalid({ series_id: 'Records of a series kept permanently are never destroyed.' });
    if (merged.records_from && merged.records_to && String(ymd(merged.records_to)) < String(ymd(merged.records_from))) {
      invalid({ records_to: 'The last date must be on or after the first.' });
    }
    if (!merged.medium) out.medium = series!.medium === 'both' ? null : series!.medium;
    out.eligible_on = eligibleOn(ymd(merged.trigger_date) ?? ymd(merged.records_to), series!);
    return out;
  };

  ctx.defineResource({
    type: DESTRUCTION, table: 'records_destructions', module: 'records', label: 'Records destruction', plural: 'Destruction log',
    path: '/api/records-destructions', route: '/destruction-log', titleField: 'title',
    ref: { field: 'ref', prefix: 'DST-' },
    searchable: ['title', 'description', 'quantity', 'location', 'certificate_ref'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    evidence: true, // the certificate of destruction
    scope: { department: (col) => `(select s.department_id from record_series s where s.id = ${col('series_id')})` },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, personal: false },
      series_id: { label: 'Record series', type: 'ref', to: SERIES, required: true },
      description: { label: 'Which records', type: 'longtext', personal: false },
      medium: { label: 'Kept on', type: 'lookup', list: 'record_medium' },
      records_from: { label: 'Records from', type: 'date' },
      records_to: { label: 'Records to', type: 'date' },
      trigger_date: { label: 'Trigger date', type: 'date' },
      eligible_on: { label: 'May be destroyed from', type: 'date', readOnly: true },
      quantity: { label: 'Quantity', type: 'text', personal: false },
      location: { label: 'Where they are', type: 'text', personal: false },
      method: { label: 'Method', type: 'lookup', list: 'destruction_method' },
      status: { label: 'Status', type: 'lookup', list: 'destruction_status', default: 'proposed', readOnly: true },
      requested_by: { label: 'Asked by', type: 'user', readOnly: true },
      approved_on: { label: 'Approved on', type: 'date', readOnly: true },
      approved_by_name: { label: 'Approved by', type: 'text', readOnly: true, personal: true },
      decision_note: { label: 'Decision note', type: 'longtext', readOnly: true },
      carried_out_on: { label: 'Carried out on', type: 'date', readOnly: true },
      carried_out_by: { label: 'Carried out by', type: 'text', readOnly: true, personal: true },
      witness_id: { label: 'Witness', type: 'user', readOnly: true },
      certificate_ref: { label: 'Certificate', type: 'text', readOnly: true, personal: false },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: async (_req, data) => prepareDestruction(data, data),
      beforeUpdate: async (req, existing, patch) => {
        // Once submitted, the entry is part of the log: only its notes change (system work, such as
        // the approval's outcome, is exempt).
        if (req && LOCKED.has(existing.status)) {
          const changed = Object.keys(patch).filter((k) => !ALWAYS_EDITABLE.has(k) && String(patch[k] ?? '') !== String(existing[k] ?? ''));
          if (changed.length) ctx.fail(409, 'locked', 'This destruction is submitted or done: only its notes can change. Cancel it and propose a new one to change the rest.');
          return patch;
        }
        if (!req) return patch;
        if (existing.status === 'canceled') ctx.fail(409, 'locked', 'This destruction was canceled. Propose a new one instead.');
        return prepareDestruction({ ...existing, ...patch }, patch);
      },
    },
  });

  // The log is kept: a destruction that was submitted or carried out, and a series with destructions
  // in the log, cannot be deleted (bulk delete from a list comes through the same route).
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'DELETE') return;
    const pattern = routePattern(req);
    const id = String((req.params as { id?: string })?.id ?? '');
    if (!UUID_RE.test(id)) return;
    if (pattern === '/api/records-destructions/:id') {
      const row = await db.one<Row>('select status from records_destructions where id = $1 and deleted_at is null', [id]);
      if (row && LOCKED.has(row.status)) ctx.fail(409, 'kept', 'This destruction is part of the destruction log and cannot be deleted. Cancel it if it will not go ahead.');
    } else if (pattern === '/api/record-series/:id') {
      const used = await db.one<Row>(`select 1 from records_destructions where series_id = $1 and deleted_at is null and status <> 'canceled' limit 1`, [id]);
      if (used) ctx.fail(409, 'kept', 'This series has destructions in the log, so it cannot be deleted. Retire it instead.');
    }
  });

  const destructionFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find(DESTRUCTION, String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Destruction not found.');

  /** Refuses while the series or the entry itself is under an active legal hold (names the hold's reference only). */
  const notHeld = async (row: Row) => {
    await assertNotHeld(db, SERIES, row.series_id, 'delete');
    await assertNotHeld(db, DESTRUCTION, row.id, 'delete');
  };

  const setState = (id: string, patch: Row, via: string) => ctx.resources.update(DESTRUCTION, id, patch, null, { via });

  async function approve(row: Row, byName: string, note: string | null, req: FastifyRequest | null) {
    await setState(row.id, { status: 'approved', approved_on: dayInZone(), approved_by_name: byName.slice(0, 200), decision_note: note }, 'the approval');
    await ctx.audit(req, {
      action: 'records_destruction.approve', recordType: DESTRUCTION, recordId: row.id,
      summary: `Destruction ${row.ref} approved by ${byName}`,
    });
  }

  notePermission('records.approve');
  defineApprovalKind(app, {
    key: DESTRUCTION_KIND, recordType: DESTRUCTION, label: 'Records destruction',
    startsWhen: 'A destruction of records past their retention period is submitted',
    outcome: 'Approved: the destruction becomes Approved and can be carried out; rejected: Rejected, with the reason',
    approverPermission: 'records.approve',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_DESTRUCTION_WORKFLOW);
    },
    async onFinish(e) {
      const row = await db.one<Row>('select * from records_destructions where id = $1', [e.instance.recordId]);
      if (!row || row.status !== 'pending_approval') return;
      if (e.outcome === 'canceled') {
        if (!e.byModule) await setState(row.id, { status: 'proposed' }, 'the approval');
        return;
      }
      const who = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'rejected') {
        await setState(row.id, { status: 'rejected', decision_note: e.comment ?? null }, 'the approval');
        await ctx.audit(e.req, {
          action: 'records_destruction.reject', recordType: DESTRUCTION, recordId: row.id,
          summary: `Destruction ${row.ref} rejected by ${who}: ${e.comment ?? 'no reason given'}`,
        });
        return;
      }
      // A hold placed while the approval ran stops it here too.
      if ((await holdsOn(db, SERIES, row.series_id)).length || (await holdsOn(db, DESTRUCTION, row.id)).length) {
        await setState(row.id, { status: 'proposed', decision_note: 'Approved while under a legal hold: submit it again once the hold is released.' }, 'the approval');
        return;
      }
      await approve(row, who, e.comment ?? null, e.req);
    },
  });

  app.get('/api/records-destructions/:id/state', { preHandler: ctx.requirePerm('records.view') }, async (req) => {
    const row = await destructionFor(req);
    const eng = approvalEngine(app);
    const latest = eng ? await eng.latest(DESTRUCTION_KIND, row.id) : null;
    const holds = [...await holdsOn(db, SERIES, row.series_id), ...await holdsOn(db, DESTRUCTION, row.id)];
    const series = await seriesOf(row.series_id);
    const today = dayInZone();
    const eligible = ymd(row.eligible_on);
    return {
      status: row.status, today, eligible_on: eligible, eligible: Boolean(eligible && eligible <= today),
      period: series ? periodText(series) : null,
      // Anyone may learn that a hold stops it (the refusal says so too); only legal.view sees which.
      held: holds.length > 0, holds: ctx.can(req.user, 'legal.view') ? holds.map((h) => ({ id: h.holdId, ref: h.ref })) : [],
      workflow_available: Boolean(eng && (await eng.definitions(DESTRUCTION_KIND)).length),
      can_approve: ctx.can(req.user, 'records.approve'),
      request: latest ? { id: latest.id, workflow: latest.name, status: latest.status, started_at: latest.startedAt, finished_at: latest.finishedAt } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/records-destructions/:id/state', tag: 'Records retention', permission: 'records.view',
    summary: 'Where a destruction stands: its status, whether its records are past their retention period, whether a legal hold stops it, and its newest approval',
    response: '{ status, today, eligible_on, eligible, period, held, holds: [{ id, ref }] (legal.view only), workflow_available, can_approve, request: { id, workflow, status, started_at, finished_at } | null }',
  });

  app.post('/api/records-destructions/:id/submit', { preHandler: ctx.requirePerm('records.edit') }, async (req, reply) => {
    const row = await destructionFor(req);
    if (row.status !== 'proposed' && row.status !== 'rejected') ctx.fail(409, 'wrong_status', 'Only a proposed or rejected destruction can be submitted.');
    const eligible = ymd(row.eligible_on);
    if (!eligible) invalid({ trigger_date: 'Give the trigger date (or the last date the records cover), so the end of the retention period is known.' });
    if (eligible! > dayInZone()) ctx.fail(409, 'not_eligible', `These records are kept until ${eligible}: they cannot be destroyed before then.`);
    await notHeld(row);
    const note = String(((req.body ?? {}) as Row).note ?? '').trim().slice(0, 2000) || null;
    const eng = approvalEngine(app);
    if (eng && await eng.running(DESTRUCTION_KIND, row.id)) ctx.fail(409, 'already_requested', 'This destruction is already waiting for approval.');
    await setState(row.id, { status: 'pending_approval', requested_by: actorOf(req).id, decision_note: null }, 'a submission');
    const started = eng ? await eng.start(DESTRUCTION_KIND, { ...row, status: 'pending_approval' }, { requester: req.user!.id, req, note }) : null;
    if (started) {
      await ctx.audit(req, { action: 'records_destruction.submit', recordType: DESTRUCTION, recordId: row.id, summary: `Destruction ${row.ref} submitted for approval (${started.name})` });
      reply.code(202);
      return { status: 'pending_approval', instance_id: started.id, workflow: started.name };
    }
    // No workflow applies: someone who may approve records work approves it at once (audited).
    if (!ctx.can(req.user, 'records.approve')) {
      await setState(row.id, { status: row.status }, 'a submission');
      ctx.fail(409, 'no_workflow', 'No Records destruction workflow applies, so only someone who may approve records work can approve it.');
    }
    await approve(row, actorOf(req).name ?? req.user!.displayName, note, req);
    return { status: 'approved' };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/records-destructions/:id/submit', tag: 'Records retention', permission: 'records.edit',
    summary: 'Submit a destruction for approval: refused before the end of the retention period (409 `not_eligible`) and while the series or the entry is under a legal hold (409 `on_hold`); starts the Records destruction approval (202), or, when no workflow applies, approves it at once for someone holding records.approve',
    body: '{ note? }', response: '{ status: "pending_approval" | "approved", instance_id?, workflow? }',
  });

  app.post('/api/records-destructions/:id/carried-out', { preHandler: ctx.requirePerm('records.edit') }, async (req) => {
    const row = await destructionFor(req);
    if (row.status !== 'approved') ctx.fail(409, 'wrong_status', 'Only an approved destruction can be recorded as carried out.');
    await notHeld(row);
    const b = (req.body ?? {}) as Row;
    const on = ymd(b.carried_out_on) ?? '';
    const today = dayInZone();
    const errors: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) errors.carried_out_on = 'Give the date the records were destroyed or transferred.';
    else if (on > today) errors.carried_out_on = 'The date cannot be in the future.';
    else if (row.approved_on && on < String(ymd(row.approved_on))) errors.carried_out_on = 'The date cannot be before the approval.';
    const by = String(b.carried_out_by ?? '').trim().slice(0, 200);
    if (!by) errors.carried_out_by = 'Say who carried it out: a person or a destruction service.';
    const method = b.method ? String(b.method) : row.method;
    if (!method) errors.method = 'Choose the method.';
    else if (!(await ctx.lookups.values('destruction_method')).some((v) => v.value === method)) errors.method = 'Choose one of the methods.';
    let witness: string | null = null;
    if (b.witness_id) {
      witness = String(b.witness_id);
      if (!UUID_RE.test(witness) || !(await db.one('select 1 from users where id = $1', [witness]))) errors.witness_id = 'Choose a person.';
    }
    if (Object.keys(errors).length) invalid(errors);
    const certificate = String(b.certificate_ref ?? '').trim().slice(0, 200) || null;
    await setState(row.id, { status: 'done', carried_out_on: on, carried_out_by: by, witness_id: witness, certificate_ref: certificate, method }, 'the destruction record');
    await ctx.audit(req, {
      action: 'records_destruction.carried_out', recordType: DESTRUCTION, recordId: row.id,
      summary: `Destruction ${row.ref} carried out on ${on} by ${by}${certificate ? ` (certificate ${certificate})` : ''}`,
    });
    return { status: 'done' };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/records-destructions/:id/carried-out', tag: 'Records retention', permission: 'records.edit',
    summary: 'Record that an approved destruction was carried out (refused while a legal hold applies); attach the certificate as an evidence file',
    body: '{ carried_out_on, carried_out_by, method?, witness_id?, certificate_ref? }', response: '{ status: "done" }',
  });

  app.post('/api/records-destructions/:id/cancel', { preHandler: ctx.requirePerm('records.edit') }, async (req) => {
    const row = await destructionFor(req);
    if (row.status === 'done' || row.status === 'canceled') ctx.fail(409, 'wrong_status', 'This destruction is already finished.');
    const reason = String(((req.body ?? {}) as Row).reason ?? '').trim();
    if (reason.length < 3 || reason.length > 2000) invalid({ reason: 'Say why it will not go ahead (3 to 2000 characters).' });
    await approvalEngine(app)?.cancel(DESTRUCTION_KIND, row.id, reason, req);
    await setState(row.id, { status: 'canceled', decision_note: reason }, 'a cancellation');
    await ctx.audit(req, { action: 'records_destruction.cancel', recordType: DESTRUCTION, recordId: row.id, summary: `Destruction ${row.ref} canceled: ${reason}` });
    return { status: 'canceled' };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/records-destructions/:id/cancel', tag: 'Records retention', permission: 'records.edit',
    summary: 'Cancel a destruction that will not go ahead (its approval, if running, is canceled); it stays in the log',
    body: '{ reason }', response: '{ status: "canceled" }',
  });

  // ---------------------------------------------------------------- My work and calendars

  defineCalendarSource(app, {
    key: 'recordsretention.reviews', label: 'My record series reviews due', recordType: SERIES, permission: 'records.view',
    work: true, kind: 'Retention schedule reviews', // an overdue review stays listed until the date moves
    events: async (c, user, from, to) => {
      const rows = await c.db.query<Row>(
        `select s.id, s.ref, s.title, s.review_on from record_series s
         where s.owner_id = $1 and s.deleted_at is null and s.status <> 'retired' and s.review_on is not null
           and s.review_on <= $3::date and (s.review_on >= $2::date or s.review_on < $4::date)
           and ${c.resources.visibleWhere(SERIES, user, 's')}`, [user.id, from, to, dayInZone()]);
      return rows.map((r) => ({
        uid: `recordsretention.reviews:${r.id}:${ymd(r.review_on)}`, title: `Review record series ${r.ref ?? ''}: ${r.title}`.replace(/ +:/, ':'),
        start: ymd(r.review_on)!, allDay: true, url: `/retention-schedule/${r.id}`, recordType: SERIES, recordId: r.id, personId: user.id, ref: r.ref ?? null,
      }));
    },
  });
  defineCalendarSource(app, {
    key: 'recordsretention.destructions', label: 'My approved destructions to carry out', recordType: DESTRUCTION, permission: 'records.view',
    work: true, kind: 'Records destructions',
    events: async (c, user, from, to) => {
      const rows = await c.db.query<Row>(
        `select d.id, d.ref, d.title, d.approved_on from records_destructions d
         where d.requested_by = $1 and d.deleted_at is null and d.status = 'approved' and d.approved_on is not null
           and d.approved_on <= $3::date and (d.approved_on >= $2::date or d.approved_on < $4::date)
           and ${c.resources.visibleWhere(DESTRUCTION, user, 'd')}`, [user.id, from, to, dayInZone()]);
      return rows.map((r) => ({
        uid: `recordsretention.destructions:${r.id}`, title: `Carry out destruction ${r.ref ?? ''}: ${r.title}`.replace(/ +:/, ':'),
        start: ymd(r.approved_on)!, allDay: true, url: `/destruction-log/${r.id}`, recordType: DESTRUCTION, recordId: r.id, personId: user.id, ref: r.ref ?? null,
      }));
    },
  });
}

const mod: ModuleDef = {
  key: 'recordsretention',
  seedDefaults,
  register,
  seed: seedRetention,
};
export default mod;
