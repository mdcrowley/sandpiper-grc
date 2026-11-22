// The app's view of this server (wave 13, E38-03, E38-09): GET /api/mobile/hello before signing in,
// GET /api/mobile/settings once signed in, and the administrator's settings of the Mobile app area
// (Administration > Mobile app): token lifetimes, required unlock and offline expiry.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { TIME_ZONE } from '../../core/config.ts';
import type { Queryable } from '../../core/db.ts';
import { featureState } from '../../core/features.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import {
  MOBILE_CLIENT_ID, MOBILE_COMPAT, MOBILE_REDIRECT_URI, MOBILE_SCOPE, MOBILE_SETTINGS,
  type MobileHello, type MobileSettings,
} from '../../../../shared/mobile-api.ts';
import type { TagFormat } from '../../../../shared/tag-format.ts';
import { oauthBase } from '../mcp/oauth.ts';
import { LIMITS, readMobileSettings, type MobileAdminSettings } from './state.ts';

/** The active tag formats, read through the tags module's own function (only while that area is on and installed). */
async function activeFormats(db: Queryable): Promise<TagFormat[] | null> {
  if (!(await featureState(db)).on.tags) return null;
  if (!(await db.one<{ t: string | null }>(`select to_regclass('public.tag_formats')::text as t`))?.t) return null;
  const { loadFormats } = await import('../tags/store.ts');
  return loadFormats(db, { activeOnly: true });
}

export function registerAppSettings(ctx: ModuleContext) {
  const { app, db } = ctx;

  app.get('/api/mobile/hello', { config: { public: true } }, async (req): Promise<MobileHello> => {
    const base = await oauthBase(ctx, req);
    return {
      product: 'sandpiper-grc', apiVersion: 1, mobile: { ...MOBILE_COMPAT },
      appName: String(await ctx.settings.get('app.name', 'Sandpiper GRC')),
      oauth: {
        authorizationEndpoint: `${base}/oauth/authorize`, tokenEndpoint: `${base}/oauth/token`, revocationEndpoint: `${base}/oauth/revoke`,
        clientId: MOBILE_CLIENT_ID, redirectUri: MOBILE_REDIRECT_URI, scope: MOBILE_SCOPE,
      },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/mobile/hello', tag: 'Mobile app', public: true,
    summary: 'What the mobile app needs before signing in: the app versions this server accepts and its sign-in addresses',
    description: 'Public; answers 404 `switched_off` while the Mobile app area is off. Never reveals the server\'s own version.',
    response: 'MobileHello: { product, apiVersion, mobile: { minVersion, recommendedVersion }, appName, oauth: { authorizationEndpoint, tokenEndpoint, revocationEndpoint, clientId, redirectUri, scope } }',
  });

  app.get('/api/mobile/settings', async (req): Promise<MobileSettings> => {
    const me = req.user!;
    const s = await readMobileSettings(ctx);
    const formats = await activeFormats(db);
    return {
      tags: formats ? { formats, confirmTextWithoutFormat: true } : null,
      unlock: { required: s.requireUnlock, afterMinutes: s.unlockAfterMinutes },
      areas: { ...(await featureState(db)).on },
      permissions: [...me.permissions],
      user: { id: me.id, displayName: me.displayName, username: me.username },
      server: { appName: String(await ctx.settings.get('app.name', 'Sandpiper GRC')), timeZone: TIME_ZONE },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/mobile/settings', tag: 'Mobile app',
    summary: 'What the mobile app needs to work for you: tag formats, unlock rules, areas switched on, your permissions',
    response: 'MobileSettings: { tags: { formats, confirmTextWithoutFormat } | null, unlock: { required, afterMinutes }, areas, permissions, user, server: { appName, timeZone } }',
  });

  // ---------- Administration > Mobile app ----------

  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const read = async () => ({ settings: await readMobileSettings(ctx), limits: LIMITS });

  app.get('/api/mobile/admin/settings', admin, read);
  ctx.describeRoute({
    method: 'GET', path: '/api/mobile/admin/settings', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'The Mobile app area\'s settings: token lifetimes, required unlock, offline expiry',
    response: '{ settings: { accessMinutes, refreshDays, requireUnlock, unlockAfterMinutes, offlineDays }, limits }',
  });

  app.put('/api/mobile/admin/settings', admin, async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Row;
    const before = await readMobileSettings(ctx);
    const next: MobileAdminSettings = { ...before };
    const fields: Record<string, string> = {};
    const words: Record<keyof typeof LIMITS, string> = {
      accessMinutes: 'Access token life in minutes', refreshDays: 'Days a phone stays signed in without use',
      unlockAfterMinutes: 'Minutes before unlocking again', offlineDays: 'Days offline work is kept',
    };
    for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      if (b[k] === undefined) continue;
      const [min, max] = LIMITS[k];
      if (typeof b[k] !== 'number' || !Number.isInteger(b[k]) || b[k] < min || b[k] > max) fields[k] = `${words[k]} must be a whole number from ${min} to ${max}.`;
      else next[k] = b[k];
    }
    if (b.requireUnlock !== undefined) {
      if (typeof b.requireUnlock !== 'boolean') fields.requireUnlock = 'Choose on or off.';
      else next.requireUnlock = b.requireUnlock;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const changed = (Object.keys(next) as (keyof MobileAdminSettings)[]).filter((k) => next[k] !== before[k]);
    if (!changed.length) return read();
    // Sign-in rules for phones, like the auth.* settings: a recent password confirmation.
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'changing the mobile app settings');
    const keyOf: Record<keyof MobileAdminSettings, string> = {
      accessMinutes: MOBILE_SETTINGS.accessMinutes.key, refreshDays: MOBILE_SETTINGS.refreshDays.key, requireUnlock: MOBILE_SETTINGS.requireUnlock.key,
      unlockAfterMinutes: MOBILE_SETTINGS.unlockAfterMinutes.key, offlineDays: MOBILE_SETTINGS.offlineDays.key,
    };
    for (const k of changed) await ctx.settings.set(keyOf[k], next[k], req);
    await ctx.audit(req, {
      action: 'mobile.settings', recordType: 'setting', recordId: 'mobile',
      summary: `Mobile app settings changed: ${changed.join(', ')}`,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, next[k]])),
    });
    return read();
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/mobile/admin/settings', tag: 'Mobile app', permission: 'admin.administer',
    summary: 'Change the Mobile app area\'s settings (recent password confirmation); new lifetimes apply to tokens issued from then on',
    body: '{ accessMinutes?: 5-60, refreshDays?: 1-90, requireUnlock?: boolean, unlockAfterMinutes?: 0-240, offlineDays?: 1-30 }',
  });
}
