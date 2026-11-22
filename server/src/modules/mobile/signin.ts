// Signing in to the mobile app (wave 13, E38-02; spec §5.2): the `mobile` client kind of the OAuth
// server in modules/mcp/oauth.ts.
//
// - The client is built in: client_id com.sandpipergrc, the only redirect com.sandpipergrc:/oauth,
//   a public client with PKCE (S256) required. No administrator step; it does not exist while the
//   Mobile app area is off (the token and revocation endpoints answer `switched_off`, and this
//   module's /api routes answer 404).
// - The sign-in page is the web page /oauth/authorize, which asks this module
//   (POST /api/mobile/oauth/authorize, .../decision) as the signed-in person. Approving needs a recent
//   password (and second factor) confirmation, as creating any credential does. `prompt=login` makes
//   the resulting tokens carry a recent sign-in claim (auth_time) that sensitive actions accept for
//   auth.reauth_minutes (core/auth.ts requireRecentAuth).
// - Tokens: access tokens (mobile.access_minutes, default 15) usable on every /api route as the person,
//   and refresh tokens (mobile.refresh_days of inactivity, default 30) that rotate on every use. Both
//   are bound to one device: the installation id the app made, which every token request must repeat.
//   A refresh token presented again after it was used revokes the device.
// - Codes, tokens and installation ids are stored as SHA-256 only.
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import type { Queryable } from '../../core/db.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { clientIp } from '../../core/request.ts';
import type { BearerResolution } from '../../core/tokens.ts';
import {
  MOBILE_ACCESS_PREFIX, MOBILE_CLIENT_ID, MOBILE_COMPAT, MOBILE_REDIRECT_URI, MOBILE_REFRESH_PREFIX, MOBILE_SCOPE,
} from '../../../../shared/mobile-api.ts';
import { defineOAuthClientKind, oauthBase, pkceMatches, type OAuthKindHelpers } from '../mcp/oauth.ts';
import {
  APP_VERSION_RE, cleanDeviceName, compareVersions, DISABLED_SINCE_SQL, installationHash, lastSwitchedOff, mobileOn, OFF_REASON,
  randomSecret, readMobileSettings, revokeDevice, sameHash, settleDisabled, settleSwitchedOff, sha, type MobileAdminSettings,
} from './state.ts';

export const CODE_SECONDS = 300;
/**
 * A refresh repeated this soon after its first use, while the tokens given then were never used, is a
 * retry (the phone lost the answer), not a reuse: it is answered once more and the unused tokens are replaced.
 */
export const RETRY_GRACE_SECONDS = 30;

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method',
  'installation_id', 'device_name', 'device_platform', 'app_version', 'prompt'] as const;
type Params = Partial<Record<(typeof PARAMS)[number], string>>;

interface Request {
  state: string; challenge: string; installationId: string; deviceName: string; platform: 'ios' | 'android'; appVersion: string; promptLogin: boolean;
}
type Checked =
  | { kind: 'stop'; status: number; code: string; message: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'ok'; request: Request; issuer: string };

/** The authorization request's parameters, as strings. */
export const paramsOf = (b: Row): Params => {
  const out: Params = {};
  for (const k of PARAMS) if (b[k] !== undefined && b[k] !== null) out[k] = String(b[k]);
  return out;
};

/** The redirect back to the app with these parameters (and state and iss). */
export function backToApp(params: Record<string, string>, state: string | undefined, issuer: string): string {
  const u = new URL(MOBILE_REDIRECT_URI);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (state !== undefined) u.searchParams.set('state', state);
  u.searchParams.set('iss', issuer);
  return u.href;
}

