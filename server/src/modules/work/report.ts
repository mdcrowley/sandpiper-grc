// "Report a problem" on My work (wave 26): every signed-in person can report a safety hazard or concern,
// and ask for help with something broken, whether or not the self-service portal is on and whatever their
// role. Each kind is offered only while its area is on (the safety event and ticket record types; a
// switched-off area's types are not in the registry). The safety report is the portal's own
// (`takeSafetyReport`): the same plain questions, the same confidential-reporting rules (the reporter kept
// apart, only named people may see who it was) and the same notice to the safety team. A request for help
// is a ticket with the person as requester, created as them (audited under their name) through the
// ticket's own checks. Only the fields below can be given: no priority, assignee or notes.
//
// The person follows what they reported in "My reports": their own safety reports (with the safety team's
// words once closed) and the tickets they raised, in plain statuses.
import type { ModuleContext, Row } from '../../core/module.ts';
import { AFFECTS, plainStatus, URGENCY } from '../portal/words.ts';
import { mySafetyReports, safetyReportOptions, takeSafetyReport } from '../safety/portal-intake.ts';

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const VIA = 'My work';

type CreateWithOptions = (type: string, data: Row, req?: unknown, opts?: { skipCustomRequired?: boolean }) => Promise<Row>;

export function registerReport(ctx: ModuleContext) {
  const { app, db } = ctx;
  const safetyOn = () => Boolean(ctx.resources.get('safety_event'));
  const ticketsOn = () => Boolean(ctx.resources.get('ticket'));
  const off = (): never => ctx.fail(404, 'switched_off', 'That kind of report is not taken here.');

  app.get('/api/work/report/options', async () => ({
    safety: safetyOn() ? await safetyReportOptions(ctx) : null,
    help: ticketsOn() ? { affects: AFFECTS.map(({ value, label }) => ({ value, label })), urgency: URGENCY.map(({ value, label }) => ({ value, label })) } : null,
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/work/report/options', tag: 'My work',
    summary: 'What I can report from My work, with its choices in plain words',
    description: 'Open to everyone signed in. A kind whose area is switched off is null.',
    response: '{ safety: { types: [{ value, label }], harm: [{ value, label }] } | null, help: { affects: [{ value, label }], urgency: [{ value, label }] } | null }',
  });

  app.post('/api/work/report/safety', async (req, reply) => {
    if (!safetyOn()) off();
    const made = await takeSafetyReport(ctx, req, VIA);
    reply.code(201);
    return made;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/work/report/safety', tag: 'My work', area: 'safety',
    summary: 'Report a safety hazard, concern or event from My work (it starts as "Reported" for the safety team to triage)',
    description: 'Open to everyone signed in while safety is on. The same questions and rules as the portal\'s safety report: with `confidential: true` the reporter is kept apart from the event and only the people named under Administration > Confidential safety reports can see who made it (each look audited).',
    body: '{ title, description, event_type, harm: none|minor|treated|serious, occurred_at, where?, immediate_actions?, injuries?, personal?: boolean, confidential?: boolean }',
    response: '{ id, ref }',
  });

  app.post('/api/work/report/help', async (req, reply) => {
    if (!ticketsOn()) off();
    const b = (req.body ?? {}) as Row;
    const me = req.user!;
    const title = text(b.title, 200);
    const details = text(b.details, 8000);
    const where = text(b.where, 200);
    const fields: Record<string, string> = {};
    if (!title) fields.title = 'Say in a few words what is wrong.';
    const affects = AFFECTS.find((a) => a.value === b.affects);
    const urgent = URGENCY.find((u) => u.value === b.how_urgent);
    if (!affects) fields.affects = 'Choose who is affected.';
    if (!urgent) fields.how_urgent = 'Choose how urgent it is.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const impacts = new Set((await ctx.lookups.values('ticket_impact')).map((v) => v.value));
    const urgencies = new Set((await ctx.lookups.values('ticket_urgency')).map((v) => v.value));
    const data: Row = {
      type: 'incident', title, requester_id: me.id, requester_name: me.displayName, requester_email: me.email || null, channel: 'portal',
      description: [details, where ? `Where: ${where}` : '', `Who is affected: ${affects!.label}`, `How urgent: ${urgent!.label}`, 'Raised from My work.'].filter(Boolean).join('\n\n'),
    };
    if (impacts.has(affects!.impact)) data.impact = affects!.impact;
    if (urgencies.has(urgent!.urgency)) data.urgency = urgent!.urgency;
    const row = await (ctx.resources.create as CreateWithOptions)('ticket', data, req, { skipCustomRequired: true });
    reply.code(201);
    return { id: row.id, ref: row.ref, title: row.title };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/work/report/help', tag: 'My work', area: 'tickets',
    summary: 'Ask for help with something broken or missing, from My work (a ticket with me as requester)',
    description: 'Open to everyone signed in while the service desk is on. Created as the person, through the ticket\'s own checks; only these fields can be given.',
    body: '{ title, details?, where?, affects: me|team|service, how_urgent: stopped|slowed|can_wait }',
    response: '{ id, ref, title }',
  });

  app.get('/api/work/report/mine', async (req) => {
    const me = req.user!;
    const safety = safetyOn() ? (await mySafetyReports(ctx, me.id)).rows : null;
    let help: Row[] | null = null;
    if (ticketsOn()) {
      const statuses = await ctx.lookups.values('ticket_status');
      const rows = await db.query<Row>(
        `select id, ref, title, status, assignee_id, approval_status, opened_at, resolved_at from tickets
         where deleted_at is null and requester_id = $1 order by opened_at desc limit 20`, [me.id]);
      help = rows.map((t) => ({ id: t.id, ref: t.ref, title: t.title, opened_at: t.opened_at, status: plainStatus(t, statuses) }));
    }
    return { safety, help };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/work/report/mine', tag: 'My work',
    summary: 'What I reported from My work, newest first, in plain statuses',
    description: 'A kind whose area is switched off is null. A report marked restricted shows its reference only.',
    response: '{ safety: [{ id, ref, title, occurred_at, reported_at, confidential, outcome, closed_on, status }] | null, help: [{ id, ref, title, opened_at, status }] | null }',
  });
}
