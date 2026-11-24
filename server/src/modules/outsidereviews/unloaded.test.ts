import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../core/auth.ts';
import { forgetReviewerTable } from '../../core/reviewers.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';

// Wave 23 A4: with the server started without this module (GRC_MODULES), nothing confines an
// outside reviewer's account, so core refuses it: it cannot sign in, and its sessions are not accepted.

type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
const saved = process.env.GRC_MODULES;

beforeAll(async () => {
  process.env.GRC_MODULES = 'admin';
  try {
    t = await testApp();
  } finally {
    if (saved === undefined) delete process.env.GRC_MODULES;
    else process.env.GRC_MODULES = saved;
  }
  // The table outlives the module: an installation that once had it keeps its reviewer accounts.
  await t.db.exec('create table if not exists outside_reviewers (user_id uuid primary key, organization text, ended_at timestamptz, created_at timestamptz not null default now(), created_by uuid)');
  forgetReviewerTable(t.db);
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('an outside reviewer account while the module is not loaded', () => {
  it('cannot sign in, and its open sessions are not accepted', async () => {
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = $1`, [ADMIN.username]))!.id;
    // A staff account signs in as usual.
    const before = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: ADMIN.username, password: ADMIN.password } });
    expect(before.statusCode, before.body).toBe(200);
    const cookie = before.cookies.find((c) => c.name === SESSION_COOKIE)!.value;

    await t.db.query('insert into outside_reviewers (user_id) values ($1)', [admin]);
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: ADMIN.username, password: ADMIN.password } });
    expect(login.statusCode).toBe(401);
    const state = await t.app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    expect(state.json().user).toBeNull();
    const options = await t.app.inject({ method: 'GET', url: '/api/users/options', headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    expect(options.statusCode).toBe(401);
    const { loadUser } = await import('../../core/auth.ts');
    expect(await loadUser(t.db, admin)).toBeNull();
  });
});
