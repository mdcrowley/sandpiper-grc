// Shared pieces of the mobile module: whether the Mobile app area is on, when it was last switched
// off (a device that signed in before that is signed out, even if the area is on again), the
// administrator's settings, and device revocation.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../../core/db.ts';
import { featureState, type FeatureState } from '../../core/features.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { tokenHash } from '../../core/tokens.ts';
import { MOBILE_SETTINGS } from '../../../../shared/mobile-api.ts';

export const sha = (s: string) => tokenHash(s);
export const randomSecret = (prefix: string) => prefix + randomBytes(32).toString('base64url');

/** Two SHA-256 hex values compared in constant time. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The installation id as stored (SHA-256 of the lower-case UUID). */
export const installationHash = (id: string) => createHash('sha256').update(`mobile-installation:${id.toLowerCase()}`).digest('hex');

export async function mobileOn(db: Queryable): Promise<boolean> {
  return (await featureState(db)).on.mobile === true;
}

/**
 * When the Mobile app area was last switched off (epoch ms), or null when never. Read from the
 * append-only audit log: every write of the `features` setting is audited with its value, so this
 * holds across processes and restarts and needs no hook in the Features page. Cached per feature
 * state (which is replaced whenever the setting is written or re-read).
 */
const offCache = new WeakMap<FeatureState, number | null>();
export async function lastSwitchedOff(db: Queryable): Promise<number | null> {
  const state = await featureState(db);
  if (offCache.has(state)) return offCache.get(state)!;
  const row = await db.one<{ at: string | null }>(
    `select max(at) as at from audit_events
     where record_type = 'setting' and record_id = 'features' and action = 'setting.change'
       and coalesce((after->>'mobile')::boolean, false) = false`);
  const at = row?.at ? new Date(row.at).getTime() : null;
  offCache.set(state, at);
  return at;
}

export const OFF_REASON = 'The Mobile app area was switched off';

/** Marks signed out every device that signed in before the area was last switched off. */
export async function settleSwitchedOff(db: Queryable): Promise<number> {
  const off = await lastSwitchedOff(db);
  if (off === null) return 0;
  return (await db.query(
    `update mobile_devices set revoked_at = now(), revoked_reason = $2
     where revoked_at is null and signed_in_at <= $1::timestamptz returning id`, [new Date(off).toISOString(), OFF_REASON])).length;
}

/**
 * SQL condition (device alias `d`): the device's account was disabled or deactivated after the device
 * signed in. Deactivation (and user provisioning) signs devices out in core (revokeProgramAccess); an
 * administrator's plain "Disable" only ends sessions, so a device must not come back when the account
 * is enabled again. Read from the append-only audit log, by the indexed record columns.
 */
export const DISABLED_SINCE_SQL = `exists (select 1 from audit_events a where a.record_type = 'user' and a.record_id = d.user_id::text
  and a.action in ('user.disable', 'user.deactivate') and a.at >= d.signed_in_at)`;
export const DISABLED_REASON = 'The account was disabled';

/** Marks signed out every device whose account was disabled after it signed in. */
export async function settleDisabled(db: Queryable, userId?: string): Promise<number> {
  return (await db.query(
    `update mobile_devices d set revoked_at = now(), revoked_reason = $2
     where d.revoked_at is null and ($1::uuid is null or d.user_id = $1::uuid) and ${DISABLED_SINCE_SQL} returning d.id`,
    [userId ?? null, DISABLED_REASON])).length;
}

/** Signs one device out: its tokens stop working at once. Answers whether it was active. */
export async function revokeDevice(db: Queryable, id: string, reason: string, by: string | null = null): Promise<boolean> {
  const row = await db.one(
    `update mobile_devices set revoked_at = now(), revoked_by = $2, revoked_reason = $3 where id = $1 and revoked_at is null returning id`,
    [id, by, reason.slice(0, 200)]);
  await db.query(`update mobile_tokens set expires_at = least(expires_at, now()) where device_id = $1`, [id]);
  return Boolean(row);
}

// ---------- administrator settings ----------

export interface MobileAdminSettings {
  accessMinutes: number;
  refreshDays: number;
  requireUnlock: boolean;
  unlockAfterMinutes: number;
  offlineDays: number;
}

/** Limits of each setting (Administration > Mobile app). */
export const LIMITS = {
  accessMinutes: [5, 60],
  refreshDays: [1, 90],
  unlockAfterMinutes: [0, 240],
  offlineDays: [1, 30],
} as const;

const clamp = (v: unknown, [min, max]: readonly [number, number], fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export async function readMobileSettings(ctx: Pick<ModuleContext, 'settings'>): Promise<MobileAdminSettings> {
  const s = MOBILE_SETTINGS;
  return {
    accessMinutes: clamp(await ctx.settings.get(s.accessMinutes.key, s.accessMinutes.fallback), LIMITS.accessMinutes, s.accessMinutes.fallback),
    refreshDays: clamp(await ctx.settings.get(s.refreshDays.key, s.refreshDays.fallback), LIMITS.refreshDays, s.refreshDays.fallback),
    requireUnlock: (await ctx.settings.get<unknown>(s.requireUnlock.key, s.requireUnlock.fallback)) === true,
    unlockAfterMinutes: clamp(await ctx.settings.get(s.unlockAfterMinutes.key, s.unlockAfterMinutes.fallback), LIMITS.unlockAfterMinutes, s.unlockAfterMinutes.fallback),
    offlineDays: clamp(await ctx.settings.get(s.offlineDays.key, s.offlineDays.fallback), LIMITS.offlineDays, s.offlineDays.fallback),
  };
}

/** A request made with the app's own access token (not a session, not a personal access token). */
export const viaMobileToken = (req: FastifyRequest) => Boolean(req.apiToken) && /^Bearer\s+grc_mat_/i.test(String(req.headers.authorization ?? ''));

/** Up to 80 printable characters, for a device name the app sends. */
export const cleanDeviceName = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/** x.y.z with an optional suffix: the app's version. */
export const APP_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][0-9A-Za-z.-]{1,40})?$/;

/** -1, 0 or 1 comparing the numeric parts of two versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0].split('.').map(Number);
  const pb = b.split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type DeviceRow = Row & { id: string; user_id: string; name: string };
