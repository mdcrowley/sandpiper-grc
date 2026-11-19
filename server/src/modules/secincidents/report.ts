import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { amberFraction, byUrgency, clockOf } from './clocks.ts';
import { incidentQuestions, lifecycle, reviewLifecycle } from './defaults.ts';

/**
 * Everything the generated incident report shows, in one read: the incident with its labels,
 * the timeline (oldest first), decisions, notifications made, checklists, roles, evidence,
 * the review and its follow-up actions. Opening it is audited.
 */
export async function buildReport(ctx: ModuleContext, req: FastifyRequest, incident: Row): Promise<Row> {
  const { db } = ctx;
  const now = new Date();
  const label = async (list: string, value: unknown) =>
    value ? (await ctx.lookups.values(list)).find((v) => v.value === value)?.label ?? String(value) : null;
  const userName = async (id: unknown) =>
    id ? (await db.one<{ display_name: string }>(`select display_name from users where id = $1`, [id]))?.display_name ?? null : null;

  const log = await db.query<Row>(
    `select id, at, author_name, entry, kind from incident_log_entries where incident_id = $1 order by at, created_at`, [incident.id]);
  const kinds = await ctx.lookups.values('incident_log_kind');
  const fraction = await amberFraction(ctx);
  const tasks = await db.query<Row>(
    `select t.*, u.display_name as completed_by_name from notification_tasks t left join users u on u.id = t.completed_by
     where t.incident_id = $1 and t.deleted_at is null`, [incident.id]);
  const checklist = await db.query<Row>(
    `select phase, step, done, done_by_name, done_at, scenario from incident_checklist_items
     where incident_id = $1 and deleted_at is null order by phase, sort, created_at`, [incident.id]);
  const phases = await ctx.lookups.values('incident_checklist_phase');
  const roles = await db.query<Row>(
    `select role, person_name, contact from incident_roles where incident_id = $1 and deleted_at is null order by sort, created_at`, [incident.id]);
  const evidence = await db.query<Row>(
    `select item, where_held, collected_by, collected_at, hash_ref from incident_evidence
     where incident_id = $1 and deleted_at is null order by collected_at nulls last, created_at`, [incident.id]);

  // Follow-up actions live in another module: only when it is loaded and the reader may see them.
  let actions: Row[] | null = null;
  if (ctx.resources.get('action') && ctx.can(req.user, 'actions.view')) {
    const statuses = await ctx.lookups.values('action_status');
    const rows = await db.query<Row>(
      `select a.ref, a.title, a.status, a.due_on, a.completed_on, u.display_name as owner
       from actions a left join users u on u.id = a.owner_id
       where a.deleted_at is null and a.source_type = 'security_incident' and a.source_id = $1
         and ${ctx.resources.visibleWhere('action', req.user, 'a')}
       order by a.due_on nulls last, a.created_at`, [incident.id]);
    actions = rows.map((a) => ({ ...a, status_label: statuses.find((s) => s.value === a.status)?.label ?? a.status }));
  }

  const questions = await incidentQuestions(ctx);
  const held: string[] = Array.isArray(incident.data_kinds) ? incident.data_kinds : [];
  const stage = (await lifecycle(ctx)).find((s) => s.value === incident.status)?.stage ?? null;
  const reviewStage = (await reviewLifecycle(ctx)).find((s) => s.value === incident.review_status)?.stage ?? 'open';

  await ctx.audit(req, {
    action: 'security_incident.report_export', recordType: 'security_incident', recordId: incident.id,
    summary: `Incident report opened for ${incident.ref}`,
  });

  return {
    generated_at: now.toISOString(),
    generated_by: req.user!.displayName,
    incident: {
      id: incident.id, ref: incident.ref, title: incident.title, summary: incident.summary,
      severity: incident.severity, severity_label: await label('security_incident_severity', incident.severity),
      status: incident.status, status_label: await label('security_incident_status', incident.status), stage,
      scenario_label: await label('security_incident_scenario', incident.scenario),
      lead: await userName(incident.lead_id),
      discovered_at: incident.discovered_at, declared_at: incident.declared_at, contained_at: incident.contained_at, closed_at: incident.closed_at,
      affected_systems: incident.affected_systems, affected_data: incident.affected_data,
      answers: questions.map((q) => ({
        question: q.question, yes: q.kind === 'flag' ? incident[q.value] === true : held.includes(q.value),
      })),
      ransom_status_label: await label('ransom_payment_status', incident.ransom_payment_status),
      ransom_applies: incident.ransom_payment_status !== 'not_applicable',
      board_resolution_ref: incident.board_resolution_ref,
    },
    timeline: log.map((e) => ({ ...e, kind_label: kinds.find((k) => k.value === e.kind)?.label ?? e.kind })),
    decisions: log.filter((e) => e.kind === 'decision'),
    notifications: tasks.map((t) => clockOf(t, incident.discovered_at, now, fraction)).sort(byUrgency),
    checklist: phases.map((p) => ({ phase: p.value, label: p.label, items: checklist.filter((c) => c.phase === p.value) }))
      .filter((p) => p.items.length),
    roles,
    evidence,
    review: {
      status: incident.review_status, status_label: await label('incident_review_status', incident.review_status), stage: reviewStage,
      due_on: incident.review_due_on, held_at: incident.review_held_at, lead: await userName(incident.review_lead_id),
      attendees: incident.review_attendees, skip_reason: incident.review_skip_reason,
      completed_at: incident.review_completed_at, completed_by: await userName(incident.review_completed_by),
      what_happened: incident.what_happened, root_cause: incident.root_cause, went_well: incident.went_well, to_improve: incident.to_improve,
    },
    actions,
  };
}
