// Watching background work (E40-04): which parts keep failing, told once to the administrators
// (alerts.ts), and the state /api/ready and the metrics endpoint report.
//
// Checked every minute by the job `core.ops_watch`:
// - a job type whose latest run gave up ("dead") with no later run that finished: `job.dead:<type>`
//   (`safety.clocks` says that regulatory notification alerts may be missed);
// - email: the last three messages that finished all failed: `mail.failing`;
// - a webhook whose latest finished delivery failed, or with a delivery still being retried after
//   three attempts: `webhook:<id>`;
// - an audit-log forwarder that has failed three times in a row: `forwarder:<id>`.
// Checked every minute by a timer in each server process, outside the queue (a queue that does not
// run cannot report that it does not run):
// - this process's poller has not finished a poll for a while: `jobs.poller:<process>`;
// - jobs have been due for 15 minutes while no job runs and none finished in that time, so no process
//   is working through the queue: `jobs.stalled`.
// Each problem clears by itself when the check no longer finds it.
import { hostname } from 'node:os';
import type { Db } from '../db.ts';
import type { ModuleContext, Row } from '../module.ts';
import type { OpsAlerts } from './alerts.ts';
import type { JobQueue } from './queue.ts';

/** Job types whose failures are watched by their own check rather than one dead job at a time. */
const OWN_CHECK = new Set(['mail.send']);
/** Minutes a due job may wait, with nothing running or finishing, before the queue counts as stalled. */
export const STALL_MINUTES = 15;
/** Failures in a row that count as "keeps failing". */
export const FAILURES_IN_A_ROW = 3;

const PROCESS = `${hostname()}:${process.pid}`;

export type JobsState = 'ok' | 'off' | 'stalled' | 'behind';
export type MailState = 'ok' | 'off' | 'failing';

const exists = async (db: Db, table: string) => Boolean((await db.one<{ t: string | null }>('select to_regclass($1)::text as t', [table]))?.t);

/** True when this process's poller runs but has not finished a poll for longer than it should. */
export function pollerStalled(jobs: JobQueue, now = Date.now()): boolean {
  const p = jobs.poller();
  if (!p.started) return false;
  const since = (p.lastPollAt ?? p.startedAt)?.getTime() ?? now;
  // Ten polls, and at least five minutes: a poll waits for the lanes it starts (a long backup is in
  // its own run, and later polls skip a busy lane), so only a poll that hangs gets this far behind.
  return now - since > Math.max(5 * 60_000, 10 * p.intervalMs);
}

/** Jobs are due and nothing is working through them (no process polls, or every poller hangs). */
export async function queueStalled(db: Db): Promise<{ stalled: boolean; waiting: number; oldestSeconds: number }> {
  const r = (await db.one<{ waiting: number; oldest: number | null; running: number; finished: number }>(
    `select
       (select count(*)::int from jobs where status in ('queued', 'failed') and run_at <= now() - make_interval(mins => $1::int)) as waiting,
       (select extract(epoch from now() - min(run_at))::int from jobs where status in ('queued', 'failed') and run_at <= now()) as oldest,
       (select count(*)::int from jobs where status = 'running' and locked_until > now()) as running,
       (select count(*)::int from jobs where finished_at > now() - make_interval(mins => $1::int)) as finished`,
    [STALL_MINUTES],
  ))!;
  return { stalled: r.waiting > 0 && r.running === 0 && r.finished === 0, waiting: r.waiting, oldestSeconds: r.oldest ?? 0 };
}

/** Email is on and the last messages that finished all failed. */
export async function mailState(db: Db): Promise<MailState> {
  if (!(await exists(db, 'mail_config'))) return 'off';
  const on = (await db.one<{ enabled: boolean }>('select enabled from mail_config where id = 1'))?.enabled === true;
  if (!on) return 'off';
  const last = await db.query<{ status: string }>(
    `select status from mail_log where status in ('sent', 'failed', 'dead') and purpose <> 'test' and created_at > now() - interval '1 day'
     order by created_at desc limit $1`, [FAILURES_IN_A_ROW]);
  return last.length >= FAILURES_IN_A_ROW && last.every((r) => r.status !== 'sent') ? 'failing' : 'ok';
}

export interface WatchResult { open: string[]; cleared: string[]; told: string[] }

