// Backups taken by the running server, every day, to a second location (E16-08, E16-17,
// E16-24). The work is in server/src/ops/online-backup.ts; this file holds the settings, the
// schedule, the record of each run, the alerts and the routes behind Administration > Backups.
//
// Routes (all need admin.administer; changing the settings also needs a recent password):
//   GET   /api/backups            settings, key, last runs, next run
//   PATCH /api/backups/settings   change the settings
//   POST  /api/backups/run        take a backup now (queued as a background job; the page follows it)
import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { PermanentJobError, scheduleWork } from '../../core/jobs/index.ts';
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
  /**
   * PostgreSQL server only (E40-11): the folder where deploy/postgres/pg-backup.sh writes its dumps, as
   * the server sees it. Empty: not checked.
   */
  pgDumpFolder: string;
  /** Hours after which the newest good dump counts as too old and the administrators are told. */
  pgDumpMaxAgeHours: number;
}

// 03:30, not 02:00: the stop-and-copy backup's scheduled task (`schedule-backup -At`) defaults to 02:00, and that
// stops the server; the two must not meet (OP-12).
export const DEFAULT_BACKUPS: BackupSettings = {
  enabled: false, time: '03:30', keep: 14, destination: 'folder', folder: '', s3Prefix: 'sandpiper-backups/', encrypt: false, includeSecretKey: false,
  pgDumpFolder: '', pgDumpMaxAgeHours: 26,
};

