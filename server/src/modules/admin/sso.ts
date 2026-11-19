// Single sign-on routes for people: the sign-in buttons, the trip to the provider and back, and
// linking, confirming and unlinking identities on Account security. Protocol and policy are in
// server/src/core/identity; the administrator's screens are in providers.ts.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadUser, requireRecentAuth, sha256 } from '../../core/auth.ts';
import { linkIdentity } from '../../core/identity/accounts.ts';
import {
  auditFailure, beginFlow, consumeFlow, DRIVERS, enabledProviders, finishSignIn, LINK_COOKIE, localSignInOn, providerById,
  providerByKey, readSecret, registerSignInPolicy, safeReturn, signinLimiter, type IdentityDeps,
} from '../../core/identity/service.ts';
import { IdentityError, type ExternalIdentity, type ProviderRecord } from '../../core/identity/types.ts';
import { verifyLogoutToken } from '../../core/identity/oidc.ts';
import { providerMfaSatisfied } from '../../core/identity/config.ts';
import type { ModuleContext } from '../../core/module.ts';
import { clientIp } from '../../core/request.ts';
import { body } from './shared.ts';

const ACCOUNT = '/account/security';

export function identityDeps(ctx: ModuleContext): IdentityDeps {
  return { app: ctx.app, db: ctx.db, audit: ctx.audit, settings: ctx.settings };
}

/** Methods a person can still sign in with, for the "do not remove the last way in" checks. */
export async function signInMethods(ctx: ModuleContext, userId: string) {
  const row = await ctx.db.one<{ has_password: boolean; break_glass: boolean; allowed: string[] | null }>(
    `select (u.password_hash is not null) as has_password, coalesce(s.break_glass, false) as break_glass, s.allowed_methods as allowed
     from users u left join identity_user_settings s on s.user_id = u.id where u.id = $1`, [userId],
  );
  const identities = await ctx.db.query<{ id: string; provider_id: string; key: string; enabled: boolean }>(
    `select i.id, i.provider_id, p.key, p.enabled from user_identities i
     join identity_providers p on p.id = i.provider_id and p.deleted_at is null where i.user_id = $1`, [userId],
  );
  const localOn = await localSignInOn(ctx);
  const allows = (m: string) => !row?.allowed || row.allowed.includes(m);
  const local = Boolean(row?.has_password) && (localOn || Boolean(row?.break_glass)) && allows('local');
  return { local, identities, allows, hasPassword: Boolean(row?.has_password), breakGlass: Boolean(row?.break_glass) };
}

