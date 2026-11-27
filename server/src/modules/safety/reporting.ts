import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { actorOf, dataLoadFor } from '../../core/dataload.ts';
import { byUrgency, clockOf, duration, stamp } from '../secincidents/clocks.ts';

/**
 * Reportability and notification clocks for safety events (E25-05, E25-06).
 *
 * The organization writes its own reporting rules (Administration > Safety reporting rules): each
 * says which events must be reported (conditions over the event's figures: fatalities, people taken
 * for medical treatment, estimated damage, evacuation, type and severity), to whom, and within how
 * many hours of the event. No rule of any jurisdiction is shipped. Every save of an event works its
 * reportability out again: a rule that newly applies starts a clock (one per event and rule), tells
 * the safety team and writes the investigation timeline; a rule that no longer applies sets its
 * pending clock to "not required". The sweep (`safety.clocks`, every 15 minutes) raises the amber
 * alert once when the setting `safety.clock_amber_fraction` (0.25) or less of the window remains,
 * and the red alert once when the deadline passes. The clock arithmetic is the security incidents'
 * (`secincidents/clocks.ts`), so both kinds of clock behave the same.
 */

const HOUR = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9][a-z0-9_]{0,59}$/;
export const DEFAULT_AMBER_FRACTION = 0.25;

/** The event fields a rule may test, with the comparisons each allows. */
export const CONDITION_FIELDS: Record<string, { label: string; kind: 'number' | 'list' | 'boolean'; list?: string }> = {
  fatalities: { label: 'Fatalities', kind: 'number' },
  people_transported: { label: 'People taken for medical treatment', kind: 'number' },
  damage_estimate: { label: 'Estimated damage', kind: 'number' },
  evacuation: { label: 'Evacuated', kind: 'boolean' },
  event_type: { label: 'Type', kind: 'list', list: 'safety_event_type' },
  severity: { label: 'Severity', kind: 'list', list: 'safety_event_severity' },
};
export const OPS: Record<string, { label: string; kinds: string[] }> = {
  gte: { label: 'is at least', kinds: ['number'] },
  gt: { label: 'is more than', kinds: ['number'] },
  eq: { label: 'is exactly', kinds: ['number'] },
  in: { label: 'is one of', kinds: ['list'] },
  is: { label: 'is', kinds: ['boolean'] },
};

export interface Condition { field: string; op: string; value: unknown }

/** Whether one event matches every condition of a rule (a rule with no condition matches nothing). */
export function ruleMatches(conditions: Condition[], event: Row): boolean {
  if (!Array.isArray(conditions) || !conditions.length) return false;
  return conditions.every((c) => {
    const v = event[c.field];
    switch (c.op) {
      case 'gte': return v !== null && v !== undefined && Number(v) >= Number(c.value);
      case 'gt': return v !== null && v !== undefined && Number(v) > Number(c.value);
      case 'eq': return v !== null && v !== undefined && Number(v) === Number(c.value);
      case 'in': return Array.isArray(c.value) && c.value.map(String).includes(String(v ?? ''));
      case 'is': return (v === true) === (c.value === true);
      default: return false;
    }
  });
}

export interface Reporting {
  evaluate(req: FastifyRequest | null, event: Row): Promise<void>;
  sweep(eventId?: string): Promise<{ amber: number; red: number }>;
}

