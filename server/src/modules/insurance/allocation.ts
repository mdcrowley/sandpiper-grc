// Premium allocation (E46-64): a policy's premium split across departments, sites, assets or vehicles.
// Each share (insurance_premium_share) names one of them; the policy's allocation method says how the
// split is worked out:
//  - equal: every share the same;
//  - measure: in proportion to a number entered for each share (vehicles, payroll, floor area: the
//    policy's "measure" says what it counts);
//  - insured_value: in proportion to the total insured value of the policy's schedule of values that
//    belongs to each share (its department, site, asset or vehicle);
//  - manual: a percentage entered by hand for each share (what is left is shown as not allocated).
// Shares and amounts are worked out again whenever a share, the policy's premium or method, or the
// schedule of values changes; amounts are rounded to cents and add up to the premium exactly (the
// largest share takes the rounding). The summary across policies (by department, site, asset or
// vehicle) counts every policy in force, so it is the same for everyone, and downloads as CSV.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { csvCell } from '../../../../shared/csv-guard.ts';
import { POLICY } from './policies.ts';

export const SHARE = 'insurance_premium_share';
/** The record a share names, in the order they are looked for. */
export const TARGETS = [
  { field: 'department_id', type: 'department', label: 'Department' },
  { field: 'site_id', type: 'site', label: 'Site' },
  { field: 'asset_id', type: 'asset', label: 'Asset' },
  { field: 'vehicle_id', type: 'vehicle', label: 'Vehicle' },
] as const;
type Target = typeof TARGETS[number];

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const cents = (n: number) => Math.round(n * 100);
const targetOf = (r: Row): Target | undefined => TARGETS.find((t) => r[t.field]);

/**
 * The split of one premium: shares in percent (four places) and amounts in cents that add up to the
 * premium (or, by hand, to the percentages given). Exported for tests.
 */
export function split(premium: number, weights: number[], manual: boolean): { share_pct: number; amount: number }[] {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const pcts = weights.map((w) => (manual ? Math.max(0, w) : total > 0 ? (Math.max(0, w) / total) * 100 : 0));
  const amounts = pcts.map((p) => cents((premium * p) / 100));
  // Unrounded shares add up to the premium (or to the percentages given): the largest takes the difference.
  const target = cents((premium * pcts.reduce((s, p) => s + p, 0)) / 100);
  const diff = target - amounts.reduce((s, a) => s + a, 0);
  if (diff && amounts.length) {
    const largest = pcts.indexOf(Math.max(...pcts));
    amounts[largest] += diff;
  }
  return pcts.map((p, i) => ({ share_pct: Math.round(p * 10000) / 10000, amount: amounts[i] / 100 }));
}