export function registerSso(ctx: ModuleContext) {
  const { app, db } = ctx;
  const deps = identityDeps(ctx);
  registerSignInPolicy(deps);

  const enabledProvider = async (req: FastifyRequest) => {
    const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
    if (!p || !p.enabled || !DRIVERS[p.type]?.start) ctx.fail(404, 'not_found', 'That sign-in provider is not available.');
    return p!;
  };

  // ---------- the sign-in page ----------

  app.get('/api/auth/providers', { config: { public: true } }, async () => ({
    providers: (await enabledProviders(db)).map((p) => ({ key: p.key, name: p.name, isDefault: p.isDefault })),
    localSignIn: await localSignInOn(ctx),
  }));

  app.post('/api/auth/sso/:key/start', { config: { public: true } }, async (req, reply) => {
    if (await signinLimiter(db).blocked(clientIp(req))) ctx.fail(429, 'rate_limited', 'Too many failed sign-ins from this address. Wait a few minutes and try again.');
    const p = await enabledProvider(req);
    try {
      return { redirectUrl: await beginFlow(deps, req, reply, p, 'signin') };
    } catch (err) {
      await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'could not start');
      return ctx.fail(502, 'provider_unavailable', `${p.name} cannot be reached just now. Try again, or ask an administrator.`);
    }
  });

  /** Where the provider sends the browser back. Always answers with a redirect into the application. */
  app.get('/api/auth/sso/:key/callback', { config: { public: true } }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const go = (path: string) => reply.header('cache-control', 'no-store').redirect(path, 302);
    const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
    if (!p || !p.enabled) {
      await auditFailure(deps, req, p, 'provider unknown or switched off');
      return go('/?sso=failed');
    }
    let flow;
    try {
      flow = await consumeFlow(deps, req, reply, p, q.state);
    } catch (err) {
      await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'bad state');
      return go('/?sso=failed');
    }
    const back = flow.purpose === 'signin' ? '/' : safeReturn(flow.returnTo, ACCOUNT);
    const sep = back.includes('?') ? '&' : '?';
    let identity: ExternalIdentity;
    try {
      identity = await DRIVERS[p.type].complete!(p, readSecret(db, p), { params: q, redirectUri: flow.redirectUri, remember: flow.remember });
    } catch (err) {
      const reason = err instanceof IdentityError ? err.reason : 'unexpected error';
      if (!(err instanceof IdentityError)) console.error('[identity] sign-in could not be completed:', err);
      await auditFailure(deps, req, p, reason, flow.userId ?? undefined, flow.purpose === 'signin' ? 'Sign-in' : flow.purpose === 'link' ? 'Linking' : 'Confirmation');
      return go(flow.purpose === 'signin' ? '/?sso=failed' : `${back}${sep}sso=${flow.purpose}_failed`);
    }

    if (flow.purpose === 'signin') {
      const out = await finishSignIn(deps, req, reply, p, identity);
      return go(out.ok ? '/' : `/?sso=${out.code}`);
    }

    // Linking and confirming belong to the session that started them, which must still be live.
    const live = flow.userId && flow.sessionHash && await db.one(
      'select 1 from sessions where token_hash = $1 and user_id = $2 and expires_at > now()', [flow.sessionHash, flow.userId],
    );
    if (!live) {
      await auditFailure(deps, req, p, 'the session that started it has ended', flow.userId ?? undefined, flow.purpose === 'link' ? 'Linking' : 'Confirmation');
      return go(`/?sso=failed`);
    }
    if (flow.purpose === 'reauth') {
      const mine = await db.one('select 1 from user_identities where provider_id = $1 and subject = $2 and user_id = $3', [p.id, identity.subject, flow.userId]);
      if (!mine) {
        await auditFailure(deps, req, p, 'a different person signed in at the provider', flow.userId!, 'Confirmation');
        return go(`${back}${sep}sso=reauth_failed`);
      }
      // E01-29 and E02-22: with a provider trusted for multi-factor sign-in, a confirmation must show one too.
      if (p.config.providerMfa === true && !providerMfaSatisfied(p.config, identity)) {
        await auditFailure(deps, req, p, 'the provider did not show a multi-factor sign-in', flow.userId!, 'Confirmation');
        return go(`${back}${sep}sso=reauth_failed`);
      }
      await db.query('update sessions set confirmed_at = now() where token_hash = $1', [flow.sessionHash]);
      await ctx.audit(req, { action: 'reauth.success', recordType: 'user', recordId: flow.userId!, summary: `Identity confirmed again through ${p.name} for administrative actions` });
      return go(`${back}${sep}sso=confirmed`);
    }
    // purpose === 'link'
    const problem = await linkProblem(ctx, flow.userId!, p, identity);
    if (problem) {
      await auditFailure(deps, req, p, problem.reason, flow.userId!, 'Linking');
      return go(`${back}${sep}sso=link_failed&why=${problem.code}`);
    }
    req.user = await loadUser(db, flow.userId!); // the person who started it, for the audit event
    await linkIdentity(deps, req, { userId: flow.userId!, provider: p, identity, method: 'self' });
    return go(`${back}${sep}sso=linked`);
  });

  // ---------- a sign-in that matched an account by email: link it with the password ----------

  const pendingLink = async (req: FastifyRequest) => {
    const token = req.cookies[LINK_COOKIE];
    if (!token) return null;
    return db.one<{ state_hash: string; provider_id: string; user_id: string; subject: string; email: string }>(
      `select state_hash, provider_id, user_id, subject, email from identity_flows
       where state_hash = $1 and purpose = 'pending_link' and used_at is null and expires_at > now()`, [sha256(token)],
    );
  };

  app.get('/api/auth/sso/pending', { config: { public: true } }, async (req) => {
    const pending = await pendingLink(req);
    const p = pending && await providerById(db, pending.provider_id);
    if (!pending || !p) return { pending: false };
    const [name, domain] = pending.email.split('@');
    return { pending: true, provider: p.name, email: `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}` };
  });

  app.post('/api/auth/sso/pending/cancel', { config: { public: true } }, async (req, reply) => {
    const pending = await pendingLink(req);
    if (pending) await db.query('update identity_flows set used_at = now() where state_hash = $1', [pending.state_hash]);
    reply.clearCookie(LINK_COOKIE, { path: '/api/auth/sso' });
    return { ok: true };
  });

  app.post('/api/auth/sso/pending/complete', async (req, reply) => {
    const me = req.user!;
    const pending = await pendingLink(req);
    reply.clearCookie(LINK_COOKIE, { path: '/api/auth/sso' });
    const p = pending && await providerById(db, pending.provider_id);
    if (!pending || !p) ctx.fail(404, 'not_found', 'There is no sign-in waiting to be linked. Start again from the sign-in page.');
    if (pending!.user_id !== me.id) {
      await auditFailure(deps, req, p, 'a different account signed in with its password', me.id, 'Linking');
      ctx.fail(409, 'wrong_account', 'That sign-in belongs to a different account here, so nothing was linked.');
    }
    // The password must have been proved just now, in this session.
    const fresh = await db.one('select 1 from sessions where token_hash = $1 and confirmed_at > now() - interval \'5 minutes\'', [req.sessionHash]);
    if (!fresh) ctx.fail(403, 'reauth_required', 'Confirm your password to continue.');
    const claimed = await db.one('update identity_flows set used_at = now() where state_hash = $1 and used_at is null returning 1', [pending!.state_hash]);
    if (!claimed) ctx.fail(409, 'used', 'That sign-in has already been linked or canceled.');
    const identity: ExternalIdentity = { subject: pending!.subject, email: pending!.email, emailVerified: true, displayName: null, groups: [] };
    const problem = await linkProblem(ctx, me.id, p!, identity);
    if (problem) {
      await auditFailure(deps, req, p, problem.reason, me.id, 'Linking');
      ctx.fail(409, problem.code, problem.message);
    }
    await linkIdentity(deps, req, { userId: me.id, provider: p!, identity, method: 'sign_in_confirmed' });
    return { ok: true, provider: p!.name };
  });

  // ---------- Account security: my identities ----------

  app.get('/api/auth/identities', async (req) => {
    const me = req.user!;
    const methods = await signInMethods(ctx, me.id);
    const linked = await db.query(
      `select i.id, i.email, i.linked_at, i.last_used_at, i.link_method, p.key as provider_key, p.name as provider_name, p.enabled
       from user_identities i join identity_providers p on p.id = i.provider_id and p.deleted_at is null
       where i.user_id = $1 order by p.name`, [me.id],
    );
    const session = await db.one<{ method: string; break_glass: boolean; provider: string | null }>(
      `select s.method, s.break_glass, p.name as provider from identity_sessions s left join identity_providers p on p.id = s.provider_id
       where s.token_hash = $1`, [req.sessionHash],
    );
    return {
      identities: linked,
      available: (await enabledProviders(db))
        .filter((p) => !linked.some((l: any) => l.provider_key === p.key) && methods.allows(p.key))
        .map((p) => ({ key: p.key, name: p.name })),
      hasPassword: methods.hasPassword,
      localSignIn: methods.local,
      breakGlass: methods.breakGlass,
      session: { method: session?.method ?? 'local', provider: session?.provider ?? null, breakGlass: Boolean(session?.break_glass) },
    };
  });

  app.post('/api/auth/sso/:key/link', async (req, reply) => {
    const me = req.user!;
    const p = await enabledProvider(req);
    const methods = await signInMethods(ctx, me.id);
    if (methods.breakGlass) ctx.fail(409, 'break_glass', 'The break-glass account signs in with its password only, so it cannot be linked.');
    if (!methods.allows(p.key)) ctx.fail(409, 'not_allowed', `Your account may not use ${p.name}. Ask an administrator.`);
    if (methods.identities.some((i) => i.provider_id === p.id)) ctx.fail(409, 'already_linked', `Your account is already linked to ${p.name}.`);
    // Proof that it is really the account holder: a password (or provider) confirmation in the last few minutes.
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, `linking ${p.name}`);
    return startFor(req, reply, p, 'link');
  });

  app.post('/api/auth/sso/:key/reauth', async (req, reply) => {
    const me = req.user!;
    const p = await enabledProvider(req);
    if (!(await db.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [me.id, p.id]))) {
      ctx.fail(409, 'not_linked', `Your account is not linked to ${p.name}.`);
    }
    return startFor(req, reply, p, 'reauth');
  });

  async function startFor(req: FastifyRequest, reply: FastifyReply, p: ProviderRecord, purpose: 'link' | 'reauth') {
    try {
      const url = await beginFlow(deps, req, reply, p, purpose, {
        userId: req.user!.id, sessionHash: req.sessionHash, returnTo: safeReturn(body(req).returnTo, ACCOUNT),
      });
      return { redirectUrl: url };
    } catch (err) {
      await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'could not start', req.user!.id, purpose === 'link' ? 'Linking' : 'Confirmation');
      return ctx.fail(502, 'provider_unavailable', `${p.name} cannot be reached just now. Try again later.`);
    }
  }

  app.delete('/api/auth/identities/:id', async (req) => {
    const me = req.user!;
    const id = String((req.params as Record<string, string>).id ?? '');
    const row = await db.one<{ id: string; provider_id: string; email: string | null }>(
      'select id, provider_id, email from user_identities where id::text = $1 and user_id = $2', [id, me.id],
    );
    if (!row) ctx.fail(404, 'not_found', 'Linked identity not found.');
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'unlinking a sign-in provider');
    await unlinkIdentity(ctx, req, me.id, row!, 'by the person');
    return { ok: true };
  });

  // ---------- back-channel sign-out (E02-23) ----------
  // The provider calls this, server to server, when a person signs out there or their directory
  // account is disabled. It carries a signed logout token, not a browser session, so the CSRF header
  // is not asked for (route config `noCsrf`); the token's signature is the proof.
  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 32 * 1024 }, (_req, raw, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(raw)))); } catch (err) { done(err as Error, undefined); }
    });
    scoped.post('/api/auth/sso/:key/backchannel-logout', { config: { public: true, noCsrf: true } }, async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const ip = clientIp(req);
      if (await signinLimiter(db).blocked(ip)) return reply.code(429).send({ error: 'rate_limited' });
      const p = await providerByKey(db, String((req.params as Record<string, string>).key ?? ''));
      if (!p || !p.enabled || p.type !== 'oidc' || p.config.backchannelLogout !== true) return reply.code(404).send({ error: 'not_found' });
      const token = (req.body as Record<string, unknown> | undefined)?.logout_token;
      let claims: { sub: string | null; sid: string | null; jti: string | null };
      try {
        if (typeof token !== 'string' || !token) throw new IdentityError('no logout token');
        claims = await verifyLogoutToken(p, token);
      } catch (err) {
        await auditFailure(deps, req, p, err instanceof IdentityError ? err.reason : 'unexpected error', undefined, 'Back-channel sign-out');
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (claims.jti) {
        await db.query(`delete from identity_logout_tokens where received_at < now() - interval '1 day'`);
        const fresh = await db.one('insert into identity_logout_tokens (provider_id, jti) values ($1,$2) on conflict do nothing returning 1', [p.id, claims.jti]);
        if (!fresh) return reply.code(200).send({ ok: true }); // already acted on
      }
      const linked = claims.sub
        ? await db.one<{ user_id: string }>('select user_id from user_identities where provider_id = $1 and subject = $2', [p.id, claims.sub])
        : undefined;
      // Sessions made through this provider: for that person, or for that provider session.
      const ended = await db.query<{ user_id: string }>(
        `delete from sessions where token_hash in (
           select s.token_hash from identity_sessions s join sessions x on x.token_hash = s.token_hash
           where s.provider_id = $1 and (($2::text is not null and s.sid = $2) or ($3::uuid is not null and x.user_id = $3)))
         returning user_id`,
        [p.id, claims.sid, linked?.user_id ?? null],
      );
      const users = [...new Set(ended.map((r) => r.user_id))];
      await ctx.audit(req, {
        action: 'identity.backchannel_logout', recordType: 'user', recordId: users.length === 1 ? users[0] : linked?.user_id,
        summary: `${p.name} signed ${ended.length} session(s) out from ${ip}${claims.sub && !linked ? ' (the subject is not linked to an account here)' : ''}`,
      });
      return reply.code(200).send({ ok: true });
    });
  });

  app.get('/api/auth/sso/session', async (req) => {
    const s = await db.one<{ method: string; break_glass: boolean; provider: string | null }>(
      `select s.method, s.break_glass, p.name as provider from identity_sessions s
       left join identity_providers p on p.id = s.provider_id where s.token_hash = $1`, [req.sessionHash],
    );
    return { method: s?.method ?? 'local', provider: s?.provider ?? null, breakGlass: Boolean(s?.break_glass) };
  });
}

