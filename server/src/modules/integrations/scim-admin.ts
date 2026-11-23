// Administration > User provisioning (E36-01): provisioning tokens (shown once, revocable), the
// switch, the sign-in provider new accounts link to, the group-to-role mapping, and recent activity.
// Every route needs admin.administer; making a token, changing its addresses, switching provisioning
// on and mapping a group to roles also need a recent password confirmation.
import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { checkSources, tokenHash } from '../../core/tokens.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { UUID_RE } from '../../core/errors.ts';
import { featureState, ownedOff, rolesShown } from '../../core/features.ts';
import { sensitive } from '../admin/shared.ts';
import { adminRoleIds, roleChangeText, syncProvisionedRoles } from './shared.ts';
import { SCIM_BASE, SCIM_TOKEN_PREFIX } from './scim.ts';

const A = 'admin.administer';
const TAG = 'User provisioning';

export function registerScimAdmin(ctx: ModuleContext) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm(A) };
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const b = (req: FastifyRequest) => (req.body ?? {}) as Row;
  const idOf = (req: FastifyRequest, what: string) => {
    const id = String((req.params as Row).id ?? '');
    return UUID_RE.test(id) ? id : ctx.fail(404, 'not_found', `${what} not found.`);
  };
  const d = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, summary: string, extra: Row = {}) =>
    ctx.describeRoute({ method, path, summary, permission: A, tag: TAG, ...extra } as never);

  // ---------- settings ----------

  const readSettings = async () => ({
    enabled: (await ctx.settings.get<unknown>('integrations.scim_enabled', false)) === true,
    linkProviderId: String(await ctx.settings.get('integrations.scim_link_provider', '') ?? '') || null,
    endpoint: SCIM_BASE,
    providers: await db.query<Row>(`select id, name, key from identity_providers where deleted_at is null and enabled order by name`).catch(() => []),
  });

  app.get('/api/admin/scim/settings', admin, async () => readSettings());
  d('GET', '/api/admin/scim/settings', 'Whether user provisioning is on, and the sign-in provider new accounts link to', {
    response: '{ enabled, linkProviderId, endpoint, providers: [{ id, name, key }] }',
  });

  app.put('/api/admin/scim/settings', admin, async (req) => {
    const body = b(req);
    const fields: Record<string, string> = {};
    const now = await readSettings();
    const enabled = body.enabled === undefined ? now.enabled : body.enabled;
    if (typeof enabled !== 'boolean') fields.enabled = 'Choose on or off.';
    let link = body.linkProviderId === undefined ? now.linkProviderId : body.linkProviderId || null;
    if (link !== null && !(typeof link === 'string' && UUID_RE.test(link) && now.providers.some((p) => p.id === link))) fields.linkProviderId = 'Choose a sign-in provider that is switched on, or none.';
    if (Object.keys(fields).length) invalid(fields);
    link = link as string | null;
    if (enabled !== now.enabled || link !== now.linkProviderId) await sensitive(ctx, req, 'changing user provisioning');
    if (enabled !== now.enabled) await ctx.settings.set('integrations.scim_enabled', enabled, req);
    if (link !== now.linkProviderId) await ctx.settings.set('integrations.scim_link_provider', link ?? '', req);
    return readSettings();
  });
  d('PUT', '/api/admin/scim/settings', 'Switch user provisioning on or off, and choose the sign-in provider new accounts may link', {
    body: '{ enabled?, linkProviderId?: provider id | null }', response: 'As GET',
    description: 'Needs a recent password confirmation (403 `reauth_required`). With a provider chosen, an account provisioning creates (or enables again) may link that provider by its email address at its next sign-in, for 30 days.',
  });

  // ---------- tokens ----------

  const TOKEN_SELECT = `select t.id, t.name, t.prefix, t.allowed_addresses, t.created_at, t.created_by, u.display_name as created_by_name,
    t.last_used_at, t.last_used_ip, t.revoked_at, (t.revoked_at is null) as active
    from scim_tokens t left join users u on u.id = t.created_by`;

  app.get('/api/admin/scim/tokens', admin, async () => ({ tokens: await db.query(`${TOKEN_SELECT} order by t.revoked_at nulls first, t.created_at desc`) }));
  d('GET', '/api/admin/scim/tokens', 'Provisioning tokens', { response: '{ tokens: [{ id, name, prefix, allowed_addresses, created_at, created_by_name, last_used_at, last_used_ip, revoked_at, active }] }' });

  app.post('/api/admin/scim/tokens', admin, async (req, reply) => {
    const body = b(req);
    const fields: Record<string, string> = {};
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 80) fields.name = 'Enter a name of up to 80 characters.';
    const sources = checkSources(body.allowedAddresses);
    if ('error' in sources) fields.allowedAddresses = sources.error;
    if (Object.keys(fields).length) invalid(fields);
    await sensitive(ctx, req, 'making a provisioning token');
    const token = `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const list = 'list' in sources ? sources.list : [];
    const row = (await db.one<Row>(
      `insert into scim_tokens (name, prefix, token_hash, allowed_addresses, created_by) values ($1, $2, $3, $4::jsonb, $5) returning id`,
      [name, token.slice(0, SCIM_TOKEN_PREFIX.length + 6), tokenHash(token), list.length ? JSON.stringify(list) : null, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'scim.token_create', recordType: 'scim_token', recordId: row.id,
      summary: `Provisioning token "${name}" made${list.length ? ` (usable from ${list.join(', ')})` : ''}`,
    });
    reply.code(201);
    // Shown now and never again: only its hash is kept.
    return { ...(await db.one<Row>(`${TOKEN_SELECT} where t.id = $1`, [row.id])), token };
  });
  d('POST', '/api/admin/scim/tokens', 'Make a provisioning token (shown in this answer only)', {
    body: '{ name, allowedAddresses?: ["203.0.113.7", "198.51.100.0/24"] }', response: '{ id, name, prefix, ..., token }',
    description: 'Needs a recent password confirmation (403 `reauth_required`). Only the SHA-256 of the token is kept.',
  });

  app.patch('/api/admin/scim/tokens/:id', admin, async (req) => {
    const id = idOf(req, 'Provisioning token');
    const before = await db.one<Row>('select id, name, allowed_addresses from scim_tokens where id = $1 and revoked_at is null', [id]);
    if (!before) ctx.fail(404, 'not_found', 'Provisioning token not found, or revoked.');
    const sources = checkSources(b(req).allowedAddresses);
    if ('error' in sources) invalid({ allowedAddresses: sources.error });
    const list = 'list' in sources ? sources.list : [];
    await sensitive(ctx, req, 'changing where a provisioning token may be used from');
    await db.query('update scim_tokens set allowed_addresses = $2::jsonb where id = $1', [id, list.length ? JSON.stringify(list) : null]);
    await ctx.audit(req, {
      action: 'scim.token_update', recordType: 'scim_token', recordId: id, summary: `Addresses of provisioning token "${before!.name}" changed`,
      before: { allowed_addresses: before!.allowed_addresses }, after: { allowed_addresses: list.length ? list : null },
    });
    return db.one(`${TOKEN_SELECT} where t.id = $1`, [id]);
  });
  d('PATCH', '/api/admin/scim/tokens/:id', 'Change the addresses a provisioning token may be used from', {
    body: '{ allowedAddresses: [] }', description: 'Needs a recent password confirmation. An empty list allows any address.',
  });

  app.delete('/api/admin/scim/tokens/:id', admin, async (req) => {
    const id = idOf(req, 'Provisioning token');
    const row = await db.one<Row>('update scim_tokens set revoked_at = now(), revoked_by = $2 where id = $1 and revoked_at is null returning name', [id, req.user!.id]);
    if (!row) ctx.fail(404, 'not_found', 'Provisioning token not found, or already revoked.');
    await ctx.audit(req, { action: 'scim.token_revoke', recordType: 'scim_token', recordId: id, summary: `Provisioning token "${row!.name}" revoked` });
    return { ok: true };
  });
  d('DELETE', '/api/admin/scim/tokens/:id', 'Revoke a provisioning token (it stops working at once)');

  // ---------- groups and their roles ----------

  /** Roles a group may be mapped to: every role except those that can administer. */
  async function mappableRoles() {
    const admins = await adminRoleIds(db);
    const rows = await db.query<Row>('select id, key, name, enabled from roles order by name');
    return rows.map((r) => ({ key: r.key, name: r.name, enabled: r.enabled, administers: admins.has(r.id) }));
  }

  const GROUP_SELECT = `select g.id, g.display_name, g.external_id, g.role_keys, g.created_at, g.updated_at, g.mapped_at,
    u.display_name as mapped_by_name, (select count(*)::int from scim_group_members m where m.group_id = g.id) as members
    from scim_group_roles g left join users u on u.id = g.mapped_by`;

  // Roles of a switched-off area are not offered or shown, but a group keeps them (W17, E18-64).
  app.get('/api/admin/scim/groups', admin, async () => {
    const state = await featureState(db);
    const groups = await db.query<Row>(`${GROUP_SELECT} order by lower(g.display_name)`);
    return {
      groups: groups.map((g) => ({ ...g, role_keys: (g.role_keys as string[]).filter((k) => !ownedOff(state, 'role', k)) })),
      roles: rolesShown(state, await mappableRoles()),
    };
  });
  d('GET', '/api/admin/scim/groups', 'Groups provisioning has sent, with the roles each is mapped to', {
    response: '{ groups: [{ id, display_name, external_id, role_keys, members, mapped_at, mapped_by_name }], roles: [{ key, name, enabled, administers }] }',
  });

  app.put('/api/admin/scim/groups/:id/roles', admin, async (req) => {
    const id = idOf(req, 'Group');
    const g = await db.one<Row>('select id, display_name, role_keys from scim_group_roles where id = $1', [id]);
    if (!g) ctx.fail(404, 'not_found', 'Group not found.');
    const keys = b(req).roleKeys;
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string') || keys.length > 50) invalid({ roleKeys: 'Choose roles from the list.' });
    const wanted = [...new Set(keys as string[])].sort();
    const roles = await mappableRoles();
    const unknown = wanted.filter((k) => !roles.some((r) => r.key === k));
    if (unknown.length) invalid({ roleKeys: `Unknown role: ${unknown.join(', ')}.` });
    const adminRoles = wanted.filter((k) => roles.find((r) => r.key === k)?.administers);
    if (adminRoles.length) invalid({ roleKeys: `Provisioning never gives a role that can administer (${adminRoles.join(', ')}). Give it by hand under Users.` });
    const before = [...(g!.role_keys as string[])].sort();
    // A hidden role (its area is off) stays mapped: the form could not show it.
    const state = await featureState(db);
    for (const k of before) if (ownedOff(state, 'role', k) && !wanted.includes(k)) wanted.push(k);
    wanted.sort();
    if (JSON.stringify(before) === JSON.stringify(wanted)) return db.one(`${GROUP_SELECT} where g.id = $1`, [id]);
    await sensitive(ctx, req, `mapping the group "${g!.display_name}" to roles`);
    const changes: { userId: string; text: string }[] = [];
    await db.tx(async (tx) => {
      await tx.query('update scim_group_roles set role_keys = $2::jsonb, mapped_at = now(), mapped_by = $3, updated_at = now() where id = $1', [id, JSON.stringify(wanted), req.user!.id]);
      const members = await tx.query<{ user_id: string }>('select user_id from scim_group_members where group_id = $1', [id]);
      for (const m of members) {
        const text = roleChangeText(await syncProvisionedRoles(ctx, tx, m.user_id));
        if (text) changes.push({ userId: m.user_id, text });
      }
    });
    await ctx.audit(req, {
      action: 'scim.group_roles', recordType: 'scim_group', recordId: id,
      summary: `Group "${g!.display_name}" mapped to roles: ${wanted.join(', ') || 'none'}; ${changes.length} member(s) changed`,
      before: { role_keys: before }, after: { role_keys: wanted },
    });
    for (const c of changes) {
      const name = (await db.one<{ username: string }>('select username from users where id = $1', [c.userId]))?.username ?? c.userId;
      await ctx.audit(req, { action: 'user.roles', recordType: 'user', recordId: c.userId, summary: `Roles of ${name} changed through the mapping of group "${g!.display_name}": ${c.text}` });
    }
    return db.one(`${GROUP_SELECT} where g.id = $1`, [id]);
  });
  d('PUT', '/api/admin/scim/groups/:id/roles', 'Map a provisioned group to roles', {
    body: '{ roleKeys: ["agent", "auditor"] }', response: 'The group',
    description: 'Needs a recent password confirmation. Roles that can administer are refused (400). The roles of every member are brought in step at once: roles given through groups are added and taken away; roles given by hand are never taken away. 409 `last_admin` when it would leave no administrator.',
  });

  app.get('/api/admin/scim/groups/:id/members', admin, async (req) => {
    const id = idOf(req, 'Group');
    return db.query(`select u.id, u.username, u.display_name, u.status from scim_group_members m join users u on u.id = m.user_id
      where m.group_id = $1 and u.deleted_at is null order by lower(u.display_name) limit 500`, [id]);
  });
  d('GET', '/api/admin/scim/groups/:id/members', 'Members of a provisioned group (first 500)', { response: '[{ id, username, display_name, status }]' });

  // ---------- activity ----------

  app.get('/api/admin/scim/activity', admin, async () => db.query(
    `select id::text, at, actor_name, action, record_type, record_id, summary, ip from audit_events
     where action like 'scim.%' or actor_name like 'Provisioning (%' order by id desc limit 50`));
  d('GET', '/api/admin/scim/activity', 'The last 50 provisioning changes and refusals (from the audit log)', { response: '[{ id, at, actor_name, action, record_type, record_id, summary, ip }]' });
}
