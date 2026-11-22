// Calendar sources for the modules that existed before wave 11 (contract C3). Each source reads the
// owning module's table with hand-written SQL, so it is guarded by `ctx.resources.get(type)` (the
// module may not be loaded, or its area switched off) and always includes `visibleWhere(type, user)`:
// a source is a list, so it returns only what the person may see, and only what they are involved in
// (owner, assignee, member), never every record of the type. The feed checks visibility again.
//
// Modules added in wave 11 (continuity, records, vendor lifecycle, condition) define their own sources
// in their `register`.
import type { FastifyInstance } from 'fastify';
import { defineCalendarSource, type CalendarEvent } from '../../core/calendar.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const named = (r: Row) => [r.ref, r.title].filter(Boolean).join(' ');
const MAX = 2000;

interface Spec {
  key: string;
  label: string;
  type: string;
  permission: string;
  /** Rows of the type (alias t) the person is involved in, in the window ($1 user, $2 from, $3 to). */
  query(ctx: ModuleContext, user: SessionUser, visible: string): Promise<{ sql: string; extra?: unknown[] }>;
  /** Event title from a row (`title`, `ref`, `d` and maybe `e`). */
  title(r: Row): string;
  /** Timed events: `d` and `e` are timestamps; otherwise `d` is a date. */
  timed?: boolean;
  /** Length of a timed event with no end, in minutes. */
  minutes?: number;
}

/** Builds a source's events: guards, runs the query, shapes the rows. */
async function eventsOf(spec: Spec, ctx: ModuleContext, user: SessionUser, from: string, to: string): Promise<CalendarEvent[]> {
  const def = ctx.resources.get(spec.type);
  if (!def) return [];
  const visible = ctx.resources.visibleWhere(spec.type, user, 't');
  const { sql, extra = [] } = await spec.query(ctx, user, visible);
  const rows = await ctx.db.query<Row>(`${sql} limit ${MAX}`, [user.id, from, to, ...extra]);
  return rows.map((r) => {
    const recordType = (r.record_type as string | undefined) ?? spec.type;
    const route = ctx.resources.get(recordType)?.route ?? def.route;
    const start = spec.timed ? iso(r.d) : day(r.d);
    const end = spec.timed
      ? (r.e ? iso(r.e) : new Date(new Date(start).getTime() + (spec.minutes ?? 60) * 60_000).toISOString())
      : (r.e ? day(r.e) : undefined);
    return {
      uid: `${spec.key}:${recordType}:${r.id}`, title: spec.title(r), start, end, allDay: !spec.timed,
      url: `${route}/${r.id}`, recordType, recordId: r.id,
    };
  });
}

async function closedActionStatuses(ctx: ModuleContext): Promise<string[]> {
  const v = await ctx.settings.get<unknown>('notifications.action_closed_statuses', ['done', 'cancelled']);
  return Array.isArray(v) && v.length ? v.map(String) : ['done', 'cancelled'];
}

/** True when the people table is there (people module loaded and on): members linked by roster person. */
const hasPeople = (ctx: ModuleContext) => Boolean(ctx.resources.get('person'));

