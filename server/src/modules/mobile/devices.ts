// Device sessions of the mobile app (wave 13, E38-02): Account > Devices for the person, and the
// devices card on an administrator's user page. Signing a device out ends its tokens at once; the
// app wipes its local data at its next refresh. Deactivating an account (also through user
// provisioning) and changing or resetting its password sign out every device in core
// (core/tokens.ts revokeProgramAccess); switching the Mobile app area off signs out every device
// (state.ts lastSwitchedOff).
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { DeviceView } from '../../../../shared/mobile-api.ts';
import { revokeDevice, settleDisabled, settleSwitchedOff, viaMobileToken } from './state.ts';

/** Active devices, and those signed out in the last 30 days (so a person sees what happened). */
const LIST_SQL = `
  select id, user_id, name, platform, app_version, created_at, last_used_at, last_used_ip, revoked_at, revoked_reason
  from mobile_devices
  where user_id = $1 and (revoked_at is null or revoked_at > now() - interval '30 days')
  order by (revoked_at is null) desc, coalesce(last_used_at, created_at) desc limit 100`;

export function deviceView(r: Row, currentId: string | null): DeviceView & { revokedReason: string | null } {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: r.id, name: r.name, platform: r.platform, appVersion: r.app_version,
    createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at), lastUsedIp: r.last_used_ip ?? null,
    current: currentId === r.id, revokedAt: iso(r.revoked_at), revokedReason: r.revoked_reason ?? null,
  };
}

export function registerDevices(ctx: ModuleContext) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const current = (req: FastifyRequest) => (viaMobileToken(req) ? req.apiToken!.id : null);
  const listOf = async (userId: string, req: FastifyRequest) => {
    await settleSwitchedOff(db);
    await settleDisabled(db, userId);
    return (await db.query<Row>(LIST_SQL, [userId])).map((r) => deviceView(r, current(req)));
  };
  const idOf = (v: unknown) => {
    const id = String(v ?? '');
    return UUID_RE.test(id) ? id : null;
  };

  app.get('/api/me/devices', async (req) => listOf(req.user!.id, req));
  ctx.describeRoute({
    method: 'GET', path: '/api/me/devices', tag: 'Mobile app',
    summary: 'Your signed-in installations of the mobile app (and those signed out in the last 30 days)',
    response: 'DeviceView[]: [{ id, name, platform, appVersion, createdAt, lastUsedAt, lastUsedIp, current, revokedAt, revokedReason }]',
  });

  app.delete('/api/me/devices/:id', async (req) => {
    const id = idOf((req.params as Row).id);
    const row = id ? await db.one<Row>('select id, name from mobile_devices where id = $1 and user_id = $2 and revoked_at is null', [id, req.user!.id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Device not found, or already signed out.');
    const self = current(req) === row!.id;
    await revokeDevice(db, row!.id, self ? 'signed out in the app' : 'signed out by its owner', req.user!.id);
    await ctx.audit(req, { action: 'mobile.device_revoke', recordType: 'mobile_device', recordId: row!.id, summary: `Mobile device "${row!.name}" signed out by its owner` });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/me/devices/:id', tag: 'Mobile app', summary: 'Sign one of your devices out: its tokens stop working at once and the app wipes its data' });

  const userOf = async (v: unknown) => {
    const id = idOf(v);
    const u = id ? await db.one<Row>('select id, username from users where id = $1 and deleted_at is null', [id]) : undefined;
    if (!u) ctx.fail(404, 'not_found', 'User not found.');
    return u!;
  };

  app.get('/api/admin/users/:id/devices', admin, async (req) => {
    const u = await userOf((req.params as Row).id);
    return listOf(u.id, req);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/users/:id/devices', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'A person\'s signed-in installations of the mobile app (and those signed out in the last 30 days)', response: 'DeviceView[]',
  });

  app.delete('/api/admin/users/:id/devices/:deviceId', admin, async (req) => {
    const p = req.params as Row;
    const u = await userOf(p.id);
    const id = idOf(p.deviceId);
    const row = id ? await db.one<Row>('select id, name from mobile_devices where id = $1 and user_id = $2 and revoked_at is null', [id, u.id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Device not found, or already signed out.');
    await revokeDevice(db, row!.id, 'signed out by an administrator', req.user!.id);
    await ctx.audit(req, { action: 'mobile.device_revoke', recordType: 'mobile_device', recordId: row!.id, summary: `Mobile device "${row!.name}" of ${u.username} signed out by an administrator` });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/admin/users/:id/devices/:deviceId', tag: 'Mobile app', permission: 'admin.administer', summary: 'Sign one of a person\'s devices out' });

  app.delete('/api/admin/users/:id/devices', admin, async (req) => {
    const u = await userOf((req.params as Row).id);
    const rows = await db.query<Row>('select id from mobile_devices where user_id = $1 and revoked_at is null', [u.id]);
    for (const r of rows) await revokeDevice(db, r.id, 'signed out by an administrator', req.user!.id);
    if (rows.length) {
      await ctx.audit(req, { action: 'mobile.device_revoke', recordType: 'user', recordId: u.id, summary: `All ${rows.length} mobile device(s) of ${u.username} signed out by an administrator` });
    }
    return { ok: true, signedOut: rows.length };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/admin/users/:id/devices', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'Sign every device of a person out', response: '{ ok, signedOut }',
  });
}
