// Core's operational upkeep on the job queue (wave 19, E40-04, E40-06, E40-07), set up by
// ensureJobs:
// - `core.ops_watch` (every minute): background work that keeps failing is told to the
//   administrators once per problem (watch.ts, alerts.ts); a timer in each server process checks the
//   poller itself, outside the queue;
// - `core.session_cleanup` (daily): expired sessions, and used or expired one-time links, removed;
// - `core.audit_archive` (daily; off until switched on): core/audit-archive.ts;
// - the operational metrics endpoint (core/monitoring.ts) and what /api/ready says about the
//   queue and email (core/health.ts reads `app.opsState`).
import type { ModuleContext } from '../module.ts';
import { registerAuditArchive } from '../audit-archive.ts';
import { registerMetricsEndpoint } from '../monitoring.ts';
import { makeOpsAlerts, type OpsAlerts } from './alerts.ts';
import type { JobQueue } from './queue.ts';
import { makeWatch, type JobsState, type MailState, type Watch } from './watch.ts';

const DAY = 86_400_000;

declare module 'fastify' {
  interface FastifyInstance {
    /** Core's operational state (E40-04): what /api/ready reports beside the database. */
    opsState: { jobs(): Promise<JobsState>; mail(): Promise<MailState>; alerts: OpsAlerts; watch: Watch };
  }
}

/** Removes expired sessions, and one-time links that were used or have expired (E40-07). */
export async function cleanupSessions(db: ModuleContext['db']): Promise<{ sessions: number; links: number }> {
  const sessions = await db.query('delete from sessions where expires_at < now() returning 1');
  const links = await db.query('delete from one_time_tokens where used_at is not null or expires_at < now() returning 1');
  return { sessions: sessions.length, links: links.length };
}

export async function registerOps(ctx: ModuleContext, jobs: JobQueue): Promise<void> {
  const { app, db } = ctx;
  const alerts = makeOpsAlerts(ctx);
  const watch = makeWatch(ctx, jobs, alerts);

  jobs.register('core.ops_watch', async () => {
    const r = await watch.check();
    return { open: r.open.length, told: r.told, cleared: r.cleared };
  }, { maxAttempts: 2 });
  await jobs.schedule('core.ops_watch', { type: 'core.ops_watch', every: 60_000, firstRunInMs: 90_000 });

  jobs.register('core.session_cleanup', async () => cleanupSessions(db), { maxAttempts: 3 });
  await jobs.schedule('core.session_cleanup', { type: 'core.session_cleanup', every: DAY, firstRunInMs: 15 * 60_000 });

  await registerAuditArchive(ctx, jobs, alerts);
  registerMetricsEndpoint(ctx, jobs, watch);

  // /api/ready reads these; cached for 15 seconds so a busy probe does not query each time.
  const cache = new Map<string, { at: number; value: Promise<string> }>();
  const cached = <T extends string>(key: string, fn: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 15_000) return hit.value as Promise<T>;
    const value = fn().catch((err) => { cache.delete(key); throw err; });
    cache.set(key, { at: Date.now(), value });
    return value;
  };
  if (!app.hasDecorator('opsState')) {
    app.decorate('opsState', {
      jobs: () => cached('jobs', () => watch.jobsState()),
      mail: () => cached('mail', () => watch.mailState()),
      alerts, watch,
    });
  }

  // The poller checks itself from outside the queue, in every server process that serves requests.
  const watchdog = !process.env.VITEST && ctx.dataDir !== 'memory';
  let timer: NodeJS.Timeout | null = null;
  app.addHook('onListen', async () => {
    if (!watchdog || timer) return;
    timer = setInterval(() => {
      void watch.checkPoller().catch((err) => console.error('[jobs] the poller check failed:', (err as Error).message));
    }, 60_000);
    timer.unref();
  });
  app.addHook('onClose', async () => { if (timer) clearInterval(timer); timer = null; });

  // Open problems, for Administration > Background jobs.
  app.get('/api/admin/jobs/alerts', { preHandler: ctx.requirePerm('admin.administer') }, async () => ({ alerts: await alerts.open() }));
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/jobs/alerts', tag: 'Background jobs', permission: 'admin.administer',
    summary: 'Operational problems still open (background work that keeps failing), newest first',
    response: '{ alerts: [{ key, title, detail, route, opened_at, last_seen_at, notified_at, occurrences }] }',
  });
}
