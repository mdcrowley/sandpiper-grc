import { randomToken, sha256 } from '../../core/auth.ts';
import { revokeAllPasskeys } from '../../core/webauthn/index.ts';
import { revokedSummary, revokeProgramAccess } from '../../core/tokens.ts';
import { pageOf } from '../../core/api/conventions.ts';
import type { Queryable } from '../../core/db.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { FastifyRequest } from 'fastify';
import { adminRoute, administratorIds, body, guardAdministrators, idParam, invalid, sensitive } from './shared.ts';

// Never selects password_hash, totp_secret or recovery_codes.
const USER_SELECT = `
  select u.id, u.username, u.email, u.display_name, u.status, u.department_id, d.name as department,
    u.totp_enabled, (u.locked_until is not null and u.locked_until > now()) as locked, u.locked_until,
    u.failed_attempts, u.last_login_at, u.password_changed_at, u.created_at, u.updated_at,
    (u.password_hash is not null) as has_password,
    (select count(*)::int from webauthn_credentials w where w.user_id = u.id and w.revoked_at is null) as passkeys,
    coalesce((select json_agg(json_build_object('key', r.key, 'name', r.name, 'enabled', r.enabled, 'requires_mfa', r.requires_mfa) order by r.name)
              from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id), '[]'::json) as roles,
    exists (select 1 from one_time_tokens t where t.user_id = u.id and t.used_at is null and t.expires_at > now()) as link_pending,
    (select count(*)::int from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions,
    (select count(*)::int from user_identities i join identity_providers p on p.id = i.provider_id and p.deleted_at is null
      where i.user_id = u.id) as identities,
    coalesce((select s.break_glass from identity_user_settings s where s.user_id = u.id), false) as break_glass
  from users u left join departments d on d.id = u.department_id and d.deleted_at is null
  where u.deleted_at is null`;

const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
export const LINK_HOURS = 24;