/** Why an identity cannot be linked to this person, or null. */
async function linkProblem(ctx: ModuleContext, userId: string, p: ProviderRecord, identity: ExternalIdentity) {
  const user = await ctx.db.one<{ email: string; break_glass: boolean }>(
    `select u.email, coalesce(s.break_glass, false) as break_glass from users u
     left join identity_user_settings s on s.user_id = u.id where u.id = $1`, [userId],
  );
  if (!user) return { code: 'failed', reason: 'account not found', message: 'Account not found.' };
  if (user.break_glass) return { code: 'break_glass', reason: 'break-glass account', message: 'The break-glass account cannot be linked.' };
  const other = await ctx.db.one<{ user_id: string }>('select user_id from user_identities where provider_id = $1 and subject = $2', [p.id, identity.subject]);
  if (other && other.user_id !== userId) return { code: 'taken', reason: 'identity already linked to another account', message: `That ${p.name} identity is already linked to another account.` };
  if (other) return { code: 'already_linked', reason: 'already linked', message: `Your account is already linked to ${p.name}.` };
  if (await ctx.db.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [userId, p.id])) {
    return { code: 'already_linked', reason: 'account already linked at this provider', message: `Your account is already linked to ${p.name}.` };
  }
  if (!identity.email || !identity.emailVerified) return { code: 'unverified', reason: 'no verified email from the provider', message: `${p.name} did not confirm an email address.` };
  if (identity.email.toLowerCase() !== user.email.toLowerCase()) {
    return { code: 'email', reason: 'provider email differs from the account email', message: `The email address ${p.name} gave is not the one on your account.` };
  }
  return null;
}

