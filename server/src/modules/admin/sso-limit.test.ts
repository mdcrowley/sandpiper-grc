import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E22-43: the single sign-on routes claim the per-address sign-in slot before the attempt (take()),
// as the local sign-in does, so attempts sent at the same moment cannot all slip under the limit.
// The counts are checked as soon as the answers are in: on a database server with several
// connections, a claim given back only after the answer was sent would still be counted here.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const failures = async () => (await t.db.one<{ c: number }>(`select count(*)::int c from audit_events where action = 'signin.failure'`))!.c;
const hits = async () => (await t.db.one<{ c: number }>(`select count(*)::int c from rate_limit_hits where bucket = 'signin'`))!.c;

describe('single sign-on per-address limit (E22-43)', () => {
  it('counts simultaneous attempts: no more than the limit get through, and each failure counts once', async () => {
    await t.db.query(`delete from rate_limit_hits where bucket = 'signin'`);
    const before = await failures();
    // A callback for a provider that does not exist is a failed sign-in (audited, counted).
    const answers = await Promise.all(Array.from({ length: 30 }, () =>
      t.app.inject({ method: 'GET', url: '/api/auth/sso/no-such-provider/callback?state=x' })));
    for (const a of answers) {
      expect(a.statusCode).toBe(302);
      expect(a.headers.location).toBe('/?sso=failed');
    }
    const failed = (await failures()) - before;
    // (Claimed first and counted after, so a burst may even be refused whole: never more than the limit.)
    expect(failed).toBeLessThanOrEqual(20);
    // A failure keeps its claim as its count and every other claim was given back before its answer
    // was sent: what remains, once every answer is in, is one row per recorded failure.
    expect(await hits()).toBe(failed);

    // Over the limit: a further attempt is refused before it is tried (nothing more is audited).
    for (let i = failed; i < 20; i++) await t.app.inject({ method: 'GET', url: '/api/auth/sso/no-such-provider/callback?state=x' });
    const atLimit = await failures();
    const refused = await t.app.inject({ method: 'POST', url: '/api/auth/sso/no-such-provider/start', headers: { 'x-grc-csrf': '1' }, payload: {} });
    expect(refused.statusCode).toBe(429);
    expect(await failures()).toBe(atLimit);
    await t.db.query(`delete from rate_limit_hits where bucket = 'signin'`);
  });

  it('shares the bucket with the local password sign-in', async () => {
    await t.db.query(`delete from rate_limit_hits where bucket = 'signin'`);
    for (let i = 0; i < 20; i++) {
      await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'nobody', password: 'wrong wrong wrong' } });
    }
    const sso = await t.app.inject({ method: 'GET', url: '/api/auth/sso/no-such-provider/callback?state=x' });
    expect(sso.headers.location).toBe('/?sso=failed');
    expect(await hits()).toBe(20); // refused before the attempt: not counted again
    await t.db.query(`delete from rate_limit_hits where bucket = 'signin'`);
  });
});
