// E18-84: finding the requester when logging a ticket. One search over user accounts and, for people
// who may see it, the staff roster (people module), so an agent picks the caller instead of typing
// the name, department and email by hand. Typing a name that is not found still works (an outside
// requester): the form keeps free text.
import type { ModuleContext, Row } from '../../core/module.ts';

export interface RequesterOption {
  /** "user" (an account: the ticket's requester_id is set) or "person" (a roster entry with no account). */
  kind: 'user' | 'person';
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  /** The roster's employee number, when there is one. */
  number: string | null;
  user_id: string | null;
}

const LIMIT = 8;

export function registerRequesters(ctx: ModuleContext) {
  const { app, db } = ctx;
  const may = async (req: { user?: unknown }) => ctx.can(req.user as never, 'tickets.create') || ctx.can(req.user as never, 'tickets.edit');

  /** GET /api/tickets/requesters?q= : active accounts and roster people matching a name, email or employee number. */
  app.get('/api/tickets/requesters', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => {
    if (!(await may(req))) ctx.fail(403, 'forbidden', 'You may not log or change tickets.');
    const q = String((req.query as Row).q ?? '').trim().slice(0, 100);
    if (q.length < 2) return { rows: [] };
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const users = await db.query<Row>(
      `select u.id, u.display_name as name, u.email, d.name as department
         from users u left join departments d on d.id = u.department_id and d.deleted_at is null
        where u.deleted_at is null and u.status = 'active'
          and (u.display_name ilike $1 or u.email ilike $1 or u.username ilike $1)
        order by (u.display_name ilike $2) desc, u.display_name limit ${LIMIT}`, [like, `${q.replace(/[%_\\]/g, '\\$&')}%`]);
    const rows: RequesterOption[] = users.map((u) => ({
      kind: 'user', id: u.id, name: u.name, email: u.email ?? null, department: u.department ?? null, number: null, user_id: u.id,
    }));
    // The roster holds personal details: only for people who may see it.
    if (ctx.resources.get('person') && ctx.can(req.user, 'people.view')) {
      const people = await db.query<Row>(
        `select p.id, p.full_name as name, p.email, p.employee_number as number, p.user_id, d.name as department
           from people p left join departments d on d.id = p.department_id and d.deleted_at is null
          where p.deleted_at is null and p.status <> 'left'
            and (p.full_name ilike $1 or p.preferred_name ilike $1 or p.email ilike $1 or p.employee_number ilike $1)
          order by (p.full_name ilike $2) desc, p.full_name limit ${LIMIT}`, [like, `${q.replace(/[%_\\]/g, '\\$&')}%`]);
      const taken = new Set(rows.map((r) => r.id));
      for (const p of people) {
        if (p.user_id && taken.has(p.user_id)) continue; // the account is listed already
        rows.push({ kind: 'person', id: p.id, name: p.name, email: p.email ?? null, department: p.department ?? null, number: p.number ?? null, user_id: p.user_id ?? null });
      }
    }
    return { rows: rows.slice(0, LIMIT * 2) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/tickets/requesters', permission: 'tickets.view', summary: 'Find a requester among the accounts and the staff roster',
    description: 'For people who may log or change tickets. `q` (at least two characters) matches a name, email address, user name or employee number. Roster people are included only for holders of `people.view`; a roster person with an account is listed once, as the account.',
    query: { q: 'Part of a name, email address or employee number' },
    response: '{ rows: [{ kind: user|person, id, name, email, department, number, user_id }] }',
  });
}
