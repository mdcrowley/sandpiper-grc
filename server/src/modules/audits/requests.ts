// Evidence requests answered by the auditee (E24-09). The person asked needs no audit permission:
// they see their own requests, and only the request itself (reference, what is asked for, due date,
// status, their answer), never the audit it belongs to. Restricted requests (on a restricted audit)
// are shown only to people who may see restricted records.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

export function registerRequests(ctx: ModuleContext) {
  const { app, db } = ctx;

  const OWN = (req: FastifyRequest) => `
    select r.id, r.ref, r.request, r.due_on, r.status, r.response_note, r.provided_at, r.updated_at
    from audit_requests r
    where r.deleted_at is null and r.owner_id = $1 and ${ctx.resources.visibleWhere('audit_request', req.user, 'r')}`;

  const present = (r: Row, today: string, labels: { value: string; label: string }[]) => ({
    id: r.id, ref: r.ref, request: r.request, due_on: r.due_on, status: r.status,
    status_label: labels.find((l) => l.value === r.status)?.label ?? r.status,
    response_note: r.response_note, provided_at: r.provided_at,
    overdue: Boolean(r.due_on && String(r.due_on) < today && ['requested', 'returned'].includes(String(r.status))),
    answerable: ['requested', 'returned', 'provided'].includes(String(r.status)),
  });

  app.get('/api/audit-requests/mine', async (req) => {
    const today = dayInZone();
    const labels = await ctx.lookups.values('audit_request_status');
    const rows = await db.query<Row>(`${OWN(req)} order by (r.status in ('requested', 'returned')) desc, r.due_on nulls last, r.ref`, [req.user!.id]);
    const list = rows.map((r) => present(r, today, labels));
    return { today, open: list.filter((r) => r.status === 'requested' || r.status === 'returned'), answered: list.filter((r) => r.status !== 'requested' && r.status !== 'returned') };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audit-requests/mine', tag: 'Audits',
    summary: 'The evidence requests addressed to me: the request text, due date, status and my answer only, never the audit',
    description: 'Needs only a session. Requests on a restricted audit are listed only for people who may see restricted records.',
    response: '{ today, open: [{ id, ref, request, due_on, status, status_label, response_note, provided_at, overdue, answerable }], answered: [...] }',
  });

  app.post('/api/audit-requests/:id/respond', async (req) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`${OWN(req)} and r.id = $2`, [req.user!.id, id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Evidence request not found.');
    if (row!.status === 'accepted') ctx.fail(409, 'accepted', 'The auditor has already accepted this evidence.');
    const note = String(((req.body ?? {}) as Row).response_note ?? '').trim().slice(0, 8000);
    if (!note) ctx.fail(400, 'validation', 'Check the highlighted fields.', { response_note: 'Say what you are providing and where the auditor can find it.' });
    // System work on the person's behalf: they may not hold audit permissions, and they may change only these fields.
    await ctx.resources.update('audit_request', row!.id, { response_note: note, status: 'provided', provided_at: new Date().toISOString() }, null);
    await ctx.audit(req, {
      action: 'audit_request.respond', recordType: 'audit_request', recordId: row!.id,
      summary: `Evidence request ${row!.ref} answered by the person asked`, before: { status: row!.status, response_note: row!.response_note }, after: { status: 'provided', response_note: note },
    });
    // Tell the audit's lead auditor, who decides whether the evidence is enough.
    const lead = await db.one<Row>(`select a.lead_auditor_id from audit_requests r join audits a on a.id = r.audit_id where r.id = $1`, [row!.id]);
    if (lead?.lead_auditor_id && ctx.app.hasDecorator('notify')) {
      await ctx.app.notify({
        userIds: [lead.lead_auditor_id], kind: 'audits', recordType: 'audit_request', recordId: row!.id,
        title: `Evidence provided: ${row!.ref}`, body: 'Check it and accept it, or return it with what is still needed.',
      });
    }
    const labels = await ctx.lookups.values('audit_request_status');
    return present((await db.one<Row>(`${OWN(req)} and r.id = $2`, [req.user!.id, row!.id]))!, dayInZone(), labels);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audit-requests/:id/respond', tag: 'Audits',
    summary: 'Answer an evidence request addressed to me: say what is provided and where; the request becomes Provided',
    description: 'Needs only a session, and only the person the request is addressed to. 409 `accepted` once the auditor has accepted the evidence. Audited; the lead auditor is notified.',
    body: '{ response_note: string }', response: '{ id, ref, request, due_on, status, status_label, response_note, provided_at, overdue, answerable }',
  });
}
