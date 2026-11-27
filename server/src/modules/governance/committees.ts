// Committees (E28-02): a governing body, risk, safety or audit committee with its chair, secretary,
// quorum rule and members. Members sit for a side (management, labor, independent), may vote or not,
// and may be an account, a roster person (type `person`, people module, when loaded) or just a name.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A member's name is typed only for someone with no account or roster person; otherwise it is read
// from the account or the person each time, so it is never a stale or unremovable copy.
const MEMBER_COLS = `m.id, m.committee_id, m.user_id, m.person_id, coalesce(nullif(m.name, ''), u.display_name) as name, m.name as typed_name,
  m.side, m.role, m.voting, m.from_on::text as from_on, m.to_on::text as to_on, u.display_name as user_name`;
const MEMBER_FROM = 'committee_members m left join users u on u.id = m.user_id';

export interface Quorum { voting: number; present: number; needed: number; met: boolean | null; rule: string }

/** Fills in the names of members who are roster people (the people module's `person` type, when loaded). */
export async function withNames(ctx: ModuleContext, rows: Row[]): Promise<Row[]> {
  const def = ctx.resources.get('person');
  const ids = [...new Set(rows.filter((r) => !r.typed_name && r.person_id).map((r) => String(r.person_id)))];
  if (def && ids.length) {
    const found = await ctx.db.query<{ id: string; n: string }>(
      `select id::text as id, ${def.titleField} as n from ${def.table} where id::text = any($1::text[]) and deleted_at is null`, [ids]);
    const names = new Map(found.map((f) => [f.id, f.n]));
    for (const r of rows) if (!r.typed_name && r.person_id && names.has(String(r.person_id))) r.name = names.get(String(r.person_id));
  }
  for (const r of rows) { if (!r.name) r.name = 'A member'; delete r.typed_name; }
  return rows;
}

/** The members of a committee in office on a day (YYYY-MM-DD), voting or not. */
export async function membersOn(ctx: ModuleContext, committeeId: string, day: string): Promise<Row[]> {
  return withNames(ctx, await ctx.db.query<Row>(
    `select ${MEMBER_COLS} from ${MEMBER_FROM}
     where m.committee_id = $1 and m.deleted_at is null
       and (m.from_on is null or m.from_on <= $2::date) and (m.to_on is null or m.to_on >= $2::date)
     order by case m.role when 'chair' then 0 when 'member' then 1 else 2 end, m.created_at`, [committeeId, day]));
}

/** One member (also one who left), with their name. */
export async function memberById(ctx: ModuleContext, id: string): Promise<Row | undefined> {
  const row = await ctx.db.one<Row>(`select ${MEMBER_COLS} from ${MEMBER_FROM} where m.id = $1`, [id]);
  return row ? (await withNames(ctx, [row]))[0] : undefined;
}

/** Members needed for a quorum: a count, or a percentage of the voting members (rounded up); a majority when unset. */
export function quorumNeeded(committee: Row, voting: number): number {
  const value = committee.quorum_value === null || committee.quorum_value === undefined ? null : Number(committee.quorum_value);
  if (value === null || !Number.isFinite(value) || value <= 0) return Math.floor(voting / 2) + 1;
  if (committee.quorum_rule === 'percent') return Math.max(1, Math.ceil((voting * Math.min(100, value)) / 100));
  return Math.max(1, Math.ceil(value));
}

/** Whether a meeting had its quorum: voting members in office on the meeting's day who were present. */
export async function quorumOf(ctx: ModuleContext, meeting: Row): Promise<Quorum> {
  const committee = await ctx.db.one<Row>('select quorum_rule, quorum_value from committees where id = $1', [meeting.committee_id]);
  const day = todayInZone(new Date(meeting.scheduled_at));
  const members = (await membersOn(ctx, meeting.committee_id, day)).filter((m) => m.voting);
  const present = members.length
    ? (await ctx.db.one<{ n: number }>(
      'select count(*)::int as n from meeting_attendance where meeting_id = $1 and present and member_id = any($2::uuid[])',
      [meeting.id, members.map((m) => m.id)]))!.n
    : 0;
  const needed = quorumNeeded(committee ?? {}, members.length);
  const anyRecorded = Boolean(await ctx.db.one('select 1 from meeting_attendance where meeting_id = $1 limit 1', [meeting.id]));
  return { voting: members.length, present, needed, met: anyRecorded && members.length > 0 ? present >= needed : null, rule: committee?.quorum_rule ?? 'count' };
}

