// Operational metrics for a monitoring system (E40-04): `GET /api/ops/metrics`, in the Prometheus
// text format (version 0.0.4), off by default.
//
// Switched on by giving the server a token: GRC_METRICS_TOKEN (at least 24 characters), or
// GRC_METRICS_TOKEN_FILE naming a file that holds it. The scraper sends `Authorization: Bearer
// <token>`. Without a token set the route answers 404, as if it did not exist; a wrong token
// answers 401. No session, personal access token or CSRF header is involved.
//
// What it gives is about the server, never about people or records: request counts and durations
// by method and status class (no paths, so no record ids), the job queue by status and its oldest
// due job, recent jobs that gave up by type, email and webhook deliveries by status, audit-log
// forwarders failing, open operational alerts, database connections (PostgreSQL server), and the
// process's memory and uptime. Counters are per process and start at zero when it starts.
import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { envOrFile, type Db } from './db.ts';
import type { JobQueue } from './jobs/queue.ts';
import type { Watch } from './jobs/watch.ts';
import type { ModuleContext } from './module.ts';
import { versionInfo } from '../ops/version.ts';

const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

interface RequestStats {
  /** `${method} ${class}` → count */
  counts: Map<string, number>;
  /** method → bucket counts (cumulative is made when printed), sum and count */
  durations: Map<string, { buckets: number[]; sum: number; count: number }>;
}

const stats = new WeakMap<FastifyInstance, RequestStats>();

/** Counts every answer (method, status class and how long it took). Register before the routes. */
export function registerRequestMetrics(app: FastifyInstance): void {
  const s: RequestStats = { counts: new Map(), durations: new Map() };
  stats.set(app, s);
  app.addHook('onResponse', async (req, reply) => {
    const method = /^[A-Z]{3,7}$/.test(req.method) ? req.method : 'OTHER';
    const klass = `${Math.floor(reply.statusCode / 100)}xx`;
    const key = `${method} ${klass}`;
    s.counts.set(key, (s.counts.get(key) ?? 0) + 1);
    const seconds = (reply.elapsedTime ?? 0) / 1000;
    const d = s.durations.get(method) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    const i = BUCKETS.findIndex((b) => seconds <= b);
    if (i >= 0) d.buckets[i] += 1;
    d.sum += seconds;
    d.count += 1;
    s.durations.set(method, d);
  });
}

/** The configured token, or null when the endpoint is off. */
export function metricsToken(): string | null {
  let t: string | undefined;
  try {
    t = envOrFile('GRC_METRICS_TOKEN');
  } catch (err) {
    console.error(`[metrics] GRC_METRICS_TOKEN_FILE could not be read: ${(err as Error).message}`);
    return null;
  }
  if (!t) return null;
  if (t.length < 24) {
    console.error('[metrics] GRC_METRICS_TOKEN is shorter than 24 characters: the metrics endpoint stays off.');
    return null;
  }
  return t;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

class Out {
  lines: string[] = [];
  metric(name: string, type: 'counter' | 'gauge' | 'histogram', help: string) {
    this.lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    return this;
  }
  value(name: string, value: number, labels: Record<string, string> = {}) {
    const l = Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',');
    this.lines.push(`${name}${l ? `{${l}}` : ''} ${Number.isFinite(value) ? value : 0}`);
    return this;
  }
  text() { return `${this.lines.join('\n')}\n`; }
}

const exists = async (db: Db, table: string) => Boolean((await db.one<{ t: string | null }>('select to_regclass($1)::text as t', [table]))?.t);

