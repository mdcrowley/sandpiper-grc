// Certifications coming up for renewal in My work, the compliance calendar and calendar feeds
// (E41-03): calendar sources (core/calendar.ts). A certification is the holder's to renew: the
// roster person's account (people.user_id). An expired one stays until it is renewed, suspended or
// revoked; once a later certification of the same kind is recorded, the earlier one is left out.
// Needs the people module (the roster); without it the sources have nothing to show.
//
// Two sources: `training.certifications` for people who hold training.view (anyone's, for the
// compliance calendar), and `training.my_certifications` (E46-70) for every employee without it:
// named, so it needs no permission, and it gives only the asker's own (My work on the web and on
// the mobile app, which reads the same GET /api/work/mine). Each item is given by one of them only.
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { can } from '../../core/services.ts';

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

/** Active certifications of `who` (an account, or null for everyone) expiring between two days and not renewed. */
async function dueCertifications(c: ModuleContext, user: SessionUser, who: string | null, from: string, to: string): Promise<Row[]> {
  return c.db.query<Row>(
    `select t.id, t.ref, t.certification_type, t.expires_on::text as d, p.user_id as p from certifications t
     join people p on p.id = t.person_id and p.deleted_at is null
     where t.deleted_at is null and ${c.resources.visibleWhere('certification', user, 't')}
       and p.user_id is not null and ($1::uuid is null or p.user_id = $1)
       and t.status = 'active' and t.expires_on between $2::date and $3::date
       and not exists (select 1 from certifications n where n.deleted_at is null and n.status = 'active' and n.person_id = t.person_id
                         and n.certification_type = t.certification_type and n.id <> t.id
                         and (n.expires_on is null or n.expires_on > t.expires_on))
     order by t.expires_on, t.id limit 2000`, [who, from, to]);
}

export function registerDue(ctx: ModuleContext) {
  const label = async (c: ModuleContext) => new Map((await c.lookups.values('certification_type')).map((v) => [v.value, v.label]));
  defineCalendarSource(ctx.app, {
    key: 'training.certifications', label: 'My certifications due for renewal', kind: 'Certification renewals',
    recordType: 'certification', permission: 'training.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      if (!c.resources.get('person')) return [];
      const types = await label(c);
      const rows = await dueCertifications(c, user, whoFor(user, scope), from, to);
      return rows.map((r) => ({
        uid: `training.certifications:${r.id}:${day(r.d)}`, title: `Certification expires: ${types.get(r.certification_type) ?? r.certification_type}`,
        start: day(r.d), allDay: true, url: `/training/certifications/${r.id}`, recordType: 'certification', recordId: r.id,
        ref: r.ref ?? null, personId: r.p ?? null,
      }));
    },
  });
  // E46-70: an employee without training permissions still sees their own renewals in My work.
  defineCalendarSource(ctx.app, {
    key: 'training.my_certifications', label: 'My certifications due for renewal', kind: 'My certification renewals',
    recordType: 'certification', permission: 'training.view', work: true, named: true,
    async events(c, user, from, to) {
      // Holders of training.view get them from training.certifications (one item, one source).
      if (!c.resources.get('person') || can(user, 'training.view')) return [];
      const types = await label(c);
      const rows = await dueCertifications(c, user, user.id, from, to);
      return rows.map((r) => ({
        uid: `training.certifications:${r.id}:${day(r.d)}`, title: `Your certification expires: ${types.get(r.certification_type) ?? r.certification_type}`,
        start: day(r.d), allDay: true, url: '/training/mine', recordType: 'certification', recordId: r.id,
        ref: r.ref ?? null, personId: user.id,
      }));
    },
  });
}