/** Checks an authorization request of the app. Never redirects anywhere but the app's own address. */
export function checkRequest(p: Params, issuer: string): Checked {
  if (p.client_id !== MOBILE_CLIENT_ID) return { kind: 'stop', status: 400, code: 'invalid_client', message: 'This sign-in request is not from the Sandpiper GRC app.' };
  if (p.redirect_uri !== MOBILE_REDIRECT_URI) {
    return { kind: 'stop', status: 400, code: 'invalid_redirect_uri', message: 'The app asked to return to an address that is not its own. Nothing was sent to it.' };
  }
  const state = p.state;
  const back = (error: string, description: string): Checked => ({ kind: 'redirect', url: backToApp({ error, error_description: description }, state, issuer) });
  if (p.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (!state || state.length > 1000) return back('invalid_request', 'Send a state of up to 1000 characters.');
  if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge ?? '')) return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  if ((p.scope ?? MOBILE_SCOPE) !== MOBILE_SCOPE) return back('invalid_scope', `The app's scope is "${MOBILE_SCOPE}".`);
  if (!UUID_RE.test(p.installation_id ?? '')) return back('invalid_request', 'installation_id must be a UUID.');
  const deviceName = cleanDeviceName(p.device_name);
  if (!deviceName) return back('invalid_request', 'Send a device_name of up to 80 characters.');
  if (p.device_platform !== 'ios' && p.device_platform !== 'android') return back('invalid_request', 'device_platform must be ios or android.');
  const appVersion = String(p.app_version ?? '');
  if (!APP_VERSION_RE.test(appVersion)) return back('invalid_request', 'Send the app_version (for example 0.1.0).');
  if (compareVersions(appVersion, MOBILE_COMPAT.minVersion) < 0) {
    return back('invalid_request', `This version of the app is too old for this server (it needs ${MOBILE_COMPAT.minVersion} or later). Update the app.`);
  }
  if (p.prompt !== undefined && p.prompt !== '' && p.prompt !== 'login') return back('invalid_request', 'prompt may only be login.');
  return {
    kind: 'ok', issuer,
    request: {
      state, challenge: p.code_challenge!, installationId: p.installation_id!.toLowerCase(), deviceName, platform: p.device_platform,
      appVersion, promptLogin: p.prompt === 'login',
    },
  };
}

