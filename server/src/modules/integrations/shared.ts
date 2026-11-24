// Shared by provisioning (SCIM) and its administration: who the audit log names for a change made by
// provisioning, which roles may be granted through a group, and keeping a person's roles in step with
// the groups they are in.
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../../core/db.ts';
import type { ModuleContext, SessionUser } from '../../core/module.ts';
import { adminCapableRoleIds } from '../../core/identity/accounts.ts';
import { administratorIds } from '../admin/shared.ts';

/**
 * A request that the audit log names as "Provisioning (<token name>)": the same source address and
 * request id as the call, with no person (actor id null). Used for every change provisioning makes.
 */
export function provisioningRequest(req: FastifyRequest, tokenName: string): FastifyRequest {
  const actor: SessionUser = { id: null as unknown as string, username: '', displayName: `Provisioning (${tokenName})`, email: '', roles: [], permissions: [] };
  return Object.assign(Object.create(req) as FastifyRequest, { user: actor, apiToken: null });
}

/**
 * Ids of roles that can administer: `*` or any `admin.` grant (W19). The same definition as the SCIM
 * guards (isAdminCapable), so provisioning never gives a role that would then stop it deprovisioning
 * the person. Provisioning never maps a group to, or gives, such a role.
 */
export const adminRoleIds = (q: Queryable): Promise<Set<string>> => adminCapableRoleIds(q);

export interface RoleChange { added: string[]; removed: string[] }

/**
 * Brings a person's roles in step with the mapped groups they are in (E36-01):
 *  - a role a mapped group names, that the person does not hold, is given and remembered as given by
 *    provisioning (scim_role_grants); a role that can administer is never given;
 *  - a role provisioning gave that no group names any more is taken away; a role an administrator gave
 *    by hand is never taken away;
 *  - refused (409 `last_admin`, rolled back) when it would leave nobody able to administer.
 * Call inside a transaction. Returns the role keys added and removed (the caller audits).
 */
export async function syncProvisionedRoles(ctx: Pick<ModuleContext, 'fail'>, tx: Queryable, userId: string): Promise<RoleChange> {
  const admins = await adminRoleIds(tx);
  const wanted = await tx.query<{ id: string; key: string }>(
    `select distinct r.id, r.key from scim_group_members m
       join scim_group_roles g on g.id = m.group_id
       join roles r on r.key in (select jsonb_array_elements_text(g.role_keys))
     where m.user_id = $1`, [userId]);
  const desired = new Map(wanted.filter((r) => !admins.has(r.id)).map((r) => [r.id, r.key]));
  const held = new Set((await tx.query<{ role_id: string }>('select role_id from user_roles where user_id = $1', [userId])).map((r) => r.role_id));
  const granted = (await tx.query<{ role_id: string }>('select role_id from scim_role_grants where user_id = $1', [userId])).map((r) => r.role_id);
  const keyOf = async (id: string) => (await tx.one<{ key: string }>('select key from roles where id = $1', [id]))?.key ?? id;
  const out: RoleChange = { added: [], removed: [] };
  for (const [id, key] of desired) {
    if (held.has(id)) continue;
    await tx.query('insert into user_roles (user_id, role_id) values ($1, $2) on conflict do nothing', [userId, id]);
    await tx.query('insert into scim_role_grants (user_id, role_id) values ($1, $2) on conflict do nothing', [userId, id]);
    out.added.push(key);
  }
  for (const id of granted) {
    if (desired.has(id)) continue;
    if (held.has(id)) {
      await tx.query('delete from user_roles where user_id = $1 and role_id = $2', [userId, id]);
      out.removed.push(await keyOf(id));
    }
    await tx.query('delete from scim_role_grants where user_id = $1 and role_id = $2', [userId, id]);
  }
  if (out.removed.length && (await administratorIds(tx)).length === 0) {
    ctx.fail(409, 'last_admin', 'That would leave no active administrator, so the roles were not changed.');
  }
  out.added.sort();
  out.removed.sort();
  return out;
}

export const roleChangeText = (c: RoleChange) =>
  [c.added.length ? `given ${c.added.join(', ')}` : '', c.removed.length ? `lost ${c.removed.join(', ')}` : ''].filter(Boolean).join('; ');