/**
 * SQL that is true when `userId` sits on the committee `committeeExpr` today: its chair or secretary,
 * or a member in office whose account it is (directly, or through their roster person when the
 * people module is loaded). The id is checked, so it is safe to put into the SQL.
 */
export function memberSql(ctx: ModuleContext, userId: string | null | undefined, committeeExpr: string): string {
  if (!userId || !UUID_RE.test(userId)) return 'false';
  const today = todayInZone();
  const person = ctx.resources.get('person');
  const viaPerson = person && person.fields.user_id
    ? ` or m.person_id in (select p.id from ${person.table} p where p.user_id = '${userId}' and p.deleted_at is null)` : '';
  return `exists (select 1 from committees cc where cc.id = ${committeeExpr} and cc.deleted_at is null and (cc.chair_id = '${userId}' or cc.secretary_id = '${userId}'
    or exists (select 1 from committee_members m where m.committee_id = cc.id and m.deleted_at is null
      and (m.from_on is null or m.from_on <= '${today}'::date) and (m.to_on is null or m.to_on >= '${today}'::date)
      and (m.user_id = '${userId}'${viaPerson}))))`;
}

/** Whether a person sits on a committee today (chair, secretary or member in office). */
export async function isMember(ctx: ModuleContext, committeeId: string, userId: string | null | undefined): Promise<boolean> {
  if (!UUID_RE.test(String(committeeId ?? ''))) return false;
  return Boolean(await ctx.db.one(`select 1 as ok where ${memberSql(ctx, userId, '$1::uuid')}`, [committeeId]));
}

/**
 * Whether a person may read a committee's closed-session (executive session) items: its members,
 * chair and secretary, and the people who prepare meetings (governance.edit).
 */
export async function seesClosed(ctx: ModuleContext, user: SessionUser | null | undefined, committeeId: string): Promise<boolean> {
  if (!user) return false;
  return ctx.can(user, 'governance.edit') || isMember(ctx, committeeId, user.id);
}

