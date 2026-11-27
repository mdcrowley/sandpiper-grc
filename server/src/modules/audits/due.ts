// Evidence requests in My work, the compliance calendar and calendar feeds (E41-03): one calendar
// source (core/calendar.ts). An open request is one still to answer: requested, or returned for more.
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

export function registerDue(ctx: ModuleContext) {
  defineCalendarSource(ctx.app, {
    key: 'audits.requests', label: 'Evidence requests asked of me', kind: 'Evidence requests',
    recordType: 'audit_request', permission: 'audits.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.request, t.due_on::text as d, t.owner_id as p from audit_requests t
         where t.deleted_at is null and ${c.resources.visibleWhere('audit_request', user, 't')}
           and ($1::uuid is null or t.owner_id = $1) and t.due_on between $2::date and $3::date
           and coalesce(t.status, 'requested') not in ('provided', 'accepted')
         order by t.due_on, t.id limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `audits.requests:${r.id}`, title: `Evidence due: ${r.ref ?? ''} ${String(r.request).slice(0, 120)}`.replace(/\s+/g, ' '),
        start: day(r.d), allDay: true, url: `/audits/requests/${r.id}`, recordType: 'audit_request', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });

  // E45-16: findings waiting for the named auditor's verification, dated by when it is due (or today,
  // when no date was set), so overdue ones stay listed until verified.
  defineCalendarSource(ctx.app, {
    key: 'audits.verifications', label: 'Finding verifications I am to make', kind: 'Finding verifications',
    recordType: 'audit_finding', permission: 'audits.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.title, coalesce(t.verification_due, t.updated_at::date)::text as d, t.verifier_id as p from audit_findings t
         where t.deleted_at is null and ${c.resources.visibleWhere('audit_finding', user, 't')}
           and t.verifier_id is not null and ($1::uuid is null or t.verifier_id = $1)
           and t.verified_on is null and t.status = 'awaiting_verification'
           and coalesce(t.verification_due, t.updated_at::date) <= $3::date
           and (coalesce(t.verification_due, t.updated_at::date) >= $2::date or coalesce(t.verification_due, t.updated_at::date) < $4::date)
         order by 4, t.id limit 2000`, [whoFor(user, scope), from, to, dayInZone()]);
      return rows.map((r) => ({
        uid: `audits.verifications:${r.id}`, title: `Verify finding: ${r.ref ?? ''} ${String(r.title).slice(0, 120)}`.replace(/\s+/g, ' '),
        start: day(r.d), allDay: true, url: `/audit-findings/${r.id}`, recordType: 'audit_finding', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });

  // E45-15: review notes on workpaper steps that the step's preparer is to clear.
  defineCalendarSource(ctx.app, {
    key: 'audits.review_notes', label: 'Workpaper review notes for me to clear', kind: 'Workpaper review notes',
    recordType: 'audit_engagement', permission: 'audits.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select n.id, a.id as audit_id, a.ref, n.raised_at::date::text as d, n.addressed_to as p, n.note from workpaper_review_notes n
         join audits a on a.id = n.parent_id and n.parent_type = 'audit_engagement' and a.deleted_at is null
         where n.cleared_at is null and n.addressed_to is not null and ${c.resources.visibleWhere('audit_engagement', user, 'a')}
           and ($1::uuid is null or n.addressed_to = $1) and n.raised_at::date <= $3::date and $2::date is not null
         order by n.raised_at, n.id limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `audits.review_notes:${r.id}`, title: `Clear review note: ${r.ref ?? ''} ${String(r.note).slice(0, 100)}`.replace(/\s+/g, ' '),
        start: day(r.d), allDay: true, url: `/audits/engagements/${r.audit_id}?tab=checklist`, recordType: 'audit_engagement', recordId: r.audit_id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
}