/** The metrics text. Exported for tests. */
export async function metricsText(app: FastifyInstance, db: Db, jobs: JobQueue, watch: Watch): Promise<string> {
  const o = new Out();
  const v = versionInfo(false);
  o.metric('grc_build_info', 'gauge', 'The installed version (always 1).').value('grc_build_info', 1, { version: v.version, commit: v.commit ?? '' });
  o.metric('grc_process_uptime_seconds', 'gauge', 'Seconds since this server process started.').value('grc_process_uptime_seconds', Math.round(process.uptime()));
  const mem = process.memoryUsage();
  o.metric('grc_process_resident_memory_bytes', 'gauge', 'Resident memory of this process.').value('grc_process_resident_memory_bytes', mem.rss);
  o.metric('grc_process_heap_used_bytes', 'gauge', 'JavaScript heap in use.').value('grc_process_heap_used_bytes', mem.heapUsed);

  const s = stats.get(app);
  o.metric('grc_http_requests_total', 'counter', 'Answers given by this process, by method and status class.');
  for (const [key, n] of [...(s?.counts ?? new Map())].sort()) {
    const [method, klass] = key.split(' ');
    o.value('grc_http_requests_total', n, { method, status: klass });
  }
  o.metric('grc_http_request_duration_seconds', 'histogram', 'Time to answer, by method.');
  for (const [method, d] of [...(s?.durations ?? new Map())].sort()) {
    let cumulative = 0;
    BUCKETS.forEach((b, i) => { cumulative += d.buckets[i]; o.value('grc_http_request_duration_seconds_bucket', cumulative, { method, le: String(b) }); });
    o.value('grc_http_request_duration_seconds_bucket', d.count, { method, le: '+Inf' });
    o.value('grc_http_request_duration_seconds_sum', Math.round(d.sum * 1000) / 1000, { method });
    o.value('grc_http_request_duration_seconds_count', d.count, { method });
  }

  const pool = db.poolStats?.();
  if (pool) {
    o.metric('grc_db_pool_connections', 'gauge', 'Database connections of this process (PostgreSQL server), by state.');
    o.value('grc_db_pool_connections', pool.total - pool.idle, { state: 'busy' });
    o.value('grc_db_pool_connections', pool.idle, { state: 'idle' });
    o.metric('grc_db_pool_max', 'gauge', 'Most connections this process may open (GRC_DATABASE_POOL_MAX).').value('grc_db_pool_max', pool.max);
    o.metric('grc_db_pool_waiting', 'gauge', 'Requests waiting for a database connection.').value('grc_db_pool_waiting', pool.waiting);
    o.metric('grc_db_pool_exhausted_total', 'counter', 'Requests answered 503 because no connection came free in time.').value('grc_db_pool_exhausted_total', pool.exhausted);
  }

  const p = jobs.poller();
  o.metric('grc_jobs_poller_running', 'gauge', '1 when this process works through the job queue.').value('grc_jobs_poller_running', p.started ? 1 : 0);
  o.metric('grc_jobs_poller_last_poll_age_seconds', 'gauge', 'Seconds since this process last finished a poll (0 when it does not poll).')
    .value('grc_jobs_poller_last_poll_age_seconds', p.started && p.lastPollAt ? Math.round((Date.now() - p.lastPollAt.getTime()) / 1000) : 0);
  o.metric('grc_jobs', 'gauge', 'Jobs in the queue, by status.');
  const counts = new Map((await db.query<{ status: string; n: number }>('select status, count(*)::int as n from jobs group by status')).map((r) => [r.status, r.n]));
  for (const st of ['queued', 'running', 'failed', 'dead', 'done']) o.value('grc_jobs', counts.get(st) ?? 0, { status: st });
  const oldest = await db.one<{ s: number | null }>(`select extract(epoch from now() - min(run_at))::int as s from jobs where status in ('queued', 'failed') and run_at <= now()`);
  o.metric('grc_jobs_oldest_due_seconds', 'gauge', 'How long the oldest due job has waited.').value('grc_jobs_oldest_due_seconds', oldest?.s ?? 0);
  o.metric('grc_jobs_dead_recent', 'gauge', 'Jobs that gave up in the last 24 hours, by type.');
  for (const r of await db.query<{ type: string; n: number }>(
    `select type, count(*)::int as n from jobs where status = 'dead' and finished_at > now() - interval '1 day' group by type order by type`)) {
    o.value('grc_jobs_dead_recent', r.n, { type: r.type });
  }

  if (await exists(db, 'mail_log')) {
    o.metric('grc_mail_messages_recent', 'gauge', 'Email messages queued in the last 24 hours, by status.');
    for (const r of await db.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from mail_log where created_at > now() - interval '1 day' group by status order by status`)) {
      o.value('grc_mail_messages_recent', r.n, { status: r.status });
    }
    o.metric('grc_mail_failing', 'gauge', '1 when email is on and the last messages all failed.').value('grc_mail_failing', (await watch.mailState()) === 'failing' ? 1 : 0);
  }
  if (await exists(db, 'webhook_deliveries')) {
    o.metric('grc_webhook_deliveries_recent', 'gauge', 'Webhook deliveries made in the last 24 hours, by status.');
    for (const r of await db.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from webhook_deliveries where created_at > now() - interval '1 day' group by status order by status`)) {
      o.value('grc_webhook_deliveries_recent', r.n, { status: r.status });
    }
  }
  if (await exists(db, 'audit_forwarders')) {
    const f = await db.one<{ active: number; failing: number }>(
      `select count(*) filter (where active)::int as active, count(*) filter (where active and failures > 0)::int as failing from audit_forwarders where deleted_at is null`);
    o.metric('grc_audit_forwarders', 'gauge', 'Active audit-log forwarders, and those whose last attempt failed.');
    o.value('grc_audit_forwarders', f?.active ?? 0, { state: 'active' }).value('grc_audit_forwarders', f?.failing ?? 0, { state: 'failing' });
  }
  const alerts = await db.one<{ n: number }>('select count(*)::int as n from ops_alerts where cleared_at is null');
  o.metric('grc_ops_alerts_open', 'gauge', 'Operational problems open (Administration > Background jobs).').value('grc_ops_alerts_open', alerts?.n ?? 0);
  return o.text();
}

export function registerMetricsEndpoint(ctx: ModuleContext, jobs: JobQueue, watch: Watch): void {
  const { app, db } = ctx;
  app.get('/api/ops/metrics', { config: { public: true, ownBearer: true } }, async (req, reply) => {
    const token = metricsToken();
    if (!token) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    const given = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]?.trim() ?? '';
    if (!given || !timingSafeEqual(digest(given), digest(token))) {
      reply.header('www-authenticate', 'Bearer');
      return reply.code(401).send({ error: { code: 'unauthenticated', message: 'A valid metrics token is needed.' } });
    }
    reply.header('cache-control', 'no-store');
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return metricsText(app, db, jobs, watch);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/ops/metrics', tag: 'Session', public: true,
    summary: 'Operational metrics in the Prometheus text format (off unless GRC_METRICS_TOKEN is set; Authorization: Bearer <that token>)',
    description: 'Counts about the server only: requests, the job queue, email and webhook deliveries, forwarders, open operational alerts, database connections and the process. No personal data. Answers 404 while no token is configured.',
  });
}
