// The audit archive (E40-06): audit events older than a setting are written to a file, checked,
// and only then removed from the database. Off by default: nothing is ever removed unless an
// administrator switches it on (Audit log > Archive), with a recent password confirmation.
//
// A run (the daily job `core.audit_archive`, or "Archive now"):
// 1. reads the events older than the cut-off, oldest first, a batch at a time, into one
//    gzip-compressed JSON Lines file `audit-archive-<yyyyMMdd-HHmmss>.jsonl.gz` in the chosen folder
//    (outside the data folder), at most MAX_PER_RUN events per run (the next run takes the rest);
// 2. reads the file back and checks the count and a SHA-256 of every line against what was written,
//    then writes `<file>.json` beside it (what it holds, the cut-off, the first and last event id and
//    both checksums);
// 3. removes exactly those events, a batch per transaction, in a transaction that sets
//    `grc.audit_archive` (the append-only trigger lets a delete through only then; migration 030);
// 4. writes the audit event `audit.archive`, which names the file, the count and the checksum.
// A run that stops part-way leaves the file complete and checked; events not yet removed are taken
// again by the next run, so an event can be in two files, never in none.
//
// A least-privilege run-time role (docs/installation.md) may not delete audit events at all: the run
// then stops before writing anything and says so. The archive then runs as the database owner, with
// the command `audit-archive` (server/src/ops/audit-archive-owner.ts, E40-14), from a scheduled task;
// the daily job only watches, and tells the administrators once when events more than
// OWNER_GRACE_DAYS past the cut-off are still in the database (the owner's runs have stopped).
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { requireRecentAuth } from './auth.ts';
import type { Db } from './db.ts';
import type { ModuleContext, Row } from './module.ts';
import type { JobQueue } from './jobs/queue.ts';
import type { OpsAlerts } from './jobs/alerts.ts';

export const SETTING_AUDIT_ARCHIVE = 'audit.archive';
export const MAX_PER_RUN = 500_000;
/** With a least-privilege role, how long past the cut-off events may wait for the owner's run before the administrators are told. */
export const OWNER_GRACE_DAYS = 31;
/** The command that archives as the database owner, as an operator types it. */
export const OWNER_COMMAND = 'npm run cli -- audit-archive (grc audit-archive in the container)';
const BATCH = 5_000;
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;

export interface AuditArchiveSettings {
  enabled: boolean;
  /** Events older than this many months are archived (at least 12). */
  olderThanMonths: number;
  /** An absolute folder outside the data folder. */
  folder: string;
}

export const DEFAULT_AUDIT_ARCHIVE: AuditArchiveSettings = { enabled: false, olderThanMonths: 84, folder: '' };

export interface ArchiveResult {
  status: 'off' | 'nothing' | 'archived' | 'not_permitted';
  file?: string;
  count?: number;
  sha256?: string;
  firstId?: number;
  lastId?: number;
  cutoff?: string;
  more?: boolean;
  message?: string;
  /** not_permitted: events more than OWNER_GRACE_DAYS past the cut-off are still there (the owner's runs have stopped). */
  overdue?: boolean;
}

export async function readArchiveSettings(ctx: Pick<ModuleContext, 'settings'>): Promise<AuditArchiveSettings> {
  const raw = await ctx.settings.get<unknown>(SETTING_AUDIT_ARCHIVE, DEFAULT_AUDIT_ARCHIVE);
  return { ...DEFAULT_AUDIT_ARCHIVE, ...(raw && typeof raw === 'object' ? raw as Row : {}) } as AuditArchiveSettings;
}

/** Field problems with these settings, empty when they may be saved. */
export function archiveSettingsProblems(s: AuditArchiveSettings, dataDir: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!Number.isInteger(s.olderThanMonths) || s.olderThanMonths < 12 || s.olderThanMonths > 1200) {
    fields.olderThanMonths = 'Enter a whole number of months from 12 to 1200.';
  }
  if (s.enabled || s.folder) {
    if (!s.folder) fields.folder = 'Enter the folder to write archive files to.';
    else if (!isAbsolute(s.folder)) fields.folder = 'Enter a full path, for example D:\\Archive\\Sandpiper or /srv/archive/sandpiper.';
    else if (dataDir !== 'memory') {
      const rel = relative(resolve(dataDir), resolve(s.folder));
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) fields.folder = 'Choose a folder outside the data folder.';
    }
  }
  return fields;
}

const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** May the account the server uses remove audit events at all? */
export async function mayRemoveAuditEvents(db: Db): Promise<boolean> {
  const r = await db.one<{ ok: boolean }>(`select has_table_privilege(current_user, 'audit_events', 'DELETE') as ok`);
  return r?.ok === true;
}

