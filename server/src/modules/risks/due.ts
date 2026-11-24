// Corrective-action verifications and obligation periods to attest in My work, the compliance
// calendar and calendar feeds (E41-03): calendar sources (core/calendar.ts).
// - A verification is for the action's verifier, else its plan's responsible person (as the
//   reminders choose, caps.ts runVerificationReminders).
// - A period to attest is a recorded period not yet attested, other than the one ending on the
//   obligation's next due date (that one is the `obligations.due` source), for the obligation's owner.
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { PENDING_VERIFICATION } from './actions-resource.ts';

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const named = (r: Row) => [r.ref, r.title].filter(Boolean).join(' ');

export function registerDue(ctx: ModuleContext) {
  defineCalendarSource(ctx.app, {
    key: 'actions.verifications', label: 'Corrective actions for me to verify', kind: 'Verifications',
    recordType: 'action', permission: 'actions.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select * from (
           select t.id, t.ref, t.title, t.verification_due::text as d, coalesce(t.verifier_id, c.responsible_id) as p from actions t left join caps c on c.id = t.cap_id and c.deleted_at is null
           where t.deleted_at is null and ${c.resources.visibleWhere('action', user, 't')} and t.status = $4
             and t.verification_due between $2::date and $3::date) u
         where $1::uuid is null or u.p = $1
         order by d, id limit 2000`, [whoFor(user, scope), from, to, PENDING_VERIFICATION]);
      return rows.map((r) => ({
        uid: `actions.verifications:${r.id}`, title: `Verify action: ${named(r)}`, start: day(r.d), allDay: true,
        url: `/actions/${r.id}`, recordType: 'action', recordId: r.id, ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });

  defineCalendarSource(ctx.app, {
    key: 'obligations.attestations', label: 'Obligation periods for me to attest', kind: 'Attestations',
    recordType: 'obligation', permission: 'obligations.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.title, t.owner_id as p, x.id as period_id, x.due_on::text as d,
                x.period_start::text as ps, x.period_end::text as pe
         from obligation_periods x join obligations t on t.id = x.obligation_id
         where t.deleted_at is null and ${c.resources.visibleWhere('obligation', user, 't')}
           and ($1::uuid is null or t.owner_id = $1) and x.status is null and x.due_on between $2::date and $3::date
           and x.due_on is distinct from t.next_due_on
         order by x.due_on, t.id limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `obligations.attestations:${r.period_id}`, title: `Attest period ${day(r.ps)} to ${day(r.pe)}: ${named(r)}`,
        start: day(r.d), allDay: true, url: `/obligations/${r.id}?tab=periods`, recordType: 'obligation', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
}
