// The requester's own requests: raise one (from the catalog or "report a problem"), list them,
// read one with its public messages, reply, reopen and rate. A request may be raised for a
// colleague (E15-12), who then follows it too.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { MINE, type Access } from './access.ts';
import { createFromPortal } from './create.ts';
import { readSettings, type OnBehalf } from './settings.ts';
import { AFFECTS, plainStatus, URGENCY } from './words.ts';

const DAY_MS = 86_400_000;
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export function registerRequests(ctx: ModuleContext, access: Access, files: { forTicket(req: FastifyRequest, id: string): Promise<Row[] | null> }) {
  const { app, db } = ctx;
  const view = { preHandler: access.need('portal.view') };
  const create = { preHandler: access.need('portal.create') };

  const statuses = () => ctx.lookups.values('ticket_status');
  const bad = (fields: Record<string, string>, message = 'Check the highlighted fields.'): never => ctx.fail(400, 'validation', message, fields);

  async function notifyOwners(ticket: Row, title: string, body?: string | null) {
    if (!app.hasDecorator('notify')) return;
    const notify = (app as unknown as { notify: (i: Row) => Promise<unknown> }).notify;
    const groups = await ctx.settings.get<Record<string, string[]>>('tickets.group_members', {});
    const members = ticket.assignment_group ? groups[ticket.assignment_group] ?? [] : [];
    const who = ticket.assignee_id ? { userIds: [ticket.assignee_id] } : members.length ? { userIds: members } : { permission: 'tickets.edit' };
    await notify({ ...who, kind: 'general', title, body: body ?? null, recordType: 'ticket', recordId: ticket.id });
  }

  /** Reopen window: until when the requester may reopen, or null when they may not. */
  async function reopenUntil(t: Row, cat: string): Promise<string | null> {
    if (t.status === 'cancelled' || (cat !== 'resolved' && cat !== 'closed') || !t.resolved_at) return null;
    const days = (await readSettings(ctx)).reopen_days;
    if (!days) return null;
    const until = new Date(new Date(t.resolved_at).getTime() + days * DAY_MS);
    return until > new Date() ? until.toISOString() : null;
  }

  // ---------- on behalf of a colleague (E15-12) ----------

  /** Colleagues the caller may raise a request for, under the portal's rule. */
  async function colleagues(me: { id: string }, rule: OnBehalf, q: string, id?: string): Promise<Row[]> {
    if (rule === 'nobody') return [];
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return db.query<Row>(
      `select u.id, u.display_name as label, d.name as department
       from users u left join departments d on d.id = u.department_id
       where u.deleted_at is null and u.status = 'active' and u.id <> $1
         and ($2::text = 'anyone' or (u.department_id is not null and u.department_id = (select department_id from users where id = $1)))
         and ($4::uuid is not null and u.id = $4::uuid or $4::uuid is null and (u.display_name ilike $3 or u.username ilike $3))
       order by u.display_name limit 20`, [me.id, rule, like, id ?? null]);
  }

  app.get('/api/portal/colleagues', create, async (req) => {
    const rule = (await readSettings(ctx)).on_behalf;
    const q = text((req.query as Row).q, 80);
    return { rule, rows: rule === 'nobody' || q.length < 2 ? [] : await colleagues(req.user!, rule, q) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/portal/colleagues', permission: 'portal.create',
    summary: 'Colleagues I may raise a request for (the portal setting decides: nobody, my department, or anyone)',
    query: { q: 'At least two letters of a name' }, response: '{ rule, rows: [{ id, label, department }] }',
  });

  // ---------- raise ----------

  app.post('/api/portal/requests', create, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const me = req.user!;
    const impacts = new Set((await ctx.lookups.values('ticket_impact')).map((v) => v.value));
    const urgencies = new Set((await ctx.lookups.values('ticket_urgency')).map((v) => v.value));
    const details = text(b.details, 8000);
    const where = text(b.where, 200);
    const data: Row = {
      requester_id: me.id, requester_name: me.displayName, requester_email: me.email || null, channel: 'portal',
    };
    let forPerson: Row | null = null;
    if (b.for_user_id !== undefined && b.for_user_id !== null && b.for_user_id !== '' && b.for_user_id !== me.id) {
      const rule = (await readSettings(ctx)).on_behalf;
      if (rule === 'nobody') bad({ for_user_id: 'Requests can only be raised for yourself here.' });
      const id = typeof b.for_user_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.for_user_id) ? b.for_user_id : null;
      forPerson = id ? (await colleagues(me, rule, '', id))[0] ?? null : null;
      if (!forPerson) {
        bad({ for_user_id: rule === 'department' ? 'You can raise a request only for someone in your own department.' : 'Choose a colleague from the list.' });
      }
      data.affected_user_id = forPerson!.id;
      data.affected_user = forPerson!.label;
    }

    if (b.catalog_item_id !== undefined && b.catalog_item_id !== null && b.catalog_item_id !== '') {
      const item = typeof b.catalog_item_id === 'string'
        ? await db.one<Row>('select * from catalog_items where id::text = $1 and deleted_at is null and active and portal', [b.catalog_item_id])
        : undefined;
      if (!item) ctx.fail(404, 'not_found', 'That request is not offered in the portal.');
      const defaults = (item!.defaults ?? {}) as Row;
      for (const f of ['type', 'category', 'subcategory', 'impact', 'urgency', 'assignment_group'] as const) {
        if (defaults[f] !== undefined && defaults[f] !== null && defaults[f] !== '') data[f] = defaults[f];
      }
      const answers = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : {}) as Row;
      const questions = (item!.questions ?? []) as Row[];
      const first = questions.map((q) => text(answers[q.key], 120)).find(Boolean);
      const prefix = typeof defaults.title === 'string' && defaults.title.trim() ? defaults.title : `${item!.name}: `;
      data.title = text(b.title, 200) || `${prefix.trim().endsWith(':') ? prefix.trimEnd() + ' ' : prefix}${first || me.displayName}`.slice(0, 200);
      data.catalog_item_id = item!.id;
      data.catalog_answers = answers;
      data.description = [details, where ? `Where: ${where}` : ''].filter(Boolean).join('\n\n') || null;
    } else {
      const title = text(b.title, 200);
      const fields: Record<string, string> = {};
      if (!title) fields.title = 'Say in a few words what is wrong.';
      const affects = AFFECTS.find((a) => a.value === b.affects);
      const urgent = URGENCY.find((u) => u.value === b.how_urgent);
      if (!affects) fields.affects = 'Choose who is affected.';
      if (!urgent) fields.how_urgent = 'Choose how urgent it is.';
      if (Object.keys(fields).length) bad(fields);
      data.type = 'incident';
      data.title = title;
      if (impacts.has(affects!.impact)) data.impact = affects!.impact;
      if (urgencies.has(urgent!.urgency)) data.urgency = urgent!.urgency;
      data.description = [
        details,
        where ? `Where: ${where}` : '',
        `Who is affected: ${affects!.label}`,
        `How urgent: ${urgent!.label}`,
      ].filter(Boolean).join('\n\n');
    }

    // Created as the person (audited under their name, notifications sent), through the same
    // checks as any ticket. Only the fields set above can be given: no priority, assignee or notes.
    if (forPerson) data.description = [`Raised by ${me.displayName} for ${forPerson.label}.`, data.description].filter(Boolean).join('\n\n');
    const row = await createFromPortal(ctx, 'ticket', data, req);
    if (forPerson && app.hasDecorator('notify')) {
      await (app as unknown as { notify: (i: Row) => Promise<unknown> }).notify({
        userIds: [forPerson.id], kind: 'general', title: `${me.displayName} raised a request for you: ${row.ref}`,
        body: row.title, route: `/portal/requests/${row.id}`,
      });
    }
    reply.code(201);
    return { id: row.id, ref: row.ref, title: row.title };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/portal/requests', permission: 'portal.create',
    summary: 'Raise a request from the portal: a catalog item with its answers, or a short problem report',
    body: '{ catalog_item_id?, answers?: { key: value }, title?, details?, where?, affects?: me|team|service, how_urgent?: stopped|slowed|can_wait, for_user_id? (a colleague, when the portal allows it) }',
  });

  // ---------- list and read ----------

  app.get('/api/portal/requests', view, async (req) => {
    const q = req.query as Record<string, string>;
    const all = await statuses();
    const rows = await db.query<Row>(
      `select t.id, t.ref, t.title, t.status, t.assignee_id, t.approval_status, t.opened_at, t.updated_at, t.resolved_at, t.type,
              c.name as item_name,
              (select max(created_at) from comments m where m.record_type = 'ticket' and m.record_id = t.id and not m.internal) as last_message_at
       from tickets t left join catalog_items c on c.id = t.catalog_item_id
       where t.deleted_at is null and ${MINE}
       order by t.opened_at desc limit 500`, [req.user!.id]);
    const out = rows.map((t) => ({
      id: t.id, ref: t.ref, title: t.title, type: t.type, item_name: t.item_name, opened_at: t.opened_at,
      updated_at: t.updated_at, resolved_at: t.resolved_at, last_message_at: t.last_message_at, status: plainStatus(t, all),
    }));
    const words = String(q.q ?? '').trim().toLowerCase();
    return {
      rows: out.filter((r) => (q.state === 'open' ? !r.status.done : q.state === 'done' ? r.status.done : true)
        && (!words || `${r.ref} ${r.title} ${r.item_name ?? ''}`.toLowerCase().includes(words))),
      open: out.filter((r) => !r.status.done).length,
      waiting_on_you: out.filter((r) => r.status.waiting_on_you).length,
      total: out.length,
    };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/portal/requests', permission: 'portal.view', summary: 'My own requests, newest first', query: { state: 'open | done', q: 'Words to find' } });

  app.get('/api/portal/requests/:id', view, async (req) => {
    const t = await access.needOwnTicket(req, (req.params as Row).id);
    const all = await statuses();
    const status = plainStatus(t, all);
    const cat = String(all.find((s) => s.value === t.status)?.meta?.category ?? 'open');
    const item = t.catalog_item_id ? await db.one<Row>('select id, name from catalog_items where id = $1', [t.catalog_item_id]) : null;
    const assignee = t.assignee_id ? await db.one<Row>('select display_name from users where id = $1', [t.assignee_id]) : null;
    const me = req.user!.id;
    // Public messages only. Internal notes never leave the server.
    const comments = await db.query<Row>(
      `select id, body, author_id, author_name, created_at from comments
       where record_type = 'ticket' and record_id = $1 and internal = false order by created_at`, [t.id]);
    const until = await reopenUntil(t, cat);
    const resolutionLabel = t.resolution_code
      ? (await ctx.lookups.values('resolution_code')).find((r) => r.value === t.resolution_code)?.label ?? null : null;
    return {
      id: t.id, ref: t.ref, title: t.title, description: t.description, type: t.type, status,
      opened_at: t.opened_at, updated_at: t.updated_at, resolved_at: t.resolved_at, closed_at: t.closed_at,
      item: item ? { id: item.id, name: item.name } : null,
      answers: ((t.catalog_answers ?? []) as Row[]).map((a) => ({ label: a.label, value: a.value })),
      assignee_name: assignee?.display_name ?? null,
      // E15-12: who raised it, when it was raised for me; and who it is for, when I raised it for someone.
      raised_by: t.requester_id !== me ? t.requester_name ?? null : null,
      raised_for: t.requester_id === me && t.affected_user_id && t.affected_user_id !== me ? t.affected_user ?? null : null,
      resolution: status.done && t.status !== 'cancelled' ? { label: resolutionLabel, notes: t.resolution_notes ?? null } : null,
      approval_note: t.approval_status === 'rejected' ? t.approval_note ?? null : null,
      rating: t.satisfaction_by_requester ? { score: t.satisfaction_score, comment: t.satisfaction_comment, at: t.satisfaction_at } : null,
      can_rate: status.done && t.status !== 'cancelled' && !t.satisfaction_by_requester,
      can_reopen: Boolean(until) && ctx.can(req.user, 'portal.create'),
      reopen_until: until,
      can_reply: !status.done && ctx.can(req.user, 'portal.create'),
      messages: comments.map((c) => ({
        id: c.id, body: c.body, author_name: c.author_name, mine: c.author_id === req.user!.id, created_at: c.created_at,
      })),
      files: await files.forTicket(req, t.id),
    };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/portal/requests/:id', permission: 'portal.view', summary: 'One of my requests with its public messages' });

  // ---------- reply ----------

  async function addMessage(req: FastifyRequest, t: Row, body: string): Promise<Row> {
    const row = (await db.one<Row>(
      `insert into comments (record_type, record_id, body, internal, author_id, author_name)
       values ('ticket', $1, $2, false, $3, $4) returning id, body, author_id, author_name, created_at`,
      [t.id, body, req.user!.id, req.user!.displayName]))!;
    await ctx.audit(req, { action: 'comment.add', recordType: 'ticket', recordId: t.id, summary: 'Public comment added to ticket from the portal' });
    return row;
  }

  app.post('/api/portal/requests/:id/messages', create, async (req, reply) => {
    const t = await access.needOwnTicket(req, (req.params as Row).id);
    const body = text((req.body as Row | undefined)?.body, 10000);
    if (!body) bad({ body: 'Write your message first.' });
    const status = plainStatus(t, await statuses());
    if (status.done) ctx.fail(409, 'finished', 'This request is finished. Reopen it if the problem is back.');
    const row = await addMessage(req, t, body);
    // A reply to "waiting for you" hands the request back to IT.
    if (t.status === 'waiting_requester') await ctx.resources.update('ticket', t.id, { status: t.assignee_id ? 'in_progress' : 'new' });
    await notifyOwners(t, `Reply from the requester: ${[t.ref, t.title].filter(Boolean).join(' ')}`, body.slice(0, 300));
    reply.code(201);
    return { id: row.id, body: row.body, author_name: row.author_name, mine: true, created_at: row.created_at };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/portal/requests/:id/messages', permission: 'portal.create', summary: 'Reply on one of my requests (a public comment)', body: '{ body }' });

  // ---------- reopen ----------

  app.post('/api/portal/requests/:id/reopen', create, async (req) => {
    const t = await access.needOwnTicket(req, (req.params as Row).id);
    const all = await statuses();
    const cat = String(all.find((s) => s.value === t.status)?.meta?.category ?? 'open');
    const reason = text((req.body as Row | undefined)?.reason, 4000);
    if (!(await reopenUntil(t, cat))) ctx.fail(409, 'cannot_reopen', 'This request can no longer be reopened. Raise a new one instead.');
    if (!reason) bad({ reason: 'Say what is still wrong.' });
    await addMessage(req, t, `Reopened by the requester: ${reason}`);
    await ctx.resources.update('ticket', t.id, { status: t.assignee_id ? 'in_progress' : 'new' }, req);
    await db.query('update tickets set reopened_count = reopened_count + 1 where id = $1', [t.id]);
    await notifyOwners(t, `Reopened by the requester: ${[t.ref, t.title].filter(Boolean).join(' ')}`, reason.slice(0, 300));
    return { ok: true };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/portal/requests/:id/reopen', permission: 'portal.create', summary: 'Reopen one of my resolved requests within the reopen window', body: '{ reason }' });

  // ---------- rate ----------

  app.post('/api/portal/requests/:id/rating', view, async (req) => {
    const t = await access.needOwnTicket(req, (req.params as Row).id);
    const b = (req.body ?? {}) as Row;
    const score = Number(b.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) bad({ score: 'Choose from 1 to 5 stars.' });
    const status = plainStatus(t, await statuses());
    if (!status.done || t.status === 'cancelled') ctx.fail(409, 'not_finished', 'You can rate a request once it is resolved.');
    if (t.satisfaction_by_requester) ctx.fail(409, 'already_rated', 'You have already rated this request.');
    const comment = text(b.comment, 2000) || null;
    // The satisfaction fields are written as the system (so the requester's answer is locked) and audited as the person.
    await ctx.resources.update('ticket', t.id, {
      satisfaction_score: score, satisfaction_comment: comment, satisfaction_by_requester: true, satisfaction_at: new Date().toISOString(),
    });
    await ctx.audit(req, {
      action: 'ticket.satisfaction', recordType: 'ticket', recordId: t.id,
      summary: `Requester rated ${t.ref} ${score} out of 5`, after: { satisfaction_score: score, satisfaction_comment: comment },
    });
    return { ok: true, score, comment };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/portal/requests/:id/rating', permission: 'portal.view', summary: 'Rate one of my finished requests, once', body: '{ score: 1-5, comment? }' });
}
