import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { featureState, ownedOff, permissionOff, SWITCHED_OFF, type FeatureState } from '../../core/features.ts';
import { defaultGrantDifferences, roleDescription, syncDefaultGrants } from '../../core/services.ts';
import { ACTIONS, adminRoute, MODULE_ACTIONS, body, guardAdministrators, idParam, invalid, isValidGrant, MODULE_KEYS, sensitive } from './shared.ts';

const ROLE_SELECT = `
  select r.id, r.key, r.name, r.description, r.enabled, r.requires_mfa, r.created_at, r.updated_at,
    coalesce((select json_agg(rp.permission order by rp.permission) from role_permissions rp where rp.role_id = r.id), '[]'::json) as grants,
    (select count(*)::int from user_roles ur join users u on u.id = ur.user_id and u.deleted_at is null where ur.role_id = r.id) as members
  from roles r`;

/**
 * A role as shown (E18-64): a default role of a switched-off area (`owns.role` in core/features.ts) is
 * not shown at all, and an unedited default description is worded for the areas that are on.
 */
export function shownRole<T extends Row>(row: T, s: FeatureState): T | null {
  if (ownedOff(s, 'role', row.key)) return null;
  return { ...row, description: roleDescription(row.key, row.description, (a) => s.on[a] !== false) };
}

