import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';

// The API reference says what the routes really accept and require (wave 9 docs review): the
// sign-in body, the routes a token cannot call, the password confirmation on webhook changes and
// every portal setting.

let t: Awaited<ReturnType<typeof testApp>>;
let paths: Record<string, Record<string, unknown>>;

beforeAll(async () => {
  t = await testApp();
  await t.api.patch('/api/admin/features', { features: { portal: true, mobile: true, civilrights: true } });
  paths = ((await t.core.openapi.build(null)) as { paths: typeof paths }).paths;
});
afterAll(async () => { await t.close(); });

const op = (path: string, method: string) => JSON.stringify(paths[path]?.[method] ?? null);

describe('API reference', () => {
  it('describes the sign-in body with the recovery code and passkey, and its answers', () => {
    const login = op('/api/auth/login', 'post');
    for (const word of ['recoveryCode', 'webauthn', 'mfa_required', 'invalid_credentials']) expect(login).toContain(word);
  });

  it('marks the administrator token routes as session only', () => {
    expect(op('/api/admin/tokens', 'get')).toContain('Session only');
    expect(op('/api/admin/tokens/{id}', 'delete')).toContain('Session only');
  });

  it('says which webhook changes need a password confirmation', () => {
    expect(op('/api/admin/webhooks/{id}', 'patch')).toContain('reauth_required');
    expect(op('/api/admin/webhooks/{id}/rotate-secret', 'post')).toContain('reauth_required');
  });

  it('lists every portal setting the PUT route accepts', () => {
    const put = op('/api/portal/settings', 'put');
    expect(put).toContain('on_behalf');
    expect(put).toContain('safety_reports');
  });
});
