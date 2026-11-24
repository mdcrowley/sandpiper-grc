import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { isEnabled as portalOn, readSettings as portalSettings } from '../portal/settings.ts';
import { keepReporterApart, reporterOf } from './confidential.ts';
import { peopleCounts } from './event-detail.ts';
import type { Reporting } from './reporting.ts';

/**
 * Safety events: what happened, where (site, vehicle, service), how serious, what was done at
 * once, and the investigation (root cause, findings, corrective actions in the action
 * tracker). Events that hold personal information are restricted. Links to hazards.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE_ACTION = ['done', 'cancelled'];

/** Open corrective actions of one event (actions are kept by the risks module). */
export async function openActions(ctx: ModuleContext, eventId: string): Promise<number> {
  if (!ctx.resources.get('action')) return 0;
  const r = await ctx.db.one<{ c: number }>(
    `select count(*)::int c from actions where deleted_at is null and source_type = 'safety_event' and source_id::text = $1
       and not (coalesce(status, '') = any($2::text[]))`, [eventId, DONE_ACTION]);
  return r?.c ?? 0;
}

export function registerEvents(ctx: ModuleContext, reporting: Reporting) {
  const { app, db } = ctx;
  /** The reporter of a confidential report entered by someone else, between the checks and the save (E41-05). */
  const apart = new WeakMap<FastifyRequest, string | null>();
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const metaOf = async (list: string, value: unknown) => (await ctx.lookups.values(list)).find((v) => v.value === value)?.meta ?? {};

  async function announce(req: FastifyRequest | null, row: Row) {
    if (!app.hasDecorator('notify')) return;
    const sev = (await ctx.lookups.values('safety_event_severity')).find((v) => v.value === row.severity);
    await app.notify({
      permission: 'safety.view', userIds: [row.investigator_id], kind: 'safety',
      title: `${sev?.label ?? 'Serious'} safety event: ${row.ref} ${row.title}`,
      body: row.confidential_reporter ? 'The reporter asked for their identity to be kept confidential.' : req?.user ? `Reported by ${req.user.displayName}.` : null,
      recordType: 'safety_event', recordId: row.id,
    });
  }

  /**
   * Tells the reporter, in plain words, what was done about their report when it closes (E41-05). A
   * confidential reporter's notification names neither the event nor what it was about; they read
   * the words in the portal's "My safety reports" (or in the notification when the portal is off).
   */
  async function tellReporter(req: FastifyRequest | null, row: Row) {
    const userId = await reporterOf(db, row);
    if (!userId || !app.hasDecorator('notify')) return;
    const outcome = String(row.reporter_outcome ?? '').trim();
    const portal = (await portalOn(ctx)) && (await portalSettings(ctx)).safety_reports;
    const confidential = row.confidential_reporter === true;
    await app.notify({
      userIds: [userId], kind: 'general',
      title: confidential ? 'A safety report you made has been closed' : `Your safety report ${row.ref} is closed`,
      body: confidential && portal ? 'Read what was done under My safety reports in the portal.' : outcome || 'The safety team has finished looking into it.',
      route: portal ? '/portal/safety' : confidential ? '/notifications' : `/safety/events/${row.id}`,
      // A confidential reporter is told in the application only: an email would put their name and
      // address in the outgoing message log at the moment the event closed (wave 23 A6).
      inAppOnly: confidential,
    });
    await ctx.audit(req, { action: 'safety_event.reporter_told', recordType: 'safety_event', recordId: row.id, summary: 'Reporter told what was done about their report' });
  }

  async function check(req: FastifyRequest | null, merged: Row, patch: Row, existing: Row | null): Promise<Row> {
    // Confidential reporting (E41-05): the event never holds a confidential reporter.
    if (!existing && patch.confidential_reporter === true) {
      const reporter = typeof patch.reported_by_id === 'string' ? patch.reported_by_id : null;
      if (reporter && req?.user && reporter === req.user.id) {
        invalid({ confidential_reporter: 'Your name is recorded as the person who entered this event, so it cannot be kept confidential here. Use "Report a safety concern" in the portal instead.' });
      }
      if (req) apart.set(req, reporter);
      patch.reported_by_id = null;
    }
    if (existing) {
      if ('confidential_reporter' in patch && Boolean(patch.confidential_reporter) !== Boolean(existing.confidential_reporter)) {
        invalid({ confidential_reporter: 'Whether the reporter stays confidential is chosen when the report is made.' });
      }
      if (existing.confidential_reporter && patch.reported_by_id) {
        invalid({ reported_by_id: 'The reporter of this event asked to stay confidential, so their name is kept apart from the event.' });
      }
    }
    if (patch.occurred_at !== undefined && patch.occurred_at !== null) {
      const at = Date.parse(String(patch.occurred_at));
      if (Number.isNaN(at)) invalid({ occurred_at: 'Enter the date and time.' });
      if (at > Date.now() + 5 * 60_000) invalid({ occurred_at: 'The event cannot be in the future.' });
    }
    const errors: Record<string, string> = {};
    for (const k of ['injuries', 'fatalities', 'people_transported']) {
      if (patch[k] !== undefined && patch[k] !== null && (!Number.isInteger(Number(patch[k])) || Number(patch[k]) < 0)) errors[k] = 'Enter a whole number, zero or more.';
    }
    if (patch.damage_estimate !== undefined && patch.damage_estimate !== null && !(Number(patch.damage_estimate) >= 0)) errors.damage_estimate = 'Enter an amount, zero or more.';
    for (const [k, lim] of [['latitude', 90], ['longitude', 180]] as const) {
      const v = patch[k];
      if (v !== undefined && v !== null && !(Math.abs(Number(v)) <= lim)) errors[k] = `Enter a number from -${lim} to ${lim}.`;
    }
    const blank = (v: unknown) => v === null || v === undefined;
    if (('latitude' in patch || 'longitude' in patch) && blank(merged.latitude) !== blank(merged.longitude)) {
      errors[blank(merged.latitude) ? 'latitude' : 'longitude'] ??= 'Give both latitude and longitude, or neither.';
    }
    if (patch.contributing_factors !== undefined && patch.contributing_factors !== null) {
      const known = (await ctx.lookups.values('safety_contributing_factor')).map((v) => v.value);
      if (!Array.isArray(patch.contributing_factors)) errors.contributing_factors = 'Give a list.';
      else {
        const given = [...new Set((patch.contributing_factors as unknown[]).map(String))];
        const bad = given.filter((x) => !known.includes(x));
        if (bad.length) errors.contributing_factors = `Not known: ${bad.join(', ')}.`;
        else patch.contributing_factors = given;
      }
    }
    if (Object.keys(errors).length) invalid(errors);
    // With people involved recorded, the counts follow them (E25-02).
    if (existing) {
      const counts = await peopleCounts(ctx, existing.id);
      if (counts.people > 0) { patch.fatalities = counts.fatalities; patch.people_transported = counts.transported; }
    }
    // Types that usually hold personal information start restricted unless the reporter says otherwise.
    if (!existing && (patch.restricted === undefined || patch.restricted === null)) {
      patch.restricted = (await metaOf('safety_event_type', merged.event_type)).restrict === true;
    }
    const closing = (await metaOf('safety_event_status', merged.status)).final === true;
    const wasClosed = existing ? (await metaOf('safety_event_status', existing.status)).final === true : false;
    if (closing && !wasClosed) {
      if (!String(merged.root_cause ?? '').trim()) invalid({ root_cause: 'Record the root cause before closing the event.' });
      // The reporter is told what was done (E41-05): a person closing it writes the words.
      const hasReporter = merged.confidential_reporter === true || Boolean(merged.reported_by_id);
      if (hasReporter && req?.user && !String(merged.reporter_outcome ?? '').trim()) {
        invalid({ reporter_outcome: 'Say in plain words what was done about the report: the reporter is told when the event closes.' });
      }
      const who = !hasReporter ? null
        : existing ? await reporterOf(db, merged)
        : merged.confidential_reporter === true ? (req ? apart.get(req) ?? null : null) : (merged.reported_by_id as string);
      if (who) patch.reporter_told_at = new Date().toISOString();
      const open = existing ? await openActions(ctx, existing.id) : 0;
      if (open > 0) ctx.fail(409, 'actions_open', `${open} corrective action(s) are still open. Finish or cancel them before closing the event.`);
      if (!merged.closed_on) patch.closed_on = dayInZone();
    }
    if (!closing && wasClosed) patch.closed_on = null;
    return patch;
  }

  ctx.defineResource({
    type: 'safety_event', table: 'safety_events', module: 'safety', label: 'Safety event', plural: 'Safety events',
    path: '/api/safety-events', route: '/safety/events', titleField: 'title',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { site: 'site_id' },
    ref: { field: 'ref', prefix: 'SE-' },
    restricted: 'flag',
    searchable: ['title', 'description', 'location_detail', 'root_cause', 'findings'],
    defaultSort: { field: 'occurred_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      occurred_at: { label: 'Date and time', type: 'datetime', required: true },
      event_type: { label: 'Type', type: 'lookup', list: 'safety_event_type', required: true },
      severity: { label: 'Severity', type: 'lookup', list: 'safety_event_severity', required: true },
      status: { label: 'Status', type: 'lookup', list: 'safety_event_status', default: 'reported' },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      vehicle_id: { label: 'Vehicle', type: 'ref', to: 'vehicle' },
      service_id: { label: 'Route or service', type: 'ref', to: 'service' },
      location_detail: { label: 'Location', type: 'text' },
      description: { label: 'What happened', type: 'longtext' },
      immediate_actions: { label: 'Immediate actions', type: 'longtext', mobileEditable: true },
      injuries: { label: 'People injured', type: 'number' },
      fatalities: { label: 'Fatalities', type: 'number' },
      people_transported: { label: 'People taken for medical treatment', type: 'number' },
      damage_estimate: { label: 'Estimated damage', type: 'currency' },
      evacuation: { label: 'Vehicle or station evacuated', type: 'boolean' },
      weather: { label: 'Weather', type: 'lookup', list: 'safety_weather' },
      lighting: { label: 'Lighting', type: 'lookup', list: 'safety_lighting' },
      surface: { label: 'Road or track surface', type: 'lookup', list: 'safety_surface' },
      latitude: { label: 'Latitude', type: 'number' },
      longitude: { label: 'Longitude', type: 'number' },
      contributing_factors: { label: 'Contributing factors', type: 'json', default: [] },
      post_event_testing_required: { label: 'Post-event testing required', type: 'boolean' },
      reportable: { label: 'Reportable', type: 'boolean', readOnly: true },
      reportable_reasons: { label: 'Reporting rules that apply', type: 'json', readOnly: true },
      reported_by_id: { label: 'Reported by', type: 'user' },
      investigator_id: { label: 'Investigator', type: 'user' },
      investigation_due: { label: 'Investigation due', type: 'date' },
      root_cause: { label: 'Root cause', type: 'longtext' },
      root_cause_category: { label: 'Root cause category', type: 'lookup', list: 'root_cause_category' },
      findings: { label: 'Findings', type: 'longtext' },
      closed_on: { label: 'Closed on', type: 'date', readOnly: true },
      // No default here: an event type may start it restricted (see check); the column defaults to false.
      restricted: { label: 'Restricted (holds personal information)', type: 'boolean' },
      notes: { label: 'Notes', type: 'longtext' },
      // E41-05: the reporter's identity is kept apart from the event (confidential.ts).
      confidential_reporter: { label: 'Reporter asked to stay confidential', type: 'boolean', default: false },
      reporter_outcome: { label: 'What the reporter is told', type: 'longtext' },
      reporter_told_at: { label: 'Reporter told', type: 'datetime', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => check(req, data, data, null),
      beforeUpdate: (req, existing, patch) => check(req, { ...existing, ...patch }, patch, existing),
      afterCreate: async (req, row) => {
        if (row.confidential_reporter && req && apart.has(req)) {
          await keepReporterApart(db, row.id, apart.get(req) ?? null);
          apart.delete(req);
        }
        if ((await metaOf('safety_event_status', row.status)).final === true) await tellReporter(req, row);
        if ((await metaOf('safety_event_severity', row.severity)).notify === true) await announce(req, row);
        // Reportability is worked out on every save (E25-05).
        await reporting.evaluate(req, row);
      },
      afterUpdate: async (req, before, after) => {
        await reporting.evaluate(req, after);
        if ((await metaOf('safety_event_status', after.status)).final === true && (await metaOf('safety_event_status', before.status)).final !== true) {
          await tellReporter(req, after);
        }
        if (before.severity === after.severity) return;
        const was = (await metaOf('safety_event_severity', before.severity)).notify === true;
        if (!was && (await metaOf('safety_event_severity', after.severity)).notify === true) await announce(req, after);
      },
    },
  });

  // ---------- links to hazards ----------

  const eventFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('safety_event', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Safety event not found.');

  async function hazardsOf(eventId: string): Promise<Row[]> {
    return db.query<Row>(
      `select h.id, h.ref, h.title, h.status, h.rating, h.residual_rating, l.created_at as linked_at
       from safety_event_hazards l join hazards h on h.id = l.hazard_id and h.deleted_at is null
       where l.event_id = $1 order by h.ref`, [eventId]);
  }

  app.get('/api/safety-events/:id/hazards', { preHandler: ctx.requirePerm('safety.view') }, async (req) => hazardsOf((await eventFor(req)).id));
  ctx.describeRoute({ method: 'GET', path: '/api/safety-events/:id/hazards', summary: 'Hazards linked to a safety event', permission: 'safety.view' });

  app.post('/api/safety-events/:id/hazards', { preHandler: ctx.requirePerm('safety.edit') }, async (req, reply) => {
    const event = await eventFor(req);
    const hazardId = String((req.body as Row | null)?.hazard_id ?? '');
    if (!UUID.test(hazardId)) invalid({ hazard_id: 'Choose a hazard.' });
    const hazard = (await ctx.resources.find('hazard', hazardId, req.user)) ?? invalid({ hazard_id: 'That hazard does not exist.' });
    const made = await db.one(
      'insert into safety_event_hazards (event_id, hazard_id, created_by) values ($1,$2,$3) on conflict do nothing returning event_id',
      [event.id, hazard.id, req.user!.id]);
    if (!made) ctx.fail(409, 'duplicate', 'That hazard is already linked to this event.');
    await ctx.audit(req, { action: 'safety_event.hazard_add', recordType: 'safety_event', recordId: event.id, summary: `Linked to hazard ${hazard.ref} ${hazard.title}`, after: { hazard_id: hazard.id } });
    // The hazard's history names the event only by reference: a restricted event's title stays with the event.
    await ctx.audit(req, { action: 'hazard.event_add', recordType: 'hazard', recordId: hazard.id, summary: `Safety event ${event.ref} linked`, after: { event_id: event.id } });
    reply.code(201);
    return hazardsOf(event.id);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/safety-events/:id/hazards', summary: 'Link a hazard to a safety event', permission: 'safety.edit', body: '{ hazard_id }' });

  app.delete('/api/safety-events/:id/hazards/:hazardId', { preHandler: ctx.requirePerm('safety.edit') }, async (req) => {
    const event = await eventFor(req);
    const hazardId = (req.params as { hazardId: string }).hazardId;
    const gone = UUID.test(hazardId)
      ? await db.one('delete from safety_event_hazards where event_id = $1 and hazard_id = $2 returning hazard_id', [event.id, hazardId])
      : undefined;
    if (!gone) ctx.fail(404, 'not_found', 'That hazard is not linked to this event.');
    await ctx.audit(req, { action: 'safety_event.hazard_remove', recordType: 'safety_event', recordId: event.id, summary: 'Hazard link removed', before: { hazard_id: hazardId } });
    await ctx.audit(req, { action: 'hazard.event_remove', recordType: 'hazard', recordId: hazardId, summary: `Safety event ${event.ref} no longer linked`, before: { event_id: event.id } });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/safety-events/:id/hazards/:hazardId', summary: 'Remove a hazard link', permission: 'safety.edit' });

  /** Events linked to one hazard: restricted events are left out for people without security.view. */
  app.get('/api/hazards/:id/events', { preHandler: ctx.requirePerm('safety.view') }, async (req) => {
    const hazard = (await ctx.resources.find('hazard', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Hazard not found.');
    return db.query<Row>(
      `select e.id, e.ref, e.title, e.occurred_at, e.event_type, e.severity, e.status
       from safety_event_hazards l join safety_events e on e.id = l.event_id and e.deleted_at is null
       where l.hazard_id = $1 and ${ctx.resources.visibleWhere('safety_event', req.user, 'e')}
       order by e.occurred_at desc`, [hazard.id]);
  });
  ctx.describeRoute({ method: 'GET', path: '/api/hazards/:id/events', summary: 'Safety events linked to a hazard', permission: 'safety.view' });

  /** Safety events on one vehicle or one service, for their pages. */
  for (const [kind, column] of [['vehicles', 'vehicle_id'], ['services', 'service_id']] as const) {
    app.get(`/api/${kind}/:id/safety-events`, { preHandler: ctx.requirePerm('safety.view') }, async (req) => {
      const id = (req.params as { id: string }).id;
      if (!UUID.test(id)) ctx.fail(404, 'not_found', 'Not found.');
      return db.query<Row>(
        `select id, ref, title, occurred_at, event_type, severity, status from safety_events
         where deleted_at is null and ${column} = $1 and ${ctx.resources.visibleWhere('safety_event', req.user)}
         order by occurred_at desc limit 200`, [id]);
    });
    ctx.describeRoute({ method: 'GET', path: `/api/${kind}/:id/safety-events`, summary: `Safety events on one ${kind === 'vehicles' ? 'vehicle' : 'service'}`, permission: 'safety.view' });
  }
}