/** Removes a link, refusing when it is the person's last way to sign in. Audited. */
export async function unlinkIdentity(
  ctx: ModuleContext, req: FastifyRequest, userId: string, row: { id: string; provider_id: string; email: string | null }, who: string,
) {
  const methods = await signInMethods(ctx, userId);
  const others = methods.identities.filter((i) => i.id !== row.id && i.enabled && methods.allows(i.key));
  if (!methods.local && others.length === 0) {
    ctx.fail(409, 'last_method', 'This is the only way left to sign in to the account, so it cannot be unlinked. Set a password or link another provider first.');
  }
  const p = await providerById(ctx.db, row.provider_id);
  await ctx.db.query('delete from user_identities where id = $1', [row.id]);
  // Other sessions made through that provider end too (not the one doing this).
  await ctx.db.query(
    `delete from sessions where user_id = $1 and token_hash <> $3
       and token_hash in (select token_hash from identity_sessions where provider_id = $2)`,
    [userId, row.provider_id, req.sessionHash ?? ''],
  );
  await ctx.audit(req, {
    action: 'identity.unlink', recordType: 'user', recordId: userId,
    summary: `${p?.name ?? 'Provider'} identity unlinked ${who} (from ${clientIp(req)})`,
    before: { provider: p?.key, email: row.email },
  });
}
