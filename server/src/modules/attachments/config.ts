// Administrator settings for where files are kept, how they are scanned and when removed files
// are purged. Every outbound connection here is off by default: files stay on the local disk
// and nothing is scanned until an administrator says otherwise.
import { existsSync, readFileSync } from 'node:fs';
import { secretBox } from '../../core/auth.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { ClamdConfig } from './clamd.ts';
import type { S3Config } from './s3.ts';

export const SETTING_STORAGE = 'attachments.storage';
export const SETTING_SCANNER = 'attachments.scanner';
export const SETTING_PURGE_DAYS = 'attachments.purge_days';
export const DEFAULT_PURGE_DAYS = 30;
const SECRET_CONTEXT = 'attachments.s3.secret';

export type CredentialSource = 'settings' | 'file' | 'environment';

export interface StorageSettings {
  driver: 'disk' | 's3';
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    pathStyle: boolean;
    prefix: string;
    sse: 'none' | 'AES256' | 'aws:kms';
    kmsKeyId: string;
    credentials: CredentialSource;
    accessKeyId: string;
    /** Encrypted with the application's secret key (see core/secretbox.ts). Never sent to the browser. */
    secret: string;
    /** For credentials "file": a JSON file holding { "accessKeyId", "secretAccessKey", "sessionToken"? }. */
    credentialsFile: string;
  };
}

export const DEFAULT_STORAGE: StorageSettings = {
  driver: 'disk',
  s3: {
    endpoint: '', region: 'us-east-1', bucket: '', pathStyle: true, prefix: '', sse: 'none', kmsKeyId: '',
    credentials: 'settings', accessKeyId: '', secret: '', credentialsFile: '',
  },
};

export interface ScannerSettings {
  enabled: boolean;
  host: string;
  port: number;
  timeoutSeconds: number;
  maxMb: number;
  /** When the scanner cannot give a verdict: accept the file as "Not scanned" (with a warning), or refuse it. */
  whenUnavailable: 'accept' | 'refuse';
}

export const DEFAULT_SCANNER: ScannerSettings = {
  enabled: false, host: '127.0.0.1', port: 3310, timeoutSeconds: 60, maxMb: 100, whenUnavailable: 'accept',
};

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});

export async function readStorage(ctx: ModuleContext): Promise<StorageSettings> {
  const raw = obj(await ctx.settings.get<unknown>(SETTING_STORAGE, DEFAULT_STORAGE));
  const s3 = { ...DEFAULT_STORAGE.s3, ...obj(raw.s3) };
  return { driver: raw.driver === 's3' ? 's3' : 'disk', s3: s3 as StorageSettings['s3'] };
}

export async function readScanner(ctx: ModuleContext): Promise<ScannerSettings> {
  return { ...DEFAULT_SCANNER, ...obj(await ctx.settings.get<unknown>(SETTING_SCANNER, DEFAULT_SCANNER)) } as ScannerSettings;
}

export async function readPurgeDays(ctx: ModuleContext): Promise<number> {
  const n = Number(await ctx.settings.get<unknown>(SETTING_PURGE_DAYS, DEFAULT_PURGE_DAYS));
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : DEFAULT_PURGE_DAYS;
}

export const clamdConfig = (s: ScannerSettings): ClamdConfig => ({
  host: s.host, port: s.port, timeoutMs: s.timeoutSeconds * 1000, maxBytes: s.maxMb * 1024 * 1024,
});

/** The storage settings as the browser sees them: never the secret, only whether there is one. */
export function presentStorage(s: StorageSettings): Row {
  const { secret, ...rest } = s.s3;
  return { driver: s.driver, s3: { ...rest, secretSet: Boolean(secret) } };
}

/** The S3 connection settings with credentials resolved, or a plain reason why they are not usable. */
export function resolveS3(ctx: ModuleContext, s: StorageSettings['s3']): S3Config {
  let accessKeyId = s.accessKeyId;
  let secretAccessKey = '';
  let sessionToken: string | undefined;
  if (s.credentials === 'environment') {
    accessKeyId = process.env.GRC_S3_ACCESS_KEY_ID ?? '';
    secretAccessKey = process.env.GRC_S3_SECRET_ACCESS_KEY ?? '';
    sessionToken = process.env.GRC_S3_SESSION_TOKEN || undefined;
    if (!accessKeyId || !secretAccessKey) throw new Error('GRC_S3_ACCESS_KEY_ID and GRC_S3_SECRET_ACCESS_KEY are not set in the server\'s environment.');
  } else if (s.credentials === 'file') {
    if (!s.credentialsFile || !existsSync(s.credentialsFile)) throw new Error(`The credentials file ${s.credentialsFile || '(none given)'} does not exist on the server.`);
    let parsed: Row;
    try {
      parsed = JSON.parse(readFileSync(s.credentialsFile, 'utf8'));
    } catch {
      throw new Error('The credentials file is not valid JSON.');
    }
    accessKeyId = String(parsed.accessKeyId ?? '');
    secretAccessKey = String(parsed.secretAccessKey ?? '');
    sessionToken = parsed.sessionToken ? String(parsed.sessionToken) : undefined;
    if (!accessKeyId || !secretAccessKey) throw new Error('The credentials file needs "accessKeyId" and "secretAccessKey".');
  } else {
    if (!s.accessKeyId || !s.secret) throw new Error('Enter the access key and the secret key.');
    secretAccessKey = secretBox(ctx.db).decrypt(s.secret, SECRET_CONTEXT);
  }
  if (!s.endpoint || !s.bucket || !s.region) throw new Error('Enter the endpoint, region and bucket.');
  return {
    endpoint: s.endpoint, region: s.region, bucket: s.bucket, pathStyle: s.pathStyle, prefix: s.prefix,
    sse: s.sse, kmsKeyId: s.kmsKeyId || undefined, accessKeyId, secretAccessKey, sessionToken,
  };
}