/** One archive run. Throws with a plain message when the file cannot be written or does not check. */
export async function archiveAuditEvents(
  ctx: Pick<ModuleContext, 'db' | 'audit' | 'settings'>,
  opts: {
    now?: Date; settings?: AuditArchiveSettings; onProgress?: (p: Row) => Promise<void>;
    /** Who runs it, for the audit event ("the owner command as grc_owner"). */
    by?: string;
  } = {},
): Promise<ArchiveResult> {
  const { db } = ctx;
  const s = opts.settings ?? await readArchiveSettings(ctx);
  if (!s.enabled) return { status: 'off' };
  if (!s.folder || !isAbsolute(s.folder)) throw new Error('No archive folder is set.');
  const now = opts.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - s.olderThanMonths);
  const cut = cutoff.toISOString();

  const first = await db.one<{ id: number }>('select id from audit_events where at < $1::timestamptz order by id limit 1', [cut]);
  if (!first) return { status: 'nothing', cutoff: cut };
  if (!(await mayRemoveAuditEvents(db))) {
    const grace = new Date(cutoff.getTime() - OWNER_GRACE_DAYS * 86_400_000).toISOString();
    const overdue = Boolean(await db.one('select 1 from audit_events where at < $1::timestamptz limit 1', [grace]));
    return {
      status: 'not_permitted', cutoff: cut, overdue,
      message: overdue
        ? `The database account the server uses may not remove audit events (a least-privilege role), and events more than ${OWNER_GRACE_DAYS} days past the cut-off are still in the database. Run the archive as the database owner: ${OWNER_COMMAND}.`
        : `The database account the server uses may not remove audit events (a least-privilege role). Nothing was archived here; the archive runs as the database owner: ${OWNER_COMMAND}.`,
    };
  }

  await mkdir(s.folder, { recursive: true, mode: PRIVATE_DIR });
  let name = `audit-archive-${stampOf(now)}.jsonl.gz`;
  for (let i = 2; existsSync(join(s.folder, name)); i++) name = `audit-archive-${stampOf(now)}_${i}.jsonl.gz`;
  const file = join(s.folder, name);

  // 1. Write.
  const ids: number[] = [];
  const lines = createHash('sha256');
  const gzip = createGzip();
  const out = createWriteStream(file, { mode: PRIVATE_FILE });
  gzip.pipe(out);
  try {
    let after = 0;
    while (ids.length < MAX_PER_RUN) {
      const rows = await db.query<Row>(
        `select * from audit_events where at < $1::timestamptz and id > $2 order by id limit $3`,
        [cut, after, Math.min(BATCH, MAX_PER_RUN - ids.length)],
      );
      if (!rows.length) break;
      for (const r of rows) {
        const line = `${JSON.stringify({ ...r, id: Number(r.id), at: r.at instanceof Date ? r.at.toISOString() : r.at })}\n`;
        lines.update(line);
        if (!gzip.write(line)) await once(gzip, 'drain');
        ids.push(Number(r.id));
      }
      after = Number(rows[rows.length - 1].id);
      await opts.onProgress?.({ stage: 'writing', events: ids.length });
    }
    gzip.end();
    await once(out, 'close');
  } catch (err) {
    gzip.destroy();
    out.destroy();
    await rm(file, { force: true });
    throw err;
  }
  const contentSha = lines.digest('hex');

  // 2. Read back and check.
  const back = createHash('sha256');
  let count = 0;
  const reader = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of reader) {
    back.update(`${line}\n`);
    count += 1;
  }
  if (count !== ids.length || back.digest('hex') !== contentSha) {
    await rm(file, { force: true });
    throw new Error(`The archive file ${name} did not read back as written; it was deleted and nothing was removed.`);
  }
  const fileSha = createHash('sha256');
  for await (const chunk of createReadStream(file)) fileSha.update(chunk as Buffer);
  const sha256 = fileSha.digest('hex');
  const bytes = (await stat(file)).size;
  const firstId = ids[0];
  const lastId = ids[ids.length - 1];
  await writeFile(`${file}.json`, `${JSON.stringify({
    kind: 'sandpiper-audit-archive', file: name, createdAt: now.toISOString(), olderThan: cut, events: count,
    firstId, lastId, bytes, sha256, contentSha256: contentSha, format: 'gzip-compressed JSON Lines, one audit event a line, oldest first',
  }, null, 2)}\n`, { mode: PRIVATE_FILE });

  // 3. Remove exactly the events written, a batch per transaction.
  let removed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH);
    removed += await db.tx(async (tx) => {
      await tx.query(`select set_config('grc.audit_archive', 'on', true)`);
      const gone = await tx.query(`delete from audit_events where id = any($1::bigint[]) and at < $2::timestamptz returning 1`, [part, cut]);
      return gone.length;
    });
    await opts.onProgress?.({ stage: 'removing', events: ids.length, removed });
  }

  // 4. Audited.
  const more = ids.length >= MAX_PER_RUN;
  await ctx.audit(null, {
    action: 'audit.archive', recordType: 'audit_archive', recordId: name,
    summary: `${removed.toLocaleString('en-US')} audit events older than ${cut.slice(0, 10)} archived to ${file} (SHA-256 ${sha256.slice(0, 16)}…) and removed${opts.by ? ` by ${opts.by}` : ''}${more ? '; more remain for the next run' : ''}`,
    after: { file, events: count, removed, firstId, lastId, bytes, sha256, olderThan: cut, ...(opts.by ? { by: opts.by } : {}) },
  });
  return { status: 'archived', file, count, sha256, firstId, lastId, cutoff: cut, more };
}

