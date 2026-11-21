import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';

// Readiness (OP-13). GET /api/health is liveness: the process answers, nothing more, so it stays
// cheap for frequent probes. GET /api/ready also asks the database for one row and says 503 when
// it does not answer within READY_TIMEOUT_MS (a PostgreSQL server that is down or unreachable, or
// an embedded database held by one long piece of work), so a container health check or a load
// balancer sees the problem. Both are public and say nothing about the cause beyond one word; the
// cause goes to the server log.

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

export function registerReadiness(app: FastifyInstance, db: Pick<Db, 'one'>, timeoutMs = READY_TIMEOUT_MS): void {
  let lastLogged = '';
  app.get('/api/ready', { config: { public: true } }, async (_req, reply) => {
    const { state, error } = await checkDatabase(db, timeoutMs);
    if (state === 'ok') {
      lastLogged = '';
      return { ok: true, database: 'ok' };
    }
    // Once per change of state, not on every probe.
    const what = state === 'timeout' ? `no answer within ${timeoutMs} ms` : (error as Error)?.message ?? String(error);
    if (what !== lastLogged) {
      lastLogged = what;
      console.error(`[ready] the database is not ready: ${what}`);
    }
    reply.header('cache-control', 'no-store');
    return reply.code(503).send({ ok: false, database: state });
  });
}
