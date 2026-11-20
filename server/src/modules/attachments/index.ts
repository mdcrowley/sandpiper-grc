// Attachments: files on any record, kept outside the database.
//
// Who may do what follows the record the file belongs to: seeing the record lets you list and
// download its files; `<module>.edit` on it lets you add, describe and remove them. A record
// the caller may not see (including a restricted one) answers "not found" for everything, so
// neither its files nor their existence leak.
import type { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleDef, ResourceDef, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { registerFileAdmin } from './admin.ts';
import { registerBackgroundFileJobs } from './background.ts';
import { registerBackups } from './backups.ts';
import { clamdScanner } from './clamd.ts';
import { clamdConfig, readScanner } from './config.ts';
import { runEvidenceFileReminders } from './evidenceReminders.ts';
import { dailyHousekeeping } from './housekeeping.ts';
import { insertAttachment, prepareFile, receiveFile, sandboxDownload, sendStoredFile, type Refusal } from './intake.ts';
import { makeScannerRegistry } from './scanner.ts';
import {
  formatBytes, present, readSettings, SETTING_EXTENSIONS, SETTING_MAX_BYTES, validateDescriptive, validateSettings,
} from './service.ts';
import { makeStores } from './stores.ts';

interface Parent { def: ResourceDef; row: Row; restricted: boolean; label: string }

const DAY = 24 * 3_600_000;

const mod: ModuleDef = {
  key: 'attachments',

  async register(ctx) {
    const { app, db } = ctx;
    // Where files are kept (local disk, or an object store once an administrator sets one up).
    const stores = makeStores(ctx);
    if (!app.hasDecorator('attachmentStores')) app.decorate('attachmentStores', stores);
    await stores.reload();
    // Other modules reach the scanner hook through the Fastify instance (see scanner.ts).
    if (!app.hasDecorator('fileScanner')) app.decorate('fileScanner', makeScannerRegistry());
    const scanners = app.fileScanner;

    /** Installs the ClamAV scanner when an administrator has switched it on; removes it when switched off. */
    async function applyScanner() {
      const s = await readScanner(ctx);
      if (s.enabled) scanners.use(clamdScanner(clamdConfig(s)));
      else if (scanners.current().name === 'clamav') scanners.reset();
    }
    await applyScanner();

    registerFileAdmin(ctx, applyScanner);
    await registerBackgroundFileJobs(ctx);
    await registerBackups(ctx);

    // Daily: files of records deleted for good are marked removed, and removed files past the
    // purge period are deleted from storage. A job-queue schedule (Administration > Background jobs).
    await scheduleWork(ctx, 'attachments.housekeeping', async () => {
      const r = await dailyHousekeeping(ctx);
      return { orphans: r.orphans, purged: r.purge.purged, failed: r.purge.failed };
    }, { every: DAY, firstRunInMs: 120_000, leaseSeconds: 1800 });

    // Daily: evidence files about to expire remind their record's owner (E14-18, evidenceReminders.ts).
    await scheduleWork(ctx, 'attachments.evidence_reminders', () => runEvidenceFileReminders(ctx), { every: DAY, firstRunInMs: 140_000 });

    // ---------- who may see and change the files of a record ----------

    /** The parent record if the caller may see it; undefined otherwise (never says which). */
    async function findParent(req: FastifyRequest, type: unknown, id: unknown): Promise<Parent | undefined> {
      if (typeof type !== 'string' || typeof id !== 'string' || !UUID_RE.test(id)) return undefined;
      const def = ctx.resources.get(type);
      if (!def || !ctx.can(req.user, `${def.module}.view`)) return undefined;
      if (def.restricted === true && !ctx.can(req.user, 'security.view')) return undefined;
      const row = await ctx.resources.find(type, id, req.user);
      if (!row) return undefined;
      const restricted = def.restricted === true || (def.restricted === 'flag' && row.restricted === true);
      const label = [def.ref && row[def.ref.field], row[def.titleField]].filter(Boolean).join(' ') || def.label;
      return { def, row, restricted, label };
    }

    const mayEdit = (req: FastifyRequest, parent: Parent) => ctx.can(req.user, `${parent.def.module}.edit`);

    async function needParent(req: FastifyRequest, type: unknown, id: unknown, action: 'view' | 'edit'): Promise<Parent> {
      const parent = (await findParent(req, type, id)) ?? ctx.fail(404, 'not_found', 'Record not found.');
      if (action === 'edit' && !mayEdit(req, parent)) {
        ctx.fail(403, 'forbidden', 'You do not have permission to change the files on this record.');
      }
      return parent;
    }

    /** One attachment and its parent. Missing, removed and not-visible all look the same. */
    async function needAttachment(req: FastifyRequest, action: 'view' | 'edit'): Promise<{ att: Row; parent: Parent }> {
      const id = (req.params as { id?: string }).id ?? '';
      const att = UUID_RE.test(id)
        ? await db.one<Row>('select * from attachments where id = $1 and deleted_at is null', [id])
        : undefined;
      const parent = att ? await findParent(req, att.record_type, att.record_id) : undefined;
      if (!att || !parent) ctx.fail(404, 'not_found', 'File not found.');
      if (action === 'edit' && !mayEdit(req, parent!)) {
        ctx.fail(403, 'forbidden', 'You do not have permission to change the files on this record.');
      }
      return { att: att!, parent: parent! };
    }

    // ---------- settings ----------

    app.get('/api/attachments/config', async (req) => {
      const s = await readSettings(ctx);
      return {
        maxBytes: s.maxBytes, allowedExtensions: s.allowedExtensions, scanner: scanners.current().name,
        whenUnavailable: (await readScanner(ctx)).whenUnavailable,
        canAdminister: ctx.can(req.user, 'admin.administer'),
      };
    });

    app.patch('/api/attachments/settings', { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
      const change = validateSettings(ctx, (req.body ?? {}) as Row);
      const current = await readSettings(ctx);
      // Allowing a new file type widens what may be uploaded, so it asks to confirm your identity (E01-33).
      const added = (change.allowedExtensions ?? []).filter((x) => !current.allowedExtensions.includes(x));
      if (added.length) await requireRecentAuth({ db: ctx.db, audit: ctx.audit, settings: ctx.settings }, req, `allowing more file types (${added.join(', ')})`);
      if (change.maxBytes !== undefined && change.maxBytes !== current.maxBytes) {
        await ctx.settings.set(SETTING_MAX_BYTES, change.maxBytes, req);
      }
      if (change.allowedExtensions && change.allowedExtensions.join() !== current.allowedExtensions.join()) {
        await ctx.settings.set(SETTING_EXTENSIONS, change.allowedExtensions, req);
      }
      const s = await readSettings(ctx);
      return { maxBytes: s.maxBytes, allowedExtensions: s.allowedExtensions };
    });

    // ---------- list ----------

    app.get('/api/attachments', async (req) => {
      const { record_type, record_id } = req.query as Record<string, string>;
      const parent = await needParent(req, record_type, record_id, 'view');
      const rows = await db.query<Row>(
        `select * from attachments where record_type = $1 and record_id = $2 and deleted_at is null
         order by created_at desc, id`,
        [record_type, record_id],
      );
      return { rows: rows.map(present), canEdit: mayEdit(req, parent), today: todayInZone() };
    });

    // ---------- evidence about to expire, across every record the caller may see ----------

    app.get('/api/attachments/evidence-expiring', async (req) => {
      const asked = Number((req.query as Record<string, string>).days);
      const days = Number.isFinite(asked) ? Math.min(730, Math.max(1, Math.round(asked))) : 90;
      const today = todayInZone();
      const found = await db.query<Row>(
        `select *, (expires_on - $1::date)::int as days_left from attachments
         where deleted_at is null and kind = 'evidence' and expires_on is not null and expires_on <= $1::date + $2::int
         order by expires_on, file_name limit 2000`,
        [today, days],
      );
      const parents = new Map<string, Parent | undefined>();
      const rows: Row[] = [];
      for (const a of found) {
        const key = `${a.record_type}:${a.record_id}`;
        if (!parents.has(key)) parents.set(key, await findParent(req, a.record_type, a.record_id));
        const parent = parents.get(key);
        if (!parent) continue; // the record is gone, or the caller may not see it
        rows.push({
          ...present(a), days_left: a.days_left, expired: a.days_left < 0,
          record_label: parent.label, record_type_label: parent.def.label, record_route: `${parent.def.route}/${a.record_id}`,
        });
      }
      return { today, days, rows };
    });

    // ---------- upload ----------

    await app.register(async (scoped) => {
      // The file is the request body. Handing the stream straight to the handler means it is
      // never buffered in memory and the 10 MB limit on JSON bodies does not apply to it; the
      // handler enforces the configured limit itself while the bytes arrive.
      scoped.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

      scoped.put('/api/attachments/upload', async (req, reply) => {
        const q = req.query as Record<string, string>;
        const body = req.body as Readable | undefined;
        if (!body || typeof body.pipe !== 'function') {
          ctx.fail(415, 'unsupported_media_type', 'Send the file as the request body with the content type application/octet-stream.');
        }

        // Everything that can be decided without the content is decided before reading it.
        const parent = await needParent(req, q.record_type, q.record_id, 'edit');
        const prepared = await prepareFile(ctx, q.name);
        const fileName = prepared.ok ? prepared.file.fileName : prepared.fileName;
        const refuse = async (refusal: Refusal): Promise<never> => {
          if (refusal.audit) {
            await ctx.audit(req, {
              action: 'attachment.refused', recordType: parent.def.type, recordId: parent.row.id,
              summary: `File refused: ${fileName} (${refusal.reason})`,
            });
          }
          return ctx.fail(refusal.status, refusal.code, refusal.message);
        };
        if (!prepared.ok) return refuse(prepared.refusal);
        const meta = validateDescriptive(ctx, q);

        // Receive straight to storage, then check the content and scan it (intake.ts).
        const received = await receiveFile(ctx, prepared.file, body!, Number(req.headers['content-length']));
        if (!received.ok) return refuse(received.refusal);
        const file = received.file;
        if (file.scanUnavailable) {
          await ctx.audit(req, {
            action: 'attachment.scan_unavailable', recordType: parent.def.type, recordId: parent.row.id,
            summary: `File accepted without a malware scan: ${fileName} (malware scanner ${file.scanUnavailable.engine} failed: ${file.scanUnavailable.detail})`,
          });
        }

        // Accept.
        const row = await insertAttachment(db, file, {
          recordType: parent.def.type, recordId: parent.row.id, kind: meta.kind, description: meta.description,
          collectedOn: meta.collected_on, expiresOn: meta.expires_on, uploadedByName: req.user!.displayName, userId: req.user!.id,
        });
        await ctx.audit(req, {
          action: 'attachment.upload', recordType: parent.def.type, recordId: parent.row.id,
          summary: `${meta.kind === 'evidence' ? 'Evidence file' : 'File'} attached: ${fileName} (${formatBytes(file.size)})`,
          after: {
            attachment_id: row.id, file_name: fileName, size_bytes: file.size, sha256: file.sha256, kind: meta.kind,
            collected_on: meta.collected_on, expires_on: meta.expires_on, scan_status: row.scan_status,
          },
        });
        reply.code(201);
        return file.scanUnavailable ? { ...present(row), scan_warning: file.scanUnavailable.warning } : present(row);
      });
    });

    // ---------- download ----------

    app.get('/api/attachments/:id/download', {
      // Runs after the application-wide headers: a downloaded file gets the tightest policy there is.
      onSend: sandboxDownload,
    }, async (req, reply) => {
      const { att, parent } = await needAttachment(req, 'view');
      const problem = async (code: string, message: string, reason: string): Promise<never> => {
        await ctx.audit(req, {
          action: 'attachment.integrity_failure', recordType: parent.def.type, recordId: parent.row.id,
          summary: `File could not be served: ${att.file_name} (${reason})`, after: { attachment_id: att.id },
        });
        return ctx.fail(500, code, message);
      };
      return sendStoredFile(ctx, reply, att, problem, async () => {
        if (!parent.restricted) return;
        await ctx.audit(req, {
          action: 'attachment.download', recordType: parent.def.type, recordId: parent.row.id,
          summary: `File downloaded from a restricted record: ${att.file_name}`, after: { attachment_id: att.id },
        });
      });
    });

    // ---------- describe and remove ----------

    app.patch('/api/attachments/:id', async (req) => {
      const { att, parent } = await needAttachment(req, 'edit');
      const next = validateDescriptive(ctx, (req.body ?? {}) as Row, att);
      const before: Row = {};
      const after: Row = {};
      for (const k of ['kind', 'description', 'collected_on', 'expires_on'] as const) {
        if ((att[k] ?? null) !== next[k]) { before[k] = att[k] ?? null; after[k] = next[k]; }
      }
      if (!Object.keys(after).length) return present(att);
      const row = (await db.one<Row>(
        `update attachments set kind = $2, description = $3, collected_on = $4, expires_on = $5,
           updated_at = now(), updated_by = $6 where id = $1 returning *`,
        [att.id, next.kind, next.description, next.collected_on, next.expires_on, req.user!.id],
      ))!;
      await ctx.audit(req, {
        action: 'attachment.update', recordType: parent.def.type, recordId: parent.row.id,
        summary: `File details changed: ${att.file_name}`, before: { attachment_id: att.id, ...before }, after,
      });
      return present(row);
    });

    // Soft delete: the row is marked and the stored bytes are kept for the purge period
    // (File settings), during which an administrator can put the file back.
    app.delete('/api/attachments/:id', async (req) => {
      const { att, parent } = await needAttachment(req, 'edit');
      await db.query(`update attachments set deleted_at = now(), removed_reason = 'removed', updated_at = now(), updated_by = $2 where id = $1`, [att.id, req.user!.id]);
      await ctx.audit(req, {
        action: 'attachment.delete', recordType: parent.def.type, recordId: parent.row.id,
        summary: `File removed: ${att.file_name}`,
        before: { attachment_id: att.id, file_name: att.file_name, size_bytes: att.size_bytes, sha256: att.sha256, kind: att.kind },
      });
      return { ok: true };
    });
  },
};
export default mod;