/** The archive job and its routes (Audit log > Archive). */
export async function registerAuditArchive(ctx: ModuleContext, jobs: JobQueue, alerts: OpsAlerts): Promise<void> {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const A = 'admin.administer';

  jobs.register('core.audit_archive', async (_payload, job) => {
    const result = await archiveAuditEvents(ctx, { onProgress: (p) => job.progress(p) });
    // With a least-privilege role the owner's command archives; the job only watches that it keeps doing so.
    if (result.status === 'not_permitted' && result.overdue) {
      await alerts.raise('audit.archive', { title: 'Old audit events are not being archived', detail: result.message, route: '/admin/audit' });
    } else await alerts.clear(['audit.archive']);
    return result;
  }, { maxAttempts: 2, leaseSeconds: 3600 });
  await jobs.schedule('core.audit_archive', { type: 'core.audit_archive', every: 24 * 3_600_000, firstRunInMs: 3 * 3_600_000 });

  async function overview() {
    const settings = await readArchiveSettings(ctx);
    const runs = await db.query<Row>(
      `select id, at, actor_name, summary, after from audit_events where action = 'audit.archive' order by id desc limit 10`);
    const job = await db.one<Row>(
      `select id, status, result, last_error, created_at, finished_at from jobs where type = 'core.audit_archive' order by created_at desc limit 1`);
    return {
      settings,
      permitted: await mayRemoveAuditEvents(db as Db),
      ownerCommand: OWNER_COMMAND,
      oldest: (await db.one<{ at: string }>('select min(at) as at from audit_events'))?.at ?? null,
      runs, job: job ?? null,
    };
  }

  app.get('/api/audit/archive', admin, overview);
  ctx.describeRoute({ method: 'GET', path: '/api/audit/archive', tag: 'Audit', permission: A, summary: 'Audit archive settings, the last archive runs and whether the server may remove events' });

  app.put('/api/audit/archive', admin, async (req) => {
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'change the audit archive');
    const b = (req.body ?? {}) as Row;
    const before = await readArchiveSettings(ctx);
    const next: AuditArchiveSettings = {
      enabled: b.enabled === undefined ? before.enabled : b.enabled === true,
      olderThanMonths: b.olderThanMonths === undefined ? before.olderThanMonths : Number(b.olderThanMonths),
      folder: b.folder === undefined ? before.folder : String(b.folder ?? '').trim(),
    };
    const fields = archiveSettingsProblems(next, ctx.dataDir);
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    await ctx.settings.set(SETTING_AUDIT_ARCHIVE, next, req);
    return overview();
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/audit/archive', tag: 'Audit', permission: A, summary: 'Change the audit archive (needs a recent password confirmation)',
    body: '{ enabled, olderThanMonths (12 to 1200), folder (absolute, outside the data folder) }',
  });

  app.post('/api/audit/archive/run', admin, async (req) => {
    const s = await readArchiveSettings(ctx);
    if (!s.enabled) ctx.fail(409, 'not_enabled', 'Switch the audit archive on first.');
    const queued = await jobs.enqueue('core.audit_archive', {}, { key: 'audit-archive' });
    if (!queued.id) ctx.fail(409, 'already_queued', 'An archive run is already waiting or running.');
    await ctx.audit(req, { action: 'audit.archive_run', recordType: 'job', recordId: queued.id!, summary: 'Audit archive run asked for by hand' });
    return { jobId: queued.id };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/audit/archive/run', tag: 'Audit', permission: A, summary: 'Run the audit archive now, as a background job' });
}
