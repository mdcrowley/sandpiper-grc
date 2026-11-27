import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import { isDataLoad } from '../../core/dataload.ts';
import { setWorkingCalendarSource, toWorkingCalendar, WORKING_CALENDAR_KEY } from '../../core/working-days.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { registerAssist } from './assist.ts';
import { registerRequesters } from './requesters.ts';
import { AGENT_AUDIENCE, audienceRule, makeAudience } from './audience.ts';
import { makeAutomation, registerAutomation } from './automation.ts';
import { makeCatalog } from './catalog.ts';
import { recordArticleFeedback } from './feedback.ts';
import { clock } from './clock.ts';
import { makeTicketNotify } from './notify.ts';
import { CATALOG, seedDefaults } from './defaults.ts';
import { registerMetrics } from './metrics.ts';
import { makeEmailIntake } from './email.ts';
import { registerSharedFiles } from './shared-files.ts';
import { seedSharedQueues } from './views.ts';
import { seedSamples } from './seed.ts';
import {
  addWorkingMinutes, categoryOf, clockView, DAY_KEYS, DEFAULT_MATRIX, priorityFor, workingMinutesBetween,
  type CalendarDef, type PriorityMatrix, type StatusCategory,
} from './sla.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SWEEP_MS = 60_000;

const toDate = (v: unknown): Date | null => (v === null || v === undefined || v === '' ? null : v instanceof Date ? v : new Date(String(v)));
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

interface Target { respond_minutes: number; resolve_minutes: number; calendar_id: string; calendar_key: string; calendar_name: string; cal: CalendarDef }

/** Service-level helpers shared by the ticket hooks, the routes and the sweep. */
export function makeSla(ctx: ModuleContext) {
  const { db } = ctx;
  const notify = makeTicketNotify(ctx);

  async function matrix(): Promise<PriorityMatrix> {
    return ctx.settings.get<PriorityMatrix>('tickets.priority_matrix', DEFAULT_MATRIX);
  }

  async function category(status: unknown): Promise<StatusCategory> {
    const all = await ctx.lookups.values('ticket_status');
    return categoryOf(all.find((s) => s.value === status)?.meta);
  }

  async function calendar(id: string): Promise<(CalendarDef & { key: string; name: string }) | null> {
    const row = await db.one<Row>('select * from calendars where id = $1 and deleted_at is null', [id]);
    if (!row) return null;
    const days = await db.query<{ day: string }>('select day from calendar_holidays where calendar_id = $1', [id]);
    return {
      key: row.key, name: row.name, timezone: row.timezone, always_open: row.always_open,
      hours: row.hours ?? {}, holidays: days.map((d) => String(d.day).slice(0, 10)),
    };
  }

  /** The targets for a priority, or null when no policy covers it (no clock runs). */
  async function target(priority: unknown): Promise<Target | null> {
    if (!priority) return null;
    const p = await db.one<Row>('select * from sla_policies where priority = $1 and deleted_at is null', [priority]);
    if (!p) return null;
    const cal = await calendar(p.calendar_id);
    if (!cal) return null;
    return {
      respond_minutes: p.respond_minutes, resolve_minutes: p.resolve_minutes,
      calendar_id: p.calendar_id, calendar_key: cal.key, calendar_name: cal.name, cal,
    };
  }

  /**
   * Flags tickets whose response or resolution target has passed. Paused tickets are skipped:
   * their due times are stale until work resumes and the times are shifted.
   */
  async function sweep(now: Date = clock.now()): Promise<number> {
    const at = now.toISOString();
    const responded = await db.query<Row>(
      `update tickets set response_breached = true
       where deleted_at is null and not response_breached and first_responded_at is null
         and resolved_at is null and paused_at is null and response_due_at < $1::timestamptz
       returning id, ref, title, assignee_id, assignment_group`, [at]);
    const resolved = await db.query<Row>(
      `update tickets set resolve_breached = true
       where deleted_at is null and not resolve_breached and resolved_at is null
         and paused_at is null and resolve_due_at < $1::timestamptz
       returning id, ref, title, assignee_id, assignment_group`, [at]);
    for (const [rows, field, what] of [[responded, 'response_breached', 'Response'], [resolved, 'resolve_breached', 'Resolution']] as const) {
      for (const r of rows) {
        await ctx.audit(null, {
          action: 'ticket.sla_breach', recordType: 'ticket', recordId: r.id,
          summary: `${what} target missed: ${r.ref} ${r.title}`, before: { [field]: false }, after: { [field]: true },
        });
        // E03-13: the owner is told at the moment the target is missed.
        await notify.send({
          ...(await notify.owners(r)), ...notify.about(r), kind: 'sla',
          title: `${what} target missed: ${notify.name(r)}`,
        });
      }
    }
    await automation.run(now);
    return responded.length + resolved.length;
  }

  const automation = makeAutomation(ctx, target, notify);

  return { matrix, category, calendar, target, sweep, notify };
}

