// Administration of stored files (behind Administration > File settings): where files are kept,
// malware scanning, the purge period, usage, removed files and the integrity check.
// Every route needs admin.administer; a change that redirects files, scans or deletes them also
// needs a recent password confirmation.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { clamdCommand, parseVersion } from './clamd.ts';
import {
  clamdConfig, presentStorage, readPurgeDays, readScanner, readStorage, resolveS3, SETTING_PURGE_DAYS, SETTING_SCANNER,
  SETTING_STORAGE, validatePurgeDays, validateScanner, validateStorage,
} from './config.ts';
import { typeGroup } from './filetypes.ts';
import { checkIntegrity, purgeRemoved, rescanNotScanned, usage } from './housekeeping.ts';
import { s3Client } from './s3.ts';
import { formatBytes } from './service.ts';

export function registerFileAdmin(ctx: ModuleContext, applyScanner: () => Promise<void>) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const confirm = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);

  app.get('/api/attachments/admin/overview', admin, async () => {
    const storage = await readStorage(ctx);
    return {
      storage: presentStorage(storage),
      s3Problem: storage.driver === 's3' || storage.s3.endpoint ? app.attachmentStores.s3Problem() : null,
      scanner: await readScanner(ctx),
      activeScanner: app.fileScanner.current().name,
      purgeDays: await readPurgeDays(ctx),
      usage: await usage(ctx),
    };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/attachments/admin/overview', summary: 'Storage, scanning and purge settings and storage usage', permission: 'admin.administer' });

  // ---------- storage ----------

  app.patch('/api/attachments/admin/storage', admin, async (req) => {
    await confirm(req, 'change where attached files are stored');
    const current = await readStorage(ctx);
    const next = validateStorage(ctx, (req.body ?? {}) as Row, current);
    if (next.driver === 's3') {
      // Prove it works before any upload depends on it.
      try {
        await s3Client({ ...resolveS3(ctx, next.s3), ...app.attachmentStores.testOverrides }).test();
      } catch (err) {
        ctx.fail(400, 'store_unreachable', `The object store could not be used, so nothing was changed: ${(err as Error).message}`);
      }
    }
    await ctx.settings.set(SETTING_STORAGE, next, req);
    await app.attachmentStores.reload();
    return presentStorage(next);
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/attachments/admin/storage', summary: 'Choose the local disk or an S3-compatible object store for new files', permission: 'admin.administer' });

  app.post('/api/attachments/admin/storage/test', admin, async (req) => {
    await confirm(req, 'test the object store connection');
    const current = await readStorage(ctx);
    const candidate = validateStorage(ctx, { ...((req.body ?? {}) as Row), driver: 's3' }, current);
    try {
      await s3Client({ ...resolveS3(ctx, candidate.s3), ...app.attachmentStores.testOverrides }).test();
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    return { ok: true, message: 'Connected: a test file was written, read back and deleted.' };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/attachments/admin/storage/test', summary: 'Try object store settings without saving them', permission: 'admin.administer' });

  // ---------- scanner ----------

  app.patch('/api/attachments/admin/scanner', admin, async (req) => {
    await confirm(req, 'change malware scanning');
    const next = validateScanner(ctx, (req.body ?? {}) as Row, await readScanner(ctx));
    await ctx.settings.set(SETTING_SCANNER, next, req);
    await applyScanner();
    return next;
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/attachments/admin/scanner', summary: 'Switch ClamAV scanning on or off and set how it is reached', permission: 'admin.administer' });

  app.post('/api/attachments/admin/scanner/test', admin, async (req) => {
    const s = validateScanner(ctx, (req.body ?? {}) as Row, await readScanner(ctx));
    try {
      const version = parseVersion(await clamdCommand({ ...clamdConfig(s), timeoutMs: Math.min(10_000, s.timeoutSeconds * 1000) }, 'VERSION'));
      return { ok: true, ...version };
    } catch (err) {
      return { ok: false, message: `The scanner could not be reached: ${(err as Error).message}` };
    }
  });
  ctx.describeRoute({ method: 'POST', path: '/api/attachments/admin/scanner/test', summary: 'Ask the scanner for its engine and signature versions', permission: 'admin.administer' });

  app.post('/api/attachments/admin/rescan', admin, async (req) => {
    const limit = Math.min(1000, Math.max(1, Number((req.body as Row | undefined)?.limit) || 200));
    return rescanNotScanned(ctx, limit);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/attachments/admin/rescan', summary: 'Scan files that were attached without a scan (up to 200 a time)', permission: 'admin.administer' });

  // ---------- purge and removed files ----------

  app.patch('/api/attachments/admin/purge', admin, async (req) => {
    await confirm(req, 'change how long removed files are kept');
    const days = validatePurgeDays(ctx, (req.body as Row | undefined)?.purgeDays);
    await ctx.settings.set(SETTING_PURGE_DAYS, days, req);
    return { purgeDays: days };
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/attachments/admin/purge', summary: 'Set how many days removed files are kept before they are purged', permission: 'admin.administer' });

  app.post('/api/attachments/admin/purge/run', admin, async (req) => {
    await confirm(req, 'purge removed files now');
    return purgeRemoved(ctx);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/attachments/admin/purge/run', summary: 'Purge removed files that are past the period now, rather than at the daily run', permission: 'admin.administer' });

  /** Removed files the caller may know about: a restricted record's files stay hidden without security.view. */
  async function visibleRemoved(req: FastifyRequest, where: string, params: unknown[]): Promise<Row[]> {
    const rows = await db.query<Row>(`select * from attachments where ${where}`, params);
    const out: Row[] = [];
    const seen = new Map<string, Row | null>();
    for (const r of rows) {
      const key = `${r.record_type}:${r.record_id}`;
      if (!seen.has(key)) {
        const def = ctx.resources.get(r.record_type);
        let parent: Row | null = null;
        if (def && ctx.can(req.user, `${def.module}.view`)) {
          // Soft-deleted records count: their files can still be restored.
          const found = await db.one<Row>(`select * from ${def.table} where id = $1 and ${ctx.resources.visibleWhere(def.type, req.user)}`, [r.record_id]);
          if (found) {
            parent = {
              label: [def.ref && found[def.ref.field], found[def.titleField]].filter(Boolean).join(' ') || def.label,
              type_label: def.label, route: found.deleted_at ? null : `${def.route}/${found.id}`, record_deleted: Boolean(found.deleted_at),
            };
          } else if (ctx.can(req.user, 'security.view')) {
            const exists = await db.one(`select 1 from ${def.table} where id = $1`, [r.record_id]);
            if (!exists) parent = { label: 'Deleted record', type_label: def.label, route: null, record_deleted: true };
          }
        } else if (!def && ctx.can(req.user, 'security.view')) {
          parent = { label: 'Record of a module that is not loaded', type_label: r.record_type, route: null, record_deleted: false };
        }
        seen.set(key, parent);
      }
      const parent = seen.get(key);
      if (parent) out.push({ ...r, parent });
    }
    return out;
  }

  app.get('/api/attachments/admin/removed', admin, async (req) => {
    const rows = await visibleRemoved(req, `deleted_at is not null and purged_at is null order by deleted_at desc limit 500`, []);
    const days = await readPurgeDays(ctx);
    return {
      purgeDays: days,
      rows: rows.map((r) => ({
        id: r.id, file_name: r.file_name, type_group: typeGroup(r.extension), size_bytes: r.size_bytes, kind: r.kind, removed_at: r.deleted_at,
        removed_reason: r.removed_reason ?? 'removed', storage_driver: r.storage_driver,
        purge_on: days ? new Date(new Date(r.deleted_at).getTime() + days * 86_400_000).toISOString() : null,
        record_label: r.parent.label, record_type_label: r.parent.type_label, record_route: r.parent.route,
        record_deleted: r.parent.record_deleted,
        can_restore: !r.parent.record_deleted || r.removed_reason !== 'record_gone',
      })),
    };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/attachments/admin/removed', summary: 'Removed files that have not been purged yet', permission: 'admin.administer' });

  app.post('/api/attachments/admin/removed/:id/restore', admin, async (req) => {
    const id = (req.params as { id: string }).id;
    const [att] = UUID_RE.test(id) ? await visibleRemoved(req, `id = $1 and deleted_at is not null and purged_at is null`, [id]) : [];
    if (!att) ctx.fail(404, 'not_found', 'File not found, or it has already been purged.');
    if (att.removed_reason === 'record_gone') ctx.fail(409, 'record_gone', 'Its record has been deleted for good, so the file cannot be put back.');
    await db.query(`update attachments set deleted_at = null, removed_reason = null, updated_at = now(), updated_by = $2 where id = $1`, [att.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'attachment.restore', recordType: att.record_type, recordId: att.record_id,
      summary: `Removed file put back: ${att.file_name} (${formatBytes(Number(att.size_bytes))})`, after: { attachment_id: att.id },
    });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/attachments/admin/removed/:id/restore', summary: 'Put a removed file back on its record', permission: 'admin.administer' });

  // ---------- integrity ----------

  app.post('/api/attachments/admin/check', admin, async (req) => {
    const report = await checkIntegrity(ctx);
    // A restricted record's file names are left out for administrators without security.view.
    if (!ctx.can(req.user, 'security.view')) {
      report.missing = report.missing.map((m) => ({ ...m, file_name: '(name hidden)' }));
    }
    await ctx.audit(req, {
      action: 'attachment.check', recordType: 'attachments',
      summary: `Storage check: ${report.rows} files, ${report.missingCount} missing from storage, ${report.unreferencedCount} stored with no record`,
    });
    return report;
  });
  ctx.describeRoute({ method: 'POST', path: '/api/attachments/admin/check', summary: 'Compare stored files with the records of them', permission: 'admin.administer' });
}