export function registerSignIn(ctx: ModuleContext) {
  const { app, db } = ctx;
  const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);
  const sessionOnly = (req: FastifyRequest) => {
    if (req.apiToken) ctx.fail(403, 'token_not_allowed', 'Sign in to the app from the browser, not with a token.');
  };

  // ---------- access tokens on every /api route, as the person ----------

  app.registerBearerResolver(MOBILE_ACCESS_PREFIX, async (token, req) => {
    if (!(await mobileOn(db))) return null;
    const row = await db.one<Row>(
      `select d.id, d.user_id, d.name, d.auth_time, d.signed_in_at, (t.used_at is null) as first_use,
              (d.last_used_at is null or d.last_used_at < now() - interval '1 minute') as stale
       from mobile_tokens t join mobile_devices d on d.id = t.device_id
       where t.token_hash = $1 and t.kind = 'access' and t.expires_at > now() and d.revoked_at is null and not ${DISABLED_SINCE_SQL}`, [sha(token)]);
    if (!row) return null;
    const off = await lastSwitchedOff(db);
    if (off !== null && new Date(row.signed_in_at).getTime() <= off) {
      await revokeDevice(db, row.id, OFF_REASON);
      return null;
    }
    // The first use of an access token ends the retry grace of the refresh that gave it.
    if (row.first_use) await db.query('update mobile_tokens set used_at = now() where token_hash = $1 and used_at is null', [sha(token)]);
    if (row.stale) await db.query('update mobile_devices set last_used_at = now(), last_used_ip = $2 where id = $1', [row.id, clientIp(req)]);
    const found: BearerResolution = {
      id: row.id, name: `Mobile app: ${row.name}`, userId: row.user_id,
      // The person's own permissions, as on the web (spec §5.2); never a scope family such as mcp.use.
      scopes: ['*'],
      // Only a prompt=login sign-in sets auth_time; core honors it for auth.reauth_minutes from then.
      confirmedAt: row.auth_time ? new Date(row.auth_time).toISOString() : null,
    };
    return found;
  });

  // ---------- the token and revocation endpoints (the `mobile` client kind) ----------

  /** Never reads through the shared handle: it may run inside a transaction (the embedded database would wait for ever). */
  async function issueTokens(q: Queryable, deviceId: string, s: MobileAdminSettings) {
    const access = randomSecret(MOBILE_ACCESS_PREFIX);
    const refresh = randomSecret(MOBILE_REFRESH_PREFIX);
    const pairId = randomUUID();
    await q.query(
      `insert into mobile_tokens (token_hash, device_id, kind, expires_at, pair_id) values
         ($1, $3, 'access', now() + make_interval(mins => $4::int), $6),
         ($2, $3, 'refresh', now() + make_interval(days => $5::int), $6)`,
      [sha(access), sha(refresh), deviceId, s.accessMinutes, s.refreshDays, pairId]);
    return { access_token: access, token_type: 'Bearer', expires_in: s.accessMinutes * 60, refresh_token: refresh, scope: MOBILE_SCOPE, device_id: deviceId, pairId };
  }

  const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store').header('pragma', 'no-cache');

  async function token(req: FastifyRequest, reply: FastifyReply, body: Record<string, string>, h: OAuthKindHelpers) {
    if (!(await mobileOn(db))) return h.error(reply, 400, 'switched_off', 'The mobile app is switched off on this server.');
    const ip = clientIp(req);
    if (await h.failures.blocked(ip)) return h.error(reply, 429, 'temporarily_unavailable', 'Too many failed requests. Wait a few minutes and try again.', { 'retry-after': '300' });
    const failed = async (status: number, error: string, description: string) => {
      await h.failures.hit(ip);
      return h.error(reply, status, error, description);
    };
    if (!UUID_RE.test(body.installation_id ?? '')) return failed(400, 'invalid_request', 'Send the installation_id.');
    const installation = installationHash(body.installation_id);

    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.code_verifier || !body.redirect_uri) return failed(400, 'invalid_request', 'Send code, code_verifier and redirect_uri.');
      // Single use, atomically: a second attempt finds used_at already set.
      const code = await db.one<Row>(`update mobile_codes set used_at = now() where code_hash = $1 and used_at is null returning *`, [sha(body.code)]);
      if (!code) {
        const replay = await db.one<Row>('select device_id from mobile_codes where code_hash = $1', [sha(body.code)]);
        if (replay?.device_id && await revokeDevice(db, replay.device_id, 'authorization code used twice')) {
          await ctx.audit(req, { action: 'mobile.code_reuse', recordType: 'mobile_device', recordId: replay.device_id, summary: 'A mobile app sign-in code was used twice; the device was signed out' });
        }
        return failed(400, 'invalid_grant', 'The authorization code is not valid (unknown, used or expired).');
      }
      if (new Date(code.expires_at).getTime() <= Date.now()) return failed(400, 'invalid_grant', 'The authorization code has expired.');
      if (body.redirect_uri !== MOBILE_REDIRECT_URI) return failed(400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
      if (!pkceMatches(body.code_verifier, code.code_challenge)) return failed(400, 'invalid_grant', 'The code_verifier does not match the code_challenge.');
      if (!sameHash(installation, code.installation_hash)) return failed(400, 'invalid_grant', 'The code was issued to another installation of the app.');
      const owner = await db.one<Row>(`select id, username from users where id = $1 and status = 'active' and deleted_at is null`, [code.user_id]);
      if (!owner) return failed(400, 'invalid_grant', 'This account can no longer sign in.');
      // An earlier device of this installation that was signed out by a switch-off or a disabled account stays so.
      await settleSwitchedOff(db);
      await settleDisabled(db, code.user_id);
      const lifetimes = await readMobileSettings(ctx);
      let made: { tokens: Record<string, unknown>; deviceId: string; again: boolean };
      try {
        made = await db.tx(async (tx) => {
          // The same installation signed in again (for example prompt=login): the same device, its earlier tokens ended.
          const existing = await tx.one<Row>(
            `select id from mobile_devices where user_id = $1 and installation_hash = $2 and revoked_at is null for update`, [code.user_id, code.installation_hash]);
          let deviceId: string;
          if (existing) {
            deviceId = existing.id;
            await tx.query(
              `update mobile_devices set name = $2, platform = $3, app_version = $4, signed_in_at = now(), auth_time = $5,
                 last_used_at = now(), last_used_ip = $6 where id = $1`,
              [deviceId, code.device_name, code.platform, code.app_version, code.prompt_login ? code.auth_time : null, ip]);
            await tx.query(`update mobile_tokens set expires_at = least(expires_at, now()) where device_id = $1`, [deviceId]);
          } else {
            deviceId = (await tx.one<Row>(
              `insert into mobile_devices (user_id, installation_hash, name, platform, app_version, auth_time, last_used_at, last_used_ip)
               values ($1, $2, $3, $4, $5, $6, now(), $7) returning id`,
              [code.user_id, code.installation_hash, code.device_name, code.platform, code.app_version, code.prompt_login ? code.auth_time : null, ip]))!.id;
          }
          await tx.query('update mobile_codes set device_id = $2 where code_hash = $1', [code.code_hash, deviceId]);
          return { tokens: await issueTokens(tx, deviceId, lifetimes), deviceId, again: Boolean(existing) };
        });
      } catch {
        return failed(400, 'invalid_grant', 'The sign-in could not be completed. Sign in again.');
      }
      await ctx.audit(req, {
        action: 'mobile.sign_in', recordType: 'mobile_device', recordId: made.deviceId,
        summary: `${owner.username} signed in to the mobile app on "${code.device_name}" (${code.platform}, app ${code.app_version})${code.prompt_login ? ' again for a sensitive action' : made.again ? ' again' : ''}`,
      });
      noStore(reply);
      const { pairId: _pair, ...answer } = made.tokens;
      return { ...answer, ...(code.prompt_login && code.auth_time ? { auth_time: new Date(code.auth_time).toISOString() } : {}) };
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return failed(400, 'invalid_request', 'Send refresh_token.');
      const hash = sha(body.refresh_token);
      const presented = await db.one<Row>(`select device_id, superseded_at from mobile_tokens where token_hash = $1 and kind = 'refresh'`, [hash]);
      if (!presented) return failed(400, 'invalid_grant', 'The refresh token is not valid (unknown, used or revoked). Sign in again.');
      const reuse = async () => {
        // Presented again after it was rotated (and not a retry the grace allows), or a token a retry replaced:
        // someone else may hold it. Sign the whole device out.
        if (await revokeDevice(db, presented.device_id, 'refresh token used twice')) {
          await ctx.audit(req, { action: 'mobile.refresh_reuse', recordType: 'mobile_device', recordId: presented.device_id, summary: 'A mobile app refresh token was used twice; the device was signed out' });
        }
        return failed(400, 'invalid_grant', 'The refresh token is not valid (unknown, used or revoked). Sign in again.');
      };
      if (presented.superseded_at) return reuse();
      const device = await db.one<Row>(`select d.*, ${DISABLED_SINCE_SQL} as disabled from mobile_devices d where d.id = $1 and d.revoked_at is null`, [presented.device_id]);
      if (!device) return failed(400, 'invalid_grant', 'This device was signed out. Sign in again.');
      if (!sameHash(installation, device.installation_hash)) {
        await revokeDevice(db, device.id, 'refresh token sent from another installation');
        await ctx.audit(req, { action: 'mobile.installation_mismatch', recordType: 'mobile_device', recordId: device.id, summary: `A refresh token of "${device.name}" was sent from another installation of the app; the device was signed out` });
        return failed(400, 'invalid_grant', 'The refresh token belongs to another installation of the app.');
      }
      const off = await lastSwitchedOff(db);
      if (off !== null && new Date(device.signed_in_at).getTime() <= off) {
        await revokeDevice(db, device.id, OFF_REASON);
        return failed(400, 'invalid_grant', 'This device was signed out. Sign in again.');
      }
      if (device.disabled || !(await db.one(`select 1 from users where id = $1 and status = 'active' and deleted_at is null`, [device.user_id]))) {
        await revokeDevice(db, device.id, 'account no longer active');
        return failed(400, 'invalid_grant', 'This account can no longer sign in.');
      }
      const lifetimes = await readMobileSettings(ctx);
      // Rotation, or the retry grace, in one transaction with the presented token's row locked, so two
      // requests with the same token can never both be answered.
      const outcome = await db.tx(async (tx): Promise<{ tokens: Record<string, unknown>; retry: boolean } | 'busy' | 'reuse' | 'lapsed'> => {
        const row = await tx.one<Row>(
          `select used_at, retried_at, rotated_to, expires_at > now() as live,
                  (used_at > now() - make_interval(secs => $2::int)) as recent,
                  (retried_at > now() - make_interval(secs => $2::int)) as retried_recently
           from mobile_tokens where token_hash = $1 and kind = 'refresh' for update`, [hash, RETRY_GRACE_SECONDS]);
        if (!row) return 'reuse';
        if (!row.used_at) {
          if (!row.live) return 'lapsed';
          await tx.query('update mobile_tokens set used_at = now() where token_hash = $1', [hash]);
          const tokens = await issueTokens(tx, device.id, lifetimes);
          await tx.query('update mobile_tokens set rotated_to = $2 where token_hash = $1', [hash, tokens.pairId]);
          return { tokens, retry: false };
        }
        // Used already. A retry (the answer to the first use was lost) is allowed once, within the grace,
        // and only while the pair given then has never been used; it replaces that pair.
        if (!row.rotated_to) return 'reuse';
        const successor = await tx.query<Row>(
          `select used_at, superseded_at, expires_at > now() as live from mobile_tokens where pair_id = $1 for update`, [row.rotated_to]);
        const unused = successor.length === 2 && successor.every((s) => !s.used_at && !s.superseded_at && s.live);
        // A second retry while the first one's answer is still unused (two at the same moment): refused, nothing changes.
        if (row.retried_at) return row.retried_recently && unused ? 'busy' : 'reuse';
        if (!row.recent || !unused) return 'reuse';
        await tx.query(`update mobile_tokens set expires_at = least(expires_at, now()), superseded_at = now() where pair_id = $1`, [row.rotated_to]);
        const tokens = await issueTokens(tx, device.id, lifetimes);
        await tx.query('update mobile_tokens set retried_at = now(), rotated_to = $2 where token_hash = $1', [hash, tokens.pairId]);
        return { tokens, retry: true };
      });
      if (outcome === 'reuse') return reuse();
      if (outcome === 'lapsed') return failed(400, 'invalid_grant', 'This device\'s sign-in has lapsed. Sign in again.');
      if (outcome === 'busy') {
        // A second retry of the same token while the first is being answered: refused, nothing changes.
        return failed(400, 'invalid_grant', 'This refresh was already answered. Use the newest tokens.');
      }
      if (outcome.retry) {
        await ctx.audit(req, { action: 'mobile.refresh_retry', recordType: 'mobile_device', recordId: device.id, summary: `The mobile app on "${device.name}" repeated a refresh whose answer it did not receive; the unused tokens of the first answer were replaced` });
      }
      await db.query('update mobile_devices set last_used_at = now(), last_used_ip = $2 where id = $1', [device.id, ip]);
      noStore(reply);
      const { pairId: _pair, ...answer } = outcome.tokens;
      return answer;
    }

    return failed(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }

  async function revoke(req: FastifyRequest, reply: FastifyReply, body: Record<string, string>, h: OAuthKindHelpers) {
    if (!(await mobileOn(db))) return h.error(reply, 400, 'switched_off', 'The mobile app is switched off on this server.');
    if (!body.token) return h.error(reply, 400, 'invalid_request', 'Send the token to revoke.');
    const row = await db.one<Row>(
      `select d.id, d.name from mobile_tokens t join mobile_devices d on d.id = t.device_id where t.token_hash = $1`, [sha(body.token)]);
    // Unknown tokens are answered the same way (RFC 7009). Either token signs the whole device out.
    if (row && await revokeDevice(db, row.id, 'signed out in the app')) {
      await ctx.audit(req, { action: 'mobile.sign_out', recordType: 'mobile_device', recordId: row.id, summary: `The mobile app on "${row.name}" signed out` });
    }
    reply.header('cache-control', 'no-store');
    return {};
  }

  defineOAuthClientKind(app, { key: 'mobile', owns: (id) => id === MOBILE_CLIENT_ID, token, revoke });

  // ---------- the sign-in page's API (signed-in person, never a token) ----------

  app.post('/api/mobile/oauth/authorize', async (req) => {
    sessionOnly(req);
    const checked = checkRequest(paramsOf((req.body ?? {}) as Row), await oauthBase(ctx, req));
    if (checked.kind === 'stop') ctx.fail(checked.status, checked.code, checked.message);
    if (checked.kind === 'redirect') return { ok: false, redirect: checked.url };
    const r = (checked as Extract<Checked, { kind: 'ok' }>).request;
    const existing = await db.one(
      `select 1 from mobile_devices where user_id = $1 and installation_hash = $2 and revoked_at is null`, [req.user!.id, installationHash(r.installationId)]);
    return {
      ok: true,
      device: { name: r.deviceName, platform: r.platform, appVersion: r.appVersion },
      promptLogin: r.promptLogin, signedInAlready: Boolean(existing),
      appName: String(await ctx.settings.get('app.name', 'Sandpiper GRC')),
    };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/mobile/oauth/authorize', tag: 'Mobile app',
    summary: 'Check the mobile app\'s sign-in request for the sign-in page (signed-in session only)',
    body: '{ response_type, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, installation_id, device_name, device_platform, app_version, prompt? } (the query of /oauth/authorize)',
    response: '{ ok: true, device: { name, platform, appVersion }, promptLogin, signedInAlready, appName } | { ok: false, redirect }',
    description: 'A wrong client_id or redirect_uri is refused here (400 `invalid_client`, `invalid_redirect_uri`) and never sent back to the app; other problems answer `{ ok: false, redirect }` to the app\'s own address with an OAuth error.',
  });

  app.post('/api/mobile/oauth/decision', async (req) => {
    sessionOnly(req);
    const b = (req.body ?? {}) as Row;
    const checked = checkRequest(paramsOf(b), await oauthBase(ctx, req));
    if (checked.kind === 'stop') ctx.fail(checked.status, checked.code, checked.message);
    if (checked.kind === 'redirect') return { redirect: checked.url };
    const { request: r, issuer } = checked as Extract<Checked, { kind: 'ok' }>;
    const me = req.user!;
    if (b.approve !== true) {
      await ctx.audit(req, { action: 'mobile.sign_in_declined', recordType: 'user', recordId: me.id, summary: `Declined to sign in to the mobile app on "${r.deviceName}"` });
      return { redirect: backToApp({ error: 'access_denied', error_description: 'The person declined.' }, r.state, issuer) };
    }
    // Making a credential for a phone needs the password (and second factor) proved recently, as on the web.
    await recentAuth(req, r.promptLogin ? 'signing in again in the mobile app for a sensitive action' : 'signing in to the mobile app');
    // The recent sign-in claim: when this session last proved the password (never a value the app sends).
    const authTime = r.promptLogin && req.sessionHash
      ? (await db.one<Row>('select confirmed_at from sessions where token_hash = $1', [req.sessionHash]))?.confirmed_at ?? null
      : null;
    const code = randomSecret('');
    await db.query(
      `insert into mobile_codes (code_hash, user_id, installation_hash, device_name, platform, app_version, code_challenge, prompt_login, auth_time, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(secs => $10::int))`,
      [sha(code), me.id, installationHash(r.installationId), r.deviceName, r.platform, r.appVersion, r.challenge, r.promptLogin, authTime, CODE_SECONDS]);
    await ctx.audit(req, {
      action: 'mobile.consent', recordType: 'user', recordId: me.id,
      summary: `Allowed the mobile app on "${r.deviceName}" (${r.platform}) to sign in${r.promptLogin ? ' again for a sensitive action' : ''}`,
    });
    return { redirect: backToApp({ code }, r.state, issuer) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/mobile/oauth/decision', tag: 'Mobile app',
    summary: 'Approve or decline the mobile app\'s sign-in (signed-in session; recent password confirmation to approve)',
    body: '{ ...the authorization request, approve: boolean }',
    response: '{ redirect } - com.sandpipergrc:/oauth with code (or error), state and iss',
  });

  // Housekeeping: used and lapsed codes and tokens.
  return {
    async cleanup() {
      await db.query(`delete from mobile_codes where expires_at < now() - interval '1 day'`);
      // Tokens a retry replaced are kept as long as a refresh token lives, so presenting one still signs the device out.
      await db.query(`delete from mobile_tokens where expires_at < now() - interval '1 day' and (superseded_at is null or superseded_at < now() - interval '90 days')`);
    },
  };
}
