// Figures of the civil rights area (the same for everyone who may see it: confidential complaints are
// counted, never shown), its metrics for computed indicators, and its daily reminders.
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays, monthEndOf } from '../../../../shared/dates.ts';
import { COMPLAINT } from './complaints.ts';
import { COMPLAINT_FINAL, REPORT_DONE } from './lists.ts';
import { attainmentOf, GOAL } from './participation.ts';
import { PROGRAM, REPORT } from './programs.ts';
import { readSettings } from './settings.ts';

const TAG = 'Civil rights';
const list = (xs: string[]) => xs.map((x) => `'${x}'`).join(', ');
const ymd = (v: unknown): string | null => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

export async function summaryOf(ctx: Pick<ModuleContext, 'db'>, today = todayInZone()) {
  const n = async (sql: string, params: unknown[] = []) => (await ctx.db.one<{ n: number }>(sql, params))!.n;
  const soon = addDays(today, 30);
  const programs = {
    total: await n(`select count(*)::int n from civil_rights_programs where deleted_at is null and status <> 'retired'`),
    update_overdue: await n(`select count(*)::int n from civil_rights_programs where deleted_at is null and status <> 'retired' and next_update_due < $1::date`, [today]),
    reports_overdue: await n(`select count(*)::int n from civil_rights_reports where deleted_at is null and status not in (${list(REPORT_DONE)}) and due_on < $1::date`, [today]),
    reports_due_soon: await n(`select count(*)::int n from civil_rights_reports where deleted_at is null and status not in (${list(REPORT_DONE)}) and due_on between $1::date and $2::date`, [today, soon]),
  };
  const open = `deleted_at is null and status not in (${list(COMPLAINT_FINAL)})`;
  const complaints = {
    open: await n(`select count(*)::int n from civil_rights_complaints where ${open}`),
    overdue: await n(`select count(*)::int n from civil_rights_complaints where ${open} and next_due_on < $1::date`, [today]),
    ack_overdue: await n(`select count(*)::int n from civil_rights_complaints where ${open} and acknowledged_on is null and ack_due_on < $1::date`, [today]),
    received_this_year: await n(`select count(*)::int n from civil_rights_complaints where deleted_at is null and received_on >= $1::date`, [`${today.slice(0, 4)}-01-01`]),
  };
  const goals = await attainmentOf(ctx);
  const current = goals.find((g) => (!g.period_start || g.period_start <= today) && (!g.period_end || g.period_end >= today)) ?? goals[0] ?? null;
  return { programs, complaints, goal: current };
}

export function registerSummary(ctx: ModuleContext) {
  const { app, db } = ctx;

  app.get('/api/civil-rights/summary', { preHandler: ctx.requirePerm('civilrights.view') }, async () => summaryOf(ctx));
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/summary', tag: TAG, permission: 'civilrights.view',
    summary: 'Figures only (the same for everyone; confidential complaints are counted): programs and their reports, open and overdue complaints, and the current participation goal\'s attainment',
    response: '{ programs: { total, update_overdue, reports_overdue, reports_due_soon }, complaints: { open, overdue, ack_overdue, received_this_year }, goal: { goal_id, title, period_label, goal_pct, attainment_pct, shortfall_pct, met, ... } | null }',
  });

  // ---------------------------------------------------------------- metrics (figures: every record counts)

  defineMetric(app, {
    key: 'civilrights.complaints_open', label: 'Civil rights complaints open', unit: 'count', recordType: COMPLAINT,
    description: 'Complaints received by the end of the month and not closed or withdrawn by then.',
    compute: async (_c, monthStart) => {
      const end = monthEndOf(monthStart);
      return (await db.one<{ n: number }>(
        `select count(*)::int n from civil_rights_complaints where deleted_at is null and received_on <= $1::date and (closed_on is null or closed_on > $1::date)`, [end]))!.n;
    },
  });
  defineMetric(app, {
    key: 'civilrights.complaints_overdue', label: 'Civil rights complaints overdue', unit: 'count', recordType: COMPLAINT,
    description: 'Complaints open at the end of the month that had passed their acknowledgment or investigation time limit by then.',
    compute: async (_c, monthStart) => {
      const end = monthEndOf(monthStart);
      return (await db.one<{ n: number }>(
        `select count(*)::int n from civil_rights_complaints where deleted_at is null and received_on <= $1::date and (closed_on is null or closed_on > $1::date)
           and (((acknowledged_on is null or acknowledged_on > $1::date) and ack_due_on < $1::date)
             or ((findings_on is null or findings_on > $1::date) and investigation_due_on < $1::date))`, [end]))!.n;
    },
  });
  defineMetric(app, {
    key: 'civilrights.goal_attainment_pct', label: 'Business participation goal attainment', unit: 'percent', recordType: GOAL,
    description: 'Amounts to certified firms as a share of the award amounts, for the goals whose period includes the end of the month (awards made by then).',
    compute: async (_c, monthStart) => {
      const end = monthEndOf(monthStart);
      const r = await db.one<Row>(
        `select coalesce(sum(a.award_amount), 0)::float8 as base,
            coalesce(sum((select coalesce(sum(f.amount), 0) from civil_rights_award_firms f where f.award_id = a.id and f.certified)), 0)::float8 as certified
         from civil_rights_awards a join civil_rights_goals g on g.id = a.goal_id
         where a.deleted_at is null and g.deleted_at is null and (a.awarded_on is null or a.awarded_on <= $1::date)
           and (g.period_start is null or g.period_start <= $1::date) and (g.period_end is null or g.period_end >= $1::date)`, [end]);
      const base = Number(r?.base ?? 0);
      return base > 0 ? Math.round((Number(r!.certified) / base) * 1000) / 10 : null;
    },
  });
}

