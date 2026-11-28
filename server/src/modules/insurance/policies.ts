// Insurance policies (IPL-), the conditions each must keep meeting (tracked by controls where there is
// one), the records each covers, and renewing a policy into its next term.
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays, addMonths, daysBetween } from '../../../../shared/dates.ts';

export const POLICY = 'insurance_policy';
export const CONDITION = 'insurance_condition';
/** Record types a policy can cover. */
export const COVERABLE = ['asset', 'vehicle', 'site', 'system'];

const day = (v: unknown) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const OPEN_POLICY = ['draft', 'active'];

export function registerPolicies(ctx: ModuleContext) {
  const { app, db } = ctx;

  function amountErrors(merged: Row, fields: string[], errors: Record<string, string>) {
    for (const f of fields) {
      const n = num(merged[f]);
      if (n !== null && (!Number.isFinite(n) || n < 0)) errors[f] = 'Enter an amount of zero or more.';
    }
  }

  async function policyRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    const from = day(merged.effective_on);
    const to = day(merged.expires_on);
    if (from && to && to < from) errors.expires_on = 'The policy cannot expire before it takes effect.';
    amountErrors(merged, ['premium', 'limit_per_occurrence', 'limit_aggregate', 'deductible', 'retention'], errors);
    const occ = num(merged.limit_per_occurrence);
    const agg = num(merged.limit_aggregate);
    if (occ !== null && agg !== null && agg > 0 && agg < occ) errors.limit_aggregate = 'The aggregate limit cannot be lower than the limit per occurrence.';
    const due = day(merged.renewal_application_due);
    if (due && to && due > to) errors.renewal_application_due = 'The renewal application is due before the policy expires.';
    if (merged.replaces_id && existing && merged.replaces_id === existing.id) errors.replaces_id = 'A policy cannot renew itself.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (!existing && !merged.owner_id && req) patch.owner_id = actorOf(req).id;
    return patch;
  }

  ctx.defineResource({
    type: POLICY, table: 'insurance_policies', module: 'insurance', label: 'Insurance policy', plural: 'Insurance policies',
    path: '/api/insurance/policies', route: '/insurance', titleField: 'title',
    ref: { field: 'ref', prefix: 'IPL-' },
    scope: { department: 'department_id' },
    evidence: true,
    searchable: ['title', 'policy_number', 'insurer_name', 'broker_name', 'named_insureds', 'sublimits', 'notes'],
    defaultSort: { field: 'expires_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Policy', type: 'text', required: true, help: 'A short name, for example "Cyber liability 2027".' },
      line: { label: 'Line of coverage', type: 'lookup', list: 'insurance_line', required: true },
      status: { label: 'Status', type: 'lookup', list: 'insurance_policy_status', default: 'active' },
      insurer_kind: { label: 'Placed with', type: 'lookup', list: 'insurer_kind', default: 'insurer' },
      insurer_id: { label: 'Carrier or pool (vendor)', type: 'ref', to: 'vendor', help: 'The insurance company or risk pool, when it is kept as a vendor.' },
      insurer_name: { label: 'Carrier or pool', type: 'text', personal: false, help: 'The insurance company or risk pool by name, when it is not kept as a vendor.' },
      broker_name: { label: 'Broker or agent', type: 'text', personal: false },
      policy_number: { label: 'Policy number', type: 'text' },
      effective_on: { label: 'Effective', type: 'date', help: 'First day of the policy term.' },
      expires_on: { label: 'Expires', type: 'date', help: 'Last day of the policy term.' },
      premium: { label: 'Premium', type: 'currency', help: 'Premium for the whole term.' },
      limit_per_occurrence: { label: 'Limit per occurrence', type: 'currency' },
      limit_aggregate: { label: 'Aggregate limit', type: 'currency' },
      deductible: { label: 'Deductible', type: 'currency' },
      retention: { label: 'Self-insured retention', type: 'currency' },
      sublimits: { label: 'Sublimits', type: 'longtext', personal: false, help: 'One per line, for example "Business interruption: 250,000".' },
      named_insureds: { label: 'Named insureds', type: 'longtext', personal: false, help: 'The organizations and bodies named on the policy.' },
      owner_id: { label: 'Owner', type: 'user', help: 'The person who looks after the policy and its renewal.' },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      renewal_status: { label: 'Renewal', type: 'lookup', list: 'insurance_renewal_status', default: 'not_started' },
      renewal_application_due: { label: 'Renewal application due', type: 'date' },
      replaces_id: { label: 'Renews', type: 'ref', to: POLICY, help: 'The policy of the term before.' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => policyRules(req, null, data),
      beforeUpdate: (req, existing, patch) => policyRules(req, existing, patch),
      // A new term coming into force closes the term before it (not in a data load: its statuses are as given).
      afterUpdate: async (req, before, after) => {
        if (isDataLoad(req) || before.status === after.status || after.status !== 'active' || !after.replaces_id) return;
        const prev = await db.one<Row>('select id, status, renewal_status from insurance_policies where id = $1 and deleted_at is null', [after.replaces_id]);
        if (!prev) return;
        const patch: Row = {};
        if (OPEN_POLICY.includes(prev.status)) patch.status = 'replaced';
        if (prev.renewal_status !== 'bound') patch.renewal_status = 'bound';
        if (Object.keys(patch).length) await ctx.resources.update(POLICY, prev.id, patch, null, { via: `the renewal ${after.ref ?? ''}`.trim() });
      },
    },
  });

  ctx.defineResource({
    type: CONDITION, table: 'insurance_conditions', module: 'insurance', label: 'Policy condition', plural: 'Policy conditions',
    path: '/api/insurance/conditions', route: '/insurance/conditions', titleField: 'title',
    searchable: ['title', 'description', 'notes'],
    defaultSort: { field: 'title', dir: 'asc' },
    fields: {
      policy_id: { label: 'Policy', type: 'ref', to: POLICY, required: true },
      title: { label: 'Condition', type: 'text', required: true, help: 'What the policy requires, for example "Second factor on all remote access".' },
      description: { label: 'Wording', type: 'longtext', personal: false, help: 'The condition or warranty as the policy words it.' },
      control_id: { label: 'Tracked by control', type: 'ref', to: 'control', help: 'The control of the control library that shows the condition is met.' },
      status: { label: 'Assessment', type: 'lookup', list: 'insurance_condition_status', default: 'not_assessed' },
      due_on: { label: 'Must be met by', type: 'date' },
      owner_id: { label: 'Owner', type: 'user' },
      notes: { label: 'Notes', type: 'longtext' },
    },
  });

  // ---------- conditions with what their controls show ----------

  app.get('/api/insurance/policies/:id/conditions', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => {
    const policy = await policyFor(req, false);
    const rows = await db.query<Row>(
      `select c.id, c.title, c.status, c.due_on::text as due_on, c.control_id, c.owner_id from insurance_conditions c
       where c.policy_id = $1 and c.deleted_at is null and ${ctx.resources.visibleWhere(CONDITION, req.user, 'c')} order by c.title`, [policy.id]);
    const today = todayInZone();
    const controls = ctx.resources.get('control') && ctx.can(req.user, 'controls.view');
    const out = [];
    for (const r of rows) {
      let control: Row | null = null;
      if (r.control_id && controls) {
        const c = await ctx.resources.find('control', r.control_id, req.user);
        if (c) {
          const next = day(c.next_test_due);
          const state = next && next < today ? 'test_overdue' : c.operating_rating ?? c.design_rating ?? 'not_tested';
          control = { id: c.id, ref: c.ref, title: c.title, operating_rating: c.operating_rating ?? null, last_tested_on: day(c.last_tested_on), next_test_due: next, state };
        }
      }
      out.push({ ...r, control, control_hidden: Boolean(r.control_id && !control) });
    }
    return { rows: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/policies/:id/conditions', tag: 'Insurance', permission: 'insurance.view',
    summary: 'A policy\'s conditions with what the control tracking each one shows (its latest rating and whether its test is overdue)',
    response: '{ rows: [{ id, title, status, due_on, control_id, owner_id, control: { id, ref, title, operating_rating, last_tested_on, next_test_due, state } | null, control_hidden }] }',
  });

  // ---------- covered records ----------

  async function policyFor(req: FastifyRequest, edit: boolean): Promise<Row> {
    const id = String((req.params as Row).id);
    if (!UUID_RE.test(id)) return ctx.fail(404, 'not_found', 'Policy not found.');
    const p = await ctx.resources.find(POLICY, id, req.user);
    if (!p) return ctx.fail(404, 'not_found', 'Policy not found.');
    if (edit && !ctx.can(req.user, 'insurance.edit')) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    return p;
  }

  app.get('/api/insurance/policies/:id/covered', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => {
    const p = await policyFor(req, false);
    const items = await db.query<Row>('select id, record_type, record_id, note, created_at from insurance_covered where policy_id = $1 order by created_at', [p.id]);
    const rows = [];
    let hidden = 0;
    for (const i of items) {
      const def = ctx.resources.get(i.record_type);
      const rec = def ? await ctx.resources.find(i.record_type, i.record_id, req.user) : undefined;
      if (!def || !rec || rec.deleted_at) { hidden += def ? 1 : 0; continue; }
      rows.push({
        id: i.id, record_type: i.record_type, type_label: def.label, record_id: i.record_id, note: i.note,
        ref: def.ref ? rec[def.ref.field] ?? null : null, label: String(rec[def.titleField] ?? ''), route: `${def.route}/${i.record_id}`,
      });
    }
    return { rows, hidden, types: COVERABLE.filter((t) => ctx.resources.get(t)).map((t) => ({ type: t, label: ctx.resources.get(t)!.label })) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/policies/:id/covered', tag: 'Insurance', permission: 'insurance.view',
    summary: 'The records a policy covers (those the caller may not open are counted as hidden)',
    response: '{ rows: [{ id, record_type, type_label, record_id, ref, label, route, note }], hidden, types: [{ type, label }] }',
  });

  app.post('/api/insurance/policies/:id/covered', { preHandler: ctx.requirePerm('insurance.edit') }, async (req, reply) => {
    const p = await policyFor(req, true);
    const b = (req.body ?? {}) as Row;
    const type = String(b.record_type ?? '');
    const recordId = String(b.record_id ?? '');
    if (!COVERABLE.includes(type) || !ctx.resources.get(type)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { record_type: 'Choose an asset, vehicle, site or system.' });
    if (!UUID_RE.test(recordId) || !(await ctx.resources.find(type, recordId, req.user))) ctx.fail(400, 'validation', 'Check the highlighted fields.', { record_id: 'Choose a record you can open.' });
    const note = b.note == null ? null : String(b.note).trim().slice(0, 500) || null;
    const who = actorOf(req);
    const row = await db.one<Row>(
      `insert into insurance_covered (policy_id, record_type, record_id, note, created_by) values ($1,$2,$3,$4,$5)
       on conflict (policy_id, record_type, record_id) do nothing returning id`, [p.id, type, recordId, note, who.id]);
    if (!row) return ctx.fail(409, 'exists', 'The policy already covers that record.');
    const label = await ctx.resources.labelFor(type, recordId);
    await ctx.audit(req, {
      action: 'insurance.cover', recordType: POLICY, recordId: p.id,
      summary: `${ctx.resources.get(type)!.label} ${label ?? ''} added to what policy ${p.ref} covers`.replace(/\s+/g, ' '),
      after: { record_type: type, record_id: recordId, note },
    });
    reply.code(201);
    return { id: row.id };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/policies/:id/covered', tag: 'Insurance', permission: 'insurance.edit',
    summary: 'Add a record to what a policy covers', body: '{ record_type, record_id, note? }', response: '{ id }',
  });

  app.delete('/api/insurance/policies/:id/covered/:item', { preHandler: ctx.requirePerm('insurance.edit') }, async (req) => {
    const p = await policyFor(req, true);
    const item = String((req.params as Row).item);
    if (!UUID_RE.test(item)) return ctx.fail(404, 'not_found', 'Not found.');
    const gone = await db.one<Row>('delete from insurance_covered where id = $1 and policy_id = $2 returning record_type, record_id', [item, p.id]);
    if (!gone) return ctx.fail(404, 'not_found', 'Not found.');
    await ctx.audit(req, {
      action: 'insurance.uncover', recordType: POLICY, recordId: p.id,
      summary: `A ${ctx.resources.get(gone.record_type)?.label.toLowerCase() ?? 'record'} taken off what policy ${p.ref} covers`, before: gone,
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/insurance/policies/:id/covered/:item', tag: 'Insurance', permission: 'insurance.edit',
    summary: 'Take a record off what a policy covers', response: '{ ok: true }',
  });

  app.get('/api/insurance/covering', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => {
    const q = req.query as Row;
    const type = String(q.record_type ?? '');
    const id = String(q.record_id ?? '');
    if (!COVERABLE.includes(type) || !UUID_RE.test(id)) return ctx.fail(400, 'validation', 'Give record_type and record_id.');
    if (!ctx.resources.get(type) || !(await ctx.resources.find(type, id, req.user))) return ctx.fail(404, 'not_found', 'Record not found.');
    const rows = await db.query<Row>(
      `select p.id, p.ref, p.title, p.line, p.status, p.expires_on::text as expires_on, p.limit_per_occurrence, p.deductible from insurance_covered c
       join insurance_policies p on p.id = c.policy_id
       where c.record_type = $1 and c.record_id = $2 and p.deleted_at is null and ${ctx.resources.visibleWhere(POLICY, req.user, 'p')}
       order by p.expires_on desc nulls last`, [type, id]);
    const total = (await db.one<Row>(
      `select count(*)::int as n from insurance_covered c join insurance_policies p on p.id = c.policy_id
       where c.record_type = $1 and c.record_id = $2 and p.deleted_at is null`, [type, id]))!.n;
    return { rows, hidden: Number(total) - rows.length };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/covering', tag: 'Insurance', permission: 'insurance.view',
    summary: 'The policies that cover one record', query: { record_type: 'The type of the covered record', record_id: 'The record' },
    response: '{ rows: [{ id, ref, title, line, status, expires_on, limit_per_occurrence, deductible }], hidden }',
  });

  // ---------- renewing into the next term ----------

  app.post('/api/insurance/policies/:id/renew', { preHandler: ctx.requirePerm('insurance.create') }, async (req, reply) => {
    const p = await policyFor(req, false);
    const b = (req.body ?? {}) as Row;
    const existing = await db.one<Row>('select ref from insurance_policies where replaces_id = $1 and deleted_at is null limit 1', [p.id]);
    if (existing) return ctx.fail(409, 'exists', `This policy has already been renewed as ${existing.ref}.`);
    const oldFrom = day(p.effective_on);
    const oldTo = day(p.expires_on);
    const from = day(b.effective_on) ?? (oldTo ? addDays(oldTo, 1) : todayInZone());
    // The same length of term as before (a year when the old term is unknown).
    const to = day(b.expires_on) ?? (oldFrom && oldTo ? addDays(from, daysBetween(oldFrom, oldTo)) : addDays(addMonths(from, 12), -1));
    const copy: Row = {
      title: String(b.title ?? '').trim() || String(p.title), line: p.line, insurer_kind: p.insurer_kind, insurer_id: p.insurer_id, insurer_name: p.insurer_name,
      broker_name: p.broker_name, policy_number: b.policy_number ?? null, effective_on: from, expires_on: to, premium: b.premium ?? null,
      limit_per_occurrence: p.limit_per_occurrence, limit_aggregate: p.limit_aggregate, deductible: p.deductible, retention: p.retention,
      sublimits: p.sublimits, named_insureds: p.named_insureds, owner_id: p.owner_id, department_id: p.department_id,
      status: 'draft', renewal_status: 'not_started', replaces_id: p.id,
    };
    const made = await ctx.resources.create(POLICY, copy, req);
    const conditions = await db.query<Row>('select title, description, control_id, owner_id from insurance_conditions where policy_id = $1 and deleted_at is null order by created_at', [p.id]);
    for (const c of conditions) await ctx.resources.create(CONDITION, { ...c, policy_id: made.id, status: 'not_assessed' }, req);
    await db.query(
      `insert into insurance_covered (policy_id, record_type, record_id, note, created_by)
       select $1, record_type, record_id, note, $3 from insurance_covered where policy_id = $2 on conflict do nothing`, [made.id, p.id, actorOf(req).id]);
    if (p.renewal_status === 'not_started' && OPEN_POLICY.includes(p.status)) await ctx.resources.update(POLICY, p.id, { renewal_status: 'gathering' }, req);
    reply.code(201);
    return made;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/policies/:id/renew', tag: 'Insurance', permission: 'insurance.create',
    summary: 'Start the next term of a policy: a new policy being placed, with the same coverage, conditions and covered records',
    description: 'The new term starts the day after the old one expires and lasts as long, unless dates are given. When the new term is set to In force, the old one becomes Renewed.',
    body: '{ effective_on?, expires_on?, title?, policy_number?, premium? }', response: 'The new policy',
  });
}
