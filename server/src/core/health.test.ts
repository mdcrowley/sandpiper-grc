import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDatabase, registerReadiness } from './health.ts';
import { testApp } from '../test/helpers.ts';

// OP-13: /api/health never touched the database, so a container stayed "healthy" with the
// database down. /api/ready asks it; /api/health stays a cheap liveness check.
describe('readiness (OP-13)', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it('answers ok without signing in when the database answers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, database: 'ok' });
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/ready' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
  });

  it('says 503 when the database fails or does not answer in time', async () => {
    const app = Fastify();
    let behavior: 'fail' | 'hang' = 'fail';
    registerReadiness(app, {
      one: (() => (behavior === 'fail' ? Promise.reject(new Error('connection refused')) : new Promise(() => undefined))) as never,
    }, 50);
    const errors: unknown[] = [];
    const saved = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
    try {
      const failed = await app.inject({ method: 'GET', url: '/api/ready' });
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toEqual({ ok: false, database: 'error' });
      expect(failed.body).not.toContain('connection refused'); // the cause goes to the log only
      behavior = 'hang';
      const slow = await app.inject({ method: 'GET', url: '/api/ready' });
      expect(slow.statusCode).toBe(503);
      expect(slow.json()).toEqual({ ok: false, database: 'timeout' });
      expect(errors.join('\n')).toMatch(/connection refused/);
    } finally {
      console.error = saved;
      await app.close();
    }
  });

  it('checkDatabase gives up after the timeout', async () => {
    const started = Date.now();
    expect((await checkDatabase({ one: (() => new Promise(() => undefined)) as never }, 30)).state).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
