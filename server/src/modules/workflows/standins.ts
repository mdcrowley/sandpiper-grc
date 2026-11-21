// Approver stand-ins (E14-32): an approver names someone to stand in for them for a period, from
// the Approvals page; administrators can set one for anyone. While it runs, steps that go to the
// approver also go to the stand-in, and either may decide (the stand-in's decision is recorded as
// made on the approver's behalf). No chains: a stand-in's own stand-in is not added.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import type { Service } from './service.ts';

const ADMIN = 'admin.administer';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The longest period one stand-in covers. */
export const MAX_STANDIN_DAYS = 366;

const day = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' && DAY_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** Checks a stand-in period; answers the errors keyed by field (empty when it is fine). */
export function checkStandin(input: { user_id: string; standin_id: string; starts_on: unknown; ends_on: unknown }, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const from = day(input.starts_on);
  const to = day(input.ends_on);
  if (!UUID_RE.test(input.standin_id)) errors.standin_id = 'Choose who stands in.';
  else if (input.standin_id === input.user_id) errors.standin_id = 'Choose someone else to stand in.';
  if (!from || Number.isNaN(Date.parse(from))) errors.starts_on = 'Give the first day (YYYY-MM-DD).';
  if (!to || Number.isNaN(Date.parse(to))) errors.ends_on = 'Give the last day (YYYY-MM-DD).';
  if (from && to && !errors.starts_on && !errors.ends_on) {
    if (to < from) errors.ends_on = 'The last day cannot be before the first.';
    else if (to < today) errors.ends_on = 'The last day has already passed.';
    else if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_STANDIN_DAYS) errors.ends_on = `A stand-in covers at most ${MAX_STANDIN_DAYS} days.`;
  }
  return errors;
}