/** A dump written by deploy/postgres/pg-backup.sh, and the record it writes beside it. */
export const PG_DUMP_RE = /^grc-db-\d{8}-\d{6}\.dump$/;
/** Dumps checked (read in full for their checksum) in one pass; older unrecorded ones wait for the next. */
const PG_DUMP_CHECKS_PER_PASS = 3;

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
  if (body.pgDumpFolder !== undefined) {
    const f = String(body.pgDumpFolder ?? '').trim();
    if (f && !isAbsolute(f)) fields.pgDumpFolder = 'Enter a full path, for example /srv/backups/grc.';
    else next.pgDumpFolder = f;
  }
  if (body.pgDumpMaxAgeHours !== undefined) {
    const n = Number(body.pgDumpMaxAgeHours);
    if (!Number.isInteger(n) || n < 1 || n > 720) fields.pgDumpMaxAgeHours = 'Enter a whole number of hours from 1 to 720.';
    else next.pgDumpMaxAgeHours = n;
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

  /**
   * Takes one backup now. Never throws: the outcome is recorded and returned. `by` is the person who
   * asked ("Back up now", run as a background job: E40-11), recorded on the run, and where progress goes.
   */
  async function run(
    trigger: 'scheduled' | 'manual', req: FastifyRequest | null,
    by: { userId?: string | null; jobId?: string | null; progress?: (p: Row) => void } = {},
  ): Promise<Row> {
    const s = await readBackupSettings(ctx);
    const row = (await db.one<Row>(
      `insert into backup_runs (trigger, encrypted, destination, created_by, job_id, progress) values ($1, $2, $3, $4, $5, $6::jsonb) returning *`,
      [trigger, s.encrypt, describeDestination(s), req?.user?.id ?? by.userId ?? null, by.jobId ?? null, JSON.stringify({ stage: 'start' })],
    ))!;
    // Progress is recorded on the run, which the page reads, without waiting for the write.
    let lastAt = 0;
    const progress = (p: Row) => {
      const now = Date.now();
      if (p.stage === 'export' && now - lastAt < 500) return;
      lastAt = now;
      void db.query(`update backup_runs set progress = $2::jsonb where id = $1 and status = 'running'`, [row.id, JSON.stringify(p)]).catch(() => undefined);
      by.progress?.(p);
    };
    try {
      const key = s.encrypt ? loadArchiveKey({ dataDir }) : null;
      if (s.encrypt && !key) throw new OpsError('Encryption is on but no key is set (GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE).');
      const secretKeyFile = s.includeSecretKey ? secretKeyFileToInclude(dataDir) : null;
      if (s.includeSecretKey && !secretKeyFile) throw new OpsError('The secret key was to be included, but it is not kept in a file any more (GRC_SECRET_KEY).');
      const result = await runOnlineBackup({ db, dataDir, workDir, destination: destinationFor(s), key, keep: s.keep, secretKeyFile, onProgress: progress });
      const done = (await db.one<Row>(
        `update backup_runs set status = 'ok', finished_at = now(), archive_name = $2, bytes = $3, verified = true, pruned = $4, encrypted = $5, progress = null
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
        `update backup_runs set status = 'failed', finished_at = now(), message = $2, progress = null where id = $1 returning *`, [row.id, message],
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

  /** A backup started within the last three hours that has not finished, in any server process. */
  const runningAnywhere = async () => Boolean(await db.one(
    `select 1 from backup_runs where status = 'running' and trigger <> 'pg_dump' and started_at > now() - interval '3 hours' limit 1`));

  async function runOnce(trigger: 'scheduled' | 'manual', req: FastifyRequest | null, by: Parameters<typeof run>[2] = {}): Promise<Row> {
    if (running || await runningAnywhere()) ctx.fail(409, 'busy', 'A backup is already running. Wait for it to finish.');
    running = run(trigger, req, by).finally(() => { running = null; });
    return running;
  }

  // ---------- PostgreSQL dumps (E40-11) ----------

  /**
   * Reads the pg_dump folder: each new dump written by deploy/postgres/pg-backup.sh (a .dump with its
   * .dump.json) is checked (size and SHA-256 against its record) and recorded as a run with trigger
   * `pg_dump`; then the newest good one's age is compared with the limit. Problems are told to the
   * administrators once each (core/jobs/alerts.ts) until they clear.
   */
  async function checkPgDumps(now = new Date()): Promise<{ checked: number; newest: string | null; ageHours: number | null; problem: string | null }> {
    const s = await readBackupSettings(ctx);
    const alerts = app.hasDecorator('opsState') ? app.opsState.alerts : null;
    const out = { checked: 0, newest: null as string | null, ageHours: null as number | null, problem: null as string | null };
    if (!s.pgDumpFolder) {
      await alerts?.clear(['backup.pg_dump_overdue', 'backup.pg_dump_bad']);
      return out;
    }
    let names: string[] = [];
    try {
      names = (await readdir(s.pgDumpFolder)).filter((n) => PG_DUMP_RE.test(n)).sort();
    } catch (err) {
      out.problem = `The pg_dump folder ${s.pgDumpFolder} cannot be read: ${(err as Error).message}.`;
    }
    const known = new Set((await db.query<{ archive_name: string }>(
      `select archive_name from backup_runs where trigger = 'pg_dump' and archive_name = any($1::text[])`, [names])).map((r) => r.archive_name));
    // Newest first, a few a pass: each is read in full for its checksum.
    const fresh = names.filter((n) => !known.has(n) && existsSync(join(s.pgDumpFolder, `${n}.json`))).reverse().slice(0, PG_DUMP_CHECKS_PER_PASS);
    for (const name of fresh) {
      const file = join(s.pgDumpFolder, name);
      let record: Row | null = null;
      let problem: string | null = null;
      try {
        record = JSON.parse(await readFile(`${file}.json`, 'utf8')) as Row;
        if (record?.kind !== 'sandpiper-pg-dump' || record.file !== name) problem = 'Its record (.dump.json) does not describe it.';
        else {
          const size = (await stat(file)).size;
          if (size !== Number(record.bytes)) problem = `Its size is ${size} bytes; its record says ${record.bytes}.`;
          else {
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
            if (hash.digest('hex') !== String(record.sha256)) problem = 'Its SHA-256 checksum does not match its record: the file has changed or is damaged.';
          }
        }
      } catch (err) {
        problem = `It could not be read: ${(err as Error).message}`;
      }
      const when = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : now).toISOString();
      const r = (await db.one<Row>(
        `insert into backup_runs (trigger, status, started_at, finished_at, destination, archive_name, bytes, verified, message)
         values ('pg_dump', $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [problem ? 'failed' : 'ok', when(record?.startedAt), when(record?.finishedAt), s.pgDumpFolder, name, Number(record?.bytes) || null, !problem,
          problem ?? `Checked: ${Number(record?.entries) || 0} entries, pg_dump ${String(record?.pgDumpVersion ?? '?').slice(0, 20)}`],
      ))!;
      await ctx.audit(null, {
        action: problem ? 'backup.pg_dump_failed' : 'backup.pg_dump_checked', recordType: 'backup', recordId: r.id,
        summary: problem ? `PostgreSQL dump ${name} failed its check: ${problem}` : `PostgreSQL dump ${name} checked (${formatBytes(Number(record?.bytes) || 0)})`,
      });
      out.checked += 1;
    }
    const newest = await db.one<Row>(`select archive_name, started_at from backup_runs where trigger = 'pg_dump' and status = 'ok' order by started_at desc limit 1`);
    const latest = await db.one<Row>(`select archive_name, status, message from backup_runs where trigger = 'pg_dump' order by started_at desc limit 1`);
    out.newest = newest?.archive_name ?? null;
    out.ageHours = newest ? Math.round(((now.getTime() - new Date(newest.started_at).getTime()) / 36e5) * 10) / 10 : null;
    if (latest?.status === 'failed') {
      await alerts?.raise('backup.pg_dump_bad', { title: 'The newest PostgreSQL backup failed its check', detail: `${latest.archive_name}: ${latest.message}`, route: '/admin/backups' });
    } else await alerts?.clear(['backup.pg_dump_bad']);
    if (out.problem || out.ageHours === null || out.ageHours > s.pgDumpMaxAgeHours) {
      out.problem ??= out.ageHours === null
        ? `No checked dump in ${s.pgDumpFolder} yet.`
        : `The newest checked dump is ${Math.round(out.ageHours)} hours old (the limit is ${s.pgDumpMaxAgeHours}).`;
      await alerts?.raise('backup.pg_dump_overdue', {
        title: 'PostgreSQL backups are overdue',
        detail: `${out.problem} Check the schedule of deploy/postgres/pg-backup.sh (docs/operations.md, "PostgreSQL server backups").`,
        route: '/admin/backups',
      });
    } else await alerts?.clear(['backup.pg_dump_overdue']);
    return out;
  }

  /** Runs the scheduled backup when it is due, and warns when backups are overdue. Called every few minutes. */
  async function tick(now = new Date()): Promise<'ran' | 'not-due' | 'off'> {
    const s = await readBackupSettings(ctx);
    // PostgreSQL dumps are checked whether or not the server's own daily backup is on.
    if (db.driver === 'server') await checkPgDumps(now);
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
    if (await runningAnywhere()) return 'not-due';
    await runOnce('scheduled', null);
    return 'ran';
  }

  // ---------- routes ----------

  async function overview() {
    const s = await readBackupSettings(ctx);
    const runs = await db.query<Row>(
      `select r.*, u.display_name as created_by_name from backup_runs r left join users u on u.id = r.created_by
       where r.trigger <> 'pg_dump' order by r.started_at desc limit 20`);
    const ok = await lastSuccess();
    const postgres = db.driver === 'server';
    const pgDumps = postgres || s.pgDumpFolder
      ? await db.query<Row>(`select * from backup_runs where trigger = 'pg_dump' order by started_at desc limit 10`) : [];
    const lastPgDump = pgDumps.find((r) => r.status === 'ok') ?? null;
    // "Back up now" waits in the queue, then runs (E40-11): the page follows both.
    const queued = await db.one<Row>(
      `select id, status, created_at, run_at from jobs where type = 'backups.run_now' and status in ('queued', 'failed', 'running') order by created_at desc limit 1`);
    const active = runs.find((r) => r.status === 'running') ?? null;
    return {
      settings: s,
      timeZone: TIME_ZONE,
      keySource: describeKeySource(),
      secretKeyNote: secretKeyNote(dataDir, s.encrypt && s.includeSecretKey),
      secretKeyFile: Boolean(secretKeyFileToInclude(dataDir)),
      s3Available: Boolean(app.attachmentStores.s3()),
      destination: describeDestination(s),
      running: Boolean(running) || Boolean(active),
      active,
      queued: queued && !active ? queued : null,
      lastSuccess: ok ?? null,
      runs,
      postgres,
      pgDumps,
      lastPgDump,
      pgDumpOverdue: s.pgDumpFolder ? !lastPgDump || (Date.now() - new Date(lastPgDump.started_at).getTime()) / 36e5 > s.pgDumpMaxAgeHours : false,
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

  // "Back up now" runs as a background job in its own lane (E40-11): a large backup is never cut off
  // by a reverse proxy's time-out, and other work goes on meanwhile. The page follows the run.
  const jobs = app.jobs;
  jobs.register('backups.run_now', async (payload: Row, job) => {
    const result = await runOnce('manual', null, {
      userId: typeof payload.userId === 'string' ? payload.userId : null, jobId: job.id,
      progress: (p) => { void job.progress(p).catch(() => undefined); },
    });
    if (result.status !== 'ok') throw new PermanentJobError(String(result.message ?? 'The backup failed.'));
    return { runId: result.id, archive: result.archive_name, bytes: Number(result.bytes ?? 0) };
  }, { maxAttempts: 1, leaseSeconds: 3600, lane: 'backups' });

  app.post('/api/backups/run', admin, async (req) => {
    const s = await readBackupSettings(ctx);
    if (s.destination === 'folder' && !s.folder) ctx.fail(400, 'not_configured', 'Choose where backups go first.');
    if (running || await runningAnywhere()) ctx.fail(409, 'busy', 'A backup is already running. Wait for it to finish.');
    const queued = await jobs.enqueue('backups.run_now', { userId: req.user!.id }, { key: 'backups.run_now', maxAttempts: 1 });
    if (!queued.id) ctx.fail(409, 'busy', 'A backup is already waiting to start.');
    await ctx.audit(req, { action: 'backup.requested', recordType: 'job', recordId: queued.id!, summary: 'Backup asked for with Back up now' });
    return { jobId: queued.id, overview: await overview() };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/backups/run', permission: 'admin.administer',
    summary: 'Take a backup now, while the application keeps running: queued as a background job; GET /api/backups follows it (active, queued, runs)',
    response: '{ jobId, overview }',
  });

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

  const api = { run: runOnce, tick, overview, checkPgDumps };
  if (!app.hasDecorator('backupScheduler')) app.decorate('backupScheduler', api);
  return api;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the attachments module is loaded: the server's own backups (tests and commands). */
    backupScheduler: {
      run(trigger: 'scheduled' | 'manual', req: FastifyRequest | null): Promise<Row>;
      tick(now?: Date): Promise<'ran' | 'not-due' | 'off'>;
      /** Checks the pg_dump folder now, whichever database is in use (tests; the schedule does it on PostgreSQL). */
      checkPgDumps(now?: Date): Promise<{ checked: number; newest: string | null; ageHours: number | null; problem: string | null }>;
    };
  }
}
