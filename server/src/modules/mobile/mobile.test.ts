import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { deactivateUser } from '../admin/users.ts';
import { MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI } from '../../../../shared/mobile-api.ts';
import { checkRequest, paramsOf } from './signin.ts';
import { compareVersions } from './state.ts';

// The mobile app's server side (wave 13, E38-02, E38-04, E38-09): the `mobile` OAuth client kind,
// device sessions, the recent sign-in claim, switched-off behavior, My work and the app's settings.

let t: Awaited<ReturnType<typeof testApp>>;

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const token = async (body: Record<string, string>) => {
  const res = await t.app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(body).toString() });
  return { status: res.statusCode, body: res.json() as any };
};
const revoke = async (body: Record<string, string>) => {
  const res = await t.app.inject({ method: 'POST', url: '/oauth/revoke', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(body).toString() });
  return { status: res.statusCode, body: res.json() as any };
};
/** A request with the app's access token. */
const bearer = async (accessToken: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
  const res = await t.app.inject({ method, url, headers: { authorization: `Bearer ${accessToken}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  let body: any = null;
  try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};

type Api = typeof t.api;
const request = (installation: string, challenge: string, extra: Record<string, string> = {}) => ({
  response_type: 'code', client_id: MOBILE_CLIENT_ID, redirect_uri: MOBILE_REDIRECT_URI, scope: 'mobile', state: 'st-1',
  code_challenge: challenge, code_challenge_method: 'S256', installation_id: installation, device_name: 'Field phone 12',
  device_platform: 'android', app_version: '0.1.0', ...extra,
});

/** Signs the app in as the person behind `api` (approving in the browser), answering the token response. */
async function signIn(api: Api = t.api, installation = randomUUID(), extra: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const params = request(installation, challenge, extra);
  const check = await api.post('/api/mobile/oauth/authorize', params);
  expect(check.status, JSON.stringify(check.body)).toBe(200);
  expect(check.body.ok).toBe(true);
  const decision = await api.post('/api/mobile/oauth/decision', { ...params, approve: true });
  expect(decision.status, JSON.stringify(decision.body)).toBe(200);
  const back = new URL(decision.body.redirect);
  expect(`${back.protocol}${back.pathname}`).toBe(MOBILE_REDIRECT_URI);
  expect(back.searchParams.get('state')).toBe('st-1');
  const code = back.searchParams.get('code')!;
  const res = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: installation });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { ...res.body, installation, code, verifier } as Record<string, any>;
}

const setMobile = async (on: boolean) => {
  const res = await t.api.patch('/api/admin/features', { features: { mobile: on } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await t.api.get('/api/auth/state');
};
const clearLimits = () => t.db.query(`delete from rate_limit_hits where bucket = 'mcp_oauth'`);

beforeAll(async () => {
  t = await testApp();
});
afterAll(async () => { await t.close(); });

describe('pieces', () => {
  it('checks the authorization request strictly and never sends an error anywhere but the app', () => {
    const { challenge } = pkce();
    const ok = checkRequest(paramsOf(request(randomUUID(), challenge)), 'https://grc.example.org');
    expect(ok.kind).toBe('ok');
    expect(checkRequest(paramsOf({ ...request(randomUUID(), challenge), client_id: 'grc_cli_x' }), 'https://grc.example.org')).toMatchObject({ kind: 'stop', code: 'invalid_client' });
    for (const redirect of ['com.sandpipergrc:/other', 'https://evil.example/cb', 'com.sandpipergrc://oauth']) {
      expect(checkRequest(paramsOf({ ...request(randomUUID(), challenge), redirect_uri: redirect }), 'https://grc.example.org'), redirect).toMatchObject({ kind: 'stop', code: 'invalid_redirect_uri' });
    }
    const bad: Record<string, string>[] = [
      { code_challenge_method: 'plain' }, { code_challenge: 'short' }, { state: '' }, { installation_id: 'not-a-uuid' },
      { device_platform: 'windows' }, { app_version: 'latest' }, { app_version: '0.0.9' }, { prompt: 'consent' }, { scope: 'mcp:read' }, { response_type: 'token' },
    ];
    for (const b of bad) {
      const r = checkRequest(paramsOf({ ...request(randomUUID(), challenge), ...b }), 'https://grc.example.org');
      expect(r.kind, JSON.stringify(b)).toBe('redirect');
      if (r.kind === 'redirect') expect(r.url.startsWith(`${MOBILE_REDIRECT_URI}?`)).toBe(true);
    }
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.0-beta.1', '0.2.0')).toBe(-1);
  });
});

describe('switched off (the default)', () => {
  it('has no client, no endpoints and no version range', async () => {
    expect((await t.anon.get('/api/mobile/hello')).status).toBe(404);
    expect((await t.api.get('/api/mobile/home')).body.error.code).toBe('switched_off');
    expect((await t.api.get('/api/me/devices')).status).toBe(404);
    expect((await t.api.post('/api/mobile/oauth/authorize', request(randomUUID(), pkce().challenge))).status).toBe(404);
    const r = await token({ grant_type: 'refresh_token', refresh_token: 'grc_mrt_x', client_id: MOBILE_CLIENT_ID, installation_id: randomUUID() });
    expect(r).toMatchObject({ status: 400, body: { error: 'switched_off' } });
    expect((await revoke({ token: 'grc_mrt_x', client_id: MOBILE_CLIENT_ID })).body.error).toBe('switched_off');
    expect((await t.api.get('/api/version')).body.mobile).toBeUndefined();
  });
});

describe('switched on', () => {
  beforeAll(async () => { await setMobile(true); });

  it('says hello before sign-in, without the server version', async () => {
    const res = await t.anon.get('/api/mobile/hello');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      product: 'sandpiper-grc', apiVersion: 1, mobile: { minVersion: '0.1.0' },
      oauth: { clientId: MOBILE_CLIENT_ID, redirectUri: MOBILE_REDIRECT_URI, scope: 'mobile' },
    });
    expect(res.body.oauth.tokenEndpoint).toMatch(/\/oauth\/token$/);
    expect(JSON.stringify(res.body)).not.toMatch(/"version"/);
    expect((await t.api.get('/api/version')).body.mobile).toEqual({ minVersion: '0.1.0', recommendedVersion: '0.1.0' });
  });

  it('signs in with PKCE, binds the tokens to the installation and acts as the person', async () => {
    const s = await signIn();
    expect(s).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'mobile' });
    expect(s.access_token).toMatch(/^grc_mat_/);
    expect(s.refresh_token).toMatch(/^grc_mrt_/);
    expect(s.auth_time).toBeUndefined();
    const state = await bearer(s.access_token, 'GET', '/api/auth/state');
    expect(state.body.user.username).toBe('admin');
    const devices = await bearer(s.access_token, 'GET', '/api/me/devices');
    expect(devices.status).toBe(200);
    const mine = devices.body.find((d: any) => d.id === s.device_id);
    expect(mine).toMatchObject({ name: 'Field phone 12', platform: 'android', appVersion: '0.1.0', current: true, revokedAt: null });
    // Stored as hashes only.
    const stored = await t.db.query<any>('select token_hash from mobile_tokens where device_id = $1', [s.device_id]);
    expect(stored.every((r) => !String(r.token_hash).startsWith('grc_'))).toBe(true);
    expect(JSON.stringify(await t.db.query('select * from mobile_devices where id = $1', [s.device_id]))).not.toContain(s.installation);
    // The app's token cannot reach account security, token management or the AI assistant endpoint.
    expect((await bearer(s.access_token, 'GET', '/api/auth/sessions')).status).toBe(403);
    expect((await bearer(s.access_token, 'GET', '/api/me/tokens')).status).toBe(403);
    expect((await bearer(s.access_token, 'GET', '/api/mcp/session')).status).toBe(403);
    // And cannot start another sign-in.
    expect((await bearer(s.access_token, 'POST', '/api/mobile/oauth/authorize', request(randomUUID(), pkce().challenge))).status).toBe(403);
  });

  it('refuses a wrong verifier, a wrong installation, a wrong redirect and an expired code', async () => {
    await clearLimits();
    const installation = randomUUID();
    const { verifier, challenge } = pkce();
    const params = request(installation, challenge);
    const codeOf = async () => new URL((await t.api.post('/api/mobile/oauth/decision', { ...params, approve: true })).body.redirect).searchParams.get('code')!;
    const base = { grant_type: 'authorization_code', redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: installation };
    expect((await token({ ...base, code: await codeOf(), code_verifier: pkce().verifier })).body.error).toBe('invalid_grant');
    expect((await token({ ...base, code: await codeOf(), code_verifier: verifier, installation_id: randomUUID() })).body.error).toBe('invalid_grant');
    expect((await token({ ...base, code: await codeOf(), code_verifier: verifier, redirect_uri: 'com.sandpipergrc:/other' })).body.error).toBe('invalid_grant');
    const late = await codeOf();
    await t.db.query(`update mobile_codes set expires_at = now() - interval '1 second' where code_hash = $1`, [createHash('sha256').update(late).digest('hex')]);
    expect((await token({ ...base, code: late, code_verifier: verifier })).body.error).toBe('invalid_grant');
    expect((await token({ ...base, code: await codeOf(), code_verifier: verifier, grant_type: 'password' })).body.error).toBe('unsupported_grant_type');
    // A declined sign-in goes back to the app with access_denied.
    const declined = await t.api.post('/api/mobile/oauth/decision', { ...params, approve: false });
    expect(new URL(declined.body.redirect).searchParams.get('error')).toBe('access_denied');
    // Wrong client or redirect at the sign-in page: refused there, never sent to the app.
    expect((await t.api.post('/api/mobile/oauth/authorize', { ...params, redirect_uri: 'https://evil.example/cb' })).status).toBe(400);
    expect((await t.api.post('/api/mobile/oauth/decision', { ...params, client_id: 'someone-else', approve: true })).status).toBe(400);
    await clearLimits();
  });

  it('rotates refresh tokens, and a reused one signs the device out', async () => {
    const s = await signIn();
    const refresh = (rt: string, installation = s.installation) => token({ grant_type: 'refresh_token', refresh_token: rt, client_id: MOBILE_CLIENT_ID, installation_id: installation });
    const r1 = await refresh(s.refresh_token);
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(s.refresh_token);
    expect(r1.body.device_id).toBe(s.device_id);
    expect((await bearer(r1.body.access_token, 'GET', '/api/mobile/settings')).status).toBe(200);
    // The old refresh token again: someone else may hold it. The whole device is signed out.
    expect((await refresh(s.refresh_token)).body.error).toBe('invalid_grant');
    expect((await bearer(r1.body.access_token, 'GET', '/api/mobile/settings')).status).toBe(401);
    expect((await refresh(r1.body.refresh_token)).body.error).toBe('invalid_grant');
    const row = await t.db.one<any>('select revoked_at, revoked_reason from mobile_devices where id = $1', [s.device_id]);
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoked_reason).toBe('refresh token used twice');
    expect((await t.db.query(`select 1 from audit_events where action = 'mobile.refresh_reuse' and record_id = $1`, [s.device_id])).length).toBe(1);
    await clearLimits();
  });

  describe('a refresh repeated because its answer was lost (30-second grace)', () => {
    const refresh = (s: Record<string, any>, rt: string) => token({ grant_type: 'refresh_token', refresh_token: rt, client_id: MOBILE_CLIENT_ID, installation_id: s.installation });
    const alive = async (accessToken: string) => (await bearer(accessToken, 'GET', '/api/mobile/settings')).status === 200;

    it('answers a retry within the window while the first answer is unused, and the first answer stops working', async () => {
      const s = await signIn();
      const first = await refresh(s, s.refresh_token); // answered, but say the phone never received it
      expect(first.status).toBe(200);
      const retry = await refresh(s, s.refresh_token);
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(retry.body.device_id).toBe(s.device_id);
      expect(retry.body.refresh_token).not.toBe(first.body.refresh_token);
      expect(Object.keys(retry.body)).not.toContain('pairId');
      expect(await alive(retry.body.access_token)).toBe(true);
      expect(await alive(first.body.access_token)).toBe(false);
      expect((await t.db.query(`select 1 from audit_events where action = 'mobile.refresh_retry' and record_id = $1`, [s.device_id])).length).toBe(1);
      // The chain goes on from the retry's tokens.
      const next = await refresh(s, retry.body.refresh_token);
      expect(next.status).toBe(200);
      expect(await alive(next.body.access_token)).toBe(true);
      // The replaced refresh token presented later: reuse, the device is signed out.
      expect((await refresh(s, first.body.refresh_token)).body.error).toBe('invalid_grant');
      expect(await alive(next.body.access_token)).toBe(false);
      await clearLimits();
    });

    it('signs out when the first answer\'s access token was used', async () => {
      const s = await signIn();
      const first = await refresh(s, s.refresh_token);
      expect(await alive(first.body.access_token)).toBe(true);
      expect((await refresh(s, s.refresh_token)).body.error).toBe('invalid_grant');
      expect(await alive(first.body.access_token)).toBe(false);
      expect((await t.db.one<any>('select revoked_reason from mobile_devices where id = $1', [s.device_id])).revoked_reason).toBe('refresh token used twice');
      await clearLimits();
    });

    it('signs out when the first answer\'s refresh token was used', async () => {
      const s = await signIn();
      const first = await refresh(s, s.refresh_token);
      const second = await refresh(s, first.body.refresh_token);
      expect(second.status).toBe(200);
      expect((await refresh(s, s.refresh_token)).body.error).toBe('invalid_grant');
      expect(await alive(second.body.access_token)).toBe(false);
      await clearLimits();
    });

    it('signs out when the retry comes after 30 seconds', async () => {
      const s = await signIn();
      const first = await refresh(s, s.refresh_token);
      await t.db.query(`update mobile_tokens set used_at = now() - interval '31 seconds' where device_id = $1 and kind = 'refresh' and used_at is not null`, [s.device_id]);
      expect((await refresh(s, s.refresh_token)).body.error).toBe('invalid_grant');
      expect(await alive(first.body.access_token)).toBe(false);
      expect((await t.db.one<any>('select revoked_at from mobile_devices where id = $1', [s.device_id])).revoked_at).not.toBeNull();
      await clearLimits();
    });

    it('signs out when the retry comes from another installation', async () => {
      const s = await signIn();
      await refresh(s, s.refresh_token);
      const other = await token({ grant_type: 'refresh_token', refresh_token: s.refresh_token, client_id: MOBILE_CLIENT_ID, installation_id: randomUUID() });
      expect(other.body.error).toBe('invalid_grant');
      expect((await t.db.one<any>('select revoked_reason from mobile_devices where id = $1', [s.device_id])).revoked_reason).toBe('refresh token sent from another installation');
      await clearLimits();
    });

    it('answers exactly one of two retries sent at the same moment, and that answer keeps working', async () => {
      const s = await signIn();
      await refresh(s, s.refresh_token);
      const both = await Promise.all([refresh(s, s.refresh_token), refresh(s, s.refresh_token)]);
      const ok = both.filter((r) => r.status === 200);
      expect(ok.length).toBe(1);
      expect(both.find((r) => r.status !== 200)!.body.error).toBe('invalid_grant');
      expect(await alive(ok[0].body.access_token)).toBe(true);
      // A third presentation once the retry's answer has been used: reuse.
      expect((await refresh(s, s.refresh_token)).body.error).toBe('invalid_grant');
      expect(await alive(ok[0].body.access_token)).toBe(false);
      await clearLimits();
    });
  });

  it('signs the device out when a refresh token comes from another installation, or a code is used twice', async () => {
    const s = await signIn();
    const other = await token({ grant_type: 'refresh_token', refresh_token: s.refresh_token, client_id: MOBILE_CLIENT_ID, installation_id: randomUUID() });
    expect(other.body.error).toBe('invalid_grant');
    expect((await bearer(s.access_token, 'GET', '/api/me/devices')).status).toBe(401);

    const s2 = await signIn();
    const again = await token({ grant_type: 'authorization_code', code: s2.code, code_verifier: s2.verifier, redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: s2.installation });
    expect(again.body.error).toBe('invalid_grant');
    expect((await bearer(s2.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    await clearLimits();
  });

  it('keeps one device per installation: signing in again gives the same device and ends its earlier tokens', async () => {
    const installation = randomUUID();
    const a = await signIn(t.api, installation);
    const b = await signIn(t.api, installation, { device_name: 'Field phone 12 (renamed)' });
    expect(b.device_id).toBe(a.device_id);
    expect((await bearer(a.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    const old = await token({ grant_type: 'refresh_token', refresh_token: a.refresh_token, client_id: MOBILE_CLIENT_ID, installation_id: installation });
    expect(old.body.error).toBe('invalid_grant');
    // An ended (not reused) token does not sign the device out.
    expect((await bearer(b.access_token, 'GET', '/api/me/devices')).status).toBe(200);
    await clearLimits();
  });

  it('signs out from the app (revocation), from Account > Devices and from the administrator\'s page', async () => {
    const a = await signIn();
    expect((await revoke({ token: a.refresh_token, client_id: MOBILE_CLIENT_ID })).status).toBe(200);
    expect((await bearer(a.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    expect((await revoke({ token: 'grc_mrt_unknown', client_id: MOBILE_CLIENT_ID })).status).toBe(200); // unknown: same answer

    const b = await signIn();
    expect((await t.api.del(`/api/me/devices/${b.device_id}`)).status).toBe(200);
    expect((await bearer(b.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    expect((await t.api.del(`/api/me/devices/${b.device_id}`)).status).toBe(404);

    const agent = await t.as('agent');
    const c = await signIn(agent);
    const d = await signIn(agent);
    // Another person cannot see or sign out someone else's device.
    expect((await t.api.del(`/api/me/devices/${c.device_id}`)).status).toBe(404);
    expect((await agent.get(`/api/admin/users/${agent.userId}/devices`)).status).toBe(403);
    const list = await t.api.get(`/api/admin/users/${agent.userId}/devices`);
    expect(list.body.filter((x: any) => !x.revokedAt).map((x: any) => x.id).sort()).toEqual([c.device_id, d.device_id].sort());
    expect((await t.api.del(`/api/admin/users/${agent.userId}/devices/${c.device_id}`)).status).toBe(200);
    expect((await bearer(c.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    expect((await bearer(d.access_token, 'GET', '/api/me/devices')).status).toBe(200);
    expect((await t.api.del(`/api/admin/users/${agent.userId}/devices`)).body.signedOut).toBe(1);
    expect((await bearer(d.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    const after = await agent.get('/api/me/devices');
    expect(after.body.every((x: any) => x.revokedAt)).toBe(true);
    expect(after.body[0].revokedReason).toBe('signed out by an administrator');
  });

  it('signs out every device when an account is disabled, deactivated or deprovisioned, and they stay out when it is enabled again', async () => {
    const agent = await t.as('agent');
    const a = await signIn(agent);
    expect((await t.api.post(`/api/admin/users/${agent.userId}/disable`)).status).toBe(200);
    expect((await bearer(a.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    expect((await t.api.post(`/api/admin/users/${agent.userId}/enable`)).status).toBe(200);
    expect((await bearer(a.access_token, 'GET', '/api/me/devices')).status).toBe(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: a.refresh_token, client_id: MOBILE_CLIENT_ID, installation_id: a.installation })).body.error).toBe('invalid_grant');
    expect((await t.api.get(`/api/admin/users/${agent.userId}/devices`)).body.find((x: any) => x.id === a.device_id).revokedAt).not.toBeNull();

    // Deactivation (as user provisioning does it) revokes the devices at once, in core.
    const other = await t.as('agent');
    const b = await signIn(other);
    const result = await deactivateUser(t.ctx, other.userId, { reason: 'deprovisioned by Test directory', by: null });
    expect(result).toMatchObject({ devices: 1 });
    const row = await t.db.one<any>('select revoked_at, revoked_reason from mobile_devices where id = $1', [b.device_id]);
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoked_reason).toBe('deprovisioned by Test directory');
    const audit = await t.db.one<any>(`select summary from audit_events where action = 'user.deactivate' and record_id = $1`, [other.userId]);
    expect(audit.summary).toContain('1 mobile device(s) signed out');
    await clearLimits();
  });

  it('honors a recent sign-in claim from prompt=login for sensitive actions, for the confirmation window only', async () => {
    const installation = randomUUID();
    const plain = await signIn(t.api, installation);
    // A sensitive action (it asks for the password on the web): refused with the plain token.
    const change = (at: string, minutes: number) => bearer(at, 'PUT', '/api/mobile/admin/settings', { accessMinutes: minutes });
    expect((await change(plain.access_token, 20)).body.error.code).toBe('reauth_required');
    // Signing in again with prompt=login gives tokens for the same device carrying the claim.
    const fresh = await signIn(t.api, installation, { prompt: 'login' });
    expect(fresh.device_id).toBe(plain.device_id);
    expect(typeof fresh.auth_time).toBe('string');
    expect((await change(fresh.access_token, 20)).status).toBe(200);
    // A refresh does not move the claim: once the sign-in is older than the window, it is refused again.
    await t.db.query(`update mobile_devices set auth_time = now() - interval '11 minutes' where id = $1`, [fresh.device_id]);
    const rotated = await token({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token, client_id: MOBILE_CLIENT_ID, installation_id: installation });
    expect(rotated.status).toBe(200);
    expect((await change(rotated.body.access_token, 25)).body.error.code).toBe('reauth_required');
    // A later sign-in without prompt=login clears it.
    const again = await signIn(t.api, installation, { prompt: 'login' });
    expect((await change(again.access_token, 25)).status).toBe(200);
    const normal = await signIn(t.api, installation);
    expect((await change(normal.access_token, 30)).body.error.code).toBe('reauth_required');
    // Personal access tokens never carry a claim, even one made a moment after a password confirmation.
    const pat = await t.api.post('/api/me/tokens', { name: 'Script for the claim test', scopes: ['*'], expiresInDays: 1 });
    expect(pat.status, JSON.stringify(pat.body)).toBe(201);
    expect((await change(pat.body.token, 35)).body.error.code).toBe('reauth_required');
    await t.api.put('/api/mobile/admin/settings', { accessMinutes: 15 });
  });

  it('uses the administrator\'s token lifetimes, and validates and confirms the settings', async () => {
    expect((await t.api.put('/api/mobile/admin/settings', { accessMinutes: 4 })).status).toBe(400);
    expect((await t.api.put('/api/mobile/admin/settings', { requireUnlock: 'yes' })).status).toBe(400);
    expect((await t.api.put('/api/mobile/admin/settings', { accessMinutes: 5, requireUnlock: true, unlockAfterMinutes: 2 })).status).toBe(200);
    const s = await signIn();
    expect(s.expires_in).toBe(300);
    const settings = await bearer(s.access_token, 'GET', '/api/mobile/settings');
    expect(settings.body.unlock).toEqual({ required: true, afterMinutes: 2 });
    expect(settings.body.user.username).toBe('admin');
    expect(settings.body.areas.mobile).toBe(true);
    expect(Array.isArray(settings.body.tags?.formats)).toBe(true);
    // An older confirmation is not enough to change them.
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 hour'`);
    expect((await t.api.put('/api/mobile/admin/settings', { accessMinutes: 15 })).body.error.code).toBe('reauth_required');
    await t.db.query(`update sessions set confirmed_at = now()`);
    expect((await t.api.put('/api/mobile/admin/settings', { accessMinutes: 15, requireUnlock: false, unlockAfterMinutes: 5 })).status).toBe(200);
    expect((await t.api.get('/api/mobile/admin/settings')).body.settings).toMatchObject({ accessMinutes: 15, refreshDays: 30, requireUnlock: false, offlineDays: 7 });
  });

  it('leaves the AI assistant OAuth server as it was', async () => {
    // The assistant connectors' switch stays off, yet the app signs in; the assistant routes do not know the app's client.
    expect((await t.api.get('/api/mcp/admin/settings')).body.oauthEnabled ?? false).toBe(false);
    const res = await t.api.post('/api/mcp/oauth/authorize', request(randomUUID(), pkce().challenge));
    expect(res.status).toBe(409); // assistant sign-in is off: unchanged answer
    const tok = await token({ grant_type: 'refresh_token', refresh_token: 'grc_ort_x', client_id: 'grc_cli_unknown' });
    expect(tok.status).toBe(404); // assistant token endpoint while off: unchanged
    // An app token is never an assistant token.
    const s = await signIn();
    const mcp = await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, payload: {} });
    expect(mcp.statusCode).not.toBe(200);
  });

  it('gives My work with the same figures as the web, and leaves switched-off areas out', async () => {
    const s = await signIn();
    const me = (await t.api.get('/api/auth/state')).body.user.id;
    await t.api.post('/api/tickets', { title: 'Platform display blank at the north depot', assignee_id: me });
    await t.api.post('/api/tickets', { title: 'Fare reader offline on bus 4410', assignee_id: me });
    const home = await bearer(s.access_token, 'GET', '/api/mobile/home');
    expect(home.status).toBe(200);
    const tickets = home.body.sections.find((x: any) => x.key === 'tickets');
    const web = await t.api.get(`/api/tickets?f.assignee_id=${me}&f.resolved_at.null=true&sort=resolve_due_at&dir=asc&pageSize=5`);
    expect(tickets.count).toBe(web.body.total);
    expect(tickets.count).toBeGreaterThanOrEqual(2);
    expect(tickets.items.length).toBeLessThanOrEqual(5);
    expect(tickets.items[0]).toMatchObject({ type: 'ticket', route: expect.stringMatching(/^\/tickets\//) });
    const actions = home.body.sections.find((x: any) => x.key === 'actions');
    if (actions) {
      const open = (await t.api.get('/api/lookups/action_status')).body
        .filter((v: any) => !['done', 'cancelled'].includes(v.value) && v.meta?.closed !== true).map((v: any) => v.value).join(',');
      expect(actions.count).toBe((await t.api.get(`/api/actions?f.owner_id=${me}&f.status=${open}`)).body.total);
    }
    const approvals = home.body.sections.find((x: any) => x.key === 'approvals');
    if (approvals) expect(approvals.count).toBe((await t.api.get('/api/workflows/approvals/count')).body.waiting);
    const training = home.body.sections.find((x: any) => x.key === 'training');
    if (training) expect(training.count).toBe((await t.api.get('/api/training/mine')).body.rows.filter((r: any) => !r.completed_on).length);
    expect(home.body.unreadNotifications).toBe((await t.api.get('/api/notifications/unread-count')).body.unread ?? 0);

    // The same for a browser session.
    const viaSession = await t.api.get('/api/mobile/home');
    expect(viaSession.body.sections.map((x: any) => [x.key, x.count])).toEqual(home.body.sections.map((x: any) => [x.key, x.count]));

    const features = await t.api.patch('/api/admin/features', { features: { tickets: false, portal: false } });
    expect(features.status, JSON.stringify(features.body)).toBe(200);
    try {
      await t.api.get('/api/auth/state');
      const off = await bearer(s.access_token, 'GET', '/api/mobile/home');
      expect(off.body.sections.map((x: any) => x.key)).not.toContain('tickets');
      const settings = await bearer(s.access_token, 'GET', '/api/mobile/settings');
      expect(settings.body.areas.tickets).toBe(false);
    } finally {
      await t.api.patch('/api/admin/features', { features: { tickets: true } });
    }
    await t.api.patch('/api/admin/features', { features: { tags: false } });
    try {
      await t.api.get('/api/auth/state');
      expect((await bearer(s.access_token, 'GET', '/api/mobile/settings')).body.tags).toBeNull();
    } finally {
      await t.api.patch('/api/admin/features', { features: { tags: true } });
    }
  });

  it('signs out every device when the area is switched off, and they stay out when it is on again', async () => {
    const a = await signIn();
    const agent = await t.as('agent');
    const b = await signIn(agent);
    await setMobile(false);
    expect((await bearer(a.access_token, 'GET', '/api/auth/state')).status).toBe(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: b.refresh_token, client_id: MOBILE_CLIENT_ID, installation_id: b.installation })).body.error).toBe('switched_off');
    await setMobile(true);
    expect((await bearer(a.access_token, 'GET', '/api/auth/state')).status).toBe(401);
    expect((await token({ grant_type: 'refresh_token', refresh_token: b.refresh_token, client_id: MOBILE_CLIENT_ID, installation_id: b.installation })).body.error).toBe('invalid_grant');
    const listed = (await agent.get('/api/me/devices')).body.find((x: any) => x.id === b.device_id);
    expect(listed.revokedReason).toBe('The Mobile app area was switched off');
    // A new sign-in works again.
    const c = await signIn();
    expect((await bearer(c.access_token, 'GET', '/api/me/devices')).status).toBe(200);
    await clearLimits();
  });
});