export function registerAllocation(ctx: ModuleContext) {
  const { app, db } = ctx;

  /** The insured value of the policy's schedule of values that belongs to a share. */
  async function insuredValue(policyId: string, share: Row): Promise<number> {
    const t = targetOf(share);
    if (!t) return 0;
    const r = await db.one<Row>(
      `select coalesce(sum(total_value), 0)::float8 as v from insurance_schedule_items
       where deleted_at is null and policy_id = $1 and ${t.field} = $2`, [policyId, share[t.field]]);
    return Number(r?.v ?? 0);
  }

  /** Works the shares of one policy out again and stores those that changed (derived values, not audited). */
  async function allocate(policyId: string | null | undefined): Promise<number> {
    if (!policyId) return 0;
    const p = await db.one<Row>('select id, premium, allocation_method from insurance_policies where id = $1 and deleted_at is null', [policyId]);
    if (!p) return 0;
    const shares = await db.query<Row>('select * from insurance_premium_shares where policy_id = $1 and deleted_at is null order by created_at, id', [p.id]);
    if (!shares.length) return 0;
    const method = String(p.allocation_method ?? 'equal');
    const weights: number[] = [];
    for (const s of shares) {
      weights.push(method === 'manual' ? num(s.percent) ?? 0
        : method === 'measure' ? num(s.measure) ?? 0
        : method === 'insured_value' ? await insuredValue(p.id, s)
        : 1);
    }
    const parts = split(num(p.premium) ?? 0, weights, method === 'manual');
    let changed = 0;
    for (const [i, s] of shares.entries()) {
      const { share_pct, amount } = parts[i];
      if (num(s.weight) === weights[i] && num(s.share_pct) === share_pct && num(s.amount) === amount) continue;
      await db.query('update insurance_premium_shares set weight = $2, share_pct = $3, amount = $4 where id = $1', [s.id, weights[i], share_pct, amount]);
      changed++;
    }
    return changed;
  }
  const allocateMany = async (ids: (string | null | undefined)[]) => {
    for (const id of new Set(ids.filter(Boolean))) await allocate(id);
  };

  async function rules(existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    const named = TARGETS.filter((t) => merged[t.field]);
    if (named.length !== 1) errors.department_id = 'Choose the one record the share is for.';
    if (existing && 'policy_id' in patch && String(patch.policy_id) !== String(existing.policy_id)) errors.policy_id = 'A share stays with its policy.';
    const pct = num(merged.percent);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) errors.percent = 'Enter a percentage from 0 to 100.';
    const measure = num(merged.measure);
    if (measure !== null && (!Number.isFinite(measure) || measure < 0)) errors.measure = 'Enter a number of zero or more.';
    if (!errors.department_id && merged.policy_id) {
      const t = named[0];
      const dup = await db.one<Row>(
        `select 1 from insurance_premium_shares where policy_id = $1 and ${t.field} = $2 and deleted_at is null and id is distinct from $3::uuid`,
        [merged.policy_id, merged[t.field], existing?.id ?? null]);
      if (dup) errors[t.field] = `The policy already has a share for this ${t.label.toLowerCase()}.`;
      // By hand, the percentages cannot add up to more than the whole premium.
      if (pct !== null && !errors.percent) {
        const others = await db.one<Row>(
          `select coalesce(sum(percent), 0)::float8 as n from insurance_premium_shares where policy_id = $1 and deleted_at is null and id is distinct from $2::uuid`,
          [merged.policy_id, existing?.id ?? null]);
        if (Number(others?.n ?? 0) + pct > 100.0001) errors.percent = `The shares by hand would add up to more than 100% (the others already take ${Math.round(Number(others?.n ?? 0) * 100) / 100}%).`;
      }
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    return patch;
  }

  ctx.defineResource({
    type: SHARE, table: 'insurance_premium_shares', module: 'insurance', label: 'Premium share', plural: 'Premium shares',
    path: '/api/insurance/premium-shares', route: '/insurance/premium-shares', titleField: 'title',
    searchable: ['title', 'note'],
    defaultSort: { field: 'amount', dir: 'desc' },
    fields: {
      title: { label: 'Share', type: 'text', required: true, personal: false, help: 'Made from the record the share is for when left empty.' },
      policy_id: { label: 'Policy', type: 'ref', to: POLICY, required: true },
      department_id: { label: 'Department', type: 'ref', to: 'department', help: 'Give one record the share is for: a department, or one of the fields below.' },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      asset_id: { label: 'Asset', type: 'ref', to: 'asset' },
      vehicle_id: { label: 'Vehicle', type: 'ref', to: 'vehicle' },
      percent: { label: 'Share by hand (%)', type: 'number', help: 'Used when the policy splits its premium by hand.' },
      measure: { label: 'Measure', type: 'number', help: 'Used when the policy splits its premium by a measure: the number for this share (for example payroll, floor area or a count of units).' },
      weight: { label: 'Worked out from', type: 'number', readOnly: true },
      share_pct: { label: 'Share (%)', type: 'number', readOnly: true },
      amount: { label: 'Premium allocated', type: 'currency', readOnly: true },
      note: { label: 'Note', type: 'longtext', personal: false },
    },
    hooks: {
      prepare: async (_req, raw, existing) => {
        if (existing || (raw.title && String(raw.title).trim())) return raw;
        const t = TARGETS.find((x) => raw[x.field]);
        const label = t && ctx.resources.get(t.type) && typeof raw[t.field] === 'string' && UUID_RE.test(String(raw[t.field]))
          ? await ctx.resources.labelFor(t.type, String(raw[t.field])) : null;
        return { ...raw, title: label ?? t?.label ?? 'Share' };
      },
      beforeCreate: (_req, data) => rules(null, data),
      beforeUpdate: (_req, existing, patch) => rules(existing, patch),
      afterCreate: async (_req, row) => { await allocate(row.policy_id); },
      afterUpdate: async (_req, _before, after) => { await allocate(after.policy_id); },
    },
  });

  ctx.resources.onChange?.(async (change) => {
    if (change.def.type === SHARE && (change.action === 'delete' || change.action === 'purge')) await allocate(change.row.policy_id);
    // A policy's premium or method changed.
    if (change.def.type === POLICY && change.action === 'update') await allocate(change.row.id);
  });

  // ---------- one policy's split ----------

  async function policyFor(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id);
    const p = UUID_RE.test(id) ? await ctx.resources.find(POLICY, id, req.user) : undefined;
    if (!p) return ctx.fail(404, 'not_found', 'Policy not found.');
    return p;
  }

  app.get('/api/insurance/policies/:id/allocation', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => {
    const p = await policyFor(req);
    const r = (await db.one<Row>(
      `select count(*)::int as shares, coalesce(sum(amount), 0)::float8 as allocated, coalesce(sum(share_pct), 0)::float8 as pct
       from insurance_premium_shares where policy_id = $1 and deleted_at is null`, [p.id]))!;
    const premium = num(p.premium) ?? 0;
    const allocated = Number(r.allocated);
    return {
      method: p.allocation_method ?? 'equal', measure: p.allocation_measure ?? null, premium, shares: r.shares,
      allocated, unallocated: Math.round((premium - allocated) * 100) / 100, allocated_pct: Math.round(Number(r.pct) * 100) / 100,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/policies/:id/allocation', tag: 'Insurance', permission: 'insurance.view',
    summary: 'How a policy\'s premium is split: its method and measure, the premium, what is allocated and what is not (the shares are the record type insurance_premium_share)',
    response: '{ method, measure, premium, shares, allocated, unallocated, allocated_pct }',
  });

  app.post('/api/insurance/policies/:id/allocation/from-covered', { preHandler: ctx.requirePerm('insurance.create') }, async (req, reply) => {
    const p = await policyFor(req);
    const covered = await db.query<Row>(
      `select record_type, record_id from insurance_covered where policy_id = $1 and record_type = any($2::text[]) order by created_at`, [p.id, ['site', 'asset', 'vehicle']]);
    let added = 0;
    let skipped = 0;
    for (const c of covered) {
      const t = TARGETS.find((x) => x.type === c.record_type)!;
      if (!ctx.resources.get(c.record_type) || !(await ctx.resources.find(c.record_type, c.record_id, req.user))) { skipped++; continue; }
      if (await db.one(`select 1 from insurance_premium_shares where policy_id = $1 and ${t.field} = $2 and deleted_at is null`, [p.id, c.record_id])) { skipped++; continue; }
      await ctx.resources.create(SHARE, { title: '', policy_id: p.id, [t.field]: c.record_id }, req);
      added++;
    }
    reply.code(201);
    return { added, skipped };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/policies/:id/allocation/from-covered', tag: 'Insurance', permission: 'insurance.create',
    summary: 'Add a premium share for each record the policy covers (those it already has, or that the caller cannot open, are skipped)',
    response: '{ added, skipped }',
  });

  // ---------- across policies: premium by department, site, asset or vehicle ----------

  async function totals(by: Target, lineFilter: string | null): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select s.${by.field} as target_id, p.line, coalesce(sum(s.amount), 0)::float8 as amount, count(distinct p.id)::int as policies
       from insurance_premium_shares s join insurance_policies p on p.id = s.policy_id
       where s.deleted_at is null and p.deleted_at is null and p.status = 'active' and s.${by.field} is not null
         and ($1::text is null or p.line = $1)
       group by s.${by.field}, p.line`, [lineFilter]);
    const byTarget = new Map<string, Row>();
    for (const r of rows) {
      const t = byTarget.get(r.target_id) ?? { target_id: r.target_id, amount: 0, policies: 0, lines: {} as Record<string, number> };
      t.amount = Math.round((t.amount + Number(r.amount)) * 100) / 100;
      t.policies += r.policies;
      t.lines[r.line ?? 'other'] = Math.round(((t.lines[r.line ?? 'other'] ?? 0) + Number(r.amount)) * 100) / 100;
      byTarget.set(r.target_id, t);
    }
    const out = [...byTarget.values()];
    for (const t of out) t.label = ctx.resources.get(by.type) ? (await ctx.resources.labelFor(by.type, t.target_id)) ?? `${by.label} removed` : by.label;
    return out.sort((a, b) => b.amount - a.amount || String(a.label).localeCompare(String(b.label)));
  }

  app.get('/api/insurance/allocation', { preHandler: ctx.requirePerm('insurance.view') }, async (req, reply) => {
    const q = req.query as Row;
    const by = TARGETS.find((t) => t.type === String(q.by ?? 'department')) ?? TARGETS[0];
    const line = typeof q.line === 'string' && /^[a-z0-9_]{1,60}$/.test(q.line) ? q.line : null;
    const rows = await totals(by, line);
    const premium = (await db.one<Row>(
      `select coalesce(sum(premium), 0)::float8 as n from insurance_policies where deleted_at is null and status = 'active' and ($1::text is null or line = $1)`, [line]))!;
    const allocated = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (q.format === 'csv') {
      if (!ctx.can(req.user, 'insurance.export')) return ctx.fail(403, 'forbidden', 'You do not have permission to export.');
      const lines = (await ctx.lookups.values('insurance_line')).filter((v) => rows.some((r) => r.lines[v.value] !== undefined));
      const head = [by.label, 'Premium allocated', ...lines.map((l) => l.label)];
      const body = rows.map((r) => [r.label, r.amount.toFixed(2), ...lines.map((l) => (r.lines[l.value] ?? 0).toFixed(2))]);
      const csv = [head, ...body].map((cols) => cols.map((c) => csvCell(String(c))).join(',')).join('\r\n');
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="premium-by-${by.type}.csv"`);
      return `﻿${csv}\r\n`;
    }
    return { by: by.type, line, premium: Number(premium.n), allocated, unallocated: Math.round((Number(premium.n) - allocated) * 100) / 100, rows };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/allocation', tag: 'Insurance', permission: 'insurance.view',
    summary: 'Premiums of the policies in force allocated by the kind of record named in `by` (department, site, asset, or another kind the policy covers), with the amount per line of coverage (the same for every viewer); `format=csv` downloads it (needs insurance.export)',
    query: { by: 'department (default), site, asset, or another kind of record the policies cover', line: 'Only policies of this line of coverage', format: 'csv' },
    response: '{ by, line, premium, allocated, unallocated, rows: [{ target_id, label, amount, policies, lines: { [line]: amount } }] }',
  });

  return { allocate, allocateMany };
}
