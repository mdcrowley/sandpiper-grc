import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { runHazardReviewReminders } from './hazard-reminders.ts';

/**
 * Overdue corrective actions: once a day, every open action that arose from a safety event and
 * is past its due date is reported to the event's investigator and to everyone who may edit
 * safety records (the action's owner already hears from the daily digest). The notification
 * service skips anyone who may not see the action, so restricted events stay hidden.
 */

const HOUR = 3_600_000;

export async function runSafetyReminders(ctx: ModuleContext): Promise<{ overdue: number; sent: number }> {
  if (!ctx.resources.get('action') || !ctx.app.hasDecorator('notify')) return { overdue: 0, sent: 0 };
  const rows = await ctx.db.query<Row>(
    `select a.id, a.ref, a.title, a.due_on::text as due_on, e.ref as event_ref, e.investigator_id
     from actions a join safety_events e on e.id::text = a.source_id::text and e.deleted_at is null
     where a.deleted_at is null and a.source_type = 'safety_event' and a.due_on < $1::date
       and not (coalesce(a.status, '') = any($2::text[]))
     order by a.due_on`, [dayInZone(), ['done', 'cancelled']]);
  let sent = 0;
  for (const a of rows) {
    const r = await ctx.app.notify({
      permission: 'safety.edit', userIds: [a.investigator_id], kind: 'safety', oncePerDay: true,
      title: `Corrective action overdue: ${a.ref} ${a.title}`,
      body: `Due ${displayDate(a.due_on)}, from safety event ${a.event_ref}.`,
      recordType: 'action', recordId: a.id,
    });
    sent += r.sent;
  }
  return { overdue: rows.length, sent };
}

export async function registerReminders(ctx: ModuleContext) {
  const { app } = ctx;
  app.post('/api/safety/reminders/run', { preHandler: ctx.requirePerm('safety.administer') }, async () => runSafetyReminders(ctx));
  ctx.describeRoute({ method: 'POST', path: '/api/safety/reminders/run', summary: 'Send the overdue corrective action reminders now (they also run every hour, once a day per action)', permission: 'safety.administer' });

  app.post('/api/safety/hazard-reminders/run', { preHandler: ctx.requirePerm('safety.administer') }, async () => runHazardReviewReminders(ctx));
  ctx.describeRoute({ method: 'POST', path: '/api/safety/hazard-reminders/run', summary: 'Send the hazard review reminders now (they also run every hour; each review date is announced at most twice)', permission: 'safety.administer' });

  // Hourly on the job queue (Administration > Background jobs).
  await scheduleWork(ctx, 'safety.reminders', () => runSafetyReminders(ctx), { every: HOUR, firstRunInMs: 90_000 });
  await scheduleWork(ctx, 'safety.hazard_reviews', () => runHazardReviewReminders(ctx), { every: HOUR, firstRunInMs: 100_000 });
}