/**
 * Tells the investigator (or, with none, the complaint handlers) once when a complaint's next time
 * limit is near and once when it has passed; report owners and program owners the same for reports
 * and program updates. Each reminder is claimed first, so two runs at once send it once.
 */
export async function runReminders(ctx: ModuleContext, today = todayInZone()): Promise<{ complaints: number; reports: number; programs: number }> {
  const { app, db } = ctx;
  const out = { complaints: 0, reports: 0, programs: 0 };
  if (!app.hasDecorator('notify')) return out;
  const s = await readSettings(ctx);
  const horizon = addDays(today, s.reminderDays);
  const claim = async (key: string) => Boolean(await db.one('insert into civil_rights_reminders (key) values ($1) on conflict do nothing returning key', [key]));
  const stateOf = (due: string) => (due < today ? 'overdue' : 'soon');
  const handlers = async () => (await db.query<{ user_id: string }>('select user_id from civil_rights_complaint_viewers')).map((r) => r.user_id);

  const complaints = await db.query<Row>(
    `select id, ref, investigator_id, next_due_on from civil_rights_complaints
     where deleted_at is null and status not in (${list(COMPLAINT_FINAL)}) and next_due_on <= $1::date limit 2000`, [horizon]);
  for (const c of complaints) {
    const due = ymd(c.next_due_on)!;
    const state = stateOf(due);
    if (!(await claim(`complaint:${c.id}:${due}:${state}`))) continue;
    const userIds = c.investigator_id ? [c.investigator_id] : await handlers();
    if (!userIds.length) continue;
    out.complaints += 1;
    // Only the reference: the complaint's words and people stay on its page.
    await app.notify({
      userIds, kind: 'civilrights', recordType: COMPLAINT, recordId: c.id,
      title: state === 'overdue' ? `Complaint ${c.ref} is past its time limit (${due})` : `Complaint ${c.ref} has a time limit on ${due}`,
      body: 'Open the complaint to see what is due.',
    });
  }

  const reports = await db.query<Row>(
    `select id, ref, title, owner_id, due_on from civil_rights_reports
     where deleted_at is null and owner_id is not null and status not in (${list(REPORT_DONE)}) and due_on <= $1::date limit 2000`, [horizon]);
  for (const r of reports) {
    const due = ymd(r.due_on)!;
    const state = stateOf(due);
    if (!(await claim(`report:${r.id}:${due}:${state}`))) continue;
    out.reports += 1;
    await app.notify({
      userIds: [r.owner_id], kind: 'civilrights', recordType: REPORT, recordId: r.id,
      title: state === 'overdue' ? `Report overdue: ${r.ref} ${r.title} was due on ${due}` : `Report due: ${r.ref} ${r.title} is due on ${due}`,
      body: 'Record the submission on the report once it is sent.',
    });
  }

  const programs = await db.query<Row>(
    `select id, ref, name, owner_id, next_update_due from civil_rights_programs
     where deleted_at is null and owner_id is not null and status <> 'retired' and next_update_due <= $1::date limit 2000`, [addDays(today, Math.max(s.reminderDays, 30))]);
  for (const p of programs) {
    const due = ymd(p.next_update_due)!;
    const state = stateOf(due);
    if (!(await claim(`program:${p.id}:${due}:${state}`))) continue;
    out.programs += 1;
    await app.notify({
      userIds: [p.owner_id], kind: 'civilrights', recordType: PROGRAM, recordId: p.id,
      title: state === 'overdue' ? `Program update overdue: ${p.ref} ${p.name}` : `Program update due on ${due}: ${p.ref} ${p.name}`,
      body: 'Update the program and its document, then record the date it was updated.',
    });
  }
  return out;
}