export function registerReporting(ctx: ModuleContext): Reporting {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const view = { preHandler: ctx.requirePerm('safety.view') };
  const edit = { preHandler: ctx.requirePerm('safety.edit') };
  const administer = { preHandler: ctx.requirePerm('safety.administer') };

  async function amberFraction(): Promise<number> {
    const f = Number(await ctx.settings.get('safety.clock_amber_fraction', DEFAULT_AMBER_FRACTION));
    return Number.isFinite(f) && f > 0 && f < 1 ? f : DEFAULT_AMBER_FRACTION;
  }

  /** An entry the application writes: no `by_id`, so nobody can change it later; `by_name` says whose action led to it. */
  async function addTimeline(eventId: string, entry: string, req: FastifyRequest | null, at = new Date()) {
    await db.query(
      `insert into safety_event_timeline (event_id, at, entry, by_id, by_name, created_by) values ($1,$2,$3,null,$4,$5)`,
      [eventId, at.toISOString(), entry, req ? actorOf(req).name : null, req ? actorOf(req).id : null],
    );
  }

  async function tell(event: Row, title: string, body: string) {
    if (!app.hasDecorator('notify')) return;
    // The notification service drops anyone who may not see the event (a restricted one needs security.view).
    await app.notify({
      permission: 'safety.view', userIds: [event.investigator_id], kind: 'safety', title, body,
      recordType: 'safety_event', recordId: event.id, route: `/safety/events/${event.id}?tab=reporting`,
    });
  }

  // ---------- evaluation on every save ----------

  async function evaluate(req: FastifyRequest | null, event: Row): Promise<void> {
    const rules = await db.query<Row>(`select * from safety_report_rules where active order by sort, name`);
    const matched = rules.filter((r) => ruleMatches(r.conditions, event));
    const reasons = matched.map((r) => ({ rule_id: r.id, key: r.key, name: r.name, party: r.party, deadline_hours: Number(r.deadline_hours), required: r.required }));
    const reportable = matched.length > 0;
    const same = Boolean(event.reportable) === reportable
      && JSON.stringify((event.reportable_reasons ?? []).map((x: Row) => x.rule_id)) === JSON.stringify(reasons.map((x) => x.rule_id));
    if (!same) {
      await db.query(`update safety_events set reportable = $2, reportable_reasons = $3::jsonb where id = $1`, [event.id, reportable, JSON.stringify(reasons)]);
    }
    // The saved row the caller answers with shows the outcome too.
    event.reportable = reportable;
    event.reportable_reasons = reasons;
    const occurred = new Date(event.occurred_at);
    const clocks = await db.query<Row>(`select * from safety_notifications where event_id = $1`, [event.id]);
    for (const rule of matched) {
      const clock = clocks.find((c) => c.rule_id === rule.id);
      const hours = Number(rule.deadline_hours);
      if (!clock) {
        const due = new Date(occurred.getTime() + hours * HOUR);
        const made = await db.one<Row>(
          `insert into safety_notifications (event_id, rule_id, party, deadline_hours, required, guidance, due_at)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict (event_id, rule_id) do nothing returning *`,
          [event.id, rule.id, rule.party, hours, rule.required, rule.guidance ?? null, due.toISOString()],
        );
        if (!made) continue;
        await addTimeline(event.id, `Reporting rule "${rule.name}" applies: notify ${rule.party} by ${stamp(due)} (${rule.required ? 'required' : 'recommended'}).`, req);
        await ctx.audit(req, {
          action: 'safety_event.reportable', recordType: 'safety_event', recordId: event.id,
          summary: `Reporting rule "${rule.name}" applies: notify ${rule.party} within ${hours} hours`,
          after: { rule_id: rule.id, party: rule.party, due_at: due.toISOString() },
        });
        await tell(event, `Reportable: notify ${rule.party} by ${stamp(due)} (${event.ref})`, `Reporting rule "${rule.name}" applies to this safety event.`);
        continue;
      }
      // The clock runs from the time of the event: when that is corrected, the deadline follows.
      if (clock.status === 'pending' && clock.deadline_hours !== null) {
        const due = new Date(occurred.getTime() + Number(clock.deadline_hours) * HOUR);
        if (!clock.due_at || new Date(clock.due_at).getTime() !== due.getTime()) {
          const later = clock.due_at && due.getTime() > new Date(clock.due_at).getTime();
          await db.query(
            `update safety_notifications set due_at = $2, updated_at = now()${later ? ', alerted_amber_at = null, alerted_red_at = null' : ''} where id = $1`,
            [clock.id, due.toISOString()]);
        }
      }
      // Set aside automatically because the rule stopped applying, and it applies again: running again.
      if (clock.status === 'not_required' && !clock.completed_by) {
        await db.query(`update safety_notifications set status = 'pending', note = null, completed_at = null, updated_at = now() where id = $1`, [clock.id]);
        await addTimeline(event.id, `Reporting rule "${rule.name}" applies again: the clock to notify ${clock.party} is running.`, req);
      }
    }
    for (const clock of clocks.filter((c) => c.rule_id && c.status === 'pending' && !matched.some((r) => r.id === c.rule_id))) {
      await db.query(
        `update safety_notifications set status = 'not_required', note = $2, completed_at = now(), completed_by = null, updated_at = now() where id = $1`,
        [clock.id, 'The reporting rule no longer applies to the event\'s figures.']);
      await addTimeline(event.id, `The reporting rule for ${clock.party} no longer applies to this event's figures: that clock is set aside.`, req);
      await ctx.audit(req, {
        action: 'safety_notification.not_required', recordType: 'safety_event', recordId: event.id,
        summary: `Notification to ${clock.party} no longer required: the rule no longer applies`,
      });
    }
    // An alert that cannot be sent now is left for the scheduled sweep; the save itself stands.
    if (matched.length) await sweep(event.id).catch((err) => console.error(`[safety] clock alerts for ${event.id} wait for the next sweep:`, (err as Error).message));
  }

  // ---------- the sweep: amber and red alerts, once each ----------

  async function sweep(eventId?: string): Promise<{ amber: number; red: number }> {
    const now = new Date();
    const fraction = await amberFraction();
    const rows = await db.query<Row>(
      `select n.*, e.ref as event_ref, e.investigator_id, e.occurred_at
       from safety_notifications n join safety_events e on e.id = n.event_id and e.deleted_at is null
       where n.status = 'pending' and n.due_at is not null and n.alerted_red_at is null and ($1::uuid is null or e.id = $1::uuid)
       order by n.due_at`, [eventId ?? null]);
    const out = { amber: 0, red: 0 };
    const failures: Error[] = [];
    for (const n of rows) {
      const clock = clockOf(n, n.occurred_at, now, fraction);
      const level = clock.state === 'red' ? 'red' : clock.state === 'amber' && !n.alerted_amber_at ? 'amber' : null;
      if (!level) continue;
      // Claimed with a conditional update, so two server processes never both send it; the stamp is
      // taken back if the alert could not be sent, so it is sent on the next run instead of never
      // (E40-12; it used to be stamped first and lost on any failure further on).
      const claimed = await db.one(
        level === 'red'
          ? `update safety_notifications set alerted_red_at = $2, alerted_amber_at = coalesce(alerted_amber_at, $2) where id = $1 and alerted_red_at is null returning id`
          : `update safety_notifications set alerted_amber_at = $2 where id = $1 and alerted_amber_at is null and alerted_red_at is null returning id`,
        [n.id, now.toISOString()]);
      if (!claimed) continue;
      try {
        const due = stamp(n.due_at);
        await addTimeline(n.event_id, level === 'red'
          ? `Alert: the deadline to notify ${n.party} has passed (it was due ${due}).`
          : `Alert: the deadline to notify ${n.party} is close (due ${due}, ${duration(clock.seconds_remaining)} left).`, null, now);
        await ctx.audit(null, {
          action: `safety_notification.alert_${level}`, recordType: 'safety_event', recordId: n.event_id,
          summary: `Safety notification clock turned ${level}: ${n.party}`, after: { due_at: n.due_at, level },
        });
        await tell({ id: n.event_id, ref: n.event_ref, investigator_id: n.investigator_id },
          level === 'red' ? `Overdue: notify ${n.party} (${n.event_ref})` : `${duration(clock.seconds_remaining)} left to notify ${n.party} (${n.event_ref})`,
          `${n.required ? 'Required' : 'Recommended'} notification, due ${due}.`);
      } catch (err) {
        await db.query(
          `update safety_notifications set alerted_red_at = $2, alerted_amber_at = $3 where id = $1`,
          [n.id, n.alerted_red_at ?? null, level === 'red' ? n.alerted_amber_at ?? null : null]);
        failures.push(err as Error);
        continue;
      }
      out[level] += 1;
    }
    // A failed alert fails the run (Background jobs shows it, and E40-04 alerts the administrators
    // when the check keeps failing); the stamp was taken back, so the next run sends it.
    if (failures.length) throw new Error(`${failures.length} safety notification alert(s) could not be sent and will be tried again: ${failures[0].message}`);
    return out;
  }

  // ---------- clocks ----------

  const shape = (n: Row, now: Date, fraction: number) => ({ ...clockOf(n, n.occurred_at, now, fraction), id: n.id, event_id: n.event_id, note: n.note ?? null });

  app.get('/api/safety-events/:id/clocks', view, async (req) => {
    const event = (await ctx.resources.find('safety_event', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Safety event not found.');
    const now = new Date();
    const fraction = await amberFraction();
    const rows = await db.query<Row>(
      `select n.*, $2::timestamptz as occurred_at, u.display_name as completed_by_name
       from safety_notifications n left join users u on u.id = n.completed_by where n.event_id = $1 order by n.due_at nulls last, n.party`,
      [event.id, event.occurred_at]);
    return {
      now: now.toISOString(), amber_fraction: fraction,
      reportable: Boolean(event.reportable), reasons: event.reportable_reasons ?? [],
      clocks: rows.map((r) => shape(r, now, fraction)).sort(byUrgency),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/safety-events/:id/clocks', permission: 'safety.view',
    summary: 'The notification clocks of one safety event, most urgent first, and the reporting rules that apply',
    response: '{ now, amber_fraction, reportable, reasons: [{ rule_id, name, party, deadline_hours, required }], clocks: [{ id, party, due_at, state, seconds_remaining, status, ... }] }',
  });

  /**
   * Every clock, most urgent first. The summary counts every clock (figures are the same for
   * everyone); the list leaves out the clocks of events the reader may not see.
   */
  app.get('/api/safety/clocks', view, async (req) => {
    const now = new Date();
    const fraction = await amberFraction();
    const wanted = String((req.query as Row)?.status ?? 'pending');
    const status = ['pending', 'done', 'not_required', 'all'].includes(wanted) ? wanted : 'pending';
    const all = await db.query<Row>(
      `select n.id, n.status, n.due_at, n.deadline_hours, e.occurred_at from safety_notifications n
       join safety_events e on e.id = n.event_id and e.deleted_at is null`);
    const states = all.map((r) => clockOf(r, r.occurred_at, now, fraction).state);
    const count = (s: string) => states.filter((x) => x === s).length;
    const rows = await db.query<Row>(
      `select n.*, e.occurred_at, e.ref as event_ref, e.title as event_title, e.severity as event_severity, u.display_name as completed_by_name
       from safety_notifications n join safety_events e on e.id = n.event_id and e.deleted_at is null
       left join users u on u.id = n.completed_by
       where ${ctx.resources.visibleWhere('safety_event', req.user, 'e')} ${status === 'all' ? '' : 'and n.status = $1'}
       order by n.due_at nulls last limit 500`, status === 'all' ? [] : [status]);
    return {
      now: now.toISOString(), amber_fraction: fraction,
      summary: { red: count('red'), amber: count('amber'), green: count('green'), open: count('red') + count('amber') + count('green'), done: count('met'), not_required: count('not_required') },
      clocks: rows.map((r) => ({ ...shape(r, now, fraction), event: { id: r.event_id, ref: r.event_ref, title: r.event_title, severity: r.event_severity } })).sort(byUrgency),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/safety/clocks', permission: 'safety.view',
    summary: 'Notification clocks across safety events, most urgent first, with counts by state',
    query: { status: 'pending (default), done, not_required or all' },
    response: '{ now, amber_fraction, summary: { red, amber, green, open, done, not_required }, clocks: [...] }',
  });

  app.post('/api/safety/clocks/sweep', administer, async () => sweep());
  ctx.describeRoute({ method: 'POST', path: '/api/safety/clocks/sweep', permission: 'safety.administer', summary: 'Raise any amber or red safety notification alert that is due now (also runs every 15 minutes)', response: '{ amber, red }' });

  /** Records that the notification was made, or that it is not required (with a reason). */
  app.post('/api/safety-notifications/:id/complete', edit, async (req) => {
    const id = (req.params as { id: string }).id;
    const n = UUID.test(id) ? await db.one<Row>(`select * from safety_notifications where id = $1`, [id]) : undefined;
    const event = n ? await ctx.resources.find('safety_event', n.event_id, req.user) : undefined;
    if (!n || !event) ctx.fail(404, 'not_found', 'Notification not found.');
    if (n!.status !== 'pending') ctx.fail(409, 'not_pending', 'This notification has already been recorded.');
    const b = (req.body ?? {}) as Row;
    const text = (k: string, max = 500) => String(b[k] ?? '').trim().slice(0, max);
    let row: Row;
    if (b.status === 'not_required') {
      if (!text('note')) invalid({ note: 'Say why this notification is not required.' });
      row = (await db.one<Row>(
        `update safety_notifications set status = 'not_required', note = $2, completed_by = $3, completed_at = now(), updated_at = now() where id = $1 returning *`,
        [n!.id, text('note', 2000), actorOf(req).id]))!;
      await addTimeline(event!.id, `Notification to ${n!.party} marked not required: ${text('note', 2000)}`, req);
    } else {
      const errors: Record<string, string> = {};
      if (!text('notified_who')) errors.notified_who = 'Say who was told.';
      if (!text('notified_how')) errors.notified_how = 'Say how they were told.';
      const at = b.notified_at ? new Date(String(b.notified_at)) : new Date();
      if (Number.isNaN(at.getTime())) errors.notified_at = 'Enter the date and time.';
      else if (at.getTime() > Date.now() + 5 * 60_000) errors.notified_at = 'The time cannot be in the future.';
      if (Object.keys(errors).length) invalid(errors);
      row = (await db.one<Row>(
        `update safety_notifications set status = 'done', notified_who = $2, notified_how = $3, notified_at = $4, reference_received = $5,
           completed_by = $6, completed_at = coalesce($7::timestamptz, now()), updated_at = now() where id = $1 returning *`,
        [n!.id, text('notified_who'), text('notified_how'), at.toISOString(), text('reference_received') || null, actorOf(req).id, b.notified_at && await dataLoadFor(db, req) ? at.toISOString() : null]))!;
      await addTimeline(event!.id, `Notification made: ${n!.party}. Told ${row.notified_who} by ${row.notified_how} at ${stamp(at)}${row.reference_received ? `; reference ${row.reference_received}` : ''}.`, req);
    }
    await ctx.audit(req, {
      action: row.status === 'done' ? 'safety_notification.done' : 'safety_notification.not_required', recordType: 'safety_event', recordId: event!.id,
      summary: row.status === 'done' ? `Notification to ${n!.party} recorded` : `Notification to ${n!.party} marked not required`,
      before: { status: 'pending' }, after: { status: row.status, notified_who: row.notified_who, notified_how: row.notified_how, notified_at: row.notified_at, reference_received: row.reference_received, note: row.note },
    });
    return shape({ ...row, occurred_at: event!.occurred_at }, new Date(), await amberFraction());
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/safety-notifications/:id/complete', permission: 'safety.edit',
    summary: 'Record that a safety notification was made (who, how, when, reference), or that it is not required (with the reason)',
    body: '{ notified_who, notified_how, notified_at?, reference_received? } | { status: "not_required", note }',
  });

  // ---------- the rules (Administration > Safety reporting rules) ----------

  async function cleanRule(b: Row, existing: Row | null): Promise<Row> {
    const errors: Record<string, string> = {};
    const out: Row = {};
    const has = (k: string) => b[k] !== undefined;
    if (!existing || has('name')) {
      out.name = String(b.name ?? '').trim().slice(0, 200);
      if (!out.name) errors.name = 'Give the rule a name.';
    }
    if (!existing) {
      out.key = String(b.key ?? '').trim() || String(out.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
      if (!KEY.test(out.key)) errors.key = 'Use lowercase letters, digits and underscores.';
      else if (await db.one('select 1 from safety_report_rules where key = $1', [out.key])) errors.key = 'Another rule has this key.';
    }
    if (!existing || has('party')) {
      out.party = String(b.party ?? '').trim().slice(0, 200);
      if (!out.party) errors.party = 'Say who must be told.';
    }
    if (!existing || has('deadline_hours')) {
      const h = Number(b.deadline_hours);
      if (b.deadline_hours === null || b.deadline_hours === '' || !Number.isFinite(h) || h <= 0 || h > 8760) errors.deadline_hours = 'Give the hours from the event, more than 0 and at most 8,760.';
      else out.deadline_hours = h;
    }
    if (!existing || has('conditions')) {
      const list = Array.isArray(b.conditions) ? b.conditions as Row[] : null;
      if (!list || !list.length) errors.conditions = 'Add at least one condition.';
      const conditions: Condition[] = [];
      for (const [i, c] of (list ?? []).entries()) {
        const f = CONDITION_FIELDS[String(c?.field)];
        const op = OPS[String(c?.op)];
        if (!f) { errors[`conditions.${i}`] = 'Choose what the condition tests.'; continue; }
        if (!op || !op.kinds.includes(f.kind)) { errors[`conditions.${i}`] = `Choose a comparison that fits ${f.label.toLowerCase()}.`; continue; }
        if (f.kind === 'number') {
          const v = Number(c.value);
          if (c.value === null || c.value === '' || !Number.isFinite(v) || v < 0) { errors[`conditions.${i}`] = 'Give a number, zero or more.'; continue; }
          conditions.push({ field: c.field, op: c.op, value: v });
        } else if (f.kind === 'boolean') {
          conditions.push({ field: c.field, op: 'is', value: c.value === true });
        } else {
          const known = (await ctx.lookups.values(f.list!)).map((v) => v.value);
          const vals = Array.isArray(c.value) ? [...new Set(c.value.map(String))] : [];
          if (!vals.length || vals.some((v) => !known.includes(v))) { errors[`conditions.${i}`] = `Choose one or more ${f.label.toLowerCase()} values.`; continue; }
          conditions.push({ field: c.field, op: 'in', value: vals });
        }
      }
      out.conditions = conditions;
    }
    if (has('required')) out.required = b.required === true;
    if (has('active')) out.active = b.active === true;
    if (has('guidance')) out.guidance = String(b.guidance ?? '').trim().slice(0, 4000) || null;
    if (has('sort')) {
      const s = Number(b.sort);
      if (!Number.isInteger(s) || s < 0 || s > 100000) errors.sort = 'Give a whole number, zero or more.'; else out.sort = s;
    }
    if (Object.keys(errors).length) invalid(errors);
    return out;
  }

  app.get('/api/safety/report-rules', view, async () => ({
    rules: await db.query<Row>(`select * from safety_report_rules order by sort, name`),
    fields: Object.entries(CONDITION_FIELDS).map(([key, f]) => ({ key, ...f, ops: Object.entries(OPS).filter(([, o]) => o.kinds.includes(f.kind)).map(([value, o]) => ({ value, label: o.label })) })),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/safety/report-rules', permission: 'safety.view',
    summary: 'The organization\'s safety reporting rules, and the event fields and comparisons a rule may use',
    response: '{ rules: [{ id, key, name, conditions: [{ field, op, value }], party, deadline_hours, required, guidance, active, sort }], fields: [{ key, label, kind, list?, ops }] }',
  });

  const ruleOf = async (req: FastifyRequest): Promise<Row> => {
    const id = (req.params as { id: string }).id;
    return (UUID.test(id) ? await db.one<Row>('select * from safety_report_rules where id = $1', [id]) : undefined) ?? ctx.fail(404, 'not_found', 'Rule not found.');
  };

  app.post('/api/safety/report-rules', administer, async (req, reply) => {
    const d = await cleanRule((req.body ?? {}) as Row, null);
    const row = (await db.one<Row>(
      `insert into safety_report_rules (key, name, conditions, party, deadline_hours, required, guidance, active, sort, created_by, updated_by)
       values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$10) returning *`,
      [d.key, d.name, JSON.stringify(d.conditions), d.party, d.deadline_hours, d.required ?? true, d.guidance ?? null, d.active ?? false, d.sort ?? 100, req.user!.id]))!;
    await ctx.audit(req, { action: 'safety_report_rule.create', recordType: 'safety_report_rule', recordId: row.id, summary: `Safety reporting rule "${row.name}" added${row.active ? '' : ' (switched off)'}`, after: row });
    reply.code(201);
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/safety/report-rules', permission: 'safety.administer', summary: 'Add a safety reporting rule (applies to events as they are saved)',
    body: '{ name, key?, conditions: [{ field, op, value }], party, deadline_hours, required?, guidance?, active?, sort? }',
  });

  app.patch('/api/safety/report-rules/:id', administer, async (req) => {
    const before = await ruleOf(req);
    const d = await cleanRule((req.body ?? {}) as Row, before);
    const keys = Object.keys(d);
    if (!keys.length) return before;
    const sets = keys.map((k, i) => `${k} = $${i + 2}${k === 'conditions' ? '::jsonb' : ''}`);
    const row = (await db.one<Row>(
      `update safety_report_rules set ${sets.join(', ')}, updated_at = now(), updated_by = $${keys.length + 2} where id = $1 returning *`,
      [before.id, ...keys.map((k) => (k === 'conditions' ? JSON.stringify(d[k]) : d[k])), req.user!.id]))!;
    await ctx.audit(req, { action: 'safety_report_rule.update', recordType: 'safety_report_rule', recordId: row.id, summary: `Safety reporting rule "${row.name}" changed`, before, after: row });
    return row;
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/safety/report-rules/:id', permission: 'safety.administer', summary: 'Change a safety reporting rule (clocks already started keep their deadline)' });

  app.delete('/api/safety/report-rules/:id', administer, async (req) => {
    const before = await ruleOf(req);
    await db.query('delete from safety_report_rules where id = $1', [before.id]);
    await ctx.audit(req, { action: 'safety_report_rule.delete', recordType: 'safety_report_rule', recordId: before.id, summary: `Safety reporting rule "${before.name}" removed`, before });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/safety/report-rules/:id', permission: 'safety.administer', summary: 'Remove a safety reporting rule (clocks it started stay on their events)' });

  return { evaluate, sweep };
}

export async function scheduleClockSweep(ctx: ModuleContext, reporting: Reporting) {
  // Every five minutes (it was 15, E40-12): deadlines of a few hours need their amber and red alerts on time.
  await scheduleWork(ctx, 'safety.clocks', () => reporting.sweep(), { every: 5 * 60_000, firstRunInMs: 110_000 });
}
