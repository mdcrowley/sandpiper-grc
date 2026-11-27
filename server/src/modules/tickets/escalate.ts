// E45-28 to E45-32: one-click paths out of a ticket (security incident, change, problem, duplicate) and linking
// several tickets to a problem from the problem's side. Each path creates or finds the other record
// through the resource engine (validation, lifecycle rules, audit) and links the two both ways:
// a ticket's problem is its Problem field (shown on the problem's Linked tickets tab); the other
// records are joined by a record link, which the Related tab of both records lists.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { categoryOf } from './sla.ts';

/** Relations of the record links these actions make. */
export const ESCALATED_TO = 'escalated_to';   // ticket -> security incident
export const FIXES = 'fixes';                 // change -> ticket (the change's own wording, "This change fixes it")
export const DUPLICATE_OF = 'duplicate_of';   // ticket -> the ticket it repeats

const MAX_TICKETS = 100;

interface Affected { system: string | null; asset: string | null }

const text = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

export function registerEscalation(ctx: ModuleContext) {
  const { app, db } = ctx;
  const edit = { preHandler: ctx.requirePerm('tickets.edit') };
  const need = (req: FastifyRequest, perm: string) => {
    if (!ctx.can(req.user, perm)) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
  };
  const ticketOf = async (req: FastifyRequest, id?: unknown): Promise<Row> => {
    const key = String(id ?? (req.params as Row).id ?? '');
    return (UUID_RE.test(key) ? await ctx.resources.find('ticket', key, req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
  };
  async function link(req: FastifyRequest, fromType: string, fromId: string, toType: string, toId: string, relation: string, auditOnTarget = false) {
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing`,
      [fromType, fromId, toType, toId, relation, actorOf(req).id]);
    await ctx.audit(req, {
      // A link to a restricted record is recorded on that record, so the ticket's history does not tell it exists.
      action: 'link.add', recordType: auditOnTarget ? toType : fromType, recordId: auditOnTarget ? toId : fromId,
      summary: auditOnTarget ? `Linked from ${fromType} (${relation})` : `Linked to ${toType} (${relation})`,
      after: { from_type: fromType, from_id: fromId, to_type: toType, to_id: toId, relation },
    });
  }

  /** The names of the ticket's system and asset, for someone who may see those areas. */
  async function affectedOf(req: FastifyRequest, t: Row): Promise<Affected> {
    const name = async (type: string, id: unknown, perm: string) =>
      (id && ctx.resources.get(type) && ctx.can(req.user, perm) ? ctx.resources.labelFor(type, String(id)) : null);
    return { system: await name('system', t.system_id, 'systems.view'), asset: await name('asset', t.asset_id, 'assets.view') };
  }

  /** Who asked and what is affected, as lines for the new record's description. */
  function context(t: Row, a: Affected): string {
    const who = [t.requester_name, t.requester_email ? `<${t.requester_email}>` : '', t.requester_department ? `(${t.requester_department})` : '']
      .filter(Boolean).join(' ');
    const lines = [
      `Raised from ticket ${t.ref}: ${t.title}`,
      who ? `Requester: ${who}` : '',
      a.system ? `Affected system: ${a.system}` : '',
      a.asset ? `Affected asset: ${a.asset}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }
  const describe = (t: Row, a: Affected) => [t.description ? String(t.description) : '', context(t, a)].filter(Boolean).join('\n\n');

  // ---------- security incident ----------

  app.post('/api/tickets/:id/security-incident', edit, async (req, reply) => {
    if (!ctx.resources.get('security_incident')) ctx.fail(404, 'not_available', 'Security incidents are not available here.');
    need(req, 'security.view');
    need(req, 'security.create');
    const t = await ticketOf(req);
    const b = (req.body ?? {}) as Row;
    const a = await affectedOf(req, t);
    const affected = [a.system, a.asset].filter(Boolean).join('\n');
    const incident = await ctx.resources.create('security_incident', {
      title: text(b.title) || t.title,
      summary: describe(t, a),
      ...(b.severity ? { severity: b.severity } : {}),
      // The organization knew from the moment the ticket was opened: the notification clocks count from then.
      discovered_at: t.opened_at ?? t.created_at,
      ...(affected ? { affected_systems: affected } : {}),
    }, req);
    await link(req, 'ticket', t.id, 'security_incident', incident.id, ESCALATED_TO, true);
    reply.code(201);
    return { id: incident.id, ref: incident.ref, route: `/security-incidents/${incident.id}` };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/tickets/:id/security-incident', permission: 'security.create',
    summary: 'Raise a security incident from a ticket',
    description: 'Creates a security incident with the ticket\'s title, description, requester and affected system or asset, discovered when the ticket was opened, and links the two. Needs tickets.edit, security.view and security.create.',
    body: '{ title?, severity? }',
  });

  // ---------- change ----------

  app.post('/api/tickets/:id/change', edit, async (req, reply) => {
    if (!ctx.resources.get('change')) ctx.fail(404, 'not_available', 'Changes are not available here.');
    need(req, 'changes.create');
    const t = await ticketOf(req);
    const b = (req.body ?? {}) as Row;
    const change = await ctx.resources.create('change', {
      title: text(b.title) || t.title,
      description: t.description ?? null,
      reason: context(t, await affectedOf(req, t)),
      // A main system or asset is named only for someone who may see that area (linking needs view on it).
      ...(t.system_id && ctx.can(req.user, 'systems.view') ? { system_id: t.system_id } : {}),
      ...(t.asset_id && ctx.can(req.user, 'assets.view') ? { asset_id: t.asset_id } : {}),
    }, req);
    await link(req, 'change', change.id, 'ticket', t.id, FIXES);
    reply.code(201);
    return { id: change.id, ref: change.ref, route: `/changes/${change.id}` };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/tickets/:id/change', permission: 'changes.create',
    summary: 'Raise a change from a ticket',
    description: 'Creates a draft change with the ticket\'s title and description, the requester and the affected system or asset, and links it to the ticket ("fixes"). Needs tickets.edit and changes.create.',
    body: '{ title? }',
  });

  // ---------- problem ----------

  app.post('/api/tickets/:id/problem', edit, async (req) => {
    const t = await ticketOf(req);
    const b = (req.body ?? {}) as Row;
    let problem: Row | undefined;
    if (b.problem_id) {
      problem = UUID_RE.test(String(b.problem_id)) ? await ctx.resources.find('problem', String(b.problem_id), req.user) : undefined;
      if (!problem) ctx.fail(400, 'validation', 'Check the highlighted fields.', { problem_id: 'Choose a problem from the list.' });
    } else {
      need(req, 'tickets.create');
      problem = await ctx.resources.create('problem', {
        title: text(b.title) || t.title,
        description: b.description !== undefined ? text(b.description, 20_000) || null : describe(t, await affectedOf(req, t)),
      }, req);
    }
    await ctx.resources.update('ticket', t.id, { problem_id: problem!.id }, req);
    return { id: problem!.id, ref: problem!.ref, route: `/problems/${problem!.id}`, created: !b.problem_id };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/tickets/:id/problem', permission: 'tickets.edit',
    summary: 'Link a ticket to a problem, or create the problem from it',
    description: 'With problem_id, sets the ticket\'s Problem. Without it, creates a problem from the ticket (title and description, or those given; needs tickets.create) and links the ticket to it.',
    body: '{ problem_id? , title?, description? }',
  });

  // ---------- duplicate ----------

  async function resolvedStatus(): Promise<string | undefined> {
    const all = await ctx.lookups.values('ticket_status');
    const resolved = all.filter((s) => categoryOf(s.meta) === 'resolved');
    return resolved.find((s) => s.value === 'resolved')?.value ?? resolved[0]?.value;
  }

  app.post('/api/tickets/:id/duplicate', edit, async (req) => {
    const t = await ticketOf(req);
    const b = (req.body ?? {}) as Row;
    const ofId = String(b.of_id ?? '');
    const original = UUID_RE.test(ofId) ? await ctx.resources.find('ticket', ofId, req.user) : undefined;
    if (!original) ctx.fail(400, 'validation', 'Check the highlighted fields.', { of_id: 'Choose the ticket this one repeats.' });
    if (original!.id === t.id) ctx.fail(400, 'validation', 'Check the highlighted fields.', { of_id: 'A ticket cannot be a duplicate of itself.' });
    const loop = await db.one(
      `select 1 from record_links where from_type = 'ticket' and from_id = $1 and to_type = 'ticket' and to_id = $2 and relation = $3`,
      [original!.id, t.id, DUPLICATE_OF]);
    if (loop) ctx.fail(400, 'validation', 'Check the highlighted fields.', { of_id: `${original!.ref} is already marked as a duplicate of this ticket.` });
    const all = await ctx.lookups.values('ticket_status');
    const done = ['resolved', 'closed'].includes(categoryOf(all.find((s) => s.value === t.status)?.meta));
    await link(req, 'ticket', t.id, 'ticket', original!.id, DUPLICATE_OF);
    const notes = `Duplicate of ${original!.ref}: ${original!.title}`;
    const to = await resolvedStatus();
    // A ticket already resolved or closed keeps its status; the link is all that is added.
    const row = done || !to
      ? t
      : await ctx.resources.update('ticket', t.id, {
        status: to, resolution_code: 'duplicate',
        resolution_notes: t.resolution_notes ? `${t.resolution_notes}\n\n${notes}` : notes,
        // The original carries the work: link the duplicate to its problem too.
        ...(original!.problem_id && !t.problem_id ? { problem_id: original!.problem_id } : {}),
      }, req);
    return { ticket: row, of: { id: original!.id, ref: original!.ref, route: `/tickets/${original!.id}` } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/tickets/:id/duplicate', permission: 'tickets.edit',
    summary: 'Mark a ticket as a duplicate of another',
    description: 'Links the ticket to the one it repeats ("duplicate_of") and, unless it is already resolved or closed, resolves it with the resolution code Duplicate. Refuses a ticket that is itself the other\'s duplicate.',
    body: '{ of_id }',
  });

  // ---------- problem side: link several tickets ----------

  app.post('/api/problems/:id/tickets', edit, async (req) => {
    const id = String((req.params as Row).id ?? '');
    const problem = (UUID_RE.test(id) ? await ctx.resources.find('problem', id, req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Problem not found.');
    const ids = (req.body as Row | undefined)?.ticket_ids;
    if (!Array.isArray(ids) || !ids.length) ctx.fail(400, 'validation', 'Check the highlighted fields.', { ticket_ids: 'Choose at least one ticket.' });
    if (ids.length > MAX_TICKETS) ctx.fail(400, 'validation', 'Check the highlighted fields.', { ticket_ids: `Link at most ${MAX_TICKETS} tickets at a time.` });
    const linked: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const raw of [...new Set(ids.map(String))]) {
      const t = UUID_RE.test(raw) ? await ctx.resources.find('ticket', raw, req.user) : undefined;
      if (!t) { skipped.push({ id: raw, reason: 'not found' }); continue; }
      if (t.problem_id === problem.id) { skipped.push({ id: raw, reason: 'already linked' }); continue; }
      await ctx.resources.update('ticket', t.id, { problem_id: problem.id }, req);
      linked.push(t.id);
    }
    return { linked: linked.length, skipped };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/problems/:id/tickets', permission: 'tickets.edit',
    summary: 'Link several tickets to a problem',
    description: 'Sets the Problem of each ticket given (at most 100). Tickets not found, or already linked, are listed under skipped.',
    body: '{ ticket_ids: string[] }',
  });

  app.delete('/api/problems/:id/tickets/:ticketId', edit, async (req) => {
    const { id, ticketId } = req.params as Row;
    const problem = (UUID_RE.test(String(id)) ? await ctx.resources.find('problem', String(id), req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Problem not found.');
    const t = await ticketOf(req, ticketId);
    if (t.problem_id !== problem.id) ctx.fail(404, 'not_found', 'That ticket is not linked to this problem.');
    await ctx.resources.update('ticket', t.id, { problem_id: null }, req);
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/problems/:id/tickets/:ticketId', permission: 'tickets.edit',
    summary: 'Unlink a ticket from a problem',
  });
}