export function registerRoles(ctx: ModuleContext) {
  const { db } = ctx;

  /** The stored role (for changes). A role of a switched-off area answers as switched off. */
  const getRole = async (id: string) => {
    const row = await db.one<Row>(`${ROLE_SELECT} where r.id = $1`, [id]);
    if (!row) ctx.fail(404, 'not_found', 'Role not found.');
    if (ownedOff(await featureState(db), 'role', row!.key)) ctx.fail(404, 'switched_off', SWITCHED_OFF);
    return row!;
  };
  const showRole = async (row: Row) => shownRole(row, await featureState(db))!;

  /** Validates the fields present in `b`. Grants already held by the role are kept even if no longer in the vocabulary. */
  function clean(b: Row, existing?: Row) {
    const fields: Record<string, string> = {};
    const out: { name?: string; description?: string; grants?: string[]; requires_mfa?: boolean; enabled?: boolean } = {};
    if (b.name !== undefined || !existing) {
      out.name = String(b.name ?? '').trim();
      if (!out.name || out.name.length > 60) fields.name = 'Enter a name of up to 60 characters.';
    }
    if (b.description !== undefined) out.description = String(b.description ?? '').trim().slice(0, 500);
    if (b.grants !== undefined) {
      if (!Array.isArray(b.grants) || b.grants.some((g: unknown) => typeof g !== 'string')) fields.grants = 'Permissions must be a list.';
      else {
        out.grants = [...new Set(b.grants as string[])].sort();
        const held: string[] = existing?.grants ?? [];
        const bad = out.grants.filter((g) => !isValidGrant(g) && !held.includes(g));
        if (bad.length) fields.grants = `Unknown permission: ${bad.slice(0, 3).join(', ')}.`;
      }
    }
    for (const [key, col] of [['requiresMfa', 'requires_mfa'], ['enabled', 'enabled']] as const) {
      if (b[key] === undefined) continue;
      if (typeof b[key] !== 'boolean') fields[key] = 'Choose on or off.';
      else out[col] = b[key];
    }
    return { out, fields };
  }

  adminRoute(ctx, 'GET', '/api/admin/roles', async () => ({
    roles: await (async () => {
      const s = await featureState(db);
      return (await db.query<Row>(`${ROLE_SELECT} order by r.name`)).map((r) => shownRole(r, s)).filter(Boolean);
    })(),
    modules: MODULE_KEYS,
    actions: ACTIONS,
    // Actions only some modules offer (tags.manage, tags.count); the others are offered by every module.
    moduleActions: MODULE_ACTIONS,
  }));

  adminRoute(ctx, 'GET', '/api/admin/roles/:id', async (req) => {
    const role = await getRole(idParam(req, 'Role'));
    const users = await db.query(
      `select u.id, u.username, u.display_name, u.status from user_roles ur
       join users u on u.id = ur.user_id and u.deleted_at is null where ur.role_id = $1 order by lower(u.display_name)`,
      [role.id],
    );
    return { ...(await showRole(role)), users };
  });

  adminRoute(ctx, 'POST', '/api/admin/roles', async (req, reply) => {
    const b = body(req);
    const { out, fields } = clean(b);
    const key = (out.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!fields.name && !/^[a-z][a-z0-9_]{1,59}$/.test(key)) fields.name = 'Start the name with a letter.';
    else if (!fields.name && await db.one('select 1 from roles where key = $1 or lower(name) = lower($2)', [key, out.name])) {
      fields.name = 'A role with that name already exists.';
    }
    if (out.grants?.includes('*')) fields.grants = 'Only the Administrator role may hold every permission.';
    if (Object.keys(fields).length) invalid(fields);
    await sensitive(ctx, req, 'creating a role');

    const id = await db.tx(async (tx) => {
      const row = await tx.one<{ id: string }>(
        'insert into roles (key, name, description, enabled, requires_mfa) values ($1,$2,$3,$4,$5) returning id',
        [key, out.name, out.description ?? '', out.enabled ?? true, out.requires_mfa ?? false],
      );
      for (const g of out.grants ?? []) await tx.query('insert into role_permissions (role_id, permission) values ($1,$2)', [row!.id, g]);
      return row!.id;
    });
    const role = await getRole(id);
    await ctx.audit(req, {
      action: 'role.create', recordType: 'role', recordId: id, summary: `Role "${role.name}" created`,
      after: { key, name: role.name, description: role.description, enabled: role.enabled, requires_mfa: role.requires_mfa, grants: role.grants },
    });
    reply.code(201);
    return role;
  });

  async function updateRole(req: FastifyRequest, id: string, b: Row) {
    const before = await getRole(id);
    // The page shows an unedited default description worded for the areas that are on; saving it
    // back unchanged keeps the stored default (which names every area), so nothing is lost.
    if (b.description !== undefined && b.description === (await showRole(before)).description) b = { ...b, description: undefined };
    const { out, fields } = clean(b, before);
    if (before.key === 'administrator') {
      if (out.grants && !out.grants.includes('*')) fields.grants = 'The Administrator role always holds every permission (*).';
      if (out.enabled === false) fields.enabled = 'The Administrator role cannot be switched off.';
    } else if (out.grants?.includes('*') && !before.grants.includes('*')) {
      fields.grants = 'Only the Administrator role may hold every permission.';
    }
    if (out.name && await db.one('select 1 from roles where lower(name) = lower($1) and id <> $2', [out.name, id])) {
      fields.name = 'A role with that name already exists.';
    }
    if (Object.keys(fields).length) invalid(fields);
    // Grants, the on/off switch and the second-factor flag decide what people can do.
    if (out.grants || out.enabled !== undefined || out.requires_mfa !== undefined) await sensitive(ctx, req, `changing the role "${before.name}"`);

    await db.tx(async (tx) => {
      await tx.query(
        'update roles set name = $2, description = $3, enabled = $4, requires_mfa = $5, updated_at = now() where id = $1',
        [id, out.name ?? before.name, out.description ?? before.description, out.enabled ?? before.enabled, out.requires_mfa ?? before.requires_mfa],
      );
      if (out.grants) {
        await tx.query('delete from role_permissions where role_id = $1', [id]);
        for (const g of out.grants) await tx.query('insert into role_permissions (role_id, permission) values ($1,$2)', [id, g]);
      }
      await guardAdministrators(tx, req.user!.id);
    });

    const after = await getRole(id);
    const keys = ['name', 'description', 'requires_mfa', 'grants'];
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length) {
      const added = (after.grants as string[]).filter((g) => !before.grants.includes(g));
      const removed = (before.grants as string[]).filter((g) => !after.grants.includes(g));
      await ctx.audit(req, {
        action: 'role.update', recordType: 'role', recordId: id,
        summary: `Role "${after.name}" changed (${changed.join(', ')})`
          + (changed.includes('grants') ? `: ${added.length} permission(s) added, ${removed.length} removed` : ''),
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
    }
    // Switching a role on or off is its own event: it is the version-1 audience switch.
    if (before.enabled !== after.enabled) {
      await ctx.audit(req, {
        action: after.enabled ? 'role.enable' : 'role.disable', recordType: 'role', recordId: id,
        summary: `Role "${after.name}" switched ${after.enabled ? 'on' : 'off'} (${after.members} member(s) affected)`,
        before: { enabled: before.enabled }, after: { enabled: after.enabled },
      });
    }
    return showRole(after);
  }

  // ---------- default grants ----------
  // A new version may add grants to a default role. Existing databases get them only here: the
  // administrator sees what would be added, then applies it. Nothing is removed, and a default
  // grant removed by an administrator after a sync is not offered again.

  adminRoute(ctx, 'GET', '/api/admin/roles/default-grants', async () => {
    // Roles and grants of switched-off areas are not offered here; applying still adds them, quietly.
    const s = await featureState(db);
    const on = (a: string) => s.on[a] !== false;
    const roles = (await defaultGrantDifferences(db))
      .filter((d) => !ownedOff(s, 'role', d.key))
      .map((d) => ({ ...d, missing: d.missing.filter((g) => !permissionOff(s, g)), description: d.description === null ? null : roleDescription(d.key, d.description, on) }))
      .filter((d) => d.missing.length || d.description !== null);
    return { roles, pending: roles.reduce((n, d) => n + d.missing.length, 0) };
  });

  adminRoute(ctx, 'POST', '/api/admin/roles/sync-default-grants', async (req) => {
    await sensitive(ctx, req, 'synchronizing default grants');
    const changed = await syncDefaultGrants(db, ctx.audit, req);
    return { ok: true, roles: changed, added: changed.reduce((n, d) => n + d.missing.length, 0) };
  });

  adminRoute(ctx, 'PATCH', '/api/admin/roles/:id', async (req) => updateRole(req, idParam(req, 'Role'), body(req)));
  adminRoute(ctx, 'POST', '/api/admin/roles/:id/enable', async (req) => updateRole(req, idParam(req, 'Role'), { enabled: true }));
  adminRoute(ctx, 'POST', '/api/admin/roles/:id/disable', async (req) => updateRole(req, idParam(req, 'Role'), { enabled: false }));
}
