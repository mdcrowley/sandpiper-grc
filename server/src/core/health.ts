import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';

// Readiness (OP-13). GET /api/health is liveness: the process answers, nothing more, so it stays
// cheap for frequent probes. GET /api/ready also asks the database for one row and says 503 when
// it does not answer within READY_TIMEOUT_MS (a PostgreSQL server that is down or unreachable, or
// an embedded database held by one long piece of work), so a container health check or a load
// balancer sees the problem. Both are public and say nothing about the cause beyond one word; the
// cause goes to the server log.
//
// Since E40-04 it also reports the job queue and email (core/jobs/watch.ts), each in one word:
// - `jobs`: `ok` (this process works through the queue), `off` (its poller is off: GRC_JOBS=off,
//   or another process does the work), `behind` (jobs have been due for a while and no process is
//   running any) or `stalled` (this process's poller has stopped finishing its polls);
// - `mail`: `off` (email not set up), `ok`, or `failing` (the last messages all failed).
// Only the database failing or this process's own poller being stalled answers 503: the other
// states are about the installation, not this process, and restarting it would not help.

export const READY_TIMEOUT_MS = 2_000;

export type DatabaseState = 'ok' | 'timeout' | 'error';

/** Asks the database for one row, giving up after `timeoutMs`. */
export async function checkDatabase(db: Pick<Db, 'one'>, timeoutMs = READY_TIMEOUT_MS): Promise<{ state: DatabaseState; error?: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((done) => { timer = setTimeout(() => done('timeout'), timeoutMs); });
  try {
    const result = await Promise.race([db.one<{ ok: number }>('select 1 as ok'), timeout]);
    if (result === 'timeout') return { state: 'timeout' };
    return result?.ok === 1 ? { state: 'ok' } : { state: 'error', error: new Error('unexpected answer') };
  } catch (error) {
    return { state: 'error', error };
  } finally {
    clearTimeout(timer);
  }
}

/** One word, or 'unknown' when the check itself failed or took longer than `timeoutMs`. */
async function word(fn: (() => Promise<string>) | undefined, timeoutMs: number): Promise<string | undefined> {
  if (!fn) return undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([fn(), new Promise<string>((done) => { timer = setTimeout(() => done('unknown'), timeoutMs); })]);
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

export function registerReadiness(app: FastifyInstance, db: Pick<Db, 'one'>, timeoutMs = READY_TIMEOUT_MS): void {
  let lastLogged = '';
  app.get('/api/ready', { config: { public: true } }, async (_req, reply) => {
    const { state, error } = await checkDatabase(db, timeoutMs);
    reply.header('cache-control', 'no-store');
    if (state === 'ok') {
      // Present once core has started the job queue (core/jobs/ops.ts).
      const ops = app.hasDecorator('opsState') ? app.opsState : undefined;
      const [jobs, mail] = await Promise.all([word(ops?.jobs, timeoutMs), word(ops?.mail, timeoutMs)]);
      const body = { ok: jobs !== 'stalled', database: 'ok', ...(jobs ? { jobs } : {}), ...(mail ? { mail } : {}) };
      const what = jobs === 'stalled' ? 'the job poller of this process has stopped finishing its polls' : '';
      if (what !== lastLogged) {
        lastLogged = what;
        if (what) console.error(`[ready] not ready: ${what}`);
      }
      return body.ok ? body : reply.code(503).send(body);
    }
    // Once per change of state, not on every probe.
    const what = state === 'timeout' ? `no answer within ${timeoutMs} ms` : (error as Error)?.message ?? String(error);
    if (what !== lastLogged) {
      lastLogged = what;
      console.error(`[ready] the database is not ready: ${what}`);
    }
    return reply.code(503).send({ ok: false, database: state });
  });
}
