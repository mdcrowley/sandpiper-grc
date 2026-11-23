// Push routes: the app registers its phone (GET/PUT/DELETE /api/me/push, the app's own token only),
// and administrators set the credentials (Administration > Push notifications).
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth, secretBox } from '../../core/auth.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import {
  PUSH_PROVIDERS, type PushConfigInput, type PushProvider, type PushStatus,
} from '../../../../shared/push-api.ts';
import { viaMobileToken } from '../mobile/state.ts';
import { APNS_TOKEN_RE } from './apns.ts';
import { configRow, loadCredentials, newVapidKey, planChange, presentConfig, pushStats, saveChange, targetContext } from './config.ts';
import { appTitle, forgetSignedOut, makeSender, pushPossible, sendToPerson } from './deliver.ts';
import { FCM_TOKEN_RE } from './fcm.ts';
import { targetRefusal } from './webpush.ts';

const TEST_TEXT = 'This is a test notification. Push notifications work on this phone.';

export function registerPushRoutes(ctx: ModuleContext) {
  const { app, db } = ctx;
  const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);

  /** The signed-in phone behind the app's token (404 for anything else: a browser session or a personal token). */
  const deviceOf = async (req: FastifyRequest) => {
    if (!viaMobileToken(req)) ctx.fail(403, 'mobile_only', 'Only the mobile app registers a phone for push notifications.');
    const d = await db.one<Row>('select id, user_id, name, platform from mobile_devices where id = $1 and user_id = $2 and revoked_at is null', [req.apiToken!.id, req.user!.id]);
    if (!d) ctx.fail(401, 'not_signed_in', 'This phone is no longer signed in.');
    return d!;
  };

  const statusOf = async (device: Row): Promise<PushStatus> => {
    const c = await loadCredentials(db);
    const providers: Record<PushProvider, boolean> = device.platform === 'ios'
      ? { apns: Boolean(c.apns), fcm: false, unifiedpush: false }
      : { apns: false, fcm: Boolean(c.fcm), unifiedpush: Boolean(c.unifiedpush) };
    const reg = await db.one<Row>('select provider from push_registrations where device_id = $1', [device.id]);
    return {
      available: Object.values(providers).some(Boolean), providers,
      vapidPublicKey: providers.unifiedpush ? c.unifiedpush!.vapidPublicKey : null,
      registered: Boolean(reg), provider: reg?.provider ?? null,
    };
  };

  app.get('/api/me/push', async (req) => statusOf(await deviceOf(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/me/push', tag: 'Mobile app',
    summary: 'Whether push notifications are set up for this phone, and whether it is registered (the app\'s own token only)',
    response: 'PushStatus: { available, providers: { apns, fcm, unifiedpush }, vapidPublicKey, registered, provider }',
  });

  app.put('/api/me/push', async (req) => {
    const device = await deviceOf(req);
    const b = (req.body ?? {}) as Row;
    const status = await statusOf(device);
    const provider = String(b.provider ?? '') as PushProvider;
    if (!(PUSH_PROVIDERS as readonly string[]).includes(provider)) ctx.fail(400, 'validation', 'Choose apns, fcm or unifiedpush.', { provider: 'Unknown push service.' });
    if (!status.providers[provider]) {
      ctx.fail(409, 'push_unavailable', provider === 'apns' && device.platform !== 'ios' ? 'Apple push is only for iPhones.'
        : 'This push service is not set up on the server. Ask your administrator.');
    }
    let target: Row;
    let environment = 'production';
    if (provider === 'unifiedpush') {
      target = { endpoint: String(b.endpoint ?? ''), p256dh: String(b.p256dh ?? ''), auth: String(b.auth ?? '') };
      const creds = await loadCredentials(db);
      const refusal = targetRefusal(target as { endpoint: string; p256dh: string; auth: string }, creds.unifiedpush!.allowedHosts);
      if (refusal) ctx.fail(400, 'validation', refusal, { endpoint: refusal });
    } else {
      const token = String(b.token ?? '').trim();
      if (!(provider === 'apns' ? APNS_TOKEN_RE : FCM_TOKEN_RE).test(token)) ctx.fail(400, 'validation', 'Not a device token.', { token: 'Not a device token.' });
      target = { token: provider === 'apns' ? token.toLowerCase() : token };
      if (provider === 'apns') {
        if (b.environment !== undefined && b.environment !== 'production' && b.environment !== 'sandbox') ctx.fail(400, 'validation', 'Choose production or sandbox.', { environment: 'Choose production or sandbox.' });
        environment = b.environment === 'sandbox' ? 'sandbox' : 'production';
      }
    }
    const hash = createHash('sha256').update(`${provider}:${JSON.stringify(target!)}`).digest('hex');
    const before = await db.one<Row>('select id, provider, target_hash from push_registrations where device_id = $1', [device.id]);
    // The same phone registered under an earlier sign-in (another device row) stops being told twice.
    await db.query('delete from push_registrations where target_hash = $1 and device_id <> $2', [hash, device.id]);
    if (before?.target_hash === hash) {
      await db.query('update push_registrations set environment = $2, updated_at = now() where id = $1', [before.id, environment]);
      return statusOf(device);
    }
    const id = before?.id ?? (await db.one<{ id: string }>('select gen_random_uuid()::text as id'))!.id;
    const sealed = secretBox(db).encrypt(JSON.stringify(target!), targetContext(id));
    await db.query(
      `insert into push_registrations (id, device_id, user_id, provider, environment, target_sealed, target_hash)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (device_id) do update set provider = excluded.provider, environment = excluded.environment,
         target_sealed = excluded.target_sealed, target_hash = excluded.target_hash, updated_at = now(),
         failures = 0, last_error = null, last_error_at = null`,
      [id, device.id, device.user_id, provider, environment, sealed, hash],
    );
    // A person who registers is told only about what arrives from now on, not about older unread ones.
    await db.query(
      `insert into push_cursor (user_id, pushed_upto) values ($1, now()) on conflict (user_id) do nothing`, [device.user_id],
    );
    await ctx.audit(req, {
      action: before ? 'push.update' : 'push.register', recordType: 'mobile_device', recordId: device.id,
      summary: `Push notifications ${before ? 'renewed' : 'switched on'} for mobile device "${device.name}" (${provider})`,
    });
    return statusOf(device);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/me/push', tag: 'Mobile app',
    summary: 'Register this phone for push notifications, or renew its token (the app\'s own token only; audited, the token is stored encrypted)',
    body: '{ provider: "apns", token, environment?: "production" | "sandbox" } | { provider: "fcm", token } | { provider: "unifiedpush", endpoint, p256dh, auth }',
    response: 'PushStatus',
  });

  app.delete('/api/me/push', async (req) => {
    const device = await deviceOf(req);
    const gone = await db.one('delete from push_registrations where device_id = $1 returning id', [device.id]);
    if (gone) {
      await ctx.audit(req, { action: 'push.unregister', recordType: 'mobile_device', recordId: device.id, summary: `Push notifications switched off for mobile device "${device.name}"` });
    }
    return { ok: true, removed: Boolean(gone) };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/me/push', tag: 'Mobile app', summary: 'Stop push notifications to this phone (the app\'s own token only)', response: '{ ok, removed }' });

  // ---------- Administration > Push notifications ----------

  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const view = async () => ({ config: presentConfig(await configRow(db)), stats: await pushStats(db) });

  app.get('/api/push/admin/config', admin, view);
  ctx.describeRoute({
    method: 'GET', path: '/api/push/admin/config', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'Push notification settings (never a key: whether one is stored and its fingerprint) and phones registered per service',
    response: '{ config: PushConfigView, stats: PushStats }',
  });

  app.put('/api/push/admin/config', admin, async (req) => {
    const row = await configRow(db);
    const change = planChange(ctx, row, (req.body ?? {}) as PushConfigInput);
    if (!change.changed.length) return view();
    await recentAuth(req, 'changing the push notification settings');
    await saveChange(db, change, req.user!.id);
    const after = presentConfig(await configRow(db));
    const before = presentConfig(row);
    await ctx.audit(req, {
      action: 'push.settings', recordType: 'setting', recordId: 'push',
      summary: `Push notification settings changed: ${change.changed.join(', ')}`,
      // The views hold no key, only whether one is stored and its fingerprint.
      before, after,
    });
    return view();
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/push/admin/config', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'Change the push notification settings (recent password confirmation; audited without the keys)',
    body: 'PushConfigInput: { apns?: { enabled?, keyId?, teamId?, bundleId?, key? (.p8 text), removeKey? }, fcm?: { enabled?, serviceAccount? (JSON text), removeKey? }, unifiedpush?: { enabled?, allowedHosts?, contact? } }',
    response: '{ config: PushConfigView, stats: PushStats }',
  });

  app.post('/api/push/admin/vapid', admin, async (req) => {
    await recentAuth(req, 'replacing the UnifiedPush key');
    const v = newVapidKey(db);
    await configRow(db);
    await db.query('update push_config set vapid_private_sealed = $1, vapid_public_key = $2, updated_at = now(), updated_by = $3 where id = 1', [v.sealed, v.publicKey, req.user!.id]);
    // Push servers tie each phone's address to the key it registered with: those phones register again.
    const removed = (await db.query(`delete from push_registrations where provider = 'unifiedpush' returning id`)).length;
    await ctx.audit(req, {
      action: 'push.settings', recordType: 'setting', recordId: 'push',
      summary: `UnifiedPush key replaced; ${removed} phone registration(s) removed (the phones register again when the app opens)`,
    });
    return { ...(await view()), removed };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/push/admin/vapid', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'Replace the server\'s UnifiedPush (VAPID) key; phones using UnifiedPush register again (recent password confirmation)',
    response: '{ config, stats, removed }',
  });

  app.post('/api/push/admin/test', admin, async (req) => {
    if (!(await pushPossible(ctx))) ctx.fail(409, 'push_unavailable', 'Switch the Mobile app on under Administration > Features first.');
    await forgetSignedOut(ctx);
    const creds = await loadCredentials(db);
    const { send, close } = makeSender(creds);
    try {
      const r = await sendToPerson(ctx, req.user!.id, { title: await appTitle(ctx), body: TEST_TEXT, count: 0 }, send, (p) => Boolean(creds[p]));
      const errors = (await db.query<Row>(
        'select provider, last_error from push_registrations where user_id = $1 and last_error is not null and last_error_at > now() - interval \'1 minute\'', [req.user!.id],
      )).map((e) => ({ provider: e.provider, message: e.last_error }));
      await ctx.audit(req, { action: 'push.test', recordType: 'setting', recordId: 'push', summary: `Test push sent to ${r.sent} of the administrator's phone(s)` });
      return { ...r, errors };
    } finally {
      close();
    }
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/push/admin/test', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'Send a test push (no record details) to your own registered phones',
    response: '{ sent, failed, removed, errors: [{ provider, message }] }',
  });
}
