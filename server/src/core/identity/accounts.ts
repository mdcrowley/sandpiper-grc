// What an external identity means for accounts here: which person it is, linking, just-in-time
// creation and role mapping. Shared by every kind of provider.
import type { FastifyRequest } from 'fastify';
import type { Db, Queryable } from '../db.ts';
import type { AuditInput } from '../module.ts';
import { domainAllowed } from './config.ts';
import type { ExternalIdentity, ProviderRecord, RoleMapping } from './types.ts';

export type Audit = (req: FastifyRequest | null, ev: AuditInput, q?: Queryable) => Promise<void>;

export interface UserRow { id: string; username: string; email: string; display_name: string; status: string }

export type Resolution =
  | { kind: 'user'; userId: string; how: 'linked' | 'permit' | 'jit' }
  | { kind: 'link_needed'; userId: string }
  | { kind: 'refused'; reason: string; userId?: string; noAccount?: boolean };

const USER_COLS = 'id, username, email, display_name, status';

export const findUserById = (db: Queryable, id: string) =>
  db.one<UserRow>(`select ${USER_COLS} from users where id = $1 and deleted_at is null`, [id]);

export async function isBreakGlass(db: Queryable, userId: string): Promise<boolean> {
  return Boolean(await db.one('select 1 from identity_user_settings where user_id = $1 and break_glass', [userId]));
}

/** The person an external identity signs in as, or what has to happen first. Writes nothing except a permit link or a JIT account. */
export async function resolveSignIn(
  deps: { db: Db; audit: Audit }, req: FastifyRequest, provider: ProviderRecord, identity: ExternalIdentity,
): Promise<Resolution> {
  const { db } = deps;
  const linked = await db.one<{ user_id: string }>(
    'select user_id from user_identities where provider_id = $1 and subject = $2', [provider.id, identity.subject],
  );
  if (linked) return { kind: 'user', userId: linked.user_id, how: 'linked' };

  if (!identity.email || !identity.emailVerified) {
    return { kind: 'refused', reason: identity.email ? 'email not verified by the provider' : 'no email from the provider', noAccount: true };
  }
  const user = await db.one<UserRow & { permit: boolean; break_glass: boolean }>(
    `select u.id, u.username, u.email, u.display_name, u.status,
       coalesce(s.permit_provider_id = $2 and s.permit_expires_at > now(), false) as permit,
       coalesce(s.break_glass, false) as break_glass
     from users u left join identity_user_settings s on s.user_id = u.id
     where u.deleted_at is null and lower(u.email) = $1`,
    [identity.email.toLowerCase(), provider.id],
  );
  if (user) {
    if (user.break_glass) return { kind: 'refused', reason: 'the break-glass account cannot use single sign-on', userId: user.id };
    if (user.status === 'disabled') return { kind: 'refused', reason: 'account disabled', userId: user.id };
    if (await db.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [user.id, provider.id])) {
      return { kind: 'refused', reason: 'the account is linked to another identity at this provider', userId: user.id };
    }
    if (user.permit) {
      await linkIdentity(deps, req, { userId: user.id, provider, identity, method: 'permit' });
      await db.query('update identity_user_settings set permit_provider_id = null, permit_expires_at = null, permit_by = null where user_id = $1', [user.id]);
      return { kind: 'user', userId: user.id, how: 'permit' };
    }
    // Linking needs both proofs: the provider's (done) and the account's own password (next).
    return { kind: 'link_needed', userId: user.id };
  }

  const cfg = provider.config;
  if (!cfg.jitEnabled) return { kind: 'refused', reason: 'no account for this email', noAccount: true };
  if (!domainAllowed(identity.email, cfg.jitDomains ?? [])) return { kind: 'refused', reason: 'email domain not allowed for new accounts', noAccount: true };
  const userId = await createJitUser(deps, req, provider, identity);
  return { kind: 'user', userId, how: 'jit' };
}