export const SOURCE_SPECS: Spec[] = [
  {
    key: 'actions.due', label: 'My actions due', type: 'action', permission: 'actions.view',
    async query(ctx, _u, visible) {
      return {
        sql: `select t.id, t.ref, t.title, t.due_on as d from actions t
              where t.deleted_at is null and ${visible} and t.owner_id = $1 and t.due_on between $2::date and $3::date
                and coalesce(t.status, '') <> all($4::text[]) order by t.due_on, t.id`,
        extra: [await closedActionStatuses(ctx)],
      };
    },
    title: (r) => `Action due: ${named(r)}`,
  },
  {
    key: 'risks.review', label: 'Reviews of risks I own', type: 'risk', permission: 'risks.view',
    async query(_ctx, _u, visible) {
      return {
        sql: `select t.id, t.ref, t.title, t.review_on as d from risks t
              where t.deleted_at is null and ${visible} and t.owner_id = $1 and t.review_on between $2::date and $3::date
                and coalesce(t.status, '') <> 'closed' order by t.review_on, t.id`,
      };
    },
    title: (r) => `Risk review: ${named(r)}`,
  },
  {
    key: 'obligations.due', label: 'Obligations I own coming due', type: 'obligation', permission: 'obligations.view',
    async query(_ctx, _u, visible) {
      return {
        sql: `select t.id, t.ref, t.title, t.next_due_on as d from obligations t
              where t.deleted_at is null and ${visible} and t.owner_id = $1 and t.next_due_on between $2::date and $3::date
              order by t.next_due_on, t.id`,
      };
    },
    title: (r) => `Obligation due: ${named(r)}`,
  },
  {
    key: 'policies.review', label: 'Reviews of policies I own', type: 'policy', permission: 'policies.view',
    async query(_ctx, _u, visible) {
      return {
        sql: `select t.id, t.ref, t.title, t.review_date as d from policies t
              where t.deleted_at is null and ${visible} and t.owner_id = $1 and t.review_date between $2::date and $3::date
                and t.status <> 'retired' order by t.review_date, t.id`,
      };
    },
    title: (r) => `Policy review: ${named(r)}`,
  },
  {
    key: 'exercises.date', label: 'Exercises I own', type: 'exercise', permission: 'exercises.view',
    async query(_ctx, _u, visible) {
      return {
        sql: `select t.id, t.ref, t.title, t.exercise_date as d from exercises t
              where t.deleted_at is null and ${visible} and t.owner_id = $1 and t.exercise_date between $2::date and $3::date
                and coalesce(t.status, '') not in ('cancelled', 'canceled') order by t.exercise_date, t.id`,
      };
    },
    title: (r) => `Exercise: ${named(r)}`,
  },
  {
    key: 'changes.window', label: 'Changes I own, work on or approve', type: 'change', permission: 'changes.view',
    timed: true,
    async query(_ctx, _u, visible) {
      // The change window overlaps the feed's window; approvers are those named when it was submitted.
      return {
        sql: `select t.id, t.ref, t.title, t.planned_start as d, t.planned_end as e from changes t
              where t.deleted_at is null and ${visible} and t.planned_start is not null
                and (t.owner_id = $1 or t.assignee_id = $1 or coalesce(t.approver_pool->'users', '[]'::jsonb) @> to_jsonb($1::text))
                and t.planned_start < ($3::date + 1)::timestamptz and coalesce(t.planned_end, t.planned_start) >= $2::date::timestamptz
                and t.status not in ('rejected', 'cancelled', 'canceled', 'closed')
              order by t.planned_start, t.id`,
      };
    },
    title: (r) => `Change: ${named(r)}`,
  },
  {
    key: 'governance.meetings', label: 'Meetings of committees I sit on', type: 'meeting', permission: 'governance.view',
    timed: true, minutes: 60,
    async query(ctx, _u, visible) {
      const viaPerson = hasPeople(ctx)
        ? 'or m.person_id in (select p.id from people p where p.user_id = $1 and p.deleted_at is null)'
        : '';
      return {
        sql: `select t.id, t.ref, t.title, t.scheduled_at as d from meetings t
              where t.deleted_at is null and ${visible} and t.status <> 'canceled'
                and t.scheduled_at >= $2::date::timestamptz and t.scheduled_at < ($3::date + 1)::timestamptz
                and (t.chair_id = $1 or t.secretary_id = $1 or exists (
                  select 1 from committee_members m where m.committee_id = t.committee_id and m.deleted_at is null
                    and (m.to_on is null or m.to_on >= t.scheduled_at::date) and (m.user_id = $1 ${viaPerson})))
              order by t.scheduled_at, t.id`,
      };
    },
    title: (r) => `Meeting: ${named(r)}`,
  },
  {
    key: 'audits.inspections', label: 'Inspections assigned to me', type: 'inspection', permission: 'audits.view',
    async query(_ctx, _u, visible) {
      return {
        sql: `select t.id, t.ref, coalesce(t.title, t.target_label) as title, t.due_on as d from inspections t
              where t.deleted_at is null and ${visible} and t.inspector_id = $1 and t.due_on between $2::date and $3::date
                and coalesce(t.status, '') not in ('complete', 'missed') order by t.due_on, t.id`,
      };
    },
    title: (r) => `Inspection due: ${named(r)}`,
  },
  {
    key: 'controls.tests', label: 'Tests of controls I own or operate', type: 'control', permission: 'controls.view',
    async query(ctx, user, visible) {
      // A control's next test, plus planned tests where I am the tester (when they are visible to me).
      const tests = ctx.resources.get('control_test')
        ? `union all
           select x.id, x.ref, x.title, x.planned_on as d, 'control_test' as record_type from control_tests x
           where x.deleted_at is null and ${ctx.resources.visibleWhere('control_test', user, 'x')} and x.tester_id = $1
             and x.performed_on is null and x.planned_on between $2::date and $3::date`
        : '';
      return {
        sql: `select * from (
                select t.id, t.ref, t.title, t.next_test_due as d, 'control' as record_type from controls t
                where t.deleted_at is null and ${visible} and (t.owner_id = $1 or t.operator_id = $1)
                  and t.next_test_due between $2::date and $3::date and coalesce(t.status, '') <> 'retired'
                ${tests}) u order by d, id`,
      };
    },
    title: (r) => (r.record_type === 'control_test' ? `Control test planned: ${named(r)}` : `Control test due: ${named(r)}`),
  },
];

/** Defines the sources above (called from the feeds module's `register`). */
export function defineFeedSources(app: FastifyInstance): void {
  for (const spec of SOURCE_SPECS) {
    defineCalendarSource(app, {
      key: spec.key, label: spec.label, recordType: spec.type, permission: spec.permission,
      events: (ctx, user, from, to) => eventsOf(spec, ctx, user, from, to),
    });
  }
}
