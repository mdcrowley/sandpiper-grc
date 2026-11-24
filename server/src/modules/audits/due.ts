// Evidence requests in My work, the compliance calendar and calendar feeds (E41-03): one calendar
// source (core/calendar.ts). An open request is one still to answer: requested, or returned for more.
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

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
}
