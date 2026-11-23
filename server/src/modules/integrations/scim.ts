// SCIM 2.0 provisioning endpoint (E36-01): /api/scim/v2/Users, /Groups and the discovery documents.
//
// Fenced like any outside caller:
//  - off until an administrator switches it on (`integrations.scim_enabled`) and makes a token;
//  - its own bearer token (`Authorization: Bearer grc_scim_...`), looked up by its SHA-256 and compared
//    in constant time; never a session or a personal access token (route config `ownBearer`);
//  - a missing, wrong, revoked or disallowed token, or provisioning switched off, all get the same
//    401 and are audited; failures are limited per source address with take() (claimed first);
//  - each token is limited to SCIM_CALLS_PER_MINUTE requests a minute;
//  - accounts are created with no local password (single sign-on only), never removed (DELETE and
//    `active: false` deactivate: deactivateUser), and the break-glass account is never seen;
//  - groups grant roles only through an administrator's mapping, and never a role that administers;
//  - an account that can administer (or the break-glass account) never has its email address or
//    active state changed, nor gets a provider link permit, by provisioning (W17-0): together they
//    would let the token holder take the account over; an administrator does that by hand;
//  - a changed email address is told to the old address;
//  - every change is audited as "Provisioning (<token name>)".
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../core/errors.ts';
import type { Queryable } from '../../core/db.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { clientIp } from '../../core/request.ts';
import { sourceAllowed, tokenHash } from '../../core/tokens.ts';
import { isAdminCapable, notifyEmailChange } from '../../core/identity/accounts.ts';
import { deactivateUser } from '../admin/users.ts';
import { provisioningRequest, roleChangeText, syncProvisionedRoles } from './shared.ts';

export const SCIM_TOKEN_PREFIX = 'grc_scim_';
export const SCIM_BASE = '/api/scim/v2';
export const SCIM_CALLS_PER_MINUTE = 600;
const MAX_COUNT = 200;
const CT = 'application/scim+json; charset=utf-8';
const S = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  spc: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
  rt: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
};
const PERMIT_DAYS = 30;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An error answered in SCIM's shape. */
export class ScimError extends Error {
  readonly statusCode: number;
  constructor(readonly status: number, readonly detail: string, readonly scimType?: string) { super(detail); this.statusCode = status; }
}
const scimFail = (status: number, detail: string, scimType?: string): never => { throw new ScimError(status, detail, scimType); };

interface Caller { id: string; name: string; req: FastifyRequest }