/** Records a link between a person and an external identity, audited. */
export async function linkIdentity(
  deps: { db: Db; audit: Audit }, req: FastifyRequest | null,
  link: { userId: string; provider: ProviderRecord; identity: ExternalIdentity; method: 'self' | 'sign_in_confirmed' | 'permit' | 'jit'; by?: string | null },
): Promise<void> {
  await deps.db.query(
    `insert into user_identities (user_id, provider_id, subject, email, link_method, linked_by, login_name) values ($1,$2,$3,$4,$5,$6,$7)`,
    [link.userId, link.provider.id, link.identity.subject, link.identity.email, link.method, link.by ?? req?.user?.id ?? null, link.identity.loginName ?? null],
  );
  const how = {
    self: 'by the person, signed in and confirmed at the provider',
    sign_in_confirmed: 'by the person, confirmed with their password',
    permit: 'at sign-in, allowed in advance by an administrator',
    jit: 'when the account was created at first sign-in',
  }[link.method];
  await deps.audit(req, {
    action: 'identity.link', recordType: 'user', recordId: link.userId,
    summary: `${link.provider.name} identity linked ${how}`,
    after: { provider: link.provider.key, email: link.identity.email, method: link.method },
  });
}

async function uniqueUsername(db: Queryable, email: string): Promise<string> {
  let base = email.split('@')[0].replace(/[^A-Za-z0-9._-]/g, '').slice(0, 56) || 'user';
  if (base.length < 3) base = `${base}${'user'.slice(0, 3 - base.length)}`;
  for (let i = 1; i < 1000; i += 1) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await db.one('select 1 from users where lower(username) = lower($1)', [candidate]))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

