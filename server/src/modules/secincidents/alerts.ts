import type { ModuleContext, Row } from '../../core/module.ts';
import { emitWebhookEvent } from '../../core/webhooks.ts';
import { amberFraction, clockOf, duration, stamp } from './clocks.ts';
import { alertResponders } from './responders.ts';

// In-app notifications for security incidents (E09-17). Everything goes through `app.notify`
// with the incident as the record, so the notifications module itself drops every recipient
// who may not see that incident: nobody without security.view is ever told anything.

export interface NotifyInput { kind: string; title: string; body?: string | null }

/** Tells the people who can see this incident. Does nothing when the notifications module is not loaded. */
export async function notifyViewers(ctx: ModuleContext, incident: Row, input: NotifyInput): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  const notify = (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify;
  const res = await notify({
    permission: 'security.view', userIds: [incident.lead_id], kind: input.kind, title: input.title, body: input.body ?? null,
    recordType: 'security_incident', recordId: incident.id,
  });
  return res?.sent ?? 0;
}

/** Tells one person (the incident lead, say), again only if they can see the incident. */
export async function notifyPerson(ctx: ModuleContext, incident: Row, userId: unknown, input: NotifyInput): Promise<number> {
  if (!ctx.app.hasDecorator('notify') || typeof userId !== 'string') return 0;
  const notify = (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify;
  const res = await notify({
    userIds: [userId], kind: input.kind, title: input.title, body: input.body ?? null,
    recordType: 'security_incident', recordId: incident.id,
  });
  return res?.sent ?? 0;
}

export interface SweepResult { amber: number; red: number }

/**
 * Raises the amber and red alerts that are due: once each per notification task. Each alert is
 * written to the incident log, audited, and sent to the people who can see the incident.
 * `incidentId` limits the sweep to one incident (used straight after a change to it).
 */
export async function sweepClocks(
  ctx: ModuleContext,
  addLog: (incidentId: string, entry: string) => Promise<unknown>,
  incidentId?: string,
): Promise<SweepResult> {
  const now = new Date();
  const fraction = await amberFraction(ctx);
  const rows = await ctx.db.query<Row>(
    `select t.*, i.discovered_at, i.ref as incident_ref, i.title as incident_title, i.lead_id
     from notification_tasks t join security_incidents i on i.id = t.incident_id
     where t.deleted_at is null and i.deleted_at is null and t.status = 'pending' and t.due_at is not null
       and t.alerted_red_at is null and ($1::uuid is null or i.id = $1::uuid)
     order by t.due_at`,
    [incidentId ?? null],
  );
  const out: SweepResult = { amber: 0, red: 0 };
  // One alert by email and text per incident and state, however many clocks changed together (E09-25).
  const outside = new Map<string, Row>();
  for (const t of rows) {
    const clock = clockOf(t, t.discovered_at, now, fraction);
    const level = clock.state === 'red' ? 'red' : clock.state === 'amber' && !t.alerted_amber_at ? 'amber' : null;
    if (!level) continue;
    // Claim before sending (E22-42): one statement stamps the alert only if no other sweep has, so
    // two sweeps running at once (the minute job and a change to the incident) send it once, and a
    // failure further on cannot repeat it every minute.
    const claimed = await ctx.db.query(
      level === 'red'
        ? `update notification_tasks set alerted_red_at = $2, alerted_amber_at = coalesce(alerted_amber_at, $2)
           where id = $1 and alerted_red_at is null returning id`
        : `update notification_tasks set alerted_amber_at = $2
           where id = $1 and alerted_amber_at is null and alerted_red_at is null returning id`,
      [t.id, now.toISOString()],
    );
    if (!claimed.length) continue;
    const due = stamp(t.due_at);
    const kind = t.required ? 'required' : 'recommended';
    const text = level === 'red'
      ? `Alert: the deadline to notify ${t.party} has passed (${kind}; it was due ${due}).`
      : `Alert: the deadline to notify ${t.party} is close (${kind}; due ${due}, ${duration(clock.seconds_remaining)} left).`;
    await addLog(t.incident_id, text);
    await ctx.audit(null, {
      action: `notification_task.alert_${level}`, recordType: 'notification_task', recordId: t.id,
      summary: `Notification clock turned ${level}: ${t.party}`, after: { due_at: t.due_at, level },
    });
    await notifyViewers(ctx, { id: t.incident_id, lead_id: t.lead_id }, {
      kind: 'clock',
      title: level === 'red'
        ? `Overdue: notify ${t.party} (${t.incident_ref})`
        : `${duration(clock.seconds_remaining)} left to notify ${t.party} (${t.incident_ref})`,
      body: `${t.incident_title}. ${t.required ? 'Required' : 'Recommended'} notification, due ${due}.`,
    });
    // Webhooks that ask for it (E13-19); restricted, so only those that include restricted records.
    await emitWebhookEvent(ctx.app, {
      event: level === 'red' ? 'notification_clock.overdue' : 'notification_clock.warning',
      record: { type: 'notification_task', id: t.id },
      data: {
        incidentId: t.incident_id, incidentRef: t.incident_ref ?? null, party: t.party, required: Boolean(t.required),
        dueAt: new Date(t.due_at).toISOString(), ...(level === 'amber' ? { secondsRemaining: clock.seconds_remaining ?? null } : {}),
      },
    });
    outside.set(`${t.incident_id}:${level}`, { id: t.incident_id, ref: t.incident_ref, lead_id: t.lead_id, level });
    out[level] += 1;
  }
  for (const a of outside.values()) await alertResponders(ctx, a, a.level);
  return out;
}