export function registerScim(ctx: ModuleContext) {
  const { app, db } = ctx;
  const failures = makeDbLimiter(db, 'scim_auth', 20, 5 * 60_000); // refused calls, by source address
  const calls = makeDbLimiter(db, 'scim_calls', SCIM_CALLS_PER_MINUTE, 60_000); // every call, by token

  if (!app.hasContentTypeParser('application/scim+json')) {
    app.addContentTypeParser('application/scim+json', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_req, raw, done) => {
      try { done(null, String(raw).trim() ? JSON.parse(String(raw)) : {}); } catch { done(new ScimError(400, 'The body is not valid JSON.', 'invalidSyntax'), undefined); }
    });
  }

  // ---------- authentication ----------

  const UNAUTHORIZED = 'Authentication failed: the bearer token is missing, not valid, or provisioning is switched off.';

  async function authenticate(req: FastifyRequest): Promise<Caller> {
    const ip = clientIp(req);
    // Claimed before the check (wave 9 SA-3): simultaneous guesses all count. Given back on success.
    const slot = await failures.take(ip);
    if (!slot.ok) scimFail(429, 'Too many failed requests from this address. Wait a few minutes and try again.', 'tooMany');
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    const token = m?.[1] ?? '';
    const enabled = (await ctx.settings.get<unknown>('integrations.scim_enabled', false)) === true;
    let row: Row | undefined;
    if (token.startsWith(SCIM_TOKEN_PREFIX) && token.length < 200) {
      const hash = tokenHash(token);
      row = await db.one<Row>('select id, name, token_hash, allowed_addresses, (last_used_at is null or last_used_at < now() - interval \'1 minute\') as stale from scim_tokens where token_hash = $1 and revoked_at is null', [hash]);
      // The lookup is by hash; the comparison of what was found is constant-time as well.
      if (row && !timingSafeEqual(Buffer.from(String(row.token_hash)), Buffer.from(hash))) row = undefined;
    }
    const sourceOk = row ? sourceAllowed(ip, row.allowed_addresses as string[] | null) : false;
    if (!enabled || !row || !sourceOk) {
      const why = !row ? 'unknown, revoked or missing token' : !enabled ? 'provisioning is switched off' : `used from ${ip}, which is not among its allowed addresses`;
      await ctx.audit(req, { action: 'scim.refused', recordType: 'scim_token', recordId: row?.id, summary: `Provisioning request refused (${why}) from ${ip}` });
      return scimFail(401, UNAUTHORIZED);
    }
    await slot.release();
    const used = await calls.take(String(row.id));
    if (!used.ok) scimFail(429, `This provisioning token is limited to ${SCIM_CALLS_PER_MINUTE} requests a minute.`, 'tooMany');
    if (row.stale) await db.query('update scim_tokens set last_used_at = now(), last_used_ip = $2 where id = $1', [row.id, ip]);
    return { id: String(row.id), name: String(row.name), req: provisioningRequest(req, String(row.name)) };
  }

  /** Runs a SCIM handler: authenticates, and answers errors in SCIM's shape. */
  const handle = (fn: (req: FastifyRequest, reply: FastifyReply, caller: Caller) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-store');
      try {
        const caller = await authenticate(req);
        const out = await fn(req, reply, caller);
        if (reply.sent) return reply;
        if (out === undefined) return reply.code(204).send();
        return reply.type(CT).send(out);
      } catch (err) {
        const e = err instanceof ScimError ? err
          : err instanceof ApiError ? new ScimError(err.status, err.message, err.code === 'last_admin' ? undefined : err.status === 409 ? 'uniqueness' : undefined)
          : null;
        if (!e) {
          console.error('[scim]', err);
          return reply.code(500).type(CT).send({ schemas: [S.error], status: '500', detail: 'The request could not be completed.' });
        }
        return reply.code(e.status).type(CT).send({ schemas: [S.error], status: String(e.status), ...(e.scimType ? { scimType: e.scimType } : {}), detail: e.detail });
      }
    };

  const base = (req: FastifyRequest) => (req.apiVersion === 'v1' ? '/api/v1/scim/v2' : SCIM_BASE);

  // ---------- users ----------

  const USER_SQL = `
    select u.id, u.username, u.email, u.display_name, u.status, u.created_at, u.updated_at,
      x.external_id, x.user_name, coalesce(x.deactivated, false) as scim_deactivated,
      coalesce((select json_agg(json_build_object('value', g.id, 'display', g.display_name) order by g.display_name)
                from scim_group_members gm join scim_group_roles g on g.id = gm.group_id where gm.user_id = u.id), '[]'::json) as groups
    from users u
    left join user_external_ids x on x.user_id = u.id and x.source = 'scim'
    left join identity_user_settings s on s.user_id = u.id
    where u.deleted_at is null and not coalesce(s.break_glass, false)`;

  function toUser(req: FastifyRequest, r: Row): Row {
    const location = `${base(req)}/Users/${r.id}`;
    return {
      schemas: [S.user],
      id: r.id,
      ...(r.external_id ? { externalId: r.external_id } : {}),
      userName: r.user_name ?? r.username,
      name: { formatted: r.display_name },
      displayName: r.display_name,
      emails: [{ value: r.email, type: 'work', primary: true }],
      active: r.status !== 'disabled',
      groups: (r.groups as Row[]).map((g) => ({ value: g.value, display: g.display, $ref: `${base(req)}/Groups/${g.value}` })),
      meta: { resourceType: 'User', created: iso(r.created_at), lastModified: iso(r.updated_at), location },
    };
  }

  async function findUser(id: string, q: Queryable = db): Promise<Row> {
    const row = UUID.test(id) ? await q.one<Row>(`${USER_SQL} and u.id = $1`, [id]) : undefined;
    return row ?? scimFail(404, `User ${id.slice(0, 64)} not found.`);
  }

  /** The user fields a SCIM body gives, checked. `partial` for PATCH (only what is present). */
  function userFields(b: Row, partial = false) {
    const out: { userName?: string; email?: string; displayName?: string; externalId?: string | null; active?: boolean } = {};
    if (b.userName !== undefined || !partial) {
      const v = typeof b.userName === 'string' ? b.userName.trim() : '';
      if (!v || v.length > 254 || /[\u0000-\u001f\s]/.test(v)) scimFail(400, 'userName is required: up to 254 characters with no spaces.', 'invalidValue');
      out.userName = v;
    }
    const emails = Array.isArray(b.emails) ? (b.emails as Row[]) : null;
    if (emails) {
      const pick = emails.find((e) => e?.primary === true) ?? emails.find((e) => e?.type === 'work') ?? emails[0];
      if (pick?.value !== undefined) out.email = String(pick.value).trim();
    } else if (typeof b.email === 'string') out.email = b.email.trim();
    if (!partial && !out.email && out.userName && /^[^@\s]+@[^@\s]+$/.test(out.userName)) out.email = out.userName;
    if (out.email !== undefined && (!/^[^@\s]+@[^@\s]+$/.test(out.email) || out.email.length > 254)) scimFail(400, 'emails must hold one email address.', 'invalidValue');
    const name = (b.name ?? {}) as Row;
    const display = typeof b.displayName === 'string' && b.displayName.trim() ? b.displayName.trim()
      : typeof name.formatted === 'string' && name.formatted.trim() ? name.formatted.trim()
      : [name.givenName, name.familyName].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
    if (display) out.displayName = display.slice(0, 120);
    if (b.externalId !== undefined) {
      if (b.externalId !== null && (typeof b.externalId !== 'string' || b.externalId.length > 200)) scimFail(400, 'externalId must be text of up to 200 characters.', 'invalidValue');
      out.externalId = b.externalId === null || b.externalId === '' ? null : String(b.externalId);
    }
    if (b.active !== undefined) out.active = parseBool(b.active, 'active');
    return out;
  }

  /** A free local user name for a SCIM userName (local names are 3 to 64 letters, digits, dots, dashes, underscores). */
  async function localUsername(q: Queryable, userName: string): Promise<string> {
    let stem = userName.includes('@') ? userName.split('@')[0] : userName;
    stem = stem.replace(/[^A-Za-z0-9._-]+/g, '.').replace(/^[.]+|[.]+$/g, '').slice(0, 56) || 'user';
    if (stem.length < 3) stem = `${stem}.user`;
    for (let i = 1; i < 1000; i++) {
      const candidate = i === 1 && USERNAME_RE.test(userName) ? userName : i === 1 ? stem : `${stem}-${i}`;
      if (!(await q.one('select 1 from users where deleted_at is null and lower(username) = lower($1)', [candidate]))) return candidate;
    }
    return scimFail(409, 'No free user name could be made from userName.', 'uniqueness');
  }

  async function assertUnique(q: Queryable, f: { userName?: string; email?: string; externalId?: string | null }, exceptId = '') {
    if (f.userName && await q.one(
      `select 1 from users u left join user_external_ids x on x.user_id = u.id and x.source = 'scim'
       where u.deleted_at is null and u.id::text <> $2 and (lower(coalesce(x.user_name, u.username)) = lower($1))`, [f.userName, exceptId])) {
      scimFail(409, 'Another account already has that userName.', 'uniqueness');
    }
    if (f.email && await q.one('select 1 from users where deleted_at is null and id::text <> $2 and lower(email) = lower($1)', [f.email, exceptId])) {
      scimFail(409, 'Another account already has that email address.', 'uniqueness');
    }
    if (f.externalId && await q.one(`select 1 from user_external_ids where source = 'scim' and external_id = $1 and user_id::text <> $2`, [f.externalId, exceptId])) {
      scimFail(409, 'Another account already has that externalId.', 'uniqueness');
    }
  }

  /** With a provider chosen on the provisioning screen: the account may link that provider at its next sign-in. */
  async function permitLink(q: Queryable, userId: string) {
    if (await isAdminCapable(q, userId)) return; // never a way in to an account that can administer (W17-0)
    const providerId = String(await ctx.settings.get('integrations.scim_link_provider', '') ?? '');
    if (!UUID.test(providerId)) return;
    if (!(await q.one('select 1 from identity_providers where id = $1 and deleted_at is null', [providerId]))) return;
    if (await q.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [userId, providerId])) return;
    await q.query(
      `insert into identity_user_settings (user_id, permit_provider_id, permit_expires_at) values ($1, $2, now() + make_interval(days => $3::int))
       on conflict (user_id) do update set permit_provider_id = excluded.permit_provider_id, permit_expires_at = excluded.permit_expires_at, updated_at = now()
       where not identity_user_settings.break_glass`, [userId, providerId, PERMIT_DAYS]);
  }

  async function saveExternal(q: Queryable, userId: string, f: { userName?: string; externalId?: string | null }) {
    await q.query(
      `insert into user_external_ids (user_id, source, external_id, user_name) values ($1, 'scim', $2, $3)
       on conflict (user_id, source) do update set
         external_id = case when $4 then excluded.external_id else user_external_ids.external_id end,
         user_name = coalesce(excluded.user_name, user_external_ids.user_name), updated_at = now()`,
      [userId, f.externalId ?? null, f.userName ?? null, f.externalId !== undefined]);
  }

  /** Applies `active` (deactivate, or enable again what provisioning disabled). */
  async function applyActive(caller: Caller, user: Row, active: boolean) {
    const disabled = user.status === 'disabled';
    if (!active && !disabled) {
      await deactivateUser(ctx, user.id, { reason: `deprovisioned by ${caller.name}`, by: caller.req });
      await db.query(`insert into user_external_ids (user_id, source, deactivated) values ($1, 'scim', true)
        on conflict (user_id, source) do update set deactivated = true, updated_at = now()`, [user.id]);
    } else if (active && disabled) {
      // Only an account provisioning disabled itself: one an administrator disabled stays disabled.
      if (!user.scim_deactivated) return;
      await db.query(`update users set status = 'active', failed_attempts = 0, locked_until = null, updated_at = now() where id = $1`, [user.id]);
      await db.query(`update user_external_ids set deactivated = false, updated_at = now() where user_id = $1 and source = 'scim'`, [user.id]);
      await permitLink(db, user.id);
      await ctx.audit(caller.req, {
        action: 'user.reactivate', recordType: 'user', recordId: user.id,
        summary: `User ${user.username} enabled again by provisioning (${caller.name}); sessions, tokens and assistant connections stay ended`,
        before: { status: 'disabled' }, after: { status: 'active' },
      });
    }
  }

  /** Would `active` change the account? (Enabling applies only to an account provisioning disabled itself.) */
  const activeChanges = (user: Row, active: boolean | undefined) =>
    active !== undefined && (active ? user.status === 'disabled' && Boolean(user.scim_deactivated) : user.status !== 'disabled');

  /** Refuses (403, audited) to change `what` of an account that can administer or is the break-glass account (W17-0). */
  async function guardAdminCapable(caller: Caller, user: Row, what: string | null) {
    if (!what || !(await isAdminCapable(db, user.id))) return;
    await ctx.audit(caller.req, {
      action: 'scim.refused', recordType: 'user', recordId: user.id,
      summary: `Provisioning (${caller.name}) may not change the ${what} of ${user.username}, who can administer`,
    });
    scimFail(403, 'This account can administer the application, so provisioning may not change its email address or active state. An administrator does that under Administration > Users.', 'mutability');
  }

  async function updateUser(caller: Caller, user: Row, f: ReturnType<typeof userFields>): Promise<void> {
    await assertUnique(db, f, user.id);
    const emailChanges = f.email !== undefined && f.email.toLowerCase() !== String(user.email).toLowerCase();
    // W17-0: checked before anything is written, so a refused request changes nothing.
    await guardAdminCapable(caller, user, emailChanges ? 'email address' : activeChanges(user, f.active) ? 'active state' : null);
    const sets: string[] = [];
    const params: unknown[] = [user.id];
    const changed: string[] = [];
    if (emailChanges) { params.push(f.email); sets.push(`email = $${params.length}`); changed.push('email'); }
    if (f.displayName !== undefined && f.displayName !== user.display_name) { params.push(f.displayName); sets.push(`display_name = $${params.length}`); changed.push('display name'); }
    if (sets.length) await db.query(`update users set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
    const nameChanged = f.userName !== undefined && f.userName !== (user.user_name ?? user.username);
    const extChanged = f.externalId !== undefined && (f.externalId ?? null) !== (user.external_id ?? null);
    if (nameChanged) changed.push('userName');
    if (extChanged) changed.push('externalId');
    if (nameChanged || extChanged || !user.user_name) await saveExternal(db, user.id, { userName: f.userName ?? user.user_name ?? user.username, externalId: f.externalId });
    if (changed.length) {
      await ctx.audit(caller.req, {
        action: 'user.update', recordType: 'user', recordId: user.id, summary: `User ${user.username} updated by provisioning (${changed.join(', ')})`,
        before: Object.fromEntries(changed.filter((c) => c === 'email' || c === 'display name').map((c) => [c, c === 'email' ? user.email : user.display_name])),
        after: Object.fromEntries(changed.filter((c) => c === 'email' || c === 'display name').map((c) => [c, c === 'email' ? f.email : f.displayName])),
      });
    }
    if (emailChanges) await notifyEmailChange(app, { username: String(user.username), oldEmail: String(user.email ?? ''), newEmail: f.email!, by: `provisioning (${caller.name})` });
    if (f.active !== undefined) await applyActive(caller, user, f.active);
  }

  const parseFilter = (raw: unknown, allowed: Record<string, string>) => {
    if (raw === undefined || raw === '') return null;
    const m = /^\s*([A-Za-z.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(String(raw));
    const col = m ? allowed[m[1].toLowerCase()] : undefined;
    if (!m || !col) return scimFail(400, `Only these filters are supported: ${Object.keys(allowed).map((k) => `${k} eq "..."`).join(', ')}.`, 'invalidFilter');
    return { col, value: m[2].replace(/\\(.)/g, '$1') };
  };
  const paging = (q: Row) => {
    const startIndex = Math.max(1, Math.trunc(Number(q.startIndex)) || 1);
    const count = Math.min(MAX_COUNT, Math.max(0, q.count === undefined ? 100 : Math.trunc(Number(q.count)) || 0));
    return { startIndex: Math.min(startIndex, 1_000_000), count };
  };
  const list = (rows: Row[], total: number, startIndex: number) =>
    ({ schemas: [S.list], totalResults: total, startIndex, itemsPerPage: rows.length, Resources: rows });

  const USER_FILTERS: Record<string, string> = {
    username: `lower(coalesce(x.user_name, u.username)) = lower($1)`,
    externalid: `x.external_id = $1`,
    'emails.value': `lower(u.email) = lower($1)`,
    emails: `lower(u.email) = lower($1)`,
    id: `u.id::text = lower($1)`,
  };

  app.get(`${SCIM_BASE}/Users`, { config: { public: true, ownBearer: true } }, handle(async (req) => {
    const q = req.query as Row;
    const f = parseFilter(q.filter, USER_FILTERS);
    const { startIndex, count } = paging(q);
    const where = f ? ` and ${f.col}` : '';
    const params = f ? [f.value] : [];
    const total = (await db.one<{ c: number }>(`select count(*)::int c from (${USER_SQL}${where}) t`, params))!.c;
    const rows = count ? await db.query<Row>(`${USER_SQL}${where} order by u.created_at, u.id limit ${count} offset ${startIndex - 1}`, params) : [];
    return list(rows.map((r) => toUser(req, r)), total, startIndex);
  }));

  app.get(`${SCIM_BASE}/Users/:id`, { config: { public: true, ownBearer: true } }, handle(async (req) => toUser(req, await findUser(idOf(req)))));

  app.post(`${SCIM_BASE}/Users`, { config: { public: true, ownBearer: true } }, handle(async (req, reply, caller) => {
    const f = userFields(body(req));
    if (!f.email) scimFail(400, 'An email address is required (emails, or a userName that is an email address).', 'invalidValue');
    await assertUnique(db, f);
    const id = await db.tx(async (tx) => {
      const username = await localUsername(tx, f.userName!);
      // No local password: the person signs in through single sign-on.
      const row = await tx.one<{ id: string }>(
        `insert into users (username, email, display_name, status) values ($1, $2, $3, 'active') returning id`,
        [username, f.email, f.displayName ?? f.userName]);
      await saveExternal(tx, row!.id, { userName: f.userName, externalId: f.externalId ?? null });
      return row!.id;
    });
    // Outside the transaction: it reads a setting (the embedded database has one connection).
    await permitLink(db, id);
    const created = await findUser(id);
    await ctx.audit(caller.req, {
      action: 'user.create', recordType: 'user', recordId: id,
      summary: `User ${created.username} created by provisioning (${caller.name}) with no roles and no local password`,
      after: { username: created.username, email: created.email, display_name: created.display_name },
    });
    if (f.active === false) await applyActive(caller, created, false);
    reply.code(201).header('location', `${base(req)}/Users/${id}`);
    return toUser(req, await findUser(id));
  }));

  app.put(`${SCIM_BASE}/Users/:id`, { config: { public: true, ownBearer: true } }, handle(async (req, _reply, caller) => {
    const user = await findUser(idOf(req));
    const f = userFields(body(req));
    await updateUser(caller, user, { ...f, active: f.active ?? true });
    return toUser(req, await findUser(user.id));
  }));

  app.patch(`${SCIM_BASE}/Users/:id`, { config: { public: true, ownBearer: true } }, handle(async (req, _reply, caller) => {
    const user = await findUser(idOf(req));
    const changes: Row = {};
    for (const op of operations(req)) {
      const kind = String(op.op ?? '').toLowerCase();
      if (kind === 'remove') {
        const path = String(op.path ?? '').toLowerCase();
        if (path === 'externalid') changes.externalId = null;
        else scimFail(400, `Removing "${String(op.path ?? '')}" is not supported.`, 'mutability');
        continue;
      }
      if (kind !== 'add' && kind !== 'replace') scimFail(400, 'Each operation is add, replace or remove.', 'invalidSyntax');
      const values = op.path === undefined ? (op.value as Row ?? {}) : { [String(op.path)]: op.value };
      for (const [rawPath, value] of Object.entries(values)) applyUserPath(changes, rawPath, value);
    }
    const f = userFields(changes, true);
    await updateUser(caller, user, f);
    return toUser(req, await findUser(user.id));
  }));

  app.delete(`${SCIM_BASE}/Users/:id`, { config: { public: true, ownBearer: true } }, handle(async (req, _reply, caller) => {
    const user = await findUser(idOf(req));
    // Never removed: the account is deactivated, and keeps its history.
    await guardAdminCapable(caller, user, activeChanges(user, false) ? 'active state' : null);
    await applyActive(caller, user, false);
    return undefined;
  }));

  /** One PATCH path for a user, into a body userFields understands. */
  function applyUserPath(changes: Row, rawPath: string, value: unknown) {
    const path = rawPath.replace(new RegExp(`^${S.user.replace(/[.:]/g, '\\$&')}:`, 'i'), '');
    const p = path.toLowerCase();
    if (p === 'active') changes.active = value;
    else if (p === 'username') changes.userName = value;
    else if (p === 'displayname') changes.displayName = value;
    else if (p === 'externalid') changes.externalId = value;
    else if (p === 'name.formatted') changes.name = { ...(changes.name as Row ?? {}), formatted: value };
    else if (p === 'name.givenname') changes.name = { ...(changes.name as Row ?? {}), givenName: value };
    else if (p === 'name.familyname') changes.name = { ...(changes.name as Row ?? {}), familyName: value };
    else if (p === 'name' && value && typeof value === 'object') changes.name = value;
    else if (p === 'emails' && Array.isArray(value)) changes.emails = value;
    else if (/^emails(\[.*\])?\.value$/.test(p)) changes.emails = [{ value, primary: true }];
    else if (p === 'emails' && typeof value === 'string') changes.emails = [{ value, primary: true }];
    // Attributes this application does not keep (title, phone numbers, addresses, extensions) are ignored.
  }

  // ---------- groups ----------

  const GROUP_SQL = `select g.id, g.display_name, g.external_id, g.created_at, g.updated_at from scim_group_roles g`;

  async function findGroup(id: string, q: Queryable = db): Promise<Row> {
    const row = UUID.test(id) ? await q.one<Row>(`${GROUP_SQL} where g.id = $1`, [id]) : undefined;
    return row ?? scimFail(404, `Group ${id.slice(0, 64)} not found.`);
  }

  async function toGroup(req: FastifyRequest, g: Row, withMembers = true): Promise<Row> {
    const members = withMembers ? await db.query<Row>(
      `select u.id as value, u.display_name as display from scim_group_members m join users u on u.id = m.user_id and u.deleted_at is null
       where m.group_id = $1 order by u.display_name`, [g.id]) : null;
    return {
      schemas: [S.group], id: g.id, displayName: g.display_name,
      ...(g.external_id ? { externalId: g.external_id } : {}),
      ...(members ? { members: members.map((m) => ({ value: m.value, display: m.display, $ref: `${base(req)}/Users/${m.value}` })) } : {}),
      meta: { resourceType: 'Group', created: iso(g.created_at), lastModified: iso(g.updated_at), location: `${base(req)}/Groups/${g.id}` },
    };
  }

  /** Member ids from a SCIM members list, each an account provisioning may see. */
  async function memberIds(value: unknown): Promise<string[]> {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    const ids = [...new Set(list.map((m) => String((m as Row)?.value ?? '')))];
    for (const id of ids) await findUser(id).catch(() => scimFail(400, `Member ${id.slice(0, 64)} is not a known user.`, 'invalidValue'));
    return ids;
  }

  /** Sets a group's members (or adds and removes some), and brings each affected person's roles in step. */
  async function changeMembers(caller: Caller, group: Row, change: { set?: string[]; add?: string[]; remove?: string[] }) {
    const current = new Set((await db.query<{ user_id: string }>('select user_id from scim_group_members where group_id = $1', [group.id])).map((r) => r.user_id));
    const next = new Set(change.set ?? current);
    for (const id of change.add ?? []) next.add(id);
    for (const id of change.remove ?? []) next.delete(id);
    const added = [...next].filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !next.has(id));
    // A full replacement (PUT) brings every member's roles in step, which also repairs any drift.
    const affected = change.set ? [...new Set([...current, ...next])] : [...added, ...removed];
    if (!affected.length) return;
    const changes: { userId: string; text: string }[] = [];
    await db.tx(async (tx) => {
      for (const id of added) await tx.query('insert into scim_group_members (group_id, user_id) values ($1, $2) on conflict do nothing', [group.id, id]);
      for (const id of removed) await tx.query('delete from scim_group_members where group_id = $1 and user_id = $2', [group.id, id]);
      for (const id of affected) {
        const text = roleChangeText(await syncProvisionedRoles(ctx, tx, id));
        if (text) changes.push({ userId: id, text });
      }
    });
    if (added.length || removed.length) {
      await ctx.audit(caller.req, {
        action: 'scim.group_members', recordType: 'scim_group', recordId: group.id,
        summary: `Members of group "${group.display_name}" changed by provisioning (${caller.name}): ${added.length} added, ${removed.length} removed`,
      });
    }
    for (const c of changes) {
      const name = (await db.one<{ username: string }>('select username from users where id = $1', [c.userId]))?.username ?? c.userId;
      await ctx.audit(caller.req, { action: 'user.roles', recordType: 'user', recordId: c.userId, summary: `Roles of ${name} changed by provisioning (${caller.name}): ${c.text}` });
    }
  }

  const GROUP_FILTERS: Record<string, string> = {
    displayname: 'lower(g.display_name) = lower($1)',
    externalid: 'g.external_id = $1',
    id: 'g.id::text = lower($1)',
  };
  const withMembers = (req: FastifyRequest) => !/\bmembers\b/i.test(String((req.query as Row).excludedAttributes ?? ''));

  app.get(`${SCIM_BASE}/Groups`, { config: { public: true, ownBearer: true } }, handle(async (req) => {
    const q = req.query as Row;
    const f = parseFilter(q.filter, GROUP_FILTERS);
    const { startIndex, count } = paging(q);
    const where = f ? ` where ${f.col}` : '';
    const params = f ? [f.value] : [];
    const total = (await db.one<{ c: number }>(`select count(*)::int c from scim_group_roles g${where}`, params))!.c;
    const rows = count ? await db.query<Row>(`${GROUP_SQL}${where} order by g.created_at, g.id limit ${count} offset ${startIndex - 1}`, params) : [];
    const out: Row[] = [];
    for (const g of rows) out.push(await toGroup(req, g, withMembers(req)));
    return list(out, total, startIndex);
  }));

  app.get(`${SCIM_BASE}/Groups/:id`, { config: { public: true, ownBearer: true } }, handle(async (req) => toGroup(req, await findGroup(idOf(req)), withMembers(req))));

  const groupName = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || s.length > 200) scimFail(400, 'displayName is required (up to 200 characters).', 'invalidValue');
    return s;
  };
  const assertGroupName = async (name: string, exceptId = '') => {
    if (await db.one('select 1 from scim_group_roles where lower(display_name) = lower($1) and id::text <> $2', [name, exceptId])) {
      scimFail(409, 'A group with that displayName already exists.', 'uniqueness');
    }
  };

  app.post(`${SCIM_BASE}/Groups`, { config: { public: true, ownBearer: true } }, handle(async (req, reply, caller) => {
    const b = body(req);
    const name = groupName(b.displayName);
    await assertGroupName(name);
    const members = await memberIds(b.members);
    const ext = typeof b.externalId === 'string' && b.externalId ? b.externalId.slice(0, 200) : null;
    const g = (await db.one<Row>('insert into scim_group_roles (display_name, external_id) values ($1, $2) returning id, display_name', [name, ext]))!;
    await ctx.audit(caller.req, {
      action: 'scim.group_create', recordType: 'scim_group', recordId: g.id,
      summary: `Group "${name}" added by provisioning (${caller.name}); it grants no role until an administrator maps it`,
    });
    if (members.length) await changeMembers(caller, g, { set: members });
    reply.code(201).header('location', `${base(req)}/Groups/${g.id}`);
    return toGroup(req, await findGroup(g.id));
  }));

  app.put(`${SCIM_BASE}/Groups/:id`, { config: { public: true, ownBearer: true } }, handle(async (req, _reply, caller) => {
    const g = await findGroup(idOf(req));
    const b = body(req);
    const name = groupName(b.displayName);
    await renameGroup(caller, g, name, b.externalId);
    await changeMembers(caller, g, { set: await memberIds(b.members) });
    return toGroup(req, await findGroup(g.id));
  }));

  async function renameGroup(caller: Caller, g: Row, name: string, externalId: unknown) {
    if (name !== g.display_name) {
      await assertGroupName(name, g.id);
      await db.query('update scim_group_roles set display_name = $2, updated_at = now() where id = $1', [g.id, name]);
      await ctx.audit(caller.req, { action: 'scim.group_update', recordType: 'scim_group', recordId: g.id, summary: `Group "${g.display_name}" renamed "${name}" by provisioning (${caller.name})` });
    }
    if (externalId !== undefined) {
      await db.query('update scim_group_roles set external_id = $2, updated_at = now() where id = $1', [g.id, typeof externalId === 'string' && externalId ? externalId.slice(0, 200) : null]);
    }
  }

  app.patch(`${SCIM_BASE}/Groups/:id`, { config: { public: true, ownBearer: true } }, handle(async (req, _reply, caller) => {
    const g = await findGroup(idOf(req));
    const add: string[] = [];
    const remove: string[] = [];
    let set: string[] | undefined;
    for (const op of operations(req)) {
      const kind = String(op.op ?? '').toLowerCase();
      const path = String(op.path ?? '');
      const memberFilter = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path);
      if (kind === 'remove') {
        if (memberFilter) remove.push(memberFilter[1]);
        else if (path.toLowerCase() === 'members') {
          if (op.value === undefined) set = [];
          else remove.push(...(Array.isArray(op.value) ? op.value : [op.value]).map((m) => String((m as Row)?.value ?? '')));
        } else scimFail(400, `Removing "${path}" is not supported.`, 'mutability');
      } else if (kind === 'add' || kind === 'replace') {
        if (path.toLowerCase() === 'members') {
          const ids = await memberIds(op.value);
          if (kind === 'add') add.push(...ids); else set = ids;
        } else if (path.toLowerCase() === 'displayname') {
          await renameGroup(caller, g, groupName(op.value), undefined);
        } else if (path.toLowerCase() === 'externalid') {
          await renameGroup(caller, g, g.display_name, op.value ?? null);
        } else if (!path && op.value && typeof op.value === 'object') {
          const v = op.value as Row;
          if (v.displayName !== undefined || v.externalId !== undefined) await renameGroup(caller, g, v.displayName !== undefined ? groupName(v.displayName) : g.display_name, v.externalId);
          if (v.members !== undefined) {
            const ids = await memberIds(v.members);
            if (kind === 'add') add.push(...ids); else set = ids;
          }
        } else scimFail(400, `Changing "${path}" is not supported.`, 'invalidPath');
      } else scimFail(400, 'Each operation is add, replace or remove.', 'invalidSyntax');
    }
    await changeMembers(caller, g, { set, add, remove });
    return toGroup(req, await findGroup(g.id), withMembers(req));
  }));

  app.delete(`${SCIM_BASE}/Groups/:id`, { config: { public: true, ownBearer: true } }, handle(async (_req, _reply, caller) => {
    const g = await findGroup(idOf(_req));
    await changeMembers(caller, g, { set: [] });
    await db.query('delete from scim_group_roles where id = $1', [g.id]);
    await ctx.audit(caller.req, { action: 'scim.group_delete', recordType: 'scim_group', recordId: g.id, summary: `Group "${g.display_name}" removed by provisioning (${caller.name})` });
    return undefined;
  }));

  // ---------- discovery ----------

  app.get(`${SCIM_BASE}/ServiceProviderConfig`, { config: { public: true, ownBearer: true } }, handle(async () => ({
    schemas: [S.spc],
    documentationUri: '',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_COUNT },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'A provisioning token made under Administration > User provisioning.', primary: true }],
    meta: { resourceType: 'ServiceProviderConfig' },
  })));

  const attr = (name: string, type: string, extra: Row = {}) => ({ name, type, multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', ...extra });
  const SCHEMAS = [
    {
      schemas: [S.schema], id: S.user, name: 'User', description: 'An account',
      attributes: [
        attr('userName', 'string', { required: true, uniqueness: 'server' }),
        attr('name', 'complex', { subAttributes: [attr('formatted', 'string'), attr('givenName', 'string'), attr('familyName', 'string')] }),
        attr('displayName', 'string'),
        attr('emails', 'complex', { multiValued: true, subAttributes: [attr('value', 'string'), attr('type', 'string'), attr('primary', 'boolean')] }),
        attr('active', 'boolean'),
        attr('groups', 'complex', { multiValued: true, mutability: 'readOnly', subAttributes: [attr('value', 'string'), attr('display', 'string')] }),
      ],
      meta: { resourceType: 'Schema' },
    },
    {
      schemas: [S.schema], id: S.group, name: 'Group', description: 'A group; grants roles only through an administrator\'s mapping',
      attributes: [
        attr('displayName', 'string', { required: true, uniqueness: 'server' }),
        attr('members', 'complex', { multiValued: true, subAttributes: [attr('value', 'string'), attr('display', 'string')] }),
      ],
      meta: { resourceType: 'Schema' },
    },
  ];
  app.get(`${SCIM_BASE}/Schemas`, { config: { public: true, ownBearer: true } }, handle(async () => list(SCHEMAS, SCHEMAS.length, 1)));
  app.get(`${SCIM_BASE}/ResourceTypes`, { config: { public: true, ownBearer: true } }, handle(async (req) => list([
    { schemas: [S.rt], id: 'User', name: 'User', endpoint: '/Users', schema: S.user, meta: { resourceType: 'ResourceType', location: `${base(req)}/ResourceTypes/User` } },
    { schemas: [S.rt], id: 'Group', name: 'Group', endpoint: '/Groups', schema: S.group, meta: { resourceType: 'ResourceType', location: `${base(req)}/ResourceTypes/Group` } },
  ], 2, 1)));

  describeScimRoutes(ctx);
}

// ---------- helpers ----------

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : undefined);
const idOf = (req: FastifyRequest) => String((req.params as Row).id ?? '');
const body = (req: FastifyRequest): Row => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Row) : scimFail(400, 'The body must be a JSON object.', 'invalidSyntax');
};
function operations(req: FastifyRequest): Row[] {
  const ops = body(req).Operations;
  if (!Array.isArray(ops) || !ops.length || ops.length > 100) scimFail(400, 'Send 1 to 100 Operations.', 'invalidSyntax');
  return ops as Row[];
}
function parseBool(v: unknown, what: string): boolean {
  if (v === true || v === false) return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return scimFail(400, `${what} must be true or false.`, 'invalidValue');
}

function describeScimRoutes(ctx: ModuleContext) {
  const tag = 'SCIM';
  const auth = 'Needs a provisioning token (`Authorization: Bearer grc_scim_...`, Administration > User provisioning), and provisioning switched on; anything else is answered 401 in SCIM\'s error shape. Answers `application/scim+json`.';
  const d = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, summary: string, extra: Row = {}) =>
    ctx.describeRoute({ method, path: `${SCIM_BASE}${path}`, summary, public: true, tag, description: `${auth}${extra.more ? ` ${extra.more}` : ''}`, ...(extra.query ? { query: extra.query } : {}), ...(extra.body ? { body: extra.body } : {}), ...(extra.response ? { response: extra.response } : {}) } as never);
  const pageQuery = { filter: '`<attribute> eq "<value>"` (see the integration guide for the attributes).', startIndex: 'First result, from 1.', count: `Results a page (at most ${MAX_COUNT}).` };
  d('GET', '/Users', 'List accounts (SCIM)', { query: pageQuery, response: '{ schemas, totalResults, startIndex, itemsPerPage, Resources: [User] }', more: 'Filters: userName, externalId, emails.value, id. The break-glass account is never listed.' });
  d('GET', '/Users/:id', 'One account (SCIM)', { response: 'User' });
  d('POST', '/Users', 'Create an account (SCIM)', { body: '{ schemas, userName, externalId?, name?, displayName?, emails: [{ value, primary }], active? }', response: '201 User', more: 'The account has no local password and no roles; 409 `uniqueness` when the userName, email or externalId is taken.' });
  d('PUT', '/Users/:id', 'Replace an account (SCIM)', { body: 'User', response: 'User', more: '`active: false` deactivates (sessions, tokens and assistant connections end).' });
  d('PATCH', '/Users/:id', 'Change an account (SCIM)', { body: '{ schemas: [PatchOp], Operations: [{ op: add|replace|remove, path?, value }] }', response: 'User', more: 'Paths: active, userName, displayName, name.*, emails, externalId. `active: false` deactivates; `active: true` enables only an account provisioning disabled. 409 `last_admin` when it would leave no administrator. 403 `mutability` when it would change the email address or active state of an account that can administer (an administrator does that by hand). A changed email address is told to the old address.' });
  d('DELETE', '/Users/:id', 'Deactivate an account (SCIM)', { response: '204', more: 'Never deletes: the account is disabled, its sessions end and its tokens, assistant connections and calendar feeds are revoked. 403 `mutability` for an account that can administer.' });
  d('GET', '/Groups', 'List groups (SCIM)', { query: { ...pageQuery, excludedAttributes: '`members` leaves the members out.' }, response: '{ schemas, totalResults, startIndex, itemsPerPage, Resources: [Group] }', more: 'Filters: displayName, externalId, id.' });
  d('GET', '/Groups/:id', 'One group (SCIM)', { response: 'Group' });
  d('POST', '/Groups', 'Create a group (SCIM)', { body: '{ schemas, displayName, externalId?, members?: [{ value }] }', response: '201 Group', more: 'A group grants no role until an administrator maps it to roles.' });
  d('PUT', '/Groups/:id', 'Replace a group and its members (SCIM)', { body: 'Group', response: 'Group' });
  d('PATCH', '/Groups/:id', 'Change a group or its members (SCIM)', { body: '{ Operations: [{ op, path: "members" | "members[value eq \\"id\\"]" | "displayName", value }] }', response: 'Group' });
  d('DELETE', '/Groups/:id', 'Remove a group (SCIM)', { response: '204', more: 'Roles it gave are taken away from its members.' });
  d('GET', '/ServiceProviderConfig', 'What this SCIM service supports', { response: 'ServiceProviderConfig' });
  d('GET', '/Schemas', 'The User and Group schemas (SCIM)', { response: 'ListResponse of Schema' });
  d('GET', '/ResourceTypes', 'The resource types (SCIM)', { response: 'ListResponse of ResourceType' });
}
