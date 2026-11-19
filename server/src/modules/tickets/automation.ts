// What the sweep does beyond flagging missed targets: warnings before a target (E03-13) and
// escalation rules (E03-14), plus the routes that administer them.
import type { ModuleContext, Row } from '../../core/module.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { GroupMembers, TicketNotify } from './notify.ts';
import { workingMinutesBetween, type CalendarDef } from './sla.ts';

export const DEFAULT_WARNING_PCT = 75;

/** What an escalation rule waits for. `since` is the column the wait is counted from. */
export const ESCALATION_CONDITIONS: Record<string, { label: string; where: string; since: string }> = {
  unassigned: { label: 'Nobody is assigned', where: 't.assignee_id is null', since: 't.opened_at' },
  no_response: { label: 'No first response', where: 't.first_responded_at is null', since: 't.opened_at' },
  untouched: { label: 'Not updated', where: 'true', since: 't.updated_at' },
};

interface TargetLike { respond_minutes: number; resolve_minutes: number; cal: CalendarDef }
type TargetFor = (priority: unknown) => Promise<TargetLike | null>;

export function makeAutomation(ctx: ModuleContext, targetFor: TargetFor, notify: TicketNotify) {
  const { db } = ctx;

  const warningPct = async () => {
    const n = Number(await ctx.settings.get<number>('tickets.sla_warning_pct', DEFAULT_WARNING_PCT));
    return Number.isFinite(n) && n > 0 && n < 100 ? n : 0;
  };

  /** Tells the owner once per clock when the configured share of the window has been used. */
  async function warn(now: Date, target: TargetFor): Promise<number> {
    const pct = await warningPct();
    if (!pct) return 0;
    const rows = await db.query<Row>(
      `select id, ref, title, priority, assignee_id, assignment_group, paused_minutes, response_due_at, resolve_due_at,
              first_responded_at, response_warned, resolve_warned, response_breached, resolve_breached
       from tickets
       where deleted_at is null and resolved_at is null and paused_at is null
         and ((not response_warned and not response_breached and first_responded_at is null and response_due_at is not null)
           or (not resolve_warned and not resolve_breached and resolve_due_at is not null))`);
    let sent = 0;
    for (const r of rows) {
      const t = await target(r.priority);
      if (!t) continue;
      const clocks = [
        { flag: 'response_warned', what: 'respond', due: r.response_due_at, total: t.respond_minutes,
          live: !r.response_warned && !r.response_breached && !r.first_responded_at },
        { flag: 'resolve_warned', what: 'resolve', due: r.resolve_due_at, total: t.resolve_minutes,
          live: !r.resolve_warned && !r.resolve_breached },
      ];
      for (const c of clocks) {
        if (!c.live || !c.due) continue;
        const due = new Date(c.due);
        if (due.getTime() <= now.getTime()) continue; // the breach flag and its notice cover this
        const left = workingMinutesBetween(t.cal, now, due);
        if (left > c.total * (1 - pct / 100)) continue;
        const claimed = await db.one(`update tickets set ${c.flag} = true where id = $1 and not ${c.flag} returning id`, [r.id]);
        if (!claimed) continue;
        sent += 1;
        await notify.send({
          ...(await notify.owners(r)), ...notify.about(r), kind: 'sla',
          title: `Close to the ${c.what} target: ${notify.name(r)}`,
          body: `${left} working ${left === 1 ? 'minute' : 'minutes'} left (${pct}% of the time has been used).`,
        });
      }
    }
    return sent;
  }

  /** Fires each enabled rule once per ticket when its wait, counted in the ticket's working calendar, has passed. */
  async function escalate(now: Date, target: TargetFor): Promise<number> {
    const rules = await db.query<Row>('select * from escalation_rules where enabled and deleted_at is null order by wait_minutes, name');
    let fired = 0;
    for (const rule of rules) {
      const cond = ESCALATION_CONDITIONS[rule.condition];
      if (!cond) continue;
      // Working time is never longer than elapsed time, so this cut-off cannot miss a ticket.
      const cutoff = new Date(now.getTime() - rule.wait_minutes * 60_000).toISOString();
      const rows = await db.query<Row>(
        `select t.id, t.ref, t.title, t.priority, t.assignee_id, t.assignment_group, ${cond.since} as since
         from tickets t
         where t.deleted_at is null and t.resolved_at is null and t.paused_at is null and ${cond.where}
           and ${cond.since} <= $2::timestamptz
           and not exists (select 1 from ticket_escalations e where e.ticket_id = t.id and e.rule_id = $1)`,
        [rule.id, cutoff]);
      for (const r of rows) {
        const t = await target(r.priority);
        const since = new Date(r.since);
        const waited = t ? workingMinutesBetween(t.cal, since, now) : Math.round((now.getTime() - since.getTime()) / 60_000);
        if (waited < rule.wait_minutes) continue;
        const toName = rule.to_user_id
          ? (await db.one<Row>('select display_name from users where id = $1', [rule.to_user_id]))?.display_name ?? 'a person who no longer exists'
          : (await ctx.lookups.values('assignment_group')).find((g) => g.value === rule.to_group)?.label ?? String(rule.to_group);
        const claimed = await db.one(
          `insert into ticket_escalations (ticket_id, rule_id, rule_name, escalated_to, at) values ($1,$2,$3,$4,$5)
           on conflict (ticket_id, rule_id) do nothing returning id`, [r.id, rule.id, rule.name, toName, now.toISOString()]);
        if (!claimed) continue;
        fired += 1;
        // Written without touching updated_at, so that "not updated" rules keep counting from the last real change.
        await db.query('update tickets set escalated_at = $2 where id = $1', [r.id, now.toISOString()]);
        await ctx.audit(null, {
          action: 'ticket.escalated', recordType: 'ticket', recordId: r.id,
          summary: `Escalated to ${toName} by the rule "${rule.name}": ${notify.name(r)}`,
          after: { rule: rule.name, condition: rule.condition, waited_minutes: waited, escalated_to: toName },
        });
        await notify.send({
          ...(rule.to_user_id ? { userIds: [rule.to_user_id] } : await notify.groupRecipients(rule.to_group)),
          ...notify.about(r), kind: 'sla',
          title: `Escalated to ${rule.to_user_id ? 'you' : toName}: ${notify.name(r)}`,
          body: `${cond.label} after ${rule.wait_minutes} working minutes (rule "${rule.name}").`,
        });
      }
    }
    return fired;
  }

  /** One pass of both. Targets are looked up once per priority. */
  async function run(now: Date): Promise<{ warned: number; escalated: number }> {
    const cache = new Map<string, Promise<TargetLike | null>>();
    const target: TargetFor = (priority) => {
      const key = String(priority ?? '');
      if (!cache.has(key)) cache.set(key, targetFor(priority));
      return cache.get(key)!;
    };
    return { warned: await warn(now, target), escalated: await escalate(now, target) };
  }

  return { run, warningPct };
}

