// E20-13: report a safety event from the self-service portal.
//
// Staff who hold the portal's Requester permissions (and no safety permission) describe what
// happened in plain words. The report becomes a safety event with status "Reported", the
// reporter recorded, and the severity as they described it; the safety team is told and triages
// it in the safety events list. The reporter follows their own reports in the portal (reference,
// date and a plain status); a report the safety team marks restricted shows them its reference only.
//
// Registered by the safety module (`registerPortalIntake(ctx)` in register()). It does nothing
// unless the portal is switched on and its "Safety reports" setting is on.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { createFromPortal } from '../portal/create.ts';
import { isEnabled, readSettings } from '../portal/settings.ts';

/** How the reporter describes the harm, and the severity each answer means (when that value exists). */
export const HARM: { value: string; label: string; severity: string }[] = [
  { value: 'none', label: 'Nobody was hurt and nothing was damaged', severity: 'no_harm' },
  { value: 'minor', label: 'A minor injury or minor damage', severity: 'minor' },
  { value: 'treated', label: 'Someone needed first aid or treatment', severity: 'moderate' },
  { value: 'serious', label: 'A serious injury or major damage', severity: 'serious' },
];

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export function registerPortalIntake(ctx: ModuleContext) {
  const { app, db } = ctx;

  const need = (perm: 'portal.view' | 'portal.create') => async (req: FastifyRequest) => {
    if (!req.user) ctx.fail(401, 'unauthenticated', 'Sign in to continue.');
    if (!(await isEnabled(ctx)) || !(await readSettings(ctx)).safety_reports) ctx.fail(404, 'portal_off', 'Safety reports are not taken in the portal.');
    if (!ctx.can(req.user, perm)) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
  };

  app.get('/api/portal/safety/options', { preHandler: need('portal.create') }, async () => {
    const types = await ctx.lookups.values('safety_event_type');
    return {
      types: types.map((t) => ({ value: t.value, label: t.label })),
      harm: HARM.map(({ value, label }) => ({ value, label })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/portal/safety/options', permission: 'portal.create',
    summary: 'Choices for reporting a safety event in the portal: event types and how bad it was, in plain words',
    response: '{ types: [{ value, label }], harm: [{ value, label }] }',
  });

  app.post('/api/portal/safety-reports', { preHandler: need('portal.create') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const me = req.user!;
    const fields: Record<string, string> = {};
    const title = text(b.title, 200);
    const description = text(b.description, 8000);
    if (!title) fields.title = 'Say in a few words what happened.';
    if (!description) fields.description = 'Describe what happened.';
    const types = await ctx.lookups.values('safety_event_type');
    if (!types.some((t) => t.value === b.event_type)) fields.event_type = 'Choose what kind of event it was.';
    const harm = HARM.find((h) => h.value === b.harm);
    if (!harm) fields.harm = 'Choose how bad it was.';
    const at = b.occurred_at ? new Date(String(b.occurred_at)) : null;
    if (!at || Number.isNaN(at.getTime())) fields.occurred_at = 'Enter when it happened.';
    else if (at.getTime() > Date.now() + 5 * 60_000) fields.occurred_at = 'The event cannot be in the future.';
    const injuries = b.injuries === undefined || b.injuries === null || b.injuries === '' ? null : Number(b.injuries);
    if (injuries !== null && (!Number.isInteger(injuries) || injuries < 0 || injuries > 500)) fields.injuries = 'Enter a whole number, zero or more.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    const severities = await ctx.lookups.values('safety_event_severity');
    const severity = severities.find((s) => s.value === harm!.severity)?.value ?? severities[0]?.value;
    const where = text(b.where, 200);
    const data: Row = {
      title, description, event_type: b.event_type, severity, occurred_at: at!.toISOString(), status: 'reported',
      location_detail: where || null, immediate_actions: text(b.immediate_actions, 4000) || null,
      injuries, reported_by_id: me.id,
      notes: `Reported by ${me.displayName} in the self-service portal. The severity is as the reporter described it ("${harm!.label}"): check it when triaging.`,
    };
    // Personal details: the reporter may ask for the report to be restricted; a type that usually holds them starts restricted anyway.
    if (b.personal === true) data.restricted = true;
    const row = await createFromPortal(ctx, 'safety_event', data, req);

    // The safety team triages every portal report. A serious one is already announced by the event itself.
    const sev = severities.find((s) => s.value === row.severity);
    if (app.hasDecorator('notify') && sev?.meta?.notify !== true) {
      await app.notify({
        permission: 'safety.edit', kind: 'safety',
        title: row.restricted ? `New safety report from the portal: ${row.ref}` : `New safety report from the portal: ${row.ref} ${row.title}`,
        body: row.restricted ? null : `Reported by ${me.displayName}.`, recordType: 'safety_event', recordId: row.id,
      });
    }
    reply.code(201);
    return { id: row.id, ref: row.ref };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/portal/safety-reports', permission: 'portal.create',
    summary: 'Report a safety event from the portal (it starts as "Reported" for the safety team to triage)',
    body: '{ title, description, event_type, harm: none|minor|treated|serious, occurred_at, where?, immediate_actions?, injuries?, personal?: boolean }',
    response: '{ id, ref }',
  });

  app.get('/api/portal/safety-reports', { preHandler: need('portal.view') }, async (req) => {
    const statuses = await ctx.lookups.values('safety_event_status');
    const rows = await db.query<Row>(
      `select id, ref, title, occurred_at, created_at, status, restricted from safety_events
       where deleted_at is null and reported_by_id = $1 order by created_at desc limit 50`, [req.user!.id]);
    return {
      rows: rows.map((r) => {
        const final = statuses.find((s) => s.value === r.status)?.meta?.final === true;
        return {
          id: r.id, ref: r.ref, title: r.restricted ? `Safety report ${r.ref}` : r.title, occurred_at: r.occurred_at, reported_at: r.created_at,
          status: final
            ? { key: 'closed', label: 'Closed', tone: 'gray' }
            : r.status === 'reported' ? { key: 'received', label: 'Received', tone: 'blue' } : { key: 'looking', label: 'Being looked into', tone: 'amber' },
        };
      }),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/portal/safety-reports', permission: 'portal.view',
    summary: 'Safety events I reported, newest first, with a plain status', response: '{ rows: [{ id, ref, title, occurred_at, reported_at, status: { key, label, tone } }] }',
  });
}
