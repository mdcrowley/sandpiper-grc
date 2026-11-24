// Funding certifications in My work, the compliance calendar and calendar feeds (E41-03): a calendar
// source (core/calendar.ts). Before a certification is signed, its authorized official has it to sign
// by its due date, and each person responsible for one of its items that applies has that item to
// confirm by the same date.
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const named = (r: Row) => [r.ref, r.title].filter(Boolean).join(' ');

export function registerDue(ctx: ModuleContext) {
  defineCalendarSource(ctx.app, {
    key: 'funding.certifications', label: 'Funding certifications for me to sign or confirm', kind: 'Funding certifications',
    recordType: 'funding_certification', permission: 'funding.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const visible = c.resources.visibleWhere('funding_certification', user, 't');
      const rows = await c.db.query<Row>(
        `select * from (
           select t.id, t.ref, t.title, t.due_on::text as d, t.signer_id as p, null::uuid as item_id, null::text as statement
           from funding_certifications t
           where t.deleted_at is null and ${visible} and t.signer_id is not null
             and coalesce(t.status, 'draft') in ('draft', 'in_review') and t.due_on between $2::date and $3::date
           union all
           select t.id, t.ref, t.title, t.due_on::text as d, i.responsible_id as p, i.id as item_id, i.statement
           from funding_certification_items i join funding_certifications t on t.id = i.certification_id
           where t.deleted_at is null and ${visible} and i.applies and i.confirmed_on is null and i.responsible_id is not null
             and coalesce(t.status, 'draft') in ('draft', 'in_review') and t.due_on between $2::date and $3::date) u
         where $1::uuid is null or u.p = $1
         order by d, id limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: r.item_id ? `funding.certifications:item:${r.item_id}` : `funding.certifications:${r.id}`,
        title: r.item_id ? `Confirm certification item: ${String(r.statement).slice(0, 100)} (${named(r)})` : `Sign certification: ${named(r)}`,
        start: day(r.d), allDay: true, url: `/funding/certifications/${r.id}`, recordType: 'funding_certification', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
}
