import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import type { Queryable } from '../../core/db.ts';
import { requireRecentAuth } from '../../core/auth.ts';
import { fail, UUID_RE } from '../../core/errors.ts';
import type { ModuleContext } from '../../core/module.ts';

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Every route registered through `adminRoute`, so tests can prove each one refuses a non-administrator. */
export const ADMIN_ROUTES: { method: string; url: string }[] = [];

/** Registers a route that needs `admin.administer`. */
export function adminRoute(ctx: ModuleContext, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, handler: Handler) {
  if (!ADMIN_ROUTES.some((r) => r.method === method && r.url === url)) ADMIN_ROUTES.push({ method, url });
  ctx.app.route({ method: method as HTTPMethods, url, preHandler: ctx.requirePerm('admin.administer'), handler });
}

/** Permission vocabulary (docs/development.md, "Permissions"). `portal` is the requester portal, granted to the Requester role. */
export const MODULE_KEYS = [
  'tickets', 'knowledge', 'assets', 'systems', 'sites', 'data', 'changes', 'vendors', 'contracts', 'frameworks',
  'risks', 'security', 'vulnerabilities', 'policies', 'training', 'exceptions', 'obligations', 'exercises',
  'actions', 'projects', 'dashboards', 'reports', 'audit', 'admin', 'portal', 'fleet', 'safety',
  'audits', 'controls', 'funding', 'governance', 'people',
  'continuity', 'legal', 'records', 'privacy',
];
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'administer', 'export'];

export function isValidGrant(grant: string): boolean {
  if (grant === '*') return true;
  const [mod, action, ...rest] = grant.split('.');
  return rest.length === 0 && MODULE_KEYS.includes(mod) && (action === '*' || ACTIONS.includes(action));
}

/** The id from the route, or a 404 when it is not a UUID. */
export function idParam(req: FastifyRequest, what = 'Record'): string {
  const id = String((req.params as Record<string, string>).id ?? '');
  if (!UUID_RE.test(id)) fail(404, 'not_found', `${what} not found.`);
  return id;
}

export const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, any>;

export function invalid(fields: Record<string, string>): never {
  return fail(400, 'validation', 'Check the highlighted fields.', fields);
}

/**
 * Sensitive administrative actions: the password must have been confirmed in this session within
 * the last few minutes (`auth.reauth_minutes`), or the request is refused with 403 `reauth_required`
 * and audited. Listed in docs/security.md; keep the two in step.
 */
export function sensitive(ctx: ModuleContext, req: FastifyRequest, what: string): Promise<void> {
  return requireRecentAuth({ db: ctx.db, audit: ctx.audit, settings: ctx.settings }, req, what);
}

/** Ids of users who can administer right now: active, holding an enabled role that grants it. */
export async function administratorIds(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `select u.id from users u
     where u.deleted_at is null and u.status = 'active' and exists (
       select 1 from user_roles ur
       join roles r on r.id = ur.role_id and r.enabled
       join role_permissions rp on rp.role_id = r.id
       where ur.user_id = u.id and rp.permission in ('*', 'admin.*', 'admin.administer'))`,
  );
  return rows.map((r) => r.id);
}

/**
 * Call inside a transaction, after the change. Throws (rolling the change back) when it would
 * leave nobody able to administer, or would take the acting administrator's own access away.
 */
export async function guardAdministrators(tx: Queryable, actorId: string): Promise<void> {
  const ids = await administratorIds(tx);
  if (ids.length === 0) {
    fail(409, 'last_administrator', 'That would leave no active administrator. Give another person the administrator role first.');
  }
  if (!ids.includes(actorId)) {
    fail(409, 'self_lockout', 'You cannot disable your own account or remove your own administrator access. Ask another administrator to do it.');
  }
}

// ---------- recovery codes ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I

/** Ten codes of 10 symbols (50 bits each), shown as XXXXX-XXXXX. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = Array.from(randomBytes(10), (b) => CODE_ALPHABET[b & 31]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
