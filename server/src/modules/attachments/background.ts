// Long file work as background jobs (E14-27), started from Administration > File settings while
// the application keeps running:
//   - attachments.rescan: scans every file attached while malware scanning was off, in batches;
//   - attachments.move:   moves every file to the local disk or to the object store (each one is
//     copied, read back and checked before the old copy is deleted; see moveFiles).
// One of each at a time. Both report progress on the job (Administration > Background jobs, and
// the File settings page), and neither is retried by itself: an administrator starts it again.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { ensureJobs, PermanentJobError } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { moveFiles, rescanNotScanned } from './housekeeping.ts';
import { noScanner } from './scanner.ts';

export const RESCAN_JOB = 'attachments.rescan';
export const MOVE_JOB = 'attachments.move';
const BATCH = 200;

export interface RescanProgress { total: number; checked: number; clean: number; infected: number; errors: number; remaining: number }

export async function registerBackgroundFileJobs(ctx: ModuleContext) {
  const { app, db } = ctx;
  const jobs = await ensureJobs(ctx);
  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const scanning = () => {
    const s = app.fileScanner.current();
    return s !== noScanner && s.name !== noScanner.name;
  };
  const notScanned = async () =>
    (await db.one<{ n: number }>(`select count(*)::int as n from attachments where deleted_at is null and scan_status = 'not_scanned'`))?.n ?? 0;

  jobs.register(RESCAN_JOB, async (_payload, job) => {
    if (!scanning()) throw new PermanentJobError('Malware scanning is switched off. Switch it on, then start the scan again.');
    const total = await notScanned();
    const sum: RescanProgress = { total, checked: 0, clean: 0, infected: 0, errors: 0, remaining: total };
    await job.progress(sum);
    // Files the scanner could not check stay "not scanned" and come round again, so the run
    // stops after as many checks as there were files, or when a whole batch could not be checked.
    while (sum.checked < total) {
      const r = await rescanNotScanned(ctx, Math.min(BATCH, total - sum.checked));
      if (!r.checked) break;
      sum.checked += r.checked;
      sum.clean += r.clean;
      sum.infected += r.infected;
      sum.errors += r.errors;
      sum.remaining = r.remaining;
      await job.progress(sum);
      if (r.errors === r.checked) break;
    }
    return sum;
  }, { maxAttempts: 1, leaseSeconds: 900 });

  jobs.register(MOVE_JOB, async (payload, job) => {
    const to = payload?.to === 's3' ? 's3' : payload?.to === 'disk' ? 'disk' : null;
    if (!to) throw new PermanentJobError('Say where the files go: disk or s3.');
    try {
      const result = await moveFiles(ctx, to, (line) => console.log(`[attachments] move: ${line}`), (sofar) => job.progress({ to, ...sofar }));
      return { to, ...result };
    } catch (err) {
      throw new PermanentJobError((err as Error).message);
    }
  }, { maxAttempts: 1, leaseSeconds: 900 });

  /** The newest job of a type, as the File settings page shows it. */
  async function latest(type: string) {
    const row = await db.one<Row>(
      `select id, status, result, last_error, payload, created_at, started_at, finished_at from jobs where type = $1 order by created_at desc limit 1`, [type],
    );
    if (!row) return null;
    return {
      id: row.id, status: row.status, progress: row.result ?? null, error: row.last_error ?? null,
      to: row.payload?.to ?? null, created_at: row.created_at, started_at: row.started_at, finished_at: row.finished_at,
    };
  }

  async function overview() {
    return { rescan: await latest(RESCAN_JOB), move: await latest(MOVE_JOB), notScanned: await notScanned(), scanning: scanning(), poller: jobs.started };
  }

  app.get('/api/attachments/admin/background', admin, async () => overview());
  ctx.describeRoute({
    method: 'GET', path: '/api/attachments/admin/background', permission: 'admin.administer',
    summary: 'The latest background scan and file move, with their progress, and how many files are not yet scanned',
    response: '{ rescan: job | null, move: job | null, notScanned, scanning, poller } where job = { id, status, progress, error, to, created_at, started_at, finished_at }',
  });

  async function start(req: FastifyRequest, type: string, payload: Row, summary: string) {
    const queued = await jobs.enqueue(type, payload, { key: type });
    if (!queued.id) ctx.fail(409, 'already_running', 'This is already waiting or running. Follow its progress below.');
    await ctx.audit(req, { action: type === RESCAN_JOB ? 'attachment.rescan_start' : 'attachment.move_start', recordType: 'attachments', recordId: queued.id!, summary });
    return overview();
  }

  app.post('/api/attachments/admin/rescan/start', admin, async (req) => {
    if (!scanning()) ctx.fail(409, 'no_scanner', 'Switch malware scanning on first.');
    return start(req, RESCAN_JOB, {}, 'Background scan of files attached without a scan started');
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/attachments/admin/rescan/start', permission: 'admin.administer',
    summary: 'Scan every file attached without a scan, as a background job (409 when one is already waiting or running)',
  });

  app.post('/api/attachments/admin/storage/move', admin, async (req) => {
    await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'move every stored file');
    const to = ((req.body ?? {}) as Row).to;
    if (to !== 'disk' && to !== 's3') ctx.fail(400, 'validation', 'Check the highlighted fields.', { to: 'Choose disk or s3.' });
    if (to === 's3' && !app.attachmentStores.s3()) {
      ctx.fail(409, 'store_unavailable', `The object store cannot be used: ${app.attachmentStores.s3Problem() ?? 'set it up above first'}.`);
    }
    return start(req, MOVE_JOB, { to }, `Moving every file to ${to === 's3' ? 'the object store' : 'the local disk'} started`);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/attachments/admin/storage/move', permission: 'admin.administer',
    summary: 'Move every stored file to the local disk or the object store, as a background job (needs a recent password confirmation)',
    body: "{ to: 'disk' | 's3' }",
  });
}