export function registerAutomation(ctx: ModuleContext, notify: TicketNotify) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('tickets.view') };
  const administer = { preHandler: ctx.requirePerm('tickets.administer') };

  // ---------- escalation rules ----------

  const listRules = () => db.query<Row>(
    `select r.id, r.name, r.condition, r.wait_minutes, r.to_user_id, u.display_name as to_user_name, r.to_group, r.enabled,
            (select count(*)::int from ticket_escalations e where e.rule_id = r.id) as fired
     from escalation_rules r left join users u on u.id = r.to_user_id
     where r.deleted_at is null order by r.wait_minutes, r.name`);

  async function checkRule(b: Row): Promise<Row> {
    const fields: Record<string, string> = {};
    const name = String(b.name ?? '').trim();
    if (!name) fields.name = 'Name is required.';
    if (!ESCALATION_CONDITIONS[String(b.condition)]) fields.condition = 'Choose what the rule waits for.';
    const wait = Number(b.wait_minutes);
    if (!Number.isInteger(wait) || wait <= 0) fields.wait_minutes = 'Enter a whole number of minutes above zero.';
    const user = b.to_user_id ? String(b.to_user_id) : null;
    const group = b.to_group ? String(b.to_group) : null;
    if (user && group) fields.to_group = 'Choose a person or a group, not both.';
    else if (!user && !group) fields.to_user_id = 'Choose who the ticket is escalated to: a person or a group.';
    else if (user && (!UUID_RE.test(user) || !(await db.one(`select 1 from users where id = $1 and status = 'active' and deleted_at is null`, [user])))) {
      fields.to_user_id = 'Choose an active user.';
    } else if (group && !(await ctx.lookups.values('assignment_group')).some((g) => g.value === group)) {
      fields.to_group = 'Choose an assignment group.';
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return { name, condition: String(b.condition), wait_minutes: wait, to_user_id: user, to_group: group, enabled: b.enabled !== false };
  }

  const pick = (r: Row | undefined) => r && {
    name: r.name, condition: r.condition, wait_minutes: r.wait_minutes, to_user_id: r.to_user_id, to_group: r.to_group, enabled: r.enabled,
  };

  app.get('/api/tickets/escalation-rules', view, async () => ({
    rules: await listRules(),
    conditions: Object.entries(ESCALATION_CONDITIONS).map(([value, c]) => ({ value, label: c.label })),
  }));

  app.post('/api/tickets/escalation-rules', administer, async (req, reply) => {
    const v = await checkRule((req.body ?? {}) as Row);
    const row = (await db.one<Row>(
      `insert into escalation_rules (name, condition, wait_minutes, to_user_id, to_group, enabled, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7) returning *`,
      [v.name, v.condition, v.wait_minutes, v.to_user_id, v.to_group, v.enabled, req.user!.id]))!;
    await ctx.audit(req, { action: 'escalation_rule.create', recordType: 'escalation_rule', recordId: row.id, summary: `Escalation rule added: ${row.name}`, after: pick(row) });
    reply.code(201);
    return (await listRules()).find((r) => r.id === row.id);
  });

  app.put('/api/tickets/escalation-rules/:id', administer, async (req) => {
    const id = String((req.params as Row).id);
    const before = UUID_RE.test(id) ? await db.one<Row>('select * from escalation_rules where id = $1 and deleted_at is null', [id]) : undefined;
    if (!before) ctx.fail(404, 'not_found', 'Escalation rule not found.');
    const v = await checkRule({ ...pick(before), ...((req.body ?? {}) as Row) });
    const row = (await db.one<Row>(
      `update escalation_rules set name = $2, condition = $3, wait_minutes = $4, to_user_id = $5, to_group = $6, enabled = $7,
         updated_at = now(), updated_by = $8 where id = $1 returning *`,
      [id, v.name, v.condition, v.wait_minutes, v.to_user_id, v.to_group, v.enabled, req.user!.id]))!;
    await ctx.audit(req, { action: 'escalation_rule.update', recordType: 'escalation_rule', recordId: id, summary: `Escalation rule changed: ${row.name}`, before: pick(before), after: pick(row) });
    return (await listRules()).find((r) => r.id === id);
  });

  app.delete('/api/tickets/escalation-rules/:id', administer, async (req) => {
    const id = String((req.params as Row).id);
    const row = UUID_RE.test(id)
      ? await db.one<Row>('update escalation_rules set deleted_at = now(), enabled = false, updated_by = $2 where id = $1 and deleted_at is null returning *', [id, req.user!.id])
      : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Escalation rule not found.');
    await ctx.audit(req, { action: 'escalation_rule.delete', recordType: 'escalation_rule', recordId: id, summary: `Escalation rule removed: ${row!.name}`, before: pick(row) });
    return { ok: true };
  });

  /** Escalations recorded against one ticket, newest first. */
  app.get('/api/tickets/:id/escalations', view, async (req) => {
    const row = (await ctx.resources.find('ticket', String((req.params as Row).id), req.user)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
    return db.query<Row>('select id, rule_name, escalated_to, at from ticket_escalations where ticket_id = $1 order by at desc', [row.id]);
  });

  // ---------- warning threshold and group members ----------

  async function settings() {
    const members = await notify.groups();
    const ids = [...new Set(Object.values(members).flat().filter((i) => UUID_RE.test(String(i))))];
    const users = ids.length ? await db.query<Row>('select id, display_name from users where id = any($1::uuid[])', [ids]) : [];
    const groups = await ctx.lookups.values('assignment_group');
    return {
      warning_pct: Number(await ctx.settings.get<number>('tickets.sla_warning_pct', DEFAULT_WARNING_PCT)),
      groups: groups.map((g) => ({
        value: g.value, label: g.label,
        members: (members[g.value] ?? []).map((id) => ({ id, label: users.find((u) => u.id === id)?.display_name ?? 'Unknown user' })),
      })),
      notifications: app.hasDecorator('notify'),
    };
  }

  app.get('/api/tickets/sla/settings', view, async () => settings());

  app.put('/api/tickets/sla/settings', administer, async (req) => {
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    if (b.warning_pct !== undefined) {
      const n = Number(b.warning_pct);
      if (!Number.isInteger(n) || n < 0 || n > 99) fields.warning_pct = 'Enter a whole number from 1 to 99, or 0 to switch warnings off.';
    }
    let members: GroupMembers | undefined;
    if (b.group_members !== undefined) {
      const known = new Set((await ctx.lookups.values('assignment_group')).map((g) => g.value));
      members = {};
      if (!b.group_members || typeof b.group_members !== 'object' || Array.isArray(b.group_members)) fields.group_members = 'Send the members as { group: [user ids] }.';
      else {
        for (const [group, ids] of Object.entries(b.group_members as Record<string, unknown>)) {
          if (!known.has(group)) { fields.group_members = `"${group}" is not an assignment group.`; continue; }
          if (!Array.isArray(ids) || ids.some((i) => !UUID_RE.test(String(i)))) { fields.group_members = 'Each member must be a user.'; continue; }
          if (ids.length) members[group] = [...new Set(ids.map(String))];
        }
      }
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (b.warning_pct !== undefined) await ctx.settings.set('tickets.sla_warning_pct', Number(b.warning_pct), req);
    if (members) await ctx.settings.set('tickets.group_members', members, req);
    return settings();
  });
}
