// Certifications coming up for renewal in My work, the compliance calendar and calendar feeds
// (E41-03): a calendar source (core/calendar.ts). A certification is the holder's to renew: the
// roster person's account (people.user_id). An expired one stays until it is renewed, suspended or
// revoked. Needs the people module (the roster); without it the source has nothing to show.
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

export function registerDue(ctx: ModuleContext) {
  defineCalendarSource(ctx.app, {
    key: 'training.certifications', label: 'My certifications due for renewal', kind: 'Certification renewals',
    recordType: 'certification', permission: 'training.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      if (!c.resources.get('person')) return [];
      const types = new Map((await c.lookups.values('certification_type')).map((v) => [v.value, v.label]));
      const rows = await c.db.query<Row>(
        `select t.id, t.ref, t.certification_type, t.expires_on::text as d, p.user_id as p from certifications t
         join people p on p.id = t.person_id and p.deleted_at is null
         where t.deleted_at is null and ${c.resources.visibleWhere('certification', user, 't')}
           and p.user_id is not null and ($1::uuid is null or p.user_id = $1)
           and t.status = 'active' and t.expires_on between $2::date and $3::date
         order by t.expires_on, t.id limit 2000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `training.certifications:${r.id}:${day(r.d)}`, title: `Certification expires: ${types.get(r.certification_type) ?? r.certification_type}`,
        start: day(r.d), allDay: true, url: `/training/certifications/${r.id}`, recordType: 'certification', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
}