export function registerUsers(ctx: ModuleContext) {
  const { db } = ctx;

  const getUser = async (id: string, q: Queryable = db) => {
    const row = await q.one<Row>(`${USER_SELECT} and u.id = $1`, [id]);
    if (!row) ctx.fail(404, 'not_found', 'User not found.');
    return row!;
  };

  /** Checks the editable profile fields that are present in `b`; returns cleaned values. */
  async function cleanProfile(b: Row, existingId?: string) {
    const fields: Record<string, string> = {};
    const out: { username?: string; email?: string; display_name?: string; department_id?: string | null } = {};
    if (b.username !== undefined || !existingId) {
      out.username = String(b.username ?? '').trim();
      if (!USERNAME_RE.test(out.username)) fields.username = 'Use 3 to 64 letters, numbers, dots, dashes or underscores.';
      else if (await db.one('select 1 from users where deleted_at is null and lower(username) = lower($1) and id::text <> $2', [out.username, existingId ?? ''])) {
        fields.username = 'Another user already has that username.';
      }
    }
    if (b.email !== undefined || !existingId) {
      out.email = String(b.email ?? '').trim();
      if (!EMAIL_RE.test(out.email) || out.email.length > 254) fields.email = 'Enter an email address.';
      else if (await db.one('select 1 from users where deleted_at is null and lower(email) = lower($1) and id::text <> $2', [out.email, existingId ?? ''])) {
        fields.email = 'Another user already has that email address.';
      }
    }
    if (b.displayName !== undefined || !existingId) {
      out.display_name = String(b.displayName ?? '').trim();
      if (!out.display_name || out.display_name.length > 120) fields.displayName = 'Enter a name of up to 120 characters.';
    }
    if (b.departmentId !== undefined) {
      out.department_id = b.departmentId ? String(b.departmentId) : null;
      if (out.department_id && !(UUID_RE.test(out.department_id)
        && await db.one('select 1 from departments where id = $1 and deleted_at is null', [out.department_id]))) {
        fields.departmentId = 'Choose a department from the list.';
      }
    }
    return { out, fields };
  }

  /** Turns role keys into ids, rejecting unknown keys. */
  async function roleIds(keys: unknown, fields: Record<string, string>): Promise<{ id: string; key: string }[]> {
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
      fields.roles = 'Choose roles from the list.';
      return [];
    }
    const wanted = [...new Set(keys as string[])];
    const rows = await db.query<{ id: string; key: string }>('select id, key from roles where key = any($1::text[])', [wanted]);
    if (rows.length !== wanted.length) fields.roles = 'Choose roles from the list.';
    return rows;
  }

  /** Issues a one-time link. Earlier unused links for the user stop working. Only the hash is stored. */
  async function issueLink(req: FastifyRequest, userId: string, purpose: 'setup' | 'reset') {
    const token = randomToken();
    await db.query('update one_time_tokens set used_at = now() where user_id = $1 and used_at is null', [userId]);
    const row = await db.one<{ expires_at: string }>(
      `insert into one_time_tokens (token_hash, user_id, purpose, expires_at, created_by)
       values ($1, $2, $3, now() + make_interval(hours => $4::int), $5) returning expires_at`,
      [sha256(token), userId, purpose, LINK_HOURS, req.user!.id],
    );
    return { link: `/redeem?token=${token}`, expiresAt: row!.expires_at, purpose };
  }

  // ---------- list and read ----------

  adminRoute(ctx, 'GET', '/api/admin/users', async (req) => {
    const query = req.query as Record<string, string>;
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (query.q?.trim()) {
      const p = add(`%${query.q.trim()}%`);
      where.push(`(u.username ilike ${p} or u.email ilike ${p} or u.display_name ilike ${p})`);
    }
    if (query.status === 'locked') where.push('(u.locked_until is not null and u.locked_until > now())');
    else if (query.status) where.push(`u.status = ${add(query.status)}`);
    if (query.role) {
      where.push(`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.key = ${add(query.role)})`);
    }
    const w = where.map((c) => ` and ${c}`).join('');
    const { page, pageSize } = pageOf(query); // whole numbers in range (SP-09)
    const total = (await db.one<{ c: number }>(`select count(*)::int c from users u where u.deleted_at is null${w}`, params))!.c;
    const rows = await db.query(
      `${USER_SELECT}${w} order by lower(u.display_name), u.id limit ${pageSize} offset ${(page - 1) * pageSize}`, params,
    );
    return { rows, total, page, pageSize };
  });

  adminRoute(ctx, 'GET', '/api/admin/users/:id', async (req) => getUser(idParam(req, 'User')));

  // ---------- create ----------

  adminRoute(ctx, 'POST', '/api/admin/users', async (req, reply) => {
    const b = body(req);
    const { out, fields } = await cleanProfile(b);
    // Least privilege: a new user holds only the roles the administrator picks (none by default).
    const roles = await roleIds(b.roles ?? [], fields);
    if (Object.keys(fields).length) invalid(fields);
    // Creating a user hands out roles and issues a one-time link.
    await sensitive(ctx, req, 'creating a user');

    const id = await db.tx(async (tx) => {
      const row = await tx.one<{ id: string }>(
        `insert into users (username, email, display_name, department_id, status, created_by, updated_by)
         values ($1,$2,$3,$4,'pending',$5,$5) returning id`,
        [out.username, out.email, out.display_name, out.department_id ?? null, req.user!.id],
      );
      for (const r of roles) await tx.query('insert into user_roles (user_id, role_id) values ($1,$2)', [row!.id, r.id]);
      return row!.id;
    });
    const link = await issueLink(req, id, 'setup');
    await ctx.audit(req, {
      action: 'user.create', recordType: 'user', recordId: id,
      summary: `User ${out.username} created; one-time setup link issued`,
      after: { username: out.username, email: out.email, display_name: out.display_name, department_id: out.department_id ?? null, roles: roles.map((r) => r.key).sort() },
    });
    reply.code(201);
    return { user: await getUser(id), setupLink: link.link, expiresAt: link.expiresAt };
  });

  // ---------- update (profile, status, roles) ----------

  async function updateUser(req: FastifyRequest, id: string, b: Row) {
    const before = await getUser(id);
    const { out, fields } = await cleanProfile(b, id);
    let roles: { id: string; key: string }[] | null = null;
    if (b.roles !== undefined) roles = await roleIds(b.roles, fields);
    let status: string | undefined;
    if (b.status !== undefined) {
      if (b.status !== 'active' && b.status !== 'disabled') fields.status = 'Status must be active or disabled.';
      // A person who has never set a password goes back to waiting for their setup link.
      else status = b.status === 'active' && !before.has_password ? 'pending' : b.status;
    }
    if (Object.keys(fields).length) invalid(fields);
    if (roles) {
      const wanted = roles.map((r) => r.key).sort();
      const held = (before.roles as { key: string }[]).map((r) => r.key).sort();
      if (JSON.stringify(wanted) !== JSON.stringify(held)) await sensitive(ctx, req, `changing the roles of ${before.username}`);
    }
    // E01-33: enabling a disabled account gives its access back (like creating one), and the email
    // address is where a password-reset link goes (like issuing one).
    if (b.status === 'active' && before.status === 'disabled') await sensitive(ctx, req, `enabling ${before.username} again`);
    if (out.email !== undefined && String(out.email ?? '').toLowerCase() !== String(before.email ?? '').toLowerCase()) {
      await sensitive(ctx, req, `changing the email address of ${before.username}`);
    }

    // Read before the transaction: the embedded database has one connection, which the transaction holds.
    const localOff = before.break_glass && (await ctx.settings.get('auth.local_signin', true)) === false;
    await db.tx(async (tx) => {
      await tx.query(
        `update users set username = $2, email = $3, display_name = $4, department_id = $5, status = $6,
           updated_at = now(), updated_by = $7 where id = $1`,
        [id, out.username ?? before.username, out.email ?? before.email, out.display_name ?? before.display_name,
          out.department_id === undefined ? before.department_id : out.department_id, status ?? before.status, req.user!.id],
      );
      if (roles) {
        await tx.query('delete from user_roles where user_id = $1', [id]);
        for (const r of roles) await tx.query('insert into user_roles (user_id, role_id) values ($1,$2)', [id, r.id]);
      }
      if (status === 'disabled') {
        await tx.query('delete from sessions where user_id = $1', [id]);
        await tx.query('update one_time_tokens set used_at = now() where user_id = $1 and used_at is null', [id]);
      }
      await guardAdministrators(tx, req.user!.id);
      // The break-glass account must stay able to administer; and with local passwords off it is the only way back in.
      if (before.break_glass) {
        if (!(await administratorIds(tx)).includes(id) && status !== 'disabled') {
          ctx.fail(409, 'break_glass', 'This is the break-glass account and must keep administrator access. Remove the break-glass designation first.');
        }
        if (status === 'disabled' && localOff) {
          ctx.fail(409, 'break_glass', 'Local passwords are off, so the break-glass account is the only way in if single sign-on fails. It cannot be disabled.');
        }
      }
    });

    const after = await getUser(id);
    const pick = (u: Row) => ({
      username: u.username, email: u.email, display_name: u.display_name, department_id: u.department_id,
      status: u.status, roles: (u.roles as { key: string }[]).map((r) => r.key).sort(),
    });
    const [pb, pa] = [pick(before), pick(after)] as Row[];
    const changed = Object.keys(pb).filter((k) => JSON.stringify(pb[k]) !== JSON.stringify(pa[k]));
    if (changed.length) {
      const only = changed.length === 1 ? changed[0] : '';
      await ctx.audit(req, {
        action: only === 'status' ? (pa.status === 'disabled' ? 'user.disable' : 'user.enable') : only === 'roles' ? 'user.roles' : 'user.update',
        recordType: 'user', recordId: id,
        summary: only === 'status' ? `User ${after.username} ${pa.status === 'disabled' ? 'disabled; sessions ended' : 'enabled'}`
          : only === 'roles' ? `Roles of ${after.username} changed to: ${pa.roles.join(', ') || 'none'}`
          : `User ${after.username} updated (${changed.join(', ')})`,
        before: Object.fromEntries(changed.map((k) => [k, pb[k]])),
        after: Object.fromEntries(changed.map((k) => [k, pa[k]])),
      });
    }
    return after;
  }

  adminRoute(ctx, 'PATCH', '/api/admin/users/:id', async (req) => updateUser(req, idParam(req, 'User'), body(req)));
  adminRoute(ctx, 'POST', '/api/admin/users/:id/disable', async (req) => updateUser(req, idParam(req, 'User'), { status: 'disabled' }));
  adminRoute(ctx, 'POST', '/api/admin/users/:id/enable', async (req) => updateUser(req, idParam(req, 'User'), { status: 'active' }));

  // ---------- account actions ----------

  adminRoute(ctx, 'POST', '/api/admin/users/:id/setup-link', async (req) => {
    const u = await getUser(idParam(req, 'User'));
    if (u.status !== 'pending') ctx.fail(409, 'not_pending', 'This person has already set a password. Issue a password-reset link instead.');
    await sensitive(ctx, req, `issuing a setup link for ${u.username}`);
    const link = await issueLink(req, u.id, 'setup');
    await ctx.audit(req, { action: 'user.setup_link', recordType: 'user', recordId: u.id, summary: `New one-time setup link issued for ${u.username}` });
    return link;
  });

  adminRoute(ctx, 'POST', '/api/admin/users/:id/reset-link', async (req) => {
    const u = await getUser(idParam(req, 'User'));
    if (u.status === 'disabled') ctx.fail(409, 'disabled', 'This account is disabled. Enable it before issuing a link.');
    await sensitive(ctx, req, `issuing a password-reset link for ${u.username}`);
    const link = await issueLink(req, u.id, u.status === 'pending' ? 'setup' : 'reset');
    await ctx.audit(req, { action: 'user.reset_link', recordType: 'user', recordId: u.id, summary: `One-time password-reset link issued for ${u.username}` });
    return link;
  });

  adminRoute(ctx, 'POST', '/api/admin/users/:id/unlock', async (req) => {
    const u = await getUser(idParam(req, 'User'));
    await db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [u.id]);
    await ctx.audit(req, {
      action: 'user.unlock', recordType: 'user', recordId: u.id,
      summary: `Account ${u.username} unlocked (${u.failed_attempts} failed attempts cleared)`,
    });
    return getUser(u.id);
  });

  adminRoute(ctx, 'POST', '/api/admin/users/:id/end-sessions', async (req) => {
    const u = await getUser(idParam(req, 'User'));
    // Ending your own sessions here keeps the one you are using.
    const ended = await db.query(
      'delete from sessions where user_id = $1 and token_hash <> $2 returning 1', [u.id, u.id === req.user!.id ? req.sessionHash : ''],
    );
    await ctx.audit(req, {
      action: 'user.end_sessions', recordType: 'user', recordId: u.id,
      summary: `Ended ${ended.length} session(s) of ${u.username}`,
    });
    return { ok: true, ended: ended.length };
  });

  adminRoute(ctx, 'POST', '/api/admin/users/:id/reset-mfa', async (req) => {
    const u = await getUser(idParam(req, 'User'));
    await sensitive(ctx, req, `resetting the second factor of ${u.username}`);
    await db.query(
      `update users set totp_enabled = false, totp_secret = null, totp_last_step = null, mfa_required_since = null,
         recovery_codes = '[]', updated_at = now() where id = $1`, [u.id]);
    // Passkeys and security keys are second factors too: a reset removes them as well.
    const keys = await revokeAllPasskeys(db, u.id, req.user!.id);
    // API tokens and AI assistant connections go too (wave 9, SA-8): a reset follows a lost or misused factor.
    const revoked = await revokeProgramAccess(db, u.id, req.user!.id, 'second factor reset by an administrator');
    await ctx.audit(req, {
      action: 'mfa.reset', recordType: 'user', recordId: u.id,
      summary: `Second factor of ${u.username} reset by an administrator${keys ? ` (${keys} passkey(s) removed)` : ''}${revokedSummary(revoked)}`,
      before: { totp_enabled: u.totp_enabled }, after: { totp_enabled: false },
    });
    return getUser(u.id);
  });
}