export function registerCommittees(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  function checkCommittee(merged: Row, patch: Row) {
    if ('quorum_rule' in patch && !['count', 'percent'].includes(String(patch.quorum_rule))) invalid({ quorum_rule: 'Choose a number of members or a percentage.' });
    if (typeof patch.resolution_prefix === 'string') {
      patch.resolution_prefix = patch.resolution_prefix.trim().slice(0, 20) || null;
      if (patch.resolution_prefix && !/^[\p{L}\p{N} ./_-]+$/u.test(patch.resolution_prefix)) invalid({ resolution_prefix: 'Use letters, digits, spaces and . / _ - only.' });
    }
    if (patch.quorum_value !== undefined && patch.quorum_value !== null) {
      const n = Number(patch.quorum_value);
      if (!Number.isFinite(n) || n <= 0) invalid({ quorum_value: 'The quorum must be more than zero.' });
      if (merged.quorum_rule === 'percent' && n > 100) invalid({ quorum_value: 'A percentage cannot be more than 100.' });
      if (merged.quorum_rule !== 'percent' && (!Number.isInteger(n) || n > 500)) invalid({ quorum_value: 'Enter a whole number of members.' });
    }
    return patch;
  }

  ctx.defineResource({
    type: 'committee', table: 'committees', module: 'governance', label: 'Committee', plural: 'Committees',
    path: '/api/committees', route: '/governance/committees', titleField: 'name',
    ref: { field: 'ref', prefix: 'COM-' },
    searchable: ['name', 'purpose'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true, personal: false },
      kind: { label: 'Kind', type: 'lookup', list: 'committee_kind', required: true },
      status: { label: 'Status', type: 'lookup', list: 'committee_status', default: 'active' },
      purpose: { label: 'Purpose and terms of reference', type: 'longtext', personal: false },
      chair_id: { label: 'Chair', type: 'user' },
      secretary_id: { label: 'Secretary', type: 'user' },
      quorum_rule: { label: 'Quorum counted as', type: 'lookup', list: 'committee_quorum_rule', default: 'count' },
      quorum_value: { label: 'Quorum', type: 'number' },
      meeting_frequency: { label: 'Meets', type: 'lookup', list: 'committee_frequency' },
      joint_labor_management: { label: 'Joint labor-management committee', type: 'boolean', default: false },
      // Resolution numbers are this text, the year of the meeting and a running number: "R-" gives R-2026-01.
      resolution_prefix: { label: 'Resolution number prefix', type: 'text', personal: false },
    },
    hooks: {
      beforeCreate: async (_req, data) => checkCommittee(data, data),
      beforeUpdate: async (_req, existing, patch) => checkCommittee({ ...existing, ...patch }, patch),
    },
  });

  // ---------- members ----------

  const committeeFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('committee', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Committee not found.');

  async function listMembers(committeeId: string): Promise<Row[]> {
    const rows = await withNames(ctx, await db.query<Row>(
      `select ${MEMBER_COLS} from ${MEMBER_FROM}
       where m.committee_id = $1 and m.deleted_at is null
       order by case m.side when 'management' then 0 when 'labor' then 1 when 'independent' then 2 else 3 end,
         case m.role when 'chair' then 0 when 'member' then 1 else 2 end, m.created_at`, [committeeId]));
    const today = todayInZone();
    return rows.map((m) => ({ ...m, current: (!m.from_on || m.from_on <= today) && (!m.to_on || m.to_on >= today) }));
  }

  /** Checks a member: an account or roster person must exist; a name is needed only for someone with neither. */
  async function memberInput(req: FastifyRequest, body: Row, existing: Row | null): Promise<Row> {
    const out: Row = {};
    const errors: Record<string, string> = {};
    const text = (k: string, max: number) => (body[k] === undefined ? undefined : String(body[k] ?? '').trim().slice(0, max));
    if (body.user_id !== undefined) {
      const id = body.user_id ? String(body.user_id) : null;
      if (id && (!UUID_RE.test(id) || !(await db.one(`select 1 from users where id = $1 and status <> 'disabled'`, [id])))) errors.user_id = 'Choose an active user.';
      out.user_id = id;
    }
    if (body.person_id !== undefined) {
      const id = body.person_id ? String(body.person_id) : null;
      // Roster people come from the people module (contract C4); without it the field is not offered.
      if (id && !ctx.resources.get('person')) errors.person_id = 'The staff roster is not part of this installation.';
      else if (id && (!UUID_RE.test(id) || !(await ctx.resources.find('person', id, req.user)))) errors.person_id = 'Choose a person from the roster.';
      out.person_id = id;
    }
    const name = text('name', 160);
    if (name !== undefined) out.name = name;
    for (const [k, list] of [['side', 'committee_side'], ['role', 'committee_role']] as const) {
      if (body[k] === undefined) continue;
      const v = body[k] ? String(body[k]) : null;
      if (v && !(await ctx.lookups.values(list)).some((x) => x.value === v)) errors[k] = 'Choose from the list.';
      if (k === 'role' && !v) errors.role = 'Choose a role.';
      out[k] = v;
    }
    if (body.voting !== undefined) out.voting = body.voting === true || body.voting === 'true';
    for (const k of ['from_on', 'to_on'] as const) {
      if (body[k] === undefined) continue;
      const v = body[k] ? String(body[k]) : null;
      if (v && (!DATE.test(v) || Number.isNaN(Date.parse(v)))) errors[k] = 'Enter a date.';
      out[k] = v;
    }
    const merged = { ...(existing ?? {}), ...out };
    if (merged.from_on && merged.to_on && merged.to_on < merged.from_on) errors.to_on = 'The end date must be on or after the start date.';
    const typed = out.name !== undefined ? out.name : existing?.typed_name;
    if (!typed && !merged.user_id && !merged.person_id) errors.name = 'Give the member\'s name, or choose an account or roster person.';
    if ('name' in out && !out.name) out.name = null;
    if (Object.keys(errors).length) invalid(errors);
    return out;
  }

  app.get('/api/committees/:id/members', { preHandler: ctx.requirePerm('governance.view') }, async (req) => listMembers((await committeeFor(req)).id));
  ctx.describeRoute({
    method: 'GET', path: '/api/committees/:id/members', tag: 'Governance', permission: 'governance.view',
    summary: 'Members of a committee, by side, with whether each is in office today',
    response: '[{ id, user_id, person_id, name, side, role, voting, from_on, to_on, current, user_name }]',
  });

  app.post('/api/committees/:id/members', { preHandler: ctx.requirePerm('governance.edit') }, async (req, reply) => {
    const committee = await committeeFor(req);
    const body = (req.body ?? {}) as Row;
    const input = await memberInput(req, { role: 'member', voting: true, ...body }, null);
    const row = (await db.one<Row>(
      `insert into committee_members (committee_id, user_id, person_id, name, side, role, voting, from_on, to_on, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning id`,
      [committee.id, input.user_id ?? null, input.person_id ?? null, input.name ?? null, input.side ?? null, input.role ?? 'member',
        input.voting ?? true, input.from_on ?? null, input.to_on ?? null, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'committee.member_add', recordType: 'committee', recordId: committee.id,
      summary: `Member added: ${(await memberById(ctx, row.id))?.name ?? 'a member'}${input.side ? ` (${input.side})` : ''}`, after: { member_id: row.id, ...input },
    });
    reply.code(201);
    return (await listMembers(committee.id)).find((m) => m.id === row.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/committees/:id/members', tag: 'Governance', permission: 'governance.edit',
    summary: 'Add a member to a committee', body: '{ user_id?, person_id?, name?, side?, role, voting, from_on?, to_on? }',
  });

  const memberOf = async (committeeId: string, memberId: string): Promise<Row> =>
    (UUID_RE.test(memberId) ? await db.one<Row>(`select ${MEMBER_COLS} from ${MEMBER_FROM} where m.id = $1 and m.committee_id = $2 and m.deleted_at is null`, [memberId, committeeId]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Member not found.');

  app.patch('/api/committees/:id/members/:memberId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const committee = await committeeFor(req);
    const before = await memberOf(committee.id, (req.params as { memberId: string }).memberId);
    const input = await memberInput(req, (req.body ?? {}) as Row, before);
    const keys = Object.keys(input);
    if (keys.length) {
      await db.query(
        `update committee_members set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${keys.length + 2} where id = $1`,
        [before.id, ...keys.map((k) => input[k]), req.user!.id]);
      await ctx.audit(req, {
        action: 'committee.member_change', recordType: 'committee', recordId: committee.id,
        summary: `Member changed: ${(await memberById(ctx, before.id))?.name ?? 'a member'}`, before: Object.fromEntries(keys.map((k) => [k, k === 'name' ? before.typed_name : before[k]])), after: input,
      });
    }
    return (await listMembers(committee.id)).find((m) => m.id === before.id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/committees/:id/members/:memberId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Change a committee member (side, role, voting, term)', body: '{ user_id?, person_id?, name?, side?, role?, voting?, from_on?, to_on? }',
  });

  app.delete('/api/committees/:id/members/:memberId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const committee = await committeeFor(req);
    const before = await memberOf(committee.id, (req.params as { memberId: string }).memberId);
    // Kept (soft-deleted) so that past attendance still names them.
    await db.query('update committee_members set deleted_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, { action: 'committee.member_remove', recordType: 'committee', recordId: committee.id, summary: `Member removed: ${(await memberById(ctx, before.id))?.name ?? 'a member'}`, before });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/committees/:id/members/:memberId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Remove a member from a committee (past attendance keeps their name; to end a term, set its end date instead)',
  });

  app.get('/api/committees/:id/quorum', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const committee = await committeeFor(req);
    const voting = (await membersOn(ctx, committee.id, todayInZone())).filter((m) => m.voting).length;
    return { voting, needed: quorumNeeded(committee, voting), rule: committee.quorum_rule, value: committee.quorum_value };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/committees/:id/quorum', tag: 'Governance', permission: 'governance.view',
    summary: 'The quorum a committee needs today: voting members in office and how many must be present',
    response: '{ voting, needed, rule, value }',
  });
}