export function registerStandinRoutes(ctx: ModuleContext, svc: Service) {
  const { app, db } = ctx;
  const SELECT = `select s.id, s.user_id, s.standin_id, to_char(s.starts_on, 'YYYY-MM-DD') as starts_on, to_char(s.ends_on, 'YYYY-MM-DD') as ends_on,
      s.note, s.created_at, s.created_by, u.display_name as user_name, d.display_name as standin_name, c.display_name as created_by_name
    from workflow_standins s left join users u on u.id = s.user_id left join users d on d.id = s.standin_id left join users c on c.id = s.created_by`;
  const view = (r: Row, me: string, today: string) => ({
    ...r, active: r.starts_on <= today && today <= r.ends_on, mine: r.user_id === me, for_me: r.standin_id === me,
  });

  app.get('/api/workflows/standins', async (req) => {
    const q = req.query as Row;
    const me = req.user!.id;
    const all = q.all === '1' || q.all === 'true';
    if (all && !ctx.can(req.user, ADMIN)) ctx.fail(403, 'forbidden', 'Only administrators see everyone\'s stand-ins.');
    const past = q.past === '1' || q.past === 'true';
    const today = dayInZone(0);
    const rows = await db.query<Row>(
      `${SELECT} where s.deleted_at is null and ($1::boolean or s.user_id = $2 or s.standin_id = $2) and ($3::boolean or s.ends_on >= $4::date)
       order by s.starts_on, u.display_name limit 500`, [all, me, past, today]);
    return { rows: rows.map((r) => view(r, me, today)), today };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/workflows/standins', tag: 'Workflows',
    summary: 'Stand-ins for approvals: those you named and those naming you (administrators: everyone with `all=1`); ended ones only with `past=1`',
    query: { all: '1: everyone (administrators)', past: '1: include periods that have ended' },
    response: '{ rows: [{ id, user_id, user_name, standin_id, standin_name, starts_on, ends_on, note, active, mine, for_me, created_by_name }], today }',
  });

  app.post('/api/workflows/standins', async (req: FastifyRequest, reply) => {
    const b = (req.body ?? {}) as Row;
    const me = req.user!.id;
    const userId = b.user_id ? String(b.user_id) : me;
    if (userId !== me && !ctx.can(req.user, ADMIN)) ctx.fail(403, 'forbidden', 'Only administrators can name a stand-in for someone else.');
    if (!UUID_RE.test(userId)) ctx.fail(400, 'validation', 'Choose the approver.', { user_id: 'Choose the approver.' });
    const today = dayInZone(0);
    const input = { user_id: userId, standin_id: String(b.standin_id ?? ''), starts_on: b.starts_on ?? today, ends_on: b.ends_on };
    const errors = checkStandin(input, today);
    const active = (id: string) => db.one<Row>(`select id, display_name from users where id = $1 and status = 'active' and deleted_at is null`, [id]);
    const approver = errors.user_id ? null : await active(userId);
    if (!approver) errors.user_id = 'Choose an active person.';
    const standin = errors.standin_id ? null : await active(input.standin_id);
    if (!errors.standin_id && !standin) errors.standin_id = 'Choose an active person.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;
    const row = (await db.one<Row>(
      `insert into workflow_standins (user_id, standin_id, starts_on, ends_on, note, created_by) values ($1, $2, $3::date, $4::date, $5, $6) returning id`,
      [userId, input.standin_id, String(input.starts_on).slice(0, 10), String(input.ends_on).slice(0, 10), note, me]))!;
    const saved = (await db.one<Row>(`${SELECT} where s.id = $1`, [row.id]))!;
    await ctx.audit(req, {
      action: 'workflow_standin.create', recordType: 'user', recordId: userId,
      summary: `${standin!.display_name} stands in for ${approver!.display_name} on approvals from ${saved.starts_on} to ${saved.ends_on}${userId !== me ? ` (set by ${req.user!.displayName})` : ''}`,
      after: { standin: input.standin_id, starts_on: saved.starts_on, ends_on: saved.ends_on, note },
    });
    if (app.hasDecorator('notify')) {
      await app.notify({
        kind: 'approval', userIds: [input.standin_id], route: '/approvals',
        title: `You stand in for ${approver!.display_name} on approvals`, body: `From ${displayDate(saved.starts_on)} to ${displayDate(saved.ends_on)}${note ? `: ${note}` : ''}`,
      });
    }
    // A period running today joins the steps already waiting for the approver.
    const added = saved.starts_on <= today ? await svc.applyStandins(userId) : 0;
    return reply.code(201).send({ ...view(saved, me, today), steps_added: added });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/workflows/standins', tag: 'Workflows',
    summary: 'Name a stand-in for approvals for a period (your own; administrators for anyone). Steps already waiting for the approver go to the stand-in too',
    body: '{ user_id?: uuid (administrators), standin_id: uuid, starts_on?: date (default today), ends_on: date, note?: string }',
    response: 'The stand-in, with steps_added',
  });

  app.delete('/api/workflows/standins/:id', async (req) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`${SELECT} where s.id = $1 and s.deleted_at is null`, [id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Stand-in not found.');
    const me = req.user!.id;
    if (row!.user_id !== me && row!.created_by !== me && !ctx.can(req.user, ADMIN)) ctx.fail(403, 'forbidden', 'Only the approver, or an administrator, can end this stand-in.');
    await db.query('update workflow_standins set deleted_at = now(), deleted_by = $2 where id = $1', [id, me]);
    await ctx.audit(req, {
      action: 'workflow_standin.delete', recordType: 'user', recordId: row!.user_id,
      summary: `${row!.standin_name} no longer stands in for ${row!.user_name} on approvals`,
      before: { standin: row!.standin_id, starts_on: row!.starts_on, ends_on: row!.ends_on },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/workflows/standins/:id', tag: 'Workflows',
    summary: 'End a stand-in (the approver, whoever set it, or an administrator); from then on the stand-in can no longer decide for them',
    response: '{ ok: true }',
  });
}
