// Backups taken by the running server, every day, to a second location (E16-08, E16-17,
// E16-24). The work is in server/src/ops/online-backup.ts; this file holds the settings, the
// schedule, the record of each run, the alerts and the routes behind Administration > Backups.
//
// Routes (all need admin.administer; changing the settings also needs a recent password):
//   GET   /api/backups            settings, key, last runs, next run
//   PATCH /api/backups/settings   change the settings
//   POST  /api/backups/run        take a backup now
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { TIME_ZONE, todayInZone } from '../../core/timezone.ts';
import { emitWebhookEvent } from '../../core/webhooks.ts';
import { describeKeySource, loadArchiveKey } from '../../ops/archive.ts';
import { OpsError } from '../../ops/errors.ts';
import { repoRoot } from '../../ops/files.ts';
import { secretKeyFileToInclude, secretKeyNote } from '../../ops/secret-key.ts';
import {
  type BackupStatusFile, type Destination, folderDestination, runOnlineBackup, writeBackupStatus,
} from '../../ops/online-backup.ts';
import { s3Client } from './s3.ts';
import { dataDirFor, formatBytes } from './service.ts';

export const SETTING_BACKUPS = 'backups.schedule';

export interface BackupSettings {
  enabled: boolean;
  /** Time of day, HH:mm, in the organization's time zone. */
  time: string;
  /** Archives kept at the destination. */
  keep: number;
  destination: 'folder' | 's3';
  /** For a folder destination: an absolute path (a local folder or a network share). */
  folder: string;
  /** For the object store: the prefix under the store's own prefix. */
  s3Prefix: string;
  /** Encrypt each archive with the key from GRC_BACKUP_KEY_FILE / GRC_BACKUP_PASSPHRASE(_FILE). */
  encrypt: boolean;
  /** Encrypted archives only: also carry the application's secret key file (kept outside the data folder). */
  includeSecretKey: boolean;
}

// 03:30, not 02:00: the stop-and-copy backup's scheduled task (`schedule-backup -At`) defaults to 02:00, and that
// stops the server; the two must not meet (OP-12).
export const DEFAULT_BACKUPS: BackupSettings = {
  enabled: false, time: '03:30', keep: 14, destination: 'folder', folder: '', s3Prefix: 'sandpiper-backups/', encrypt: false, includeSecretKey: false,
};

const OVERDUE_HOURS = 48;

export async function readBackupSettings(ctx: ModuleContext): Promise<BackupSettings> {
  const raw = await ctx.settings.get<unknown>(SETTING_BACKUPS, DEFAULT_BACKUPS);
  return { ...DEFAULT_BACKUPS, ...(raw && typeof raw === 'object' ? raw as Row : {}) } as BackupSettings;
}

/** Hour and minute now in the organization's time zone, as HH:mm. */
export function nowInZone(at = new Date()): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

function validate(ctx: ModuleContext, body: Row, current: BackupSettings, s3Available: boolean): BackupSettings {
  const fields: Record<string, string> = {};
  const next = { ...current };
  if (body.enabled !== undefined) next.enabled = body.enabled === true;
  if (body.encrypt !== undefined) next.encrypt = body.encrypt === true;
  if (body.includeSecretKey !== undefined) next.includeSecretKey = body.includeSecretKey === true;
  if (body.time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time))) fields.time = 'Enter a time of day as HH:mm, for example 03:30.';
    else next.time = String(body.time);
  }
  if (body.keep !== undefined) {
    const n = Number(body.keep);
    if (!Number.isInteger(n) || n < 1 || n > 365) fields.keep = 'Enter a whole number from 1 to 365.';
    else next.keep = n;
  }
  if (body.destination !== undefined) {
    if (body.destination !== 'folder' && body.destination !== 's3') fields.destination = 'Choose a folder or the object store.';
    else next.destination = body.destination;
  }
  if (body.folder !== undefined) next.folder = String(body.folder ?? '').trim();
  if (body.s3Prefix !== undefined) {
    let p = String(body.s3Prefix ?? '').trim();
    if (p && !p.endsWith('/')) p = `${p}/`;
    if (p.startsWith('/') || p.includes('..') || p.length > 200) fields.s3Prefix = 'Use letters, digits, hyphens and slashes, not starting with "/".';
    else next.s3Prefix = p;
  }
  const dataDir = dataDirFor(ctx);
  if (next.destination === 'folder' && (next.enabled || next.folder)) {
    if (!next.folder) fields.folder = 'Enter the folder to write backups to.';
    else if (!isAbsolute(next.folder)) fields.folder = 'Enter a full path, for example D:\\Backups\\Sandpiper or \\\\fileserver\\backups\\sandpiper.';
    else if (dataDir !== 'memory') {
      const rel = relative(resolve(dataDir), resolve(next.folder));
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) fields.folder = 'Choose a folder outside the data folder: a backup must not live with the data it protects.';
    }
  }
  if (next.destination === 's3' && next.enabled && !s3Available) fields.destination = 'Set up the object store on the File settings page first.';
  if (next.encrypt && !describeKeySource()) {
    fields.encrypt = 'No key is set: start the server with GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE.';
  }
  if (next.includeSecretKey && !next.encrypt) fields.includeSecretKey = 'The secret key can only go into encrypted backups. Switch encryption on first.';
  else if (next.includeSecretKey && !secretKeyFileToInclude(dataDir)) fields.includeSecretKey = 'The secret key is not kept in a file (it comes from GRC_SECRET_KEY), so it cannot be included.';
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  return next;
}