async function createJitUser(deps: { db: Db; audit: Audit }, req: FastifyRequest, provider: ProviderRecord, identity: ExternalIdentity): Promise<string> {
  const { db } = deps;
  const username = await uniqueUsername(db, identity.email!);
  const displayName = (identity.displayName ?? identity.email!).slice(0, 120);
  const row = await db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ($1,$2,$3,'active') returning id`,
    [username, identity.email, displayName],
  );
  await deps.audit(req, {
    action: 'user.create', recordType: 'user', recordId: row!.id,
    summary: `User ${username} created at first sign-in through ${provider.name}`,
    after: { username, email: identity.email, display_name: displayName, provider: provider.key },
  });
  await linkIdentity(deps, req, { userId: row!.id, provider, identity, method: 'jit', by: null });
  return row!.id;
}

/**
 * Role mapping: roles named in the provider's rules follow the person's groups at every sign-in
 * (added when a group matches, removed when none does). Roles not named in any rule are never touched.
 * A removal that would leave nobody able to administer is skipped and audited.
 */
export async function syncMappedRoles(
  deps: { db: Db; audit: Audit }, req: FastifyRequest | null, userId: string, provider: ProviderRecord, groups: string[],
): Promise<{ added: string[]; removed: string[] } | null> {
  const cfg = provider.config;
  if (!cfg.mappingEnabled || !Array.isArray(cfg.mappings) || !cfg.mappings.length) return null;
  const rules = cfg.mappings as RoleMapping[];
  const mapped = new Set(rules.map((m) => m.role));
  const wanted = new Set(rules.filter((m) => groups.includes(m.value)).map((m) => m.role));
  const roles = await deps.db.query<{ id: string; key: string }>('select id, key from roles where key = any($1::text[])', [[...mapped]]);
  const held = new Set((await deps.db.query<{ key: string }>(
    'select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1', [userId],
  )).map((r) => r.key));
  const added = roles.filter((r) => wanted.has(r.key) && !held.has(r.key));
  let removed = roles.filter((r) => !wanted.has(r.key) && held.has(r.key));
  if (!added.length && !removed.length) return { added: [], removed: [] };
  let skipped = false;
  await deps.db.tx(async (tx) => {
    for (const r of added) await tx.query('insert into user_roles (user_id, role_id) values ($1,$2) on conflict do nothing', [userId, r.id]);
    for (const r of removed) await tx.query('delete from user_roles where user_id = $1 and role_id = $2', [userId, r.id]);
    const admins = await tx.one<{ c: number }>(
      `select count(*)::int c from users u where u.deleted_at is null and u.status = 'active' and exists (
         select 1 from user_roles ur join roles r on r.id = ur.role_id and r.enabled
         join role_permissions rp on rp.role_id = r.id
         where ur.user_id = u.id and rp.permission in ('*', 'admin.*', 'admin.administer'))`,
    );
    if (removed.length && (admins?.c ?? 0) === 0) {
      for (const r of removed) await tx.query('insert into user_roles (user_id, role_id) values ($1,$2) on conflict do nothing', [userId, r.id]);
      removed = [];
      skipped = true;
    }
  });
  const after = [...held].filter((k) => !removed.some((r) => r.key === k)).concat(added.map((r) => r.key)).sort();
  if (added.length || removed.length) {
    await deps.audit(req, {
      action: 'user.roles', recordType: 'user', recordId: userId,
      summary: `Roles changed by ${provider.name} role mapping: ${[
        added.length ? `added ${added.map((r) => r.key).join(', ')}` : '',
        removed.length ? `removed ${removed.map((r) => r.key).join(', ')}` : '',
      ].filter(Boolean).join('; ')}`,
      before: { roles: [...held].sort() }, after: { roles: after },
    });
  }
  if (skipped) {
    await deps.audit(req, {
      action: 'identity.mapping_skipped', recordType: 'user', recordId: userId,
      summary: `${provider.name} role mapping would have left no administrator; roles were not removed`,
    });
  }
  return { added: added.map((r) => r.key), removed: removed.map((r) => r.key) };
}

/** Permissions that can administer the application: an account holding one is never changed by provisioning (W17-0). */
export const ADMIN_CAPABLE_SQL = `(rp.permission = '*' or rp.permission like 'admin.%')`;

/**
 * True when the account holds a permission that can administer (through any role, switched on or
 * not: a role switched off can be switched on again) or is the break-glass account. Provisioning may
 * not change such an account's email address, active state or provider link permit.
 */
export async function isAdminCapable(db: Queryable, userId: string): Promise<boolean> {
  return Boolean(await db.one(
    `select 1 where exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id
                              where ur.user_id = $1 and ${ADMIN_CAPABLE_SQL})
        or exists (select 1 from identity_user_settings s where s.user_id = $1 and s.break_glass)`, [userId]));
}

interface MailApp { hasDecorator?: (name: string) => boolean; sendMail?: (input: { to?: string | string[]; subject?: string; text?: string; purpose?: string; link?: string }) => Promise<unknown> }

/**
 * Tells the person at their old address that the account's email address changed (W17-0): password
 * reset links now go to the new address, so a change they did not ask for must reach them. Sends
 * nothing while email is switched off. Never throws.
 */
export async function notifyEmailChange(app: MailApp, change: { username: string; oldEmail: string | null | undefined; newEmail: string; by: string }): Promise<void> {
  const old = String(change.oldEmail ?? '').trim();
  if (!old || old.toLowerCase() === change.newEmail.trim().toLowerCase()) return;
  if (!app.hasDecorator?.('sendMail') || typeof app.sendMail !== 'function') return;
  try {
    await app.sendMail({
      to: old, purpose: 'security', link: '/account',
      subject: 'The email address of your account was changed',
      text: `The email address of the account ${change.username} was changed from this address to ${maskEmail(change.newEmail)} by ${change.by} `
        + `at ${new Date().toISOString()}. Password-reset links now go to the new address. If you did not expect this, `
        + 'tell your administrator at once.',
    });
  } catch (err) {
    console.error('[identity] email change notice failed:', err);
  }
}

/** "m****@example.test": enough for the person to recognize it, not a full address for whoever reads the old mailbox. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '****';
  return `${local.slice(0, 1)}****@${domain}`;
}
