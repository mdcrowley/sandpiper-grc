// Attachments: files on any record, kept outside the database.
//
// Who may do what follows the record the file belongs to: seeing the record lets you list and
// download its files; `<module>.edit` on it lets you add, describe and remove them. A record
// the caller may not see (including a restricted one) answers "not found" for everything, so
// neither its files nor their existence leak.
import type { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import { assertNotHeld } from '../../core/holds.ts';
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
import { linkCheckDays, runLinkCheckReminders } from './linkReminders.ts';
import { auditAddress, isLink, linkChange, registerLinkRoutes } from './links.ts';
import { insertAttachment, prepareFile, receiveFile, sandboxDownload, sendStoredFile, type Refusal } from './intake.ts';
import { queueFileTexts, registerFileText } from './text.ts';
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
    // The text inside PDF, Word and plain-text files, for search (E41-16, text.ts).
    await registerFileText(ctx);

    // Daily: files of records deleted for good are marked removed, and removed files past the
    // purge period are deleted from storage. A job-queue schedule (Administration > Background jobs).
    await scheduleWork(ctx, 'attachments.housekeeping', async () => {
      const r = await dailyHousekeeping(ctx);
      return { orphans: r.orphans, purged: r.purge.purged, failed: r.purge.failed };
    }, { every: DAY, firstRunInMs: 120_000, leaseSeconds: 1800 });

    // Daily: evidence files about to expire remind their record's owner (E14-18, evidenceReminders.ts).
    // Links not checked for a while (setting attachments.link_check_days) remind the same owner (E36-05).
    await scheduleWork(ctx, 'attachments.evidence_reminders', async () => {
      const files = await runEvidenceFileReminders(ctx);
      const links = await runLinkCheckReminders(ctx);
      return { ...files, links };
    }, { every: DAY, firstRunInMs: 140_000 });

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

    /**
     * The parents of many files at once, keyed `type:id`, with the same rule as `findParent`: one
     * query per record type, not one per record (E40-09). Records gone or not visible are left out.
     */
    async function findParents(req: FastifyRequest, refs: Row[]): Promise<Map<string, Parent>> {
      const out = new Map<string, Parent>();
      const byType = new Map<string, Set<string>>();
      for (const r of refs) {
        if (typeof r.record_type !== 'string' || typeof r.record_id !== 'string' || !UUID_RE.test(r.record_id)) continue;
        if (!byType.has(r.record_type)) byType.set(r.record_type, new Set());
        byType.get(r.record_type)!.add(r.record_id);
      }
      for (const [type, ids] of byType) {
        const def = ctx.resources.get(type);
        if (!def || !ctx.can(req.user, `${def.module}.view`)) continue;
        if (def.restricted === true && !ctx.can(req.user, 'security.view')) continue;
        const rows = await db.query<Row>(
          `select * from ${def.table} where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(type, req.user)}`, [[...ids]]);
        for (const row of rows) {
          const restricted = def.restricted === true || (def.restricted === 'flag' && row.restricted === true);
          const label = [def.ref && row[def.ref.field], row[def.titleField]].filter(Boolean).join(' ') || def.label;
          out.set(`${type}:${row.id}`, { def, row, restricted, label });
        }
      }
      return out;
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
        `select a.*, u.display_name as checked_by_name, x.status as text_status
         from attachments a left join users u on u.id = a.checked_by left join attachment_texts x on x.attachment_id = a.id
         where a.record_type = $1 and a.record_id = $2 and a.deleted_at is null
         order by a.created_at desc, a.id`,
        [record_type, record_id],
      );
      return { rows: rows.map((r) => ({ ...present(r), text_status: r.text_status ?? null })), canEdit: mayEdit(req, parent), today: todayInZone(), linkCheckDays: await linkCheckDays(ctx) };
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
      const parents = await findParents(req, found);
      const rows: Row[] = [];
      for (const a of found) {
        const parent = parents.get(`${a.record_type}:${a.record_id}`);
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
        // Its text is read for search in the background (E41-16).
        await queueFileTexts(ctx);
        reply.code(201);
        return file.scanUnavailable ? { ...present(row), scan_warning: file.scanUnavailable.warning } : present(row);
      });
    });

    // ---------- download ----------

    const serveFile = (inline: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
      const { att, parent } = await needAttachment(req, 'view');
      // A link has nothing stored here: its address is in the list (E36-05).
      if (isLink(att)) ctx.fail(409, 'is_link', 'This is a link to a document kept elsewhere. Open its address instead.');
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
          action: inline ? 'attachment.preview' : 'attachment.download', recordType: parent.def.type, recordId: parent.row.id,
          summary: `File ${inline ? 'previewed' : 'downloaded'} from a restricted record: ${att.file_name}`, after: { attachment_id: att.id },
        });
      }, { inline });
    };

    // Both run after the application-wide headers: a file gets the tightest policy there is
    // (`default-src 'none'; sandbox`), whether it is downloaded or shown in place.
    app.get('/api/attachments/:id/download', { onSend: sandboxDownload }, serveFile(false));
    // E41-16: images and PDFs shown in the browser (`Content-Disposition: inline`, only for those types).
    app.get('/api/attachments/:id/preview', { onSend: sandboxDownload }, serveFile(true));
    ctx.describeRoute({
      method: 'GET', path: '/api/attachments/:id/preview', tag: 'Attachments',
      summary: 'Show an image or a PDF in the browser',
      description: "Needs view permission on the record the file belongs to. Served in place (`Content-Disposition: inline`) under its fixed type, only for PNG, JPEG, GIF, WebP and BMP images and PDFs (the file's `preview` field); any other file answers 415 `no_preview`. The checksum is verified first, and the answer carries `Content-Security-Policy: default-src 'none'; sandbox`. Previews from restricted records are audited.",
    });

    // ---------- describe and remove ----------

    app.patch('/api/attachments/:id', async (req) => {
      const { att, parent } = await needAttachment(req, 'edit');
      const next = validateDescriptive(ctx, (req.body ?? {}) as Row, att);
      // A link's address and title can be changed too (E36-05); an uploaded file's name cannot.
      const link = isLink(att) ? linkChange(ctx, att, (req.body ?? {}) as Row) : {};
      const before: Row = {};
      const after: Row = {};
      for (const k of ['kind', 'description', 'collected_on', 'expires_on'] as const) {
        if ((att[k] ?? null) !== next[k]) { before[k] = att[k] ?? null; after[k] = next[k]; }
      }
      if (link.link_url) { before.link = auditAddress(att.link_url); after.link = auditAddress(link.link_url); }
      if (link.link_title) { before.title = att.link_title; after.title = link.link_title; }
      if (!Object.keys(after).length) return present(att);
      const row = (await db.one<Row>(
        `update attachments set kind = $2, description = $3, collected_on = $4, expires_on = $5,
           link_url = coalesce($7, link_url), link_title = coalesce($8, link_title), file_name = coalesce($8, file_name),
           updated_at = now(), updated_by = $6 where id = $1 returning *`,
        [att.id, next.kind, next.description, next.collected_on, next.expires_on, req.user!.id, link.link_url ?? null, link.link_title ?? null],
      ))!;
      await ctx.audit(req, {
        action: 'attachment.update', recordType: parent.def.type, recordId: parent.row.id,
        summary: `${isLink(att) ? 'Link' : 'File'} details changed: ${att.file_name}`, before: { attachment_id: att.id, ...before }, after,
      });
      return present(row);
    });

    // Soft delete: the row is marked and the stored bytes are kept for the purge period
    // (File settings), during which an administrator can put the file back.
    registerLinkRoutes(ctx, { needParent, needAttachment });

    app.delete('/api/attachments/:id', async (req) => {
      const { att, parent } = await needAttachment(req, 'edit');
      // The files of a record under a legal hold stay (wave 11 C1).
      await assertNotHeld(db, parent.def.type, parent.row.id, 'remove_file');
      await db.query(`update attachments set deleted_at = now(), removed_reason = 'removed', updated_at = now(), updated_by = $2 where id = $1`, [att.id, req.user!.id]);
      await ctx.audit(req, {
        action: 'attachment.delete', recordType: parent.def.type, recordId: parent.row.id,
        summary: `${isLink(att) ? 'Link' : 'File'} removed: ${att.file_name}`,
        before: { attachment_id: att.id, file_name: att.file_name, size_bytes: att.size_bytes, sha256: att.sha256, kind: att.kind },
      });
      return { ok: true };
    });
  },
};
export default mod;