export async function registerBackups(ctx: ModuleContext) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const dataDir = dataDirFor(ctx);
  const backupsDir = process.env.GRC_BACKUP_DIR ? resolve(process.env.GRC_BACKUP_DIR) : dataDir === 'memory' ? tmpdir() : join(repoRoot, 'backups');
  const workDir = join(backupsDir, `.work-${process.pid}`);
  let running: Promise<Row> | null = null;

  function destinationFor(s: BackupSettings): Destination {
    if (s.destination === 's3') {
      const remote = app.attachmentStores.s3();
      if (!remote) throw new OpsError(`The object store cannot be used: ${app.attachmentStores.s3Problem() ?? 'set it up on the File settings page'}.`);
      const client = s3Client({ ...remote.client.config, prefix: `${remote.client.config.prefix}${s.s3Prefix}` });
      return {
        describe: () => `object store ${client.describe()}`,
        put: (name, file) => client.putObject(name, createReadStream(file)),
        get: (name) => client.getObject(name),
        list: () => client.listObjects(''),
        delete: (name) => client.deleteObject(name),
      };
    }
    if (!s.folder) throw new OpsError('No backup folder is set.');
    return folderDestination(s.folder);
  }

  const describeDestination = (s: BackupSettings) => {
    try {
      return destinationFor(s).describe();
    } catch {
      return s.destination === 's3' ? 'object store (not available)' : s.folder || null;
    }
  };

  async function lastSuccess(): Promise<Row | undefined> {
    return db.one<Row>(`select * from backup_runs where status = 'ok' order by started_at desc limit 1`);
  }

  async function writeStatus(): Promise<void> {
    const s = await readBackupSettings(ctx);
    const last = await db.one<Row>(`select * from backup_runs where status <> 'running' order by started_at desc limit 1`);
    const ok = await lastSuccess();
    const status: BackupStatusFile = {
      updatedAt: new Date().toISOString(),
      enabled: s.enabled,
      schedule: s.enabled ? `daily at ${s.time} (${TIME_ZONE}), keeping ${s.keep}` : null,
      destination: describeDestination(s),
      encrypted: s.encrypt,
      lastRun: last ? { at: new Date(last.started_at).toISOString(), ok: last.status === 'ok', name: last.archive_name, message: last.message } : null,
      lastSuccess: ok ? { at: new Date(ok.started_at).toISOString(), name: ok.archive_name, bytes: Number(ok.bytes ?? 0) } : null,
    };
    await writeBackupStatus(dataDir, status).catch((err) => console.error('[backups] status file not written:', err.message));
  }

  async function alert(title: string, body: string) {
    if (!app.hasDecorator('notify')) return;
    await app.notify({ permission: 'admin.administer', kind: 'general', title, body, route: '/admin/backups', oncePerDay: true });
  }

  /** Takes one backup now. Never throws: the outcome is recorded and returned. */
  async function run(trigger: 'scheduled' | 'manual', req: FastifyRequest | null): Promise<Row> {
    const s = await readBackupSettings(ctx);
    const row = (await db.one<Row>(
      `insert into backup_runs (trigger, encrypted, destination, created_by) values ($1, $2, $3, $4) returning *`,
      [trigger, s.encrypt, describeDestination(s), req?.user?.id ?? null],
    ))!;
    try {
      const key = s.encrypt ? loadArchiveKey({ dataDir }) : null;
      if (s.encrypt && !key) throw new OpsError('Encryption is on but no key is set (GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE).');
      const secretKeyFile = s.includeSecretKey ? secretKeyFileToInclude(dataDir) : null;
      if (s.includeSecretKey && !secretKeyFile) throw new OpsError('The secret key was to be included, but it is not kept in a file any more (GRC_SECRET_KEY).');
      const result = await runOnlineBackup({ db, dataDir, workDir, destination: destinationFor(s), key, keep: s.keep, secretKeyFile });
      const done = (await db.one<Row>(
        `update backup_runs set status = 'ok', finished_at = now(), archive_name = $2, bytes = $3, verified = true, pruned = $4, encrypted = $5
          where id = $1 returning *`,
        [row.id, result.name, result.bytes, result.pruned, result.encrypted],
      ))!;
      await ctx.audit(req, {
        action: 'backup.run', recordType: 'backup', recordId: row.id,
        summary: `Backup ${result.name} written to ${done.destination} and checked there (${formatBytes(result.bytes)}${result.encrypted ? ', encrypted' : ''})${result.pruned.length ? `; ${result.pruned.length} older removed` : ''}`,
      });
      return done;
    } catch (err) {
      const message = err instanceof OpsError ? err.message : `Unexpected error: ${(err as Error).message}`;
      if (!(err instanceof OpsError)) console.error('[backups] backup failed:', err);
      const failed = (await db.one<Row>(
        `update backup_runs set status = 'failed', finished_at = now(), message = $2 where id = $1 returning *`, [row.id, message],
      ))!;
      await ctx.audit(req, { action: 'backup.failed', recordType: 'backup', recordId: row.id, summary: `Backup failed: ${message}` });
      await alert('A backup failed', message);
      await emitWebhookEvent(app, {
        event: 'backup.failed', req,
        data: { runId: row.id, trigger, destination: failed.destination ?? null, message },
      });
      return failed;
    } finally {
      await writeStatus();
    }
  }

  function runOnce(trigger: 'scheduled' | 'manual', req: FastifyRequest | null): Promise<Row> {
    if (running) ctx.fail(409, 'busy', 'A backup is already running. Wait for it to finish.');
    running = run(trigger, req).finally(() => { running = null; });
    return running;
  }

  /** Runs the scheduled backup when it is due, and warns when backups are overdue. Called every few minutes. */
  async function tick(now = new Date()): Promise<'ran' | 'not-due' | 'off'> {
    const s = await readBackupSettings(ctx);
    if (!s.enabled) return 'off';
    const ok = await lastSuccess();
    const ageHours = ok ? (now.getTime() - new Date(ok.started_at).getTime()) / 36e5 : null;
    if (ageHours !== null && ageHours > OVERDUE_HOURS) {
      await alert('Backups are overdue', `The last successful backup was ${Math.round(ageHours)} hours ago.`);
    }
    if (running || nowInZone(now) < s.time) return 'not-due';
    const today = todayInZone(now);
    const already = await db.one(
      `select 1 from backup_runs where trigger = 'scheduled' and (started_at at time zone $1)::date = $2::date limit 1`, [TIME_ZONE, today]);
    if (already) return 'not-due';
    await runOnce('scheduled', null);
    return 'ran';
  }

  // ---------- routes ----------

  async function overview() {
    const s = await readBackupSettings(ctx);
    const runs = await db.query<Row>(`select r.*, u.display_name as created_by_name from backup_runs r left join users u on u.id = r.created_by order by r.started_at desc limit 20`);
    const ok = await lastSuccess();
    return {
      settings: s,
      timeZone: TIME_ZONE,
      keySource: describeKeySource(),
      secretKeyNote: secretKeyNote(dataDir, s.encrypt && s.includeSecretKey),
      secretKeyFile: Boolean(secretKeyFileToInclude(dataDir)),
      s3Available: Boolean(app.attachmentStores.s3()),
      destination: describeDestination(s),
      running: Boolean(running),
      lastSuccess: ok ?? null,
      runs,
    };
  }

  app.get('/api/backups', admin, overview);
  ctx.describeRoute({ method: 'GET', path: '/api/backups', summary: 'Backup settings, the key in use (never the key itself) and the last runs', permission: 'admin.administer' });

  app.patch('/api/backups/settings', admin, async (req) => {
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'change the backup settings');
    const before = await readBackupSettings(ctx);
    const next = validate(ctx, (req.body ?? {}) as Row, before, Boolean(app.attachmentStores.s3()));
    await ctx.settings.set(SETTING_BACKUPS, next, req);
    await writeStatus();
    return overview();
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/backups/settings', summary: 'Change the backup schedule, destination, retention and encryption', permission: 'admin.administer' });

  app.post('/api/backups/run', admin, async (req) => {
    const s = await readBackupSettings(ctx);
    if (s.destination === 'folder' && !s.folder) ctx.fail(400, 'not_configured', 'Choose where backups go first.');
    const result = await runOnce('manual', req);
    return { run: result, overview: await overview() };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/backups/run', summary: 'Take a backup now, while the application keeps running', permission: 'admin.administer' });

  // ---------- schedule ----------

  // Every five minutes the job queue asks whether a backup is due (Administration > Background
  // jobs), so one process takes it however many there are. A run may take a while: an hour's lease.
  await scheduleWork(ctx, 'backups.schedule', () => tick(), { every: 5 * 60_000, firstRunInMs: 45_000, leaseSeconds: 3600, maxAttempts: 1 });

  app.addHook('onReady', async () => {
    // A run still marked "running" at start was cut off by a stop, or is the record of the very
    // backup that was just restored (each backup holds its own unfinished row).
    await db.query(
      `update backup_runs set status = 'failed', finished_at = coalesce(finished_at, now()),
         message = 'Interrupted: the server stopped during this backup, or this record came back with a restored backup.'
       where status = 'running'`,
    );
    if (process.env.VITEST) return;
    await writeStatus();
  });
  app.addHook('onClose', async () => {
    await running?.catch(() => undefined);
  });

  const api = { run: runOnce, tick, overview };
  if (!app.hasDecorator('backupScheduler')) app.decorate('backupScheduler', api);
  return api;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the attachments module is loaded: the server's own backups (tests and commands). */
    backupScheduler: {
      run(trigger: 'scheduled' | 'manual', req: FastifyRequest | null): Promise<Row>;
      tick(now?: Date): Promise<'ran' | 'not-due' | 'off'>;
    };
  }
}
