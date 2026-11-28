// Business participation goals: a goal for each period (a percentage, with notes on how it was set),
// the contracts and awards of the period with the firms taking part in each (a vendor or a name,
// whether it is certified, the amount), attainment against the goal, the shortfall analysis and
// good-faith-efforts notes, and the period's report data as a CSV file. Which firms count as certified
// and how a goal is set are the organization's own; no program of any jurisdiction is built in.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { csvCell } from '../../../../shared/csv-guard.ts';
import { defineChildRows } from './children.ts';
import { PROGRAM } from './programs.ts';

export const GOAL = 'participation_goal';
export const AWARD = 'participation_award';
const TAG = 'Civil rights';
const ymd = (v: unknown): string | null => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface Attainment {
  goal_id: string; ref: string | null; title: string; period_label: string | null; period_start: string | null; period_end: string | null;
  goal_pct: number | null; awards: number; award_total: number; participation_total: number; certified_total: number;
  attainment_pct: number | null; shortfall_pct: number | null; met: boolean | null;
}

/**
 * Attainment of goals (a figure: every award counts, whoever asks). `where` narrows the goals
 * (SQL over alias g, with `params`).
 */
export async function attainmentOf(ctx: Pick<ModuleContext, 'db'>, where = 'true', params: unknown[] = []): Promise<Attainment[]> {
  const rows = await ctx.db.query<Row>(
    `select g.id, g.ref, g.title, g.period_label, g.period_start, g.period_end, g.goal_pct,
        (select count(*)::int from civil_rights_awards a where a.goal_id = g.id and a.deleted_at is null) as awards,
        (select coalesce(sum(a.award_amount), 0)::float8 from civil_rights_awards a where a.goal_id = g.id and a.deleted_at is null) as award_total,
        (select coalesce(sum(f.amount), 0)::float8 from civil_rights_award_firms f join civil_rights_awards a on a.id = f.award_id
          where a.goal_id = g.id and a.deleted_at is null) as participation_total,
        (select coalesce(sum(f.amount), 0)::float8 from civil_rights_award_firms f join civil_rights_awards a on a.id = f.award_id
          where a.goal_id = g.id and a.deleted_at is null and f.certified) as certified_total
     from civil_rights_goals g where g.deleted_at is null and ${where}
     order by g.period_start desc nulls last, g.title`, params);
  return rows.map((r) => {
    const base = Number(r.award_total);
    const certified = Number(r.certified_total);
    const pct = base > 0 ? round1((certified / base) * 100) : null;
    const goal = r.goal_pct == null ? null : Number(r.goal_pct);
    return {
      goal_id: r.id, ref: r.ref ?? null, title: r.title, period_label: r.period_label ?? null, period_start: ymd(r.period_start), period_end: ymd(r.period_end),
      goal_pct: goal, awards: Number(r.awards), award_total: base, participation_total: Number(r.participation_total), certified_total: certified,
      attainment_pct: pct, shortfall_pct: goal != null && pct != null && pct < goal ? round1(goal - pct) : goal != null && pct == null ? goal : null,
      met: goal == null || pct == null ? null : pct >= goal,
    };
  });
}

