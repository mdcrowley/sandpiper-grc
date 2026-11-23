// Administration > Push notifications: the organization's own push credentials. Keys are sealed
// with the application's secret key (core/secretbox.ts, listed in core/secretkey-reseal.ts) and are
// never sent back: the page sees only whether a key is stored and its fingerprint.
import { generateKeyPairSync } from 'node:crypto';
import { secretBox } from '../../core/auth.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import {
  DEFAULT_APNS_BUNDLE_ID, PUSH_PROVIDERS, type PushConfigInput, type PushConfigView, type PushProvider, type PushStats,
} from '../../../../shared/push-api.ts';
import type { ApnsCredentials } from './apns.ts';
import type { FcmCredentials } from './fcm.ts';
import { keyFingerprint, parsePrivateKey, rawPublicKey } from './jwt.ts';
import type { UnifiedPushCredentials } from './webpush.ts';

export const CONTEXT = { apns: 'push:apns-key', fcm: 'push:fcm-key', vapid: 'push:vapid-key' } as const;
export const targetContext = (id: string) => `push-target:${id}`;

type Db = ModuleContext['db'];

export async function configRow(db: Db): Promise<Row> {
  await db.query('insert into push_config (id) values (1) on conflict (id) do nothing');
  return (await db.one<Row>('select * from push_config where id = 1'))!;
}