export function makeWatch(ctx: Pick<ModuleContext, 'db'>, jobs: JobQueue, alerts: OpsAlerts) {
  const { db } = ctx;

  async function raiseAll(found: Map<string, { title: string; detail?: string; route?: string }>, out: WatchResult) {
    for (const [key, a] of found) {
      out.open.push(key);
      if (await alerts.raise(key, a)) out.told.push(key);
    }
  }

  /** The checks made through the queue (`core.ops_watch`). */
  async function check(): Promise<WatchResult> {
    const out: WatchResult = { open: [], cleared: [], told: [] };

    // Jobs that gave up, with no later run of their type that finished.
    const dead = await db.query<Row>(
      `select d.type, count(*)::int as n, max(d.finished_at) as at, max(d.attempts) as attempts from jobs d
       where d.status = 'dead' and d.finished_at > now() - interval '7 days'
         and not exists (select 1 from jobs ok where ok.type = d.type and ok.status = 'done' and ok.finished_at > d.finished_at)
       group by d.type order by d.type`);
    const found = new Map<string, { title: string; detail?: string; route?: string }>();
    for (const d of dead.filter((r) => !OWN_CHECK.has(r.type))) {
      const safety = d.type === 'safety.clocks';
      found.set(`job.dead:${d.type}`, {
        title: safety
          ? 'The safety notification clock check has stopped: deadline alerts may be missed'
          : `Background job ${d.type} gave up`,
        detail: `${d.n === 1 ? 'A run' : `${d.n} runs`} of ${d.type} gave up after ${d.attempts} attempt(s). `
          + 'Open Administration > Background jobs to see the error and try it again.',
        route: '/admin/jobs',
      });
    }
    await raiseAll(found, out);
    out.cleared.push(...await alerts.clearExcept('job.dead:', found.keys()));

    // Email.
    const mail = await mailState(db as Db);
    if (mail === 'failing') {
      await raiseAll(new Map([['mail.failing', {
        title: 'Email is not being delivered',
        detail: `The last ${FAILURES_IN_A_ROW} messages could not be sent. Open Administration > Email to see the delivery log and test the connection.`,
        route: '/admin/email',
      }]]), out);
    } else out.cleared.push(...await alerts.clear(['mail.failing']));

    // Webhooks.
    const hooks = new Map<string, { title: string; detail?: string; route?: string }>();
    if (await exists(db as Db, 'webhook_deliveries')) {
      const rows = await db.query<Row>(
        `select w.id, w.name,
           (select d.status from webhook_deliveries d where d.webhook_id = w.id and d.status in ('delivered', 'failed')
             order by coalesce(d.last_attempt_at, d.created_at) desc limit 1) as last_status,
           (select max(d.attempts) from webhook_deliveries d where d.webhook_id = w.id and d.status = 'pending') as retrying
         from webhooks w where w.active and w.deleted_at is null`);
      for (const w of rows) {
        if (w.last_status === 'failed' || Number(w.retrying ?? 0) >= FAILURES_IN_A_ROW) {
          hooks.set(`webhook:${w.id}`, {
            title: `Webhook "${String(w.name).slice(0, 80)}" keeps failing`,
            detail: 'Its receiver has not accepted deliveries. Open Administration > Webhooks to see the deliveries and their errors.',
            route: '/admin/webhooks',
          });
        }
      }
    }
    await raiseAll(hooks, out);
    out.cleared.push(...await alerts.clearExcept('webhook:', hooks.keys()));

    // Audit-log forwarders (integrations module, when loaded).
    const fwd = new Map<string, { title: string; detail?: string; route?: string }>();
    if (await exists(db as Db, 'audit_forwarders')) {
      for (const f of await db.query<Row>(
        `select id, name, failures from audit_forwarders where active and deleted_at is null and failures >= $1`, [FAILURES_IN_A_ROW])) {
        fwd.set(`forwarder:${f.id}`, {
          title: `Audit-log forwarder "${String(f.name).slice(0, 80)}" keeps failing`,
          detail: `${f.failures} attempts in a row could not reach the collector; audit events wait and are sent once it answers. Open Administration > Log forwarding.`,
          route: '/admin/log-forwarding',
        });
      }
    }
    await raiseAll(fwd, out);
    out.cleared.push(...await alerts.clearExcept('forwarder:', fwd.keys()));
    return out;
  }

  /** The checks made outside the queue, by a timer in each process. */
  async function checkPoller(now = Date.now()): Promise<WatchResult> {
    const out: WatchResult = { open: [], cleared: [], told: [] };
    const mine = `jobs.poller:${PROCESS}`;
    if (pollerStalled(jobs, now)) {
      const p = jobs.poller();
      await raiseAll(new Map([[mine, {
        title: 'A server process has stopped running background jobs',
        detail: `The job poller in server process ${PROCESS} has not finished a poll for ${Math.round((now - (p.lastPollAt ?? p.startedAt ?? new Date(now)).getTime()) / 60_000)} minutes. Restart that process; its log may say why.`,
        route: '/admin/jobs',
      }]]), out);
    } else out.cleared.push(...await alerts.clear([mine]));
    // A process that stopped cannot clear its own alert: one not seen for ten minutes is cleared.
    const gone = await db.query<{ key: string }>(
      `select key from ops_alerts where cleared_at is null and starts_with(key, 'jobs.poller:') and key <> $1 and last_seen_at < now() - interval '10 minutes'`, [mine]);
    out.cleared.push(...await alerts.clear(gone.map((g) => g.key)));

    const q = await queueStalled(db as Db);
    if (q.stalled) {
      await raiseAll(new Map([['jobs.stalled', {
        title: 'Background jobs are not running',
        detail: `${q.waiting} job(s) have been due for more than ${STALL_MINUTES} minutes and no server process is running any. `
          + 'Scheduled work (reminders, deadline alerts, email, backups) waits until one does. Check that a server runs with its job poller on (GRC_JOBS is not "off").',
        route: '/admin/jobs',
      }]]), out);
    } else out.cleared.push(...await alerts.clear(['jobs.stalled']));
    return out;
  }

  /** What /api/ready says about the job queue in this process. */
  async function jobsState(): Promise<JobsState> {
    if (pollerStalled(jobs)) return 'stalled';
    if ((await queueStalled(db as Db)).stalled) return 'behind';
    return jobs.poller().started ? 'ok' : 'off';
  }

  return { check, checkPoller, jobsState, mailState: () => mailState(db as Db) };
}

export type Watch = ReturnType<typeof makeWatch>;