const fieldsError = (ctx: ModuleContext, fields: Record<string, string>) => {
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
};

/** Validates a change to the storage settings and returns the settings to store (secret encrypted). */
export function validateStorage(ctx: ModuleContext, body: Row, current: StorageSettings): StorageSettings {
  const fields: Record<string, string> = {};
  const inS3 = obj(body.s3);
  const driver = body.driver === undefined ? current.driver : body.driver;
  if (driver !== 'disk' && driver !== 's3') fields.driver = 'Choose the local disk or an S3-compatible object store.';
  const s3 = { ...current.s3 };
  const text = (name: keyof StorageSettings['s3'], max = 500) => {
    if (inS3[name] === undefined) return;
    const v = String(inS3[name] ?? '').trim();
    if (v.length > max) fields[name] = `Keep it under ${max} characters.`;
    else (s3 as Row)[name] = v;
  };
  text('endpoint');
  text('region', 64);
  text('bucket', 63);
  text('prefix', 200);
  text('kmsKeyId', 2048);
  text('accessKeyId', 256);
  text('credentialsFile', 1000);
  if (inS3.pathStyle !== undefined) s3.pathStyle = inS3.pathStyle === true;
  if (inS3.sse !== undefined) {
    if (!['none', 'AES256', 'aws:kms'].includes(String(inS3.sse))) fields.sse = 'Choose none, AES256 or aws:kms.';
    else s3.sse = inS3.sse as StorageSettings['s3']['sse'];
  }
  if (inS3.credentials !== undefined) {
    if (!['settings', 'file', 'environment'].includes(String(inS3.credentials))) fields.credentials = 'Choose where the credentials come from.';
    else s3.credentials = inS3.credentials as CredentialSource;
  }
  if (typeof inS3.secretAccessKey === 'string' && inS3.secretAccessKey !== '') {
    s3.secret = secretBox(ctx.db).encrypt(inS3.secretAccessKey, SECRET_CONTEXT);
  }
  if (s3.endpoint) {
    try {
      const u = new URL(s3.endpoint);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') fields.endpoint = 'The endpoint must start with https:// (or http:// for a store on this machine).';
      else if (u.search || u.hash || u.username) fields.endpoint = 'Give the endpoint address only, without a query or credentials.';
    } catch {
      fields.endpoint = 'Enter a web address such as https://s3.example.net.';
    }
  }
  if (s3.bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s3.bucket)) fields.bucket = 'Bucket names are 3 to 63 lower-case letters, digits, dots and hyphens.';
  if (s3.prefix && (s3.prefix.startsWith('/') || s3.prefix.includes('..'))) fields.prefix = 'The prefix cannot start with "/" or contain "..".';
  if (s3.prefix && !s3.prefix.endsWith('/')) s3.prefix = `${s3.prefix}/`;
  if (driver === 's3') {
    if (!s3.endpoint) fields.endpoint ??= 'Enter the endpoint.';
    if (!s3.bucket) fields.bucket ??= 'Enter the bucket.';
    if (!s3.region) fields.region ??= 'Enter the region.';
    if (s3.credentials === 'settings' && !s3.accessKeyId) fields.accessKeyId ??= 'Enter the access key.';
    if (s3.credentials === 'settings' && !s3.secret) fields.secretAccessKey = 'Enter the secret key.';
    if (s3.credentials === 'file' && !s3.credentialsFile) fields.credentialsFile ??= 'Enter the path of the credentials file on the server.';
  }
  fieldsError(ctx, fields);
  return { driver: driver as StorageSettings['driver'], s3 };
}

export function validateScanner(ctx: ModuleContext, body: Row, current: ScannerSettings): ScannerSettings {
  const fields: Record<string, string> = {};
  const next = { ...current };
  if (body.enabled !== undefined) next.enabled = body.enabled === true;
  if (body.host !== undefined) {
    const h = String(body.host ?? '').trim();
    if (!/^[A-Za-z0-9.:[\]-]{1,253}$/.test(h)) fields.host = 'Enter a host name or address, for example 127.0.0.1.';
    else next.host = h;
  }
  const whole = (name: 'port' | 'timeoutSeconds' | 'maxMb', min: number, max: number, message: string) => {
    if (body[name] === undefined) return;
    const n = Number(body[name]);
    if (!Number.isInteger(n) || n < min || n > max) fields[name] = message;
    else next[name] = n;
  };
  whole('port', 1, 65535, 'Enter a port from 1 to 65535.');
  whole('timeoutSeconds', 1, 600, 'Enter a number of seconds from 1 to 600.');
  whole('maxMb', 1, 4096, 'Enter a number of megabytes from 1 to 4096.');
  if (body.whenUnavailable !== undefined) {
    if (body.whenUnavailable !== 'accept' && body.whenUnavailable !== 'refuse') fields.whenUnavailable = 'Choose accept or refuse.';
    else next.whenUnavailable = body.whenUnavailable;
  }
  fieldsError(ctx, fields);
  return next;
}

export function validatePurgeDays(ctx: ModuleContext, value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 3650) ctx.fail(400, 'validation', 'Check the highlighted fields.', { purgeDays: 'Enter a whole number of days from 0 to 3650 (0 keeps removed files indefinitely).' });
  return n;
}