export function presentConfig(r: Row): PushConfigView {
  return {
    apns: {
      enabled: r.apns_enabled === true, keyId: r.apns_key_id, teamId: r.apns_team_id, bundleId: r.apns_bundle_id,
      keySet: Boolean(r.apns_key_sealed), keyFingerprint: r.apns_key_fingerprint ?? null,
    },
    fcm: {
      enabled: r.fcm_enabled === true, projectId: r.fcm_project_id, clientEmail: r.fcm_client_email,
      keySet: Boolean(r.fcm_key_sealed), keyFingerprint: r.fcm_key_fingerprint ?? null,
    },
    unifiedpush: {
      enabled: r.unifiedpush_enabled === true,
      allowedHosts: Array.isArray(r.unifiedpush_hosts) ? r.unifiedpush_hosts.map(String) : [],
      vapidPublicKey: r.vapid_public_key ?? null, contact: r.unifiedpush_contact,
    },
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

export interface PushCredentials {
  apns: ApnsCredentials | null;
  fcm: FcmCredentials | null;
  unifiedpush: UnifiedPushCredentials | null;
}

export const anyOn = (c: PushCredentials) => Boolean(c.apns || c.fcm || c.unifiedpush);

/** The usable credentials of each switched-on service (a service whose key cannot be opened counts as off, and is logged). */
export async function loadCredentials(db: Db): Promise<PushCredentials> {
  const r = await configRow(db);
  const box = secretBox(db);
  const open = (sealed: string | null, context: string, kind: 'ec-p256' | 'rsa', what: string) => {
    if (!sealed) return null;
    try {
      return parsePrivateKey(box.decrypt(sealed, context), kind);
    } catch (err) {
      console.error(`[push] ${what} cannot be opened: ${(err as Error).message}`);
      return null;
    }
  };
  const out: PushCredentials = { apns: null, fcm: null, unifiedpush: null };
  if (r.apns_enabled) {
    const key = open(r.apns_key_sealed, CONTEXT.apns, 'ec-p256', 'The Apple push key');
    if (key && r.apns_key_id && r.apns_team_id && r.apns_bundle_id) {
      out.apns = { key, keyId: r.apns_key_id, teamId: r.apns_team_id, bundleId: r.apns_bundle_id, fingerprint: keyFingerprint(key) };
    }
  }
  if (r.fcm_enabled) {
    const key = open(r.fcm_key_sealed, CONTEXT.fcm, 'rsa', 'The Firebase service account key');
    if (key && r.fcm_project_id && r.fcm_client_email) {
      out.fcm = { key, projectId: r.fcm_project_id, clientEmail: r.fcm_client_email, fingerprint: keyFingerprint(key) };
    }
  }
  if (r.unifiedpush_enabled) {
    const key = open(r.vapid_private_sealed, CONTEXT.vapid, 'ec-p256', 'The UnifiedPush (VAPID) key');
    const hosts = Array.isArray(r.unifiedpush_hosts) ? r.unifiedpush_hosts.map(String) : [];
    if (key && r.vapid_public_key && hosts.length) {
      out.unifiedpush = { vapidKey: key, vapidPublicKey: r.vapid_public_key, allowedHosts: hosts, contact: r.unifiedpush_contact };
    }
  }
  return out;
}

// ---------- changes ----------

const KEY_ID_RE = /^[A-Z0-9]{10}$/;
const BUNDLE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/;

/** A new VAPID key pair: the private key sealed, the public point as base64url. */
export function newVapidKey(db: Db): { sealed: string; publicKey: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  return { sealed: secretBox(db).encrypt(pem, CONTEXT.vapid), publicKey: rawPublicKey(privateKey).toString('base64url') };
}

export interface ConfigChange {
  /** Column → new value. */
  set: Row;
  /** Plain words for the audit summary: which settings changed (never a key). */
  changed: string[];
}

/** Validates a change; throws 400 with the fields at fault. */
export function planChange(ctx: ModuleContext, r: Row, input: PushConfigInput): ConfigChange {
  const set: Row = {};
  const changed: string[] = [];
  const fields: Record<string, string> = {};
  const box = secretBox(ctx.db);
  const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
  const put = (col: string, value: unknown, word: string) => {
    const before = r[col];
    if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) return;
    set[col] = value;
    if (!changed.includes(word)) changed.push(word);
  };
  const after = (col: string) => (col in set ? set[col] : r[col]);
  const bool = (v: unknown, field: string) => {
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') { fields[field] = 'Choose on or off.'; return undefined; }
    return v;
  };

  const a = obj(input.apns);
  if (a.keyId !== undefined) {
    const v = String(a.keyId ?? '').trim().toUpperCase();
    if (v && !KEY_ID_RE.test(v)) fields['apns.keyId'] = 'The key id is the 10 letters and digits Apple shows beside the key.';
    else put('apns_key_id', v, 'Apple key id');
  }
  if (a.teamId !== undefined) {
    const v = String(a.teamId ?? '').trim().toUpperCase();
    if (v && !KEY_ID_RE.test(v)) fields['apns.teamId'] = 'The team id is the 10 letters and digits of your Apple Developer account.';
    else put('apns_team_id', v, 'Apple team id');
  }
  if (a.bundleId !== undefined) {
    const v = String(a.bundleId ?? '').trim() || DEFAULT_APNS_BUNDLE_ID;
    if (!BUNDLE_RE.test(v)) fields['apns.bundleId'] = 'Enter the app\'s bundle id, for example com.sandpipergrc.';
    else put('apns_bundle_id', v, 'Apple bundle id');
  }
  if (typeof a.key === 'string' && a.key.trim()) {
    const key = parsePrivateKey(a.key.trim(), 'ec-p256');
    if (!key) fields['apns.key'] = 'Paste the whole .p8 file Apple gave, from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----.';
    else {
      put('apns_key_sealed', box.encrypt(a.key.trim(), CONTEXT.apns), 'Apple key');
      put('apns_key_fingerprint', keyFingerprint(key), 'Apple key');
    }
  } else if (a.removeKey === true && r.apns_key_sealed) {
    put('apns_key_sealed', null, 'Apple key removed');
    put('apns_key_fingerprint', null, 'Apple key removed');
    put('apns_enabled', false, 'Apple push');
  }
  const apnsOn = bool(a.enabled, 'apns.enabled');
  if (apnsOn !== undefined) put('apns_enabled', apnsOn, 'Apple push');
  if (after('apns_enabled') === true) {
    if (!after('apns_key_sealed')) fields['apns.key'] ??= 'Add the .p8 key before switching Apple push on.';
    if (!after('apns_key_id')) fields['apns.keyId'] ??= 'Enter the key id before switching Apple push on.';
    if (!after('apns_team_id')) fields['apns.teamId'] ??= 'Enter the team id before switching Apple push on.';
  }

  const f = obj(input.fcm);
  if (typeof f.serviceAccount === 'string' && f.serviceAccount.trim()) {
    let sa: Row = {};
    try {
      sa = JSON.parse(f.serviceAccount);
    } catch {
      fields['fcm.serviceAccount'] = 'Paste the service account file exactly as downloaded (it is JSON).';
    }
    if (!fields['fcm.serviceAccount']) {
      const key = typeof sa.private_key === 'string' ? parsePrivateKey(sa.private_key, 'rsa') : null;
      if (sa.type !== 'service_account') fields['fcm.serviceAccount'] = 'This is not a service account file ("type" is not "service_account").';
      else if (typeof sa.project_id !== 'string' || !PROJECT_RE.test(sa.project_id)) fields['fcm.serviceAccount'] = 'The file has no valid "project_id".';
      else if (typeof sa.client_email !== 'string' || !EMAIL_RE.test(sa.client_email)) fields['fcm.serviceAccount'] = 'The file has no valid "client_email".';
      else if (!key) fields['fcm.serviceAccount'] = 'The file\'s "private_key" is not an RSA private key.';
      else {
        put('fcm_project_id', sa.project_id, 'Firebase project');
        put('fcm_client_email', sa.client_email, 'Firebase service account');
        // Only the private key is secret; the rest of the file is not kept.
        put('fcm_key_sealed', box.encrypt(String(sa.private_key), CONTEXT.fcm), 'Firebase key');
        put('fcm_key_fingerprint', keyFingerprint(key), 'Firebase key');
      }
    }
  } else if (f.removeKey === true && r.fcm_key_sealed) {
    put('fcm_key_sealed', null, 'Firebase key removed');
    put('fcm_key_fingerprint', null, 'Firebase key removed');
    put('fcm_enabled', false, 'Firebase push');
  }
  const fcmOn = bool(f.enabled, 'fcm.enabled');
  if (fcmOn !== undefined) put('fcm_enabled', fcmOn, 'Firebase push');
  if (after('fcm_enabled') === true && !after('fcm_key_sealed')) fields['fcm.serviceAccount'] ??= 'Add the service account file before switching Firebase push on.';

  const u = obj(input.unifiedpush);
  if (u.allowedHosts !== undefined) {
    const list = Array.isArray(u.allowedHosts) ? u.allowedHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean) : null;
    const bad = list?.find((h) => !HOST_RE.test(h) || h.length > 253);
    if (!list || bad !== undefined || list.length > 50) fields['unifiedpush.allowedHosts'] = bad ? `"${bad}" is not a host name (host, host:port or *.domain).` : 'Give up to 50 host names.';
    else put('unifiedpush_hosts', [...new Set(list)], 'UnifiedPush servers');
  }
  if (u.contact !== undefined) {
    const v = String(u.contact ?? '').trim();
    if (v && !(/^mailto:[^\s@<>]+@[^\s@<>]+$/.test(v) || /^https:\/\/[^\s<>]+$/.test(v)) || v.length > 200) {
      fields['unifiedpush.contact'] = 'Leave it empty, or give a mailto: address or an https:// page.';
    } else put('unifiedpush_contact', v, 'UnifiedPush contact');
  }
  const upOn = bool(u.enabled, 'unifiedpush.enabled');
  if (upOn !== undefined) put('unifiedpush_enabled', upOn, 'UnifiedPush');
  if (after('unifiedpush_enabled') === true) {
    const hosts = after('unifiedpush_hosts');
    if (!Array.isArray(hosts) || !hosts.length) fields['unifiedpush.allowedHosts'] ??= 'List the push servers phones may use before switching UnifiedPush on.';
    if (!after('vapid_private_sealed')) {
      // The server's own key pair is made the first time UnifiedPush is switched on.
      const v = newVapidKey(ctx.db);
      put('vapid_private_sealed', v.sealed, 'UnifiedPush key made');
      put('vapid_public_key', v.publicKey, 'UnifiedPush key made');
    }
  }

  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  return { set, changed };
}