export async function registerParticipation(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  const checkGoal = (merged: Row): void => {
    const errors: Record<string, string> = {};
    if (merged.goal_pct != null && merged.goal_pct !== '') {
      const n = Number(merged.goal_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) errors.goal_pct = 'Give a percentage from 0 to 100.';
    }
    const start = ymd(merged.period_start);
    const end = ymd(merged.period_end);
    if (start && end && end < start) errors.period_end = 'The period ends after it starts.';
    if (Object.keys(errors).length) invalid(errors);
  };

  ctx.defineResource({
    type: GOAL, table: 'civil_rights_goals', module: 'civilrights', label: 'Participation goal', plural: 'Participation goals',
    path: '/api/civil-rights/goals', route: '/civil-rights/goals', titleField: 'title',
    ref: { field: 'ref', prefix: 'CRG-' }, searchable: ['title', 'method_notes', 'shortfall_analysis', 'good_faith_notes'],
    defaultSort: { field: 'period_start', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, help: 'For example "Participation goal, first three years".' },
      program_id: { label: 'Program', type: 'ref', to: PROGRAM },
      period_label: { label: 'Period', type: 'text', help: 'The period in your own words, for example "Year 1".' },
      period_start: { label: 'Period starts', type: 'date' },
      period_end: { label: 'Period ends', type: 'date' },
      goal_pct: { label: 'Goal (%)', type: 'number', help: 'The share of the period\'s award amounts expected to go to certified firms, from 0 to 100.' },
      method_notes: { label: 'How the goal was set', type: 'longtext', personal: false },
      status: { label: 'Status', type: 'lookup', list: 'civil_rights_goal_status', default: 'draft' },
      owner_id: { label: 'Owner', type: 'user' },
      shortfall_analysis: { label: 'Shortfall analysis', type: 'longtext', personal: false, help: 'Why the goal was not met and what will change.' },
      good_faith_notes: { label: 'Good-faith efforts', type: 'longtext', personal: false, help: 'Outreach and other efforts made to reach the goal.' },
    },
    hooks: {
      beforeCreate: async (_req, data) => { checkGoal(data); return data; },
      beforeUpdate: async (_req, existing, patch) => { checkGoal({ ...existing, ...patch }); return patch; },
    },
  });

  ctx.defineResource({
    type: AWARD, table: 'civil_rights_awards', module: 'civilrights', label: 'Participation award', plural: 'Participation awards',
    path: '/api/civil-rights/awards', route: '/civil-rights/awards', titleField: 'title',
    ref: { field: 'ref', prefix: 'CRA-' }, searchable: ['title', 'notes'],
    defaultSort: { field: 'awarded_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, help: 'What was awarded, for example "Shelter cleaning, two years".' },
      goal_id: { label: 'Goal', type: 'ref', to: GOAL, help: 'The participation goal whose period the award counts toward.' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
      prime_vendor_id: { label: 'Prime contractor', type: 'ref', to: 'vendor' },
      awarded_on: { label: 'Awarded on', type: 'date' },
      award_amount: { label: 'Award amount', type: 'currency', help: 'The whole amount of the award: the base the goal is measured against.' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: async (_req, data) => {
        if (data.award_amount != null && Number(data.award_amount) < 0) invalid({ award_amount: 'Give an amount of 0 or more.' });
        return data;
      },
      beforeUpdate: async (_req, _existing, patch) => {
        if (patch.award_amount != null && Number(patch.award_amount) < 0) invalid({ award_amount: 'Give an amount of 0 or more.' });
        return patch;
      },
    },
  });

  defineChildRows(ctx, {
    table: 'civil_rights_award_firms', parentType: AWARD, parentColumn: 'award_id',
    base: '/api/civil-rights/awards', segment: 'firms', tag: TAG,
    label: () => 'Participating firm',
    fields: {
      vendor_id: { kind: 'ref', to: 'vendor' }, firm_name: { kind: 'text', max: 200 }, certified: { kind: 'bool' },
      role: { kind: 'text', max: 100 }, amount: { kind: 'number', min: 0 }, note: { kind: 'longtext' },
    },
    view: 'civilrights.view', edit: 'civilrights.edit',
    summary: 'the firms taking part in an award (a vendor or a firm name, certified or not, with the amount)',
    body: '{ vendor_id?, firm_name?, certified?: boolean, role?, amount?: number, note? }',
  });

  const goalFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find(GOAL, String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Goal not found.');

  app.get('/api/civil-rights/goals/:id/attainment', { preHandler: ctx.requirePerm('civilrights.view') }, async (req) => {
    const goal = await goalFor(req);
    return (await attainmentOf(ctx, 'g.id = $1', [goal.id]))[0];
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/goals/:id/attainment', tag: TAG, permission: 'civilrights.view',
    summary: 'Attainment of one goal: award total, amounts to participating and to certified firms, attainment and shortfall in percent',
    response: '{ goal_id, ref, title, period_label, period_start, period_end, goal_pct, awards, award_total, participation_total, certified_total, attainment_pct, shortfall_pct, met }',
  });

  app.get('/api/civil-rights/attainment', { preHandler: ctx.requirePerm('civilrights.view') }, async () => attainmentOf(ctx));
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/attainment', tag: TAG, permission: 'civilrights.view',
    summary: 'Attainment against every goal, newest period first (a figure: every award counts)',
    response: '[{ goal_id, ref, title, period_label, goal_pct, award_total, certified_total, attainment_pct, shortfall_pct, met }]',
  });

  app.get('/api/civil-rights/goals/:id/export', { preHandler: ctx.requirePerm('civilrights.export') }, async (req, reply: FastifyReply) => {
    const goal = await goalFor(req);
    const a = (await attainmentOf(ctx, 'g.id = $1', [goal.id]))[0];
    const rows = await db.query<Row>(
      `select a.id, a.ref, a.title, a.contract_id, a.prime_vendor_id, a.awarded_on, a.award_amount::float8 as award_amount,
          f.vendor_id, f.firm_name, f.certified, f.role, f.amount::float8 as amount
       from civil_rights_awards a left join civil_rights_award_firms f on f.award_id = a.id
       where a.goal_id = $1 and a.deleted_at is null and ${ctx.resources.visibleWhere(AWARD, req.user, 'a')}
       order by a.awarded_on nulls last, a.ref, f.sort`, [goal.id]);
    const label = async (type: string, id: unknown) => (typeof id === 'string' && ctx.resources.get(type) && await ctx.resources.find(type, id, req.user)
      ? await ctx.resources.labelFor(type, id) : null);
    const head = ['Goal', 'Period', 'Award', 'Award title', 'Contract', 'Prime contractor', 'Awarded on', 'Award amount', 'Firm', 'Certified', 'Role', 'Firm amount'];
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([
        `${goal.ref ?? ''} ${goal.title}`.trim(), goal.period_label, r.ref, r.title, await label('contract', r.contract_id), await label('vendor', r.prime_vendor_id),
        ymd(r.awarded_on), r.award_amount, (await label('vendor', r.vendor_id)) ?? r.firm_name, r.vendor_id || r.firm_name ? (r.certified ? 'Yes' : 'No') : '',
        r.role, r.amount,
      ].map(csvCell).join(','));
    }
    // The figures of the period, as the report gives them.
    lines.push('');
    for (const [k, v] of [
      ['Goal (%)', a.goal_pct], ['Award total', a.award_total], ['Participating firms total', a.participation_total],
      ['Certified firms total', a.certified_total], ['Attainment (%)', a.attainment_pct], ['Shortfall (%)', a.shortfall_pct],
    ] as [string, unknown][]) lines.push([k, v].map(csvCell).join(','));
    await ctx.audit(req, { action: 'participation_goal.export', recordType: GOAL, recordId: goal.id, summary: `Exported the report data of ${goal.ref ?? goal.title} to CSV` });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="participation-${String(goal.ref ?? 'goal').toLowerCase()}.csv"`);
    return '﻿' + lines.join('\r\n');
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/goals/:id/export', tag: TAG, permission: 'civilrights.export',
    summary: 'The periodic report data of a goal as a CSV file: each award with its participating firms, then the period\'s figures',
    response: 'text/csv',
  });
}
