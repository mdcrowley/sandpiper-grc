// An audit's time budget and the hours worked against it (E45-63). The audit has `budget_hours`; the
// team records hours worked (who, which day, how many, optionally on which workpaper step and doing
// what). The Time view gives the budget, the hours worked, what is left or over, and the hours by person
// and by step. Who worked is `actorOf(req)`: in data load mode an administrator may name the person
// and give past days. Lists, not figures: the audit's own visibility rule applies (restricted audits).
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad, onBehalfOf } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { isDate } from './dates.ts';

const round = (n: number) => Math.round(n * 100) / 100;

export function registerTime(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const auditFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('audit_engagement', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Audit not found.');

  async function view(req: FastifyRequest, audit: Row) {
    const entries = await db.query<Row>(
      `select id, user_id, person_name, worked_on::text as worked_on, hours::float8 as hours, item_id, activity, created_at
       from audit_time_entries where audit_id = $1 and deleted_at is null order by worked_on desc, created_at desc`, [audit.id]);
    const worked = round(entries.reduce((s, e) => s + Number(e.hours), 0));
    const budget = audit.budget_hours === null || audit.budget_hours === undefined ? null : Number(audit.budget_hours);
    const byPerson = new Map<string, number>();
    const byStep = new Map<string, number>();
    for (const e of entries) {
      byPerson.set(e.person_name, (byPerson.get(e.person_name) ?? 0) + Number(e.hours));
      if (e.item_id) byStep.set(String(e.item_id), (byStep.get(String(e.item_id)) ?? 0) + Number(e.hours));
    }
    return {
      budget_hours: budget, worked_hours: worked,
      remaining_hours: budget === null ? null : round(budget - worked),
      used_pct: budget ? Math.round((worked / budget) * 100) : null,
      over_budget: budget !== null && worked > budget,
      by_person: [...byPerson].map(([name, hours]) => ({ name, hours: round(hours) })).sort((a, b) => b.hours - a.hours),
      by_step: [...byStep].map(([item_id, hours]) => ({ item_id, hours: round(hours) })),
      entries, can_record: ctx.can(req.user, 'audits.edit'), me: actorOf(req).id,
    };
  }

  app.get('/api/audits/:id/time', { preHandler: ctx.requirePerm('audits.view') }, async (req) => view(req, await auditFor(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/:id/time', tag: 'Audits', permission: 'audits.view',
    summary: 'An audit\'s time budget and the hours worked against it: totals, by person, by workpaper step, and each entry',
    response: '{ budget_hours, worked_hours, remaining_hours, used_pct, over_budget, by_person: [{ name, hours }], by_step: [{ item_id, hours }], entries: [{ id, person_name, worked_on, hours, item_id, activity }], can_record }',
  });

  app.post('/api/audits/:id/time', { preHandler: ctx.requirePerm('audits.edit') }, async (req, reply) => {
    const audit = await auditFor(req);
    if (['closed', 'canceled'].includes(String(audit.status)) && !isDataLoad(req)) ctx.fail(409, 'audit_closed', 'The audit is closed, so no more time can be recorded on it.');
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const hours = Number(b.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 || Math.round(hours * 4) !== hours * 4) fields.hours = 'Give the hours worked that day, from a quarter of an hour (0.25) to 24.';
    const today = dayInZone();
    const on = b.worked_on === undefined || b.worked_on === null || b.worked_on === '' ? today : String(b.worked_on);
    if (!isDate(on)) fields.worked_on = 'Enter a date (YYYY-MM-DD).';
    else if (on > today) fields.worked_on = 'The day cannot be in the future.';
    let itemId: string | null = null;
    if (b.item_id !== undefined && b.item_id !== null && b.item_id !== '') {
      itemId = String(b.item_id);
      const known = UUID_RE.test(itemId) && audit.template_id
        ? await db.one('select 1 from checklist_template_items where id = $1 and template_id = $2', [itemId, audit.template_id]) : undefined;
      if (!known) fields.item_id = 'Choose a step of this audit\'s checklist.';
    }
    const activity = typeof b.activity === 'string' ? b.activity.trim().slice(0, 500) || null : null;
    if (Object.keys(fields).length) invalid(fields);
    const who = actorOf(req);
    const name = onBehalfOf(req)?.name ?? who.name ?? req.user!.displayName;
    const row = (await db.one<Row>(
      `insert into audit_time_entries (audit_id, user_id, person_name, worked_on, hours, item_id, activity, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning id`, [audit.id, who.id, name, on, hours, itemId, activity, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'audit.time', recordType: 'audit_engagement', recordId: audit.id,
      summary: `${hours} hours on ${on} recorded for ${name}${activity ? `: ${activity}` : ''}`,
      after: { entry_id: row.id, person: name, worked_on: on, hours, item_id: itemId },
    });
    reply.code(201);
    return view(req, audit);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/:id/time', tag: 'Audits', permission: 'audits.edit',
    summary: 'Record hours worked on an audit (by the caller, or in data load mode the person named), optionally on one workpaper step',
    body: '{ hours (0.25 to 24, in quarters), worked_on? (default today, not in the future), item_id?, activity? }', response: 'as GET',
  });

  app.delete('/api/audits/:id/time/:entryId', { preHandler: ctx.requirePerm('audits.edit') }, async (req) => {
    const audit = await auditFor(req);
    const id = String((req.params as Row).entryId ?? '');
    const e = UUID_RE.test(id) ? await db.one<Row>('select * from audit_time_entries where id = $1 and audit_id = $2 and deleted_at is null', [id, audit.id]) : undefined;
    if (!e) return ctx.fail(404, 'not_found', 'Time entry not found.');
    await db.query('update audit_time_entries set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [id, req.user!.id]);
    await ctx.audit(req, {
      action: 'audit.time_remove', recordType: 'audit_engagement', recordId: audit.id,
      summary: `Time entry removed: ${Number(e.hours)} hours on ${String(e.worked_on instanceof Date ? e.worked_on.toISOString() : e.worked_on).slice(0, 10)} for ${e.person_name}`,
      before: { entry_id: id, person: e.person_name, hours: Number(e.hours) },
    });
    return view(req, audit);
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/audits/:id/time/:entryId', tag: 'Audits', permission: 'audits.edit',
    summary: 'Remove a time entry recorded by mistake', response: 'as GET',
  });
}

/**
 * Workpaper reference numbers (E45-63): steps are numbered by section (A, B, C… in the order the
 * sections first appear) and position in it, A.1, A.2, B.1; a checklist without sections numbers its
 * steps 1, 2, 3. The full reference puts the audit's reference first: AUD-00012/A.1.
 */
export function workpaperRefs(items: { id: string; section: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  const sections: string[] = [];
  const counts = new Map<string, number>();
  const anySection = items.some((i) => i.section && i.section.trim());
  for (const item of items) {
    const key = (item.section ?? '').trim();
    if (!anySection) { out.set(item.id, String(out.size + 1)); continue; }
    if (!sections.includes(key)) sections.push(key);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const i = sections.indexOf(key);
    const letter = i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
    out.set(item.id, `${letter}.${n}`);
  }
  return out;
}