export async function saveChange(db: Db, change: ConfigChange, userId: string | null): Promise<void> {
  const cols = Object.keys(change.set);
  if (!cols.length) return;
  const values = cols.map((c) => (c === 'unifiedpush_hosts' ? JSON.stringify(change.set[c]) : change.set[c]));
  await db.query(
    `update push_config set ${cols.map((c, i) => `${c} = $${i + 2}${c === 'unifiedpush_hosts' ? '::jsonb' : ''}`).join(', ')},
       updated_at = now(), updated_by = $1 where id = 1`,
    [userId, ...values],
  );
}

// ---------- what the page shows about delivery ----------

export async function pushStats(db: Db): Promise<PushStats> {
  const empty = () => Object.fromEntries(PUSH_PROVIDERS.map((p) => [p, 0])) as Record<PushProvider, number>;
  const out: PushStats = {
    registrations: empty(), failing: empty(),
    lastError: Object.fromEntries(PUSH_PROVIDERS.map((p) => [p, null])) as PushStats['lastError'], lastSentAt: null,
  };
  for (const r of await db.query<Row>(
    `select provider, count(*)::int as n, count(*) filter (where failures > 0)::int as failing, max(last_sent_at) as sent
     from push_registrations group by provider`,
  )) {
    out.registrations[r.provider as PushProvider] = r.n;
    out.failing[r.provider as PushProvider] = r.failing;
    if (r.sent && (!out.lastSentAt || new Date(r.sent) > new Date(out.lastSentAt))) out.lastSentAt = new Date(r.sent).toISOString();
  }
  for (const r of await db.query<Row>(
    `select distinct on (provider) provider, last_error, last_error_at from push_registrations
     where last_error is not null order by provider, last_error_at desc`,
  )) {
    out.lastError[r.provider as PushProvider] = { message: r.last_error, at: new Date(r.last_error_at).toISOString() };
  }
  return out;
}