const mod: ModuleDef = {
  key: 'tickets',
  seedDefaults,

  async register(ctx) {
    const { app, db } = ctx;
    const sla = makeSla(ctx);
    const notify = sla.notify;
    const audience = makeAudience(ctx);
    const catalog = makeCatalog(ctx, notify);
    const view ={ preHandler: ctx.requirePerm('tickets.view') };
    const administer = { preHandler: ctx.requirePerm('tickets.administer') };

    // E40-10: the business-hours calendar (its open weekdays and holidays) is the organization's one
    // working-day calendar, used by every deadline counted in working days (core/working-days.ts).
    setWorkingCalendarSource(app, async () => {
      const row = await db.one<Row>('select id from calendars where key = $1 and deleted_at is null', [WORKING_CALENDAR_KEY]);
      const cal = row ? await sla.calendar(row.id) : null;
      return cal ? toWorkingCalendar(cal) : null;
    });

    // E18-29: breach flags, warnings and escalation are brought up to date by a timer only, never
    // by reading tickets (a read must not write). The clock view (`/api/tickets/:id/sla`) works out
    // the remaining time itself, so a ticket page is right between two sweeps. Tests run it by hand.
    // The timer is a job-queue schedule (Administration > Background jobs), so the sweep runs
    // once a minute however many server processes there are (E14-22).
    await scheduleWork(ctx, 'tickets.sla_sweep', async () => ({ flagged: await sla.sweep() }), { every: SWEEP_MS, firstRunInMs: SWEEP_MS });
    app.post('/api/tickets/sla/sweep', administer, async (req) => {
      const flagged = await sla.sweep();
      await ctx.audit(req, { action: 'ticket.sla_sweep', recordType: 'ticket', summary: `Service-level check run by hand: ${flagged} target(s) newly missed` });
      return { flagged };
    });
    ctx.describeRoute({
      method: 'POST', path: '/api/tickets/sla/sweep', permission: 'tickets.administer', summary: 'Run the service-level check now',
      description: 'The check runs every minute by itself: it flags missed targets, sends warnings and applies escalation rules. Reading tickets never runs it.',
      response: '{ flagged }',
    });

    // ---------- ticket rules ----------

    function checkCommon(data: Row, selfId?: string) {
      const s = data.satisfaction_score;
      if (s !== undefined && s !== null && !(Number.isInteger(s) && s >= 1 && s <= 5)) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { satisfaction_score: 'Satisfaction is a whole number from 1 to 5.' });
      }
      if (selfId && data.parent_ticket_id === selfId) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { parent_ticket_id: 'A ticket cannot be its own parent.' });
      }
      const email = data.requester_email;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { requester_email: 'Enter a full email address.' });
      }
    }

    const needsCode = (req: FastifyRequest | null, cat: StatusCategory, code: unknown) => {
      if (req && cat === 'resolved' && !code && !isDataLoad(req)) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { resolution_code: 'Choose a resolution code to resolve the ticket.' });
      }
    };

    /**
     * Closing needs a resolution code just as resolving does. A status that ends a ticket without
     * resolving it (the built-in "cancelled", or any status with meta.resolution_code = false) is exempt.
     */
    const needsCodeToClose = async (req: FastifyRequest | null, status: unknown, code: unknown) => {
      if (!req || code || isDataLoad(req)) return; // historical tickets may have no resolution code (E18-70)
      const meta = (await ctx.lookups.values('ticket_status')).find((s) => s.value === status)?.meta;
      if (categoryOf(meta) !== 'closed' || status === 'cancelled' || meta?.resolution_code === false) return;
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { resolution_code: 'Choose a resolution code to close the ticket.' });
    };

    /**
     * E18-74: whether reaching this status answers the requester (meets the Respond target). Being
     * logged, or assigned, is not an answer: the built-in "new" and "assigned" do not count; every other
     * status does (in progress, waiting, resolved, closed). A status's meta.counts_as_response ("yes" or
     * "no", or true or false; Administration > Lists) overrides this. A public comment by anyone but the
     * requester also counts (below).
     */
    const NOT_A_RESPONSE = new Set(['new', 'assigned']);
    async function countsAsResponse(status: unknown): Promise<boolean> {
      const meta = (await ctx.lookups.values('ticket_status')).find((s) => s.value === status)?.meta;
      const set = meta?.counts_as_response;
      if (set === true || set === 'yes') return true;
      if (set === false || set === 'no') return false;
      return !NOT_A_RESPONSE.has(String(status ?? 'new'));
    }

    // A public comment by staff (anyone but the requester) is the first response when none is recorded yet.
    app.addHook('onSend', async (req, reply, payload) => {
      if (req.method !== 'POST' || reply.statusCode !== 201 || req.url.split('?')[0] !== '/api/comments' || !req.user) return payload;
      const b = (req.body ?? {}) as Row;
      if (b.record_type !== 'ticket' || b.internal !== false || isDataLoad(req)) return payload;
      try {
        const now = clock.now().toISOString();
        const met = await db.one<Row>(
          `update tickets set first_responded_at = $2::timestamptz,
                  response_breached = response_breached or coalesce(response_due_at < $2::timestamptz, false)
            where id::text = $1 and deleted_at is null and first_responded_at is null
              and (requester_id is null or requester_id <> $3) returning id, ref, title`,
          [String(b.record_id), now, req.user.id]);
        if (met) {
          await ctx.audit(req, {
            action: 'ticket.first_response', recordType: 'ticket', recordId: met.id,
            summary: `First response (public comment): ${met.ref} ${met.title}`, after: { first_responded_at: now },
          });
        }
      } catch (err) {
        console.error('[tickets] could not record the first response:', err);
      }
      return payload;
    });

    async function beforeCreate(req: FastifyRequest | null, data: Row): Promise<Row> {
      checkCommon(data);
      await catalog.applyToNewTicket(req, data);
      // E18-70: a data load gives the original times; due times and breaches it leaves out are worked
      // out from them (not from now), and the values it gives are kept.
      const loading = isDataLoad(req);
      const opened = ((!req || loading) && toDate(data.opened_at)) || clock.now();
      const at = opened.toISOString();
      data.opened_at = at;
      data.status ??= 'new';

      const computed = priorityFor(await sla.matrix(), data.impact, data.urgency);
      if (data.priority) data.priority_overridden = data.priority !== computed;
      else { data.priority = computed; data.priority_overridden = false; }

      const cat = await sla.category(data.status);
      needsCode(req, cat, data.resolution_code);
      await needsCodeToClose(req, data.status, data.resolution_code);
      const t = await sla.target(data.priority);
      const paused = Number(data.paused_minutes ?? 0);
      const respDue = (loading && toDate(data.response_due_at)) || (t ? addWorkingMinutes(t.cal, opened, t.respond_minutes) : null);
      const resDue = (loading && toDate(data.resolve_due_at)) || (t ? addWorkingMinutes(t.cal, opened, t.resolve_minutes + paused) : null);
      data.response_due_at = iso(respDue);
      data.resolve_due_at = iso(resDue);

      // The system (seeding, automation) may supply its own time stamps; people never can.
      if (!data.first_responded_at && await countsAsResponse(data.status)) data.first_responded_at = at;
      if (cat === 'paused') data.paused_at ??= at; else data.paused_at = null;
      if (cat === 'resolved' || cat === 'closed') data.resolved_at ??= at; else data.resolved_at = null;
      if (cat === 'closed') data.closed_at ??= iso(toDate(data.resolved_at)); else data.closed_at = null;
      const responded = toDate(data.first_responded_at);
      const resolved = toDate(data.resolved_at);
      const givenRespBreach = loading && typeof data.response_breached === 'boolean';
      const givenResBreach = loading && typeof data.resolve_breached === 'boolean';
      if (!givenRespBreach) data.response_breached = !!(responded && respDue && responded > respDue);
      if (!givenResBreach) data.resolve_breached = !!(resolved && resDue && resolved > resDue);
      if (loading) {
        // A loaded ticket still open with a target already past is recorded as missed (and warned) now,
        // so the service-level check sends no alert or warning about history (E18-70).
        const today = clock.now();
        const respPast = !responded && respDue && respDue < today;
        const resPast = !resolved && resDue && resDue < today;
        if (respPast && !givenRespBreach) data.response_breached = true;
        if (resPast && !givenResBreach) data.resolve_breached = true;
        if (respPast && typeof data.response_warned !== 'boolean') data.response_warned = true;
        if (resPast && typeof data.resolve_warned !== 'boolean') data.resolve_warned = true;
      }
      if (data.with_vendor && !data.vendor_raised_at) data.vendor_raised_at = at;
      return data;
    }

    async function beforeUpdate(req: FastifyRequest | null, existing: Row, patch: Row): Promise<Row> {
      // E18-70: in a data load the times given stand in for "now" (a resolution given is when it
      // happened), and what is given is kept over what would be worked out.
      const loading = isDataLoad(req);
      const now = (loading && (toDate(patch.closed_at) ?? toDate(patch.resolved_at) ?? toDate(patch.first_responded_at))) || clock.now();
      const at = now.toISOString();
      const m: Row = { ...existing, ...patch };
      checkCommon(patch, existing.id);
      // E15-07: the requester's own satisfaction answer is theirs; nobody changes it afterwards.
      if (req && existing.satisfaction_by_requester && !loading) {
        for (const f of ['satisfaction_score', 'satisfaction_comment']) {
          if (f in patch && (patch[f] ?? null) !== (existing[f] ?? null)) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { [f]: 'The requester gave this answer in the portal. It cannot be changed.' });
          }
        }
      }
      catalog.checkTasks(req, existing, patch);
      await catalog.checkApprovalGate(req, existing, m.status);

      // Priority follows the matrix unless someone has chosen one by hand.
      const computed = priorityFor(await sla.matrix(), m.impact, m.urgency);
      if (patch.priority && patch.priority !== existing.priority) {
        patch.priority_overridden = patch.priority !== computed;
      } else if ('impact' in patch || 'urgency' in patch || 'priority' in patch || 'priority_overridden' in patch) {
        if (patch.priority_overridden === false || !m.priority_overridden || !m.priority) {
          patch.priority = computed;
          patch.priority_overridden = false;
        }
      }
      m.priority = patch.priority ?? existing.priority;

      const prevCat = await sla.category(existing.status);
      const cat = await sla.category(m.status);
      const wasDone = prevCat === 'resolved' || prevCat === 'closed';
      const done = cat === 'resolved' || cat === 'closed';
      if (cat === 'resolved' && prevCat !== 'resolved') needsCode(req, cat, m.resolution_code);
      if (cat === 'closed' && (m.status !== existing.status || 'resolution_code' in patch)) await needsCodeToClose(req, m.status, m.resolution_code);

      const t = await sla.target(m.priority);
      const opened = (loading && toDate(patch.opened_at)) || toDate(existing.opened_at) || now;
      let pausedMinutes = Number(existing.paused_minutes ?? 0);
      let respDue = toDate(existing.response_due_at);
      let resDue = toDate(existing.resolve_due_at);
      const responded = toDate(existing.first_responded_at);
      const pausedAt = toDate(existing.paused_at);

      if (loading && 'opened_at' in patch && t) {
        // A new opening time moves the due times it is counted from, unless they are given too.
        resDue = addWorkingMinutes(t.cal, opened, t.resolve_minutes + pausedMinutes);
        if (!responded) respDue = addWorkingMinutes(t.cal, opened, t.respond_minutes + pausedMinutes);
      } else if (m.priority !== existing.priority) {
        resDue = t ? addWorkingMinutes(t.cal, opened, t.resolve_minutes + pausedMinutes) : null;
        if (!responded) respDue = t ? addWorkingMinutes(t.cal, opened, t.respond_minutes + pausedMinutes) : null;
      }

      if (loading && patch.response_due_at !== undefined) respDue = toDate(patch.response_due_at);
      if (loading && patch.resolve_due_at !== undefined) resDue = toDate(patch.resolve_due_at);

      // Resume: the time spent paused (working minutes only) is added to the due times.
      if (pausedAt && cat !== 'paused') {
        const mins = t ? workingMinutesBetween(t.cal, pausedAt, now) : 0;
        if (t && mins > 0) {
          pausedMinutes += mins;
          if (resDue) resDue = addWorkingMinutes(t.cal, resDue, mins);
          if (respDue && !responded) respDue = addWorkingMinutes(t.cal, respDue, mins);
        }
        patch.paused_at = null;
        patch.paused_minutes = pausedMinutes;
      }
      if (!pausedAt && cat === 'paused') patch.paused_at = at;

      // First response: the first move to a status that answers the requester (not "new" or
      // "assigned"), or a public comment (the hook above); assigning alone is not a response (E18-74).
      if (!responded && ((loading && patch.first_responded_at) || await countsAsResponse(m.status))) {
        patch.first_responded_at = (loading && patch.first_responded_at) || at;
        patch.response_breached = existing.response_breached || !!(respDue && now > respDue);
      }

      if (done && !existing.resolved_at) {
        patch.resolved_at = (loading && patch.resolved_at) || at;
        patch.resolve_breached = existing.resolve_breached || !!(resDue && now > resDue);
      }
      if (cat === 'closed' && !existing.closed_at) patch.closed_at = (loading && patch.closed_at) || at;
      if (cat !== 'closed' && existing.closed_at) patch.closed_at = null;
      if (!done && wasDone) patch.resolved_at = null;
      if (!done && cat !== 'paused' && resDue && now > resDue) patch.resolve_breached = true;

      patch.response_due_at = iso(respDue);
      patch.resolve_due_at = iso(resDue);
      if (m.with_vendor && !m.vendor_raised_at) patch.vendor_raised_at = at;
      return patch;
    }

    ctx.defineResource({
      type: 'ticket', table: 'tickets', module: 'tickets', label: 'Ticket', plural: 'Tickets',
      path: '/api/tickets', route: '/tickets', titleField: 'title', ref: { field: 'ref', prefix: 'TKT-' },
      searchable: ['title', 'description', 'requester_name', 'requester_email', 'vendor_ref'],
      defaultSort: { field: 'opened_at', dir: 'desc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        type: { label: 'Type', type: 'lookup', list: 'ticket_type', default: 'incident', required: true },
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        requester_name: { label: 'Requester', type: 'text' },
        requester_email: { label: 'Requester email', type: 'text' },
        requester_department: { label: 'Requester department', type: 'text' },
        requester_id: { label: 'Requester account', type: 'user' },
        affected_user: { label: 'Affected person', type: 'text' },
        affected_user_id: { label: 'Affected person account', type: 'user' },
        category: { label: 'Category', type: 'lookup', list: 'ticket_category' },
        subcategory: { label: 'Subcategory', type: 'text' },
        catalog_item_id: { label: 'Catalog item', type: 'ref', to: 'catalog_item' },
        system_id: { label: 'Affected system', type: 'ref', to: 'system' },
        asset_id: { label: 'Affected asset', type: 'ref', to: 'asset' },
        impact: { label: 'Impact', type: 'lookup', list: 'ticket_impact', default: 'individual' },
        urgency: { label: 'Urgency', type: 'lookup', list: 'ticket_urgency', default: 'medium' },
        priority: { label: 'Priority', type: 'lookup', list: 'ticket_priority' },
        priority_overridden: { label: 'Priority set by hand', type: 'boolean' },
        assignment_group: { label: 'Assignment group', type: 'lookup', list: 'assignment_group' },
        assignee_id: { label: 'Assignee', type: 'user' },
        status: { label: 'Status', type: 'lookup', list: 'ticket_status', default: 'new', required: true },
        resolution_code: { label: 'Resolution code', type: 'lookup', list: 'resolution_code', mobileEditable: true },
        resolution_notes: { label: 'Resolution notes', type: 'longtext' },
        channel: { label: 'Channel', type: 'lookup', list: 'ticket_channel', default: 'agent' },
        with_vendor: { label: 'With vendor', type: 'boolean', default: false },
        vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor' },
        vendor_ref: { label: 'Vendor reference', type: 'text' },
        vendor_raised_at: { label: 'Raised with vendor', type: 'datetime' },
        vendor_responded_at: { label: 'Vendor responded', type: 'datetime' },
        major_incident: { label: 'Major incident', type: 'boolean', default: false },
        parent_ticket_id: { label: 'Parent ticket', type: 'ref', to: 'ticket' },
        problem_id: { label: 'Problem', type: 'ref', to: 'problem' },
        post_incident_review: { label: 'Post-incident review', type: 'json' },
        satisfaction_score: { label: 'Satisfaction (1 to 5)', type: 'number' },
        satisfaction_comment: { label: 'Satisfaction comment', type: 'longtext' },
        satisfaction_by_requester: { label: 'Satisfaction given by the requester', type: 'boolean', readOnly: true },
        satisfaction_at: { label: 'Satisfaction given', type: 'datetime', readOnly: true },
        reopened_count: { label: 'Reopened by the requester', type: 'number', readOnly: true },
        breach_reason: { label: 'Breach reason', type: 'longtext' },
        opened_at: { label: 'Opened', type: 'datetime', readOnly: true },
        response_due_at: { label: 'Respond by', type: 'datetime', readOnly: true },
        resolve_due_at: { label: 'Resolve by', type: 'datetime', readOnly: true },
        first_responded_at: { label: 'First response', type: 'datetime', readOnly: true },
        resolved_at: { label: 'Resolved', type: 'datetime', readOnly: true },
        closed_at: { label: 'Closed', type: 'datetime', readOnly: true },
        paused_at: { label: 'Clock paused at', type: 'datetime', readOnly: true },
        paused_minutes: { label: 'Paused (working minutes)', type: 'number', readOnly: true },
        response_breached: { label: 'Response target missed', type: 'boolean', readOnly: true },
        resolve_breached: { label: 'Resolution target missed', type: 'boolean', readOnly: true },
        // Generated column: either target missed. Used to filter the list from the dashboard tile.
        target_missed: { label: 'Any target missed', type: 'boolean', readOnly: true },
        response_warned: { label: 'Close to response target', type: 'boolean', readOnly: true },
        resolve_warned: { label: 'Close to resolution target', type: 'boolean', readOnly: true },
        escalated_at: { label: 'Escalated', type: 'datetime', readOnly: true },
        catalog_answers: { label: 'Request details', type: 'json' },
        fulfilment_tasks: { label: 'Fulfillment tasks', type: 'json' },
        approval_status: { label: 'Approval', type: 'lookup', list: 'ticket_approval', readOnly: true },
        approval_by: { label: 'Decided by', type: 'user', readOnly: true },
        approval_at: { label: 'Decided', type: 'datetime', readOnly: true },
        approval_note: { label: 'Approval note', type: 'longtext', readOnly: true },
        approvals_needed: { label: 'Approvals needed', type: 'number', readOnly: true },
        approver_ids: { label: 'Named approvers', type: 'json', readOnly: true },
      },
      hooks: { beforeCreate, beforeUpdate, afterCreate, afterUpdate },
    });

    /** Tells a new assignee (or, with nobody assigned, the members of a newly chosen group) about the ticket. */
    async function tellAssignee(req: FastifyRequest | null, before: Row | null, row: Row): Promise<void> {
      const actor = req?.user?.id ?? null;
      if (row.assignee_id && row.assignee_id !== before?.assignee_id) {
        if (row.assignee_id === actor) return;
        await notify.send({
          userIds: [row.assignee_id], ...notify.about(row), kind: 'assignment',
          title: `Ticket assigned to you: ${notify.name(row)}`,
          body: row.requester_name ? `For ${row.requester_name}${row.requester_department ? ` (${row.requester_department})` : ''}.` : null,
        });
      } else if (!row.assignee_id && row.assignment_group && row.assignment_group !== before?.assignment_group) {
        const members = ((await notify.groups())[row.assignment_group] ?? []).filter((id) => id !== actor);
        if (!members.length) return;
        const label = (await ctx.lookups.values('assignment_group')).find((g) => g.value === row.assignment_group)?.label ?? row.assignment_group;
        await notify.send({ userIds: members, ...notify.about(row), kind: 'assignment', title: `Ticket assigned to ${label}: ${notify.name(row)}` });
      }
    }
    async function afterCreate(req: FastifyRequest | null, row: Row): Promise<void> {
      // E03-22: a request waiting for approval starts its approval workflow (also when the system raised it).
      await catalog.afterCreate(req, row);
      // Seeding and other system work stays quiet.
      if (!req) return;
      await tellAssignee(req, null, row);
    }
    async function afterUpdate(req: FastifyRequest | null, before: Row, after: Row): Promise<void> {
      await catalog.afterUpdate(req, before, after);
      if (req) await tellAssignee(req, before, after);
      if (req) await tellRequester(req, before, after);
    }

    /** E15: with the portal on, the requester hears when IT need them or think the request is done. */
    async function tellRequester(req: FastifyRequest, before: Row, after: Row): Promise<void> {
      if (!after.requester_id || after.requester_id === req.user?.id || after.status === before.status) return;
      if ((await ctx.settings.get<Row>('features', { portal: false }))?.portal !== true) return;
      const cat = await sla.category(after.status);
      const title = after.status === 'waiting_requester' ? `IT need a reply from you: ${after.ref}`
        : cat === 'resolved' ? `Your request ${after.ref} is resolved` : null;
      if (!title) return;
      await notify.send({ userIds: [after.requester_id], kind: 'general', title, body: after.title, route: `/portal/requests/${after.id}` });
    }

    ctx.defineResource({
      type: 'problem', table: 'problems', module: 'tickets', label: 'Problem', plural: 'Problems',
      path: '/api/problems', route: '/problems', titleField: 'title', ref: { field: 'ref', prefix: 'PRB-' },
      searchable: ['title', 'description', 'root_cause', 'workaround'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'problem_status', default: 'open', required: true },
        root_cause: { label: 'Root cause', type: 'longtext' },
        workaround: { label: 'Workaround', type: 'longtext' },
        known_error: { label: 'Known error', type: 'boolean', default: false },
        owner_id: { label: 'Owner', type: 'user' },
        knowledge_article_id: { label: 'Knowledge article', type: 'ref', to: 'knowledge_article', readOnly: true },
      },
    });

    ctx.defineResource({
      type: 'knowledge_article', table: 'knowledge_articles', module: 'knowledge', label: 'Knowledge article', plural: 'Knowledge articles',
      path: '/api/knowledge', route: '/knowledge', titleField: 'title', ref: { field: 'ref', prefix: 'KB-' },
      searchable: ['title', 'body'],
      // "IT agents only" articles (audience.ts): part of the visibility rule, whatever the route.
      rowRule: audienceRule,
      defaultSort: { field: 'updated_at', dir: 'desc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        body: { label: 'Article', type: 'longtext' },
        category: { label: 'Category', type: 'lookup', list: 'kb_category' },
        audience: { label: 'Audience', type: 'lookup', list: 'kb_audience', default: 'agents', required: true },
        status: { label: 'Status', type: 'lookup', list: 'kb_status', default: 'draft', required: true },
        owner_id: { label: 'Owner', type: 'user' },
        review_on: { label: 'Review on', type: 'date' },
        version: { label: 'Version', type: 'number', readOnly: true },
        helpful_yes: { label: 'Found helpful', type: 'number', readOnly: true },
        helpful_no: { label: 'Not helpful', type: 'number', readOnly: true },
      },
      hooks: {
        beforeCreate: async (req, data) => {
          await checkAudience(req, data);
          return { ...data, version: 1, helpful_yes: 0, helpful_no: 0 };
        },
        // A change to the body makes a new version; the text it replaces is kept.
        beforeUpdate: async (req, existing, patch) => {
          await checkAudience(req, patch);
          if ('body' in patch && (patch.body ?? '') !== (existing.body ?? '')) {
            await db.query(
              `insert into knowledge_article_versions (article_id, version, title, body, saved_at, saved_by, saved_by_name)
               values ($1,$2,$3,$4,$5,$6,$7) on conflict (article_id, version) do nothing`,
              [existing.id, existing.version, existing.title, existing.body, existing.updated_at,
                existing.updated_by, existing.updated_by ? (await db.one<Row>('select display_name from users where id = $1', [existing.updated_by]))?.display_name ?? null : 'System'],
            );
            patch.version = Number(existing.version ?? 1) + 1;
          }
          return patch;
        },
      },
    });

    ctx.defineResource({
      type: 'catalog_item', table: 'catalog_items', module: 'tickets', label: 'Catalog item', plural: 'Catalog items',
      path: '/api/catalog-items', route: '/catalog', titleField: 'name',
      searchable: ['name', 'description'],
      defaultSort: { field: 'name', dir: 'asc' },
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        category: { label: 'Category', type: 'lookup', list: 'catalog_category' },
        active: { label: 'Active', type: 'boolean', default: true },
        defaults: { label: 'Values for the request it creates', type: 'json' },
        questions: { label: 'Questions', type: 'json' },
        tasks: { label: 'Fulfillment tasks', type: 'json' },
        requires_approval: { label: 'Needs approval before work starts', type: 'boolean', default: false },
        portal: { label: 'Show in the self-service portal', type: 'boolean', default: false },
        // E03-22: who approves is the item's approval workflow; null = the catalog request approval workflow that fits best.
        approval_workflow_id: { label: 'Approval workflow', type: 'text' },
        // Before approval workflows (E03-21): kept for history, turned into workflows when approvals moved.
        approvals_needed: { label: 'Approvals needed (before workflows)', type: 'number', default: 1 },
        approver_ids: { label: 'Who may approve (before workflows)', type: 'json' },
        approval_condition: { label: 'Approval only for these answers', type: 'json' },
      },
      hooks: {
        beforeCreate: (_req, data) => catalog.checkWorkflow(data),
        beforeUpdate: (_req, existing, patch) => catalog.checkWorkflow(patch, existing),
      },
    });

    /** Only an agent may mark an article "agents only": anyone else would lose sight of it at once. */
    async function checkAudience(req: FastifyRequest | null, data: Row): Promise<void> {
      if (req && data.audience === AGENT_AUDIENCE && !(await audience.isAgent(req.user))) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { audience: 'Only IT agents can write articles for IT agents only.' });
      }
    }
    catalog.register();
    registerAutomation(ctx, notify);
    registerAssist(ctx, audience.isAgent);
    registerRequesters(ctx);
    registerSharedFiles(ctx, notify);
    await seedSharedQueues(ctx);
    const intake = makeEmailIntake(ctx, notify);
    intake.register();
    await intake.start();

    // Starter catalog, added once; administrators own it afterwards.
    if (!(await ctx.settings.get('tickets.catalogue_seeded', false))) {
      if (!(await db.one('select 1 from catalog_items limit 1'))) {
        for (const item of CATALOG) await ctx.resources.create('catalog_item', { ...item, active: true });
      }
      await ctx.settings.set('tickets.catalogue_seeded', true);
    }

    // ---------- SLA clock for one ticket ----------

    app.get('/api/tickets/:id/sla', view, async (req) => {
      const row = (await ctx.resources.find('ticket', (req.params as any).id, req.user)) ?? ctx.fail(404, 'not_found', 'Ticket not found.');
      const now = clock.now();
      const t = await sla.target(row.priority);
      const cat = await sla.category(row.status);
      const pausedAt = toDate(row.paused_at);
      return {
        now: now.toISOString(),
        priority: row.priority,
        status: row.status,
        status_category: cat,
        paused: !!pausedAt,
        paused_at: iso(pausedAt),
        paused_minutes: Number(row.paused_minutes ?? 0),
        policy: t && {
          respond_minutes: t.respond_minutes, resolve_minutes: t.resolve_minutes,
          calendar: { id: t.calendar_id, key: t.calendar_key, name: t.calendar_name, timezone: t.cal.timezone },
        },
        response: clockView(t?.cal ?? null, {
          dueAt: toDate(row.response_due_at), metAt: toDate(row.first_responded_at), breached: !!row.response_breached, pausedAt,
        }, now),
        resolve: clockView(t?.cal ?? null, {
          dueAt: toDate(row.resolve_due_at), metAt: toDate(row.resolved_at), breached: !!row.resolve_breached, pausedAt,
        }, now),
        breach_reason: row.breach_reason ?? null,
      };
    });

    // ---------- priority matrix ----------

    app.get('/api/tickets/priority-matrix', view, async () => sla.matrix());

    /** When a ticket logged now with this priority would fall due: shown while a ticket is being written. */
    app.get('/api/tickets/sla/preview', view, async (req) => {
      const t = await sla.target((req.query as Row).priority);
      if (!t) return { policy: null, response_due_at: null, resolve_due_at: null };
      const now = clock.now();
      return {
        policy: { respond_minutes: t.respond_minutes, resolve_minutes: t.resolve_minutes, calendar_name: t.calendar_name },
        response_due_at: addWorkingMinutes(t.cal, now, t.respond_minutes).toISOString(),
        resolve_due_at: addWorkingMinutes(t.cal, now, t.resolve_minutes).toISOString(),
      };
    });

    app.put('/api/tickets/priority-matrix', administer, async (req) => {
      const b = (req.body ?? {}) as Row;
      const priorities = new Set((await ctx.lookups.values('ticket_priority')).map((p) => p.value));
      const bad = (v: unknown) => typeof v !== 'string' || !priorities.has(v);
      if (bad(b.default) || !b.cells || typeof b.cells !== 'object' || Array.isArray(b.cells)) {
        ctx.fail(400, 'validation', 'The matrix needs a default priority and a set of cells.', { default: 'Choose a default priority.' });
      }
      const cells: PriorityMatrix['cells'] = {};
      for (const [impact, row] of Object.entries(b.cells as Record<string, unknown>)) {
        if (!row || typeof row !== 'object') ctx.fail(400, 'validation', `The row for impact "${impact}" is not valid.`);
        cells[impact] = {};
        for (const [urgency, p] of Object.entries(row as Record<string, unknown>)) {
          if (bad(p)) ctx.fail(400, 'validation', `"${p}" is not a priority (impact ${impact}, urgency ${urgency}).`);
          cells[impact][urgency] = p as string;
        }
      }
      const value: PriorityMatrix = { default: b.default, cells };
      await ctx.settings.set('tickets.priority_matrix', value, req);
      return value;
    });

    // ---------- SLA policies, calendars and holidays ----------

    const calendars = async () => {
      const rows = await db.query<Row>('select id, key, name, timezone, always_open, hours from calendars where deleted_at is null order by name');
      const days = await db.query<Row>('select id, calendar_id, day, name from calendar_holidays order by day');
      return rows.map((c) => ({ ...c, holidays: days.filter((d) => d.calendar_id === c.id).map(({ calendar_id: _c, ...d }) => d) }));
    };
    const policies = () => db.query<Row>(
      `select p.id, p.priority, p.respond_minutes, p.resolve_minutes, p.calendar_id, c.name as calendar_name
       from sla_policies p join calendars c on c.id = p.calendar_id where p.deleted_at is null order by p.priority`);

    app.get('/api/tickets/sla/policies', view, async () => policies());

    app.put('/api/tickets/sla/policies/:priority', administer, async (req) => {
      const priority = String((req.params as any).priority);
      const b = (req.body ?? {}) as Row;
      const fields: Record<string, string> = {};
      if (!(await ctx.lookups.values('ticket_priority')).some((p) => p.value === priority)) ctx.fail(404, 'not_found', 'Priority not found.');
      const respond = Number(b.respond_minutes);
      const resolve = Number(b.resolve_minutes);
      if (!Number.isInteger(respond) || respond <= 0) fields.respond_minutes = 'Enter a whole number of minutes above zero.';
      if (!Number.isInteger(resolve) || resolve <= 0) fields.resolve_minutes = 'Enter a whole number of minutes above zero.';
      if (!UUID.test(String(b.calendar_id ?? '')) || !(await db.one('select 1 from calendars where id = $1 and deleted_at is null', [b.calendar_id]))) {
        fields.calendar_id = 'Choose a calendar.';
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const before = await db.one<Row>('select priority, respond_minutes, resolve_minutes, calendar_id from sla_policies where priority = $1', [priority]);
      const row = await db.one<Row>(
        `insert into sla_policies (priority, respond_minutes, resolve_minutes, calendar_id, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$5)
         on conflict (priority) do update set respond_minutes = excluded.respond_minutes, resolve_minutes = excluded.resolve_minutes,
           calendar_id = excluded.calendar_id, updated_at = now(), updated_by = excluded.updated_by, deleted_at = null
         returning id, priority, respond_minutes, resolve_minutes, calendar_id`,
        [priority, respond, resolve, b.calendar_id, req.user!.id]);
      await ctx.audit(req, {
        action: 'sla_policy.update', recordType: 'sla_policy', recordId: row!.id,
        summary: `Service-level targets changed for ${priority}`, before, after: row,
      });
      return row;
    });

    app.get('/api/tickets/sla/calendars', view, async () => calendars());

    app.put('/api/tickets/sla/calendars/:id', administer, async (req) => {
      const id = String((req.params as any).id);
      const before = UUID.test(id) ? await db.one<Row>('select id, name, timezone, always_open, hours from calendars where id = $1 and deleted_at is null', [id]) : undefined;
      if (!before) ctx.fail(404, 'not_found', 'Calendar not found.');
      const b = (req.body ?? {}) as Row;
      const fields: Record<string, string> = {};
      const name = String(b.name ?? before!.name).trim();
      const timezone = String(b.timezone ?? before!.timezone).trim();
      if (!name) fields.name = 'Name is required.';
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { fields.timezone = 'That is not a known time zone (for example Europe/London).'; }
      const hours: Row = {};
      const given = (b.hours ?? before!.hours ?? {}) as Row;
      for (const day of DAY_KEYS) {
        const h = given[day];
        if (!h) { hours[day] = null; continue; }
        const ok = Array.isArray(h) && h.length === 2 && h.every((x) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(x)) || x === '24:00');
        const mins = (x: string) => Number(x.split(':')[0]) * 60 + Number(x.split(':')[1]);
        if (!ok || mins(h[1]) <= mins(h[0])) fields.hours = 'Give each working day an opening and a later closing time as HH:MM.';
        else hours[day] = [h[0], h[1]];
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const row = await db.one<Row>(
        `update calendars set name = $2, timezone = $3, always_open = $4, hours = $5::jsonb, updated_at = now(), updated_by = $6
         where id = $1 returning id, name, timezone, always_open, hours`,
        [id, name, timezone, b.always_open === undefined ? before!.always_open : b.always_open === true, JSON.stringify(hours), req.user!.id]);
      await ctx.audit(req, { action: 'calendar.update', recordType: 'calendar', recordId: id, summary: `Calendar changed: ${name}`, before, after: row });
      return row;
    });

    // E03-17: add a calendar (for example an out-of-hours rota) and retire one nothing uses.
    app.post('/api/tickets/sla/calendars', administer, async (req, reply) => {
      const b = (req.body ?? {}) as Row;
      const fields: Record<string, string> = {};
      const name = String(b.name ?? '').trim();
      const timezone = String(b.timezone ?? '').trim() || (await db.one<Row>(`select timezone from calendars where deleted_at is null order by created_at limit 1`))?.timezone || 'UTC';
      if (!name) fields.name = 'Name is required.';
      else if (await db.one('select 1 from calendars where lower(name) = lower($1) and deleted_at is null', [name])) fields.name = 'A calendar with this name already exists.';
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { fields.timezone = 'That is not a known time zone (for example Europe/London).'; }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const alwaysOpen = b.always_open === true;
      const weekday = ['08:00', '17:00'];
      const hours = alwaysOpen ? {} : { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: null, sun: null };
      const key = `cal_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
      const row = (await db.one<Row>(
        `insert into calendars (key, name, timezone, always_open, hours, created_by, updated_by) values ($1,$2,$3,$4,$5::jsonb,$6,$6)
         returning id, key, name, timezone, always_open, hours`,
        [key, name, timezone, alwaysOpen, JSON.stringify(hours), req.user!.id]))!;
      await ctx.audit(req, { action: 'calendar.create', recordType: 'calendar', recordId: row.id, summary: `Calendar added: ${name}`, after: row });
      reply.code(201);
      return { ...row, holidays: [] };
    });

    app.delete('/api/tickets/sla/calendars/:id', administer, async (req) => {
      const id = String((req.params as any).id);
      const before = UUID.test(id) ? await db.one<Row>('select id, name, timezone, always_open, hours from calendars where id = $1 and deleted_at is null', [id]) : undefined;
      if (!before) ctx.fail(404, 'not_found', 'Calendar not found.');
      const used = await db.query<Row>('select priority from sla_policies where calendar_id = $1 and deleted_at is null order by priority', [id]);
      if (used.length) {
        const labels = await ctx.lookups.values('ticket_priority');
        const names = used.map((u) => labels.find((l) => l.value === u.priority)?.label ?? u.priority).join(', ');
        ctx.fail(409, 'in_use', `This calendar is used by the targets for ${names}. Choose another calendar for them first.`);
      }
      await db.query('update calendars set deleted_at = now(), updated_by = $2 where id = $1', [id, req.user!.id]);
      await ctx.audit(req, { action: 'calendar.retire', recordType: 'calendar', recordId: id, summary: `Calendar retired: ${before!.name}`, before });
      return { ok: true };
    });

    app.post('/api/tickets/sla/calendars/:id/holidays', administer, async (req, reply) => {
      const id = String((req.params as any).id);
      const b = (req.body ?? {}) as Row;
      if (!UUID.test(id) || !(await db.one('select 1 from calendars where id = $1 and deleted_at is null', [id]))) ctx.fail(404, 'not_found', 'Calendar not found.');
      const day = String(b.day ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { day: 'Choose a date.' });
      }
      const row = await db.one<Row>(
        `insert into calendar_holidays (calendar_id, day, name, created_by) values ($1,$2,$3,$4)
         on conflict (calendar_id, day) do update set name = excluded.name returning id, calendar_id, day, name`,
        [id, day, String(b.name ?? '').trim(), req.user!.id]);
      await ctx.audit(req, { action: 'calendar.holiday_add', recordType: 'calendar', recordId: id, summary: `Holiday added: ${day} ${row!.name}`.trim(), after: row });
      reply.code(201);
      return row;
    });

    app.delete('/api/tickets/sla/holidays/:id', administer, async (req) => {
      const id = String((req.params as any).id);
      const row = UUID.test(id) ? await db.one<Row>('delete from calendar_holidays where id = $1 returning id, calendar_id, day, name', [id]) : undefined;
      if (!row) ctx.fail(404, 'not_found', 'Holiday not found.');
      await ctx.audit(req, { action: 'calendar.holiday_remove', recordType: 'calendar', recordId: row!.calendar_id, summary: `Holiday removed: ${row!.day}`, before: row });
      return { ok: true };
    });

    // ---------- problems: publish a known error ----------

    app.post('/api/problems/:id/publish-known-error', { preHandler: ctx.requirePerm('tickets.edit') }, async (req, reply) => {
      if (!ctx.can(req.user, 'knowledge.create')) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
      const p = (await ctx.resources.find('problem', (req.params as any).id, req.user)) ?? ctx.fail(404, 'not_found', 'Problem not found.');
      if (p.knowledge_article_id && (await ctx.resources.find('knowledge_article', p.knowledge_article_id, req.user))) {
        ctx.fail(409, 'already_published', 'This problem already has a knowledge article.');
      }
      const body = [
        `Known error recorded from problem ${p.ref}.`,
        p.description ? `What happens\n${p.description}` : '',
        p.root_cause ? `Root cause\n${p.root_cause}` : '',
        p.workaround ? `Workaround\n${p.workaround}` : 'Workaround\nNone recorded yet.',
      ].filter(Boolean).join('\n\n');
      const article = await ctx.resources.create('knowledge_article', {
        title: `Known error: ${p.title}`, body, category: 'known_error', audience: 'agents', status: 'draft', owner_id: p.owner_id ?? req.user!.id,
      }, req);
      // knowledge_article_id is read-only to people, so this part is written as the system.
      await ctx.resources.update('problem', p.id, { knowledge_article_id: article.id, known_error: true });
      await ctx.audit(req, {
        action: 'problem.publish_known_error', recordType: 'problem', recordId: p.id,
        summary: `Known error drafted in the knowledge base as ${article.ref}`,
      });
      reply.code(201);
      return article;
    });

    // ---------- knowledge: versions and feedback ----------

    const kbView = { preHandler: ctx.requirePerm('knowledge.view') };

    app.get('/api/knowledge/:id/versions', kbView, async (req) => {
      const a = (await ctx.resources.find('knowledge_article', (req.params as any).id, req.user)) ?? ctx.fail(404, 'not_found', 'Article not found.');
      const older = await db.query<Row>(
        'select version, title, body, saved_at, saved_by_name from knowledge_article_versions where article_id = $1 order by version desc', [a.id]);
      const by = a.updated_by ? (await db.one<Row>('select display_name from users where id = $1', [a.updated_by]))?.display_name ?? null : 'System';
      return [{ version: a.version, title: a.title, body: a.body, saved_at: a.updated_at, saved_by_name: by, current: true }, ...older.map((v) => ({ ...v, current: false }))];
    });

    app.post('/api/knowledge/:id/feedback', kbView, async (req) => {
      const a = (await ctx.resources.find('knowledge_article', (req.params as any).id, req.user)) ?? ctx.fail(404, 'not_found', 'Article not found.');
      return recordArticleFeedback(ctx, req, a, (req.body as Row | undefined)?.helpful);
    });

    registerMetrics(ctx);
  },

  async seed(ctx, opts) {
    // Invented samples only: a pilot installation starts with no pretend tickets (E18-69).
    if (opts.profile !== 'dev') return 'nothing to load (sample tickets are dev profile only)';
    const sla = makeSla(ctx);
    const summary = await seedSamples(ctx, sla);
    // Generated sample data also shows escalation at work: one invented rule, added once.
    if (await ctx.db.one('select 1 from escalation_rules limit 1')) return summary;
    await ctx.db.query(
      `insert into escalation_rules (name, condition, wait_minutes, to_group) values ('[Sample] Unassigned for four working hours', 'unassigned', 240, 'service_desk')`);
    await sla.sweep();
    return `${summary}, 1 sample escalation rule`;
  },
};

export default mod;
