import { buildApp } from '../app.ts';
import { createSession, SESSION_COOKIE } from '../core/auth.ts';
import type { ModuleDef } from '../core/module.ts';

export interface TestResponse<T = any> {
  status: number;
  body: T;
  text: string;
}

export interface TestApi {
  get<T = any>(url: string): Promise<TestResponse<T>>;
  post<T = any>(url: string, body?: unknown): Promise<TestResponse<T>>;
  patch<T = any>(url: string, body?: unknown): Promise<TestResponse<T>>;
  del<T = any>(url: string): Promise<TestResponse<T>>;
}

export const ADMIN = { username: 'admin', email: 'admin@example.test', displayName: 'Test Admin', password: 'a long test passphrase 1' };

/**
 * An in-memory application for tests. `api` is signed in as an administrator;
 * `as(roleKey)` returns a client signed in as a new user holding only that role
 * (all roles are enabled in tests, including those that ship switched off).
 */
export async function testApp(opts: { extraModules?: ModuleDef[] } = {}) {
  const built = await buildApp({ dataDir: 'memory', serveWeb: false, extraModules: opts.extraModules });
  const { app, db } = built;

  const client = (cookie: () => string | undefined): TestApi => {
    const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
      const res = await app.inject({
        method, url,
        headers: { ...(cookie() ? { cookie: `${SESSION_COOKIE}=${cookie()}` } : {}), 'x-grc-csrf': '1' },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      let parsed: any = null;
      try { parsed = res.json(); } catch { /* not JSON (CSV export) */ }
      return { status: res.statusCode, body: parsed, text: res.body };
    };
    return {
      get: (url) => call('GET', url),
      post: (url, body) => call('POST', url, body ?? {}),
      patch: (url, body) => call('PATCH', url, body ?? {}),
      del: (url) => call('DELETE', url),
    };
  };

  await db.query('update roles set enabled = true');
  const setup = await app.inject({ method: 'POST', url: '/api/setup', headers: { 'x-grc-csrf': '1' }, payload: ADMIN });
  if (setup.statusCode !== 200) throw new Error(`Test setup failed: ${setup.body}`);
  const adminCookie = setup.cookies.find((c) => c.name === SESSION_COOKIE)!.value;

  let n = 0;
  async function as(roleKey: string): Promise<TestApi & { userId: string }> {
    n += 1;
    const user = await db.one<{ id: string }>(
      `insert into users (username, email, display_name, status) values ($1,$2,$3,'active') returning id`,
      [`${roleKey}${n}`, `${roleKey}${n}@example.test`, `Test ${roleKey} ${n}`],
    );
    const role = await db.one<{ id: string }>('select id from roles where key = $1', [roleKey]);
    if (!role) throw new Error(`Unknown role ${roleKey}`);
    await db.query('insert into user_roles (user_id, role_id) values ($1,$2)', [user!.id, role.id]);
    const token = await createSession(db, user!.id);
    return { ...client(() => token), userId: user!.id };
  }

  return { ...built, api: client(() => adminCookie), anon: client(() => undefined), as };
}
