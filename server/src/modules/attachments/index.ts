// Attachments: files on any record, kept outside the database.
//
// Who may do what follows the record the file belongs to: seeing the record lets you list and
// download its files; `<module>.edit` on it lets you add, describe and remove them. A record
// the caller may not see (including a restricted one) answers "not found" for everything, so
// neither its files nor their existence leak.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleDef, ResourceDef, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import {
  BLOCKED_EXTENSIONS, checkContent, contentDisposition, contentTypeFor, downloadContentType, extensionOf, sanitiseFileName,
} from './filetypes.ts';
import { registerFileAdmin } from './admin.ts';
import { registerBackups } from './backups.ts';
import { clamdScanner } from './clamd.ts';
import { clamdConfig, readScanner } from './config.ts';
import { dailyHousekeeping } from './housekeeping.ts';
import { makeScannerRegistry, type ScanResult } from './scanner.ts';
import {
  formatBytes, Meter, present, readSettings, SETTING_EXTENSIONS, SETTING_MAX_BYTES, TooLargeError,
  validateDescriptive, validateSettings,
} from './service.ts';
import { newStorageKey, type FileStorage } from './storage.ts';
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
    registerBackups(ctx);

    // Daily: files of records deleted for good are marked removed, and removed files past the
    // purge period are deleted from storage. In process, like the other daily jobs (see E14-12).
    let first: NodeJS.Timeout | null = null;
    let daily: NodeJS.Timeout | null = null;
    app.addHook('onReady', async () => {
      if (process.env.VITEST) return;
      const run = () => {
        void dailyHousekeeping(ctx)
          .then((r) => { if (r.orphans || r.purge.purged || r.purge.failed) console.log(`[attachments] housekeeping: ${r.orphans} file(s) of deleted records marked removed, ${r.purge.purged} purged, ${r.purge.failed} failed`); })
          .catch((err) => console.error('[attachments] housekeeping failed:', err));
      };
      first = setTimeout(run, 120_000);
      daily = setInterval(run, DAY);
      first.unref();
      daily.unref();
    });
    app.addHook('onClose', async () => {
      if (first) clearTimeout(first);
      if (daily) clearInterval(daily);
    });

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
        const settings = await readSettings(ctx);
        const fileName = sanitiseFileName(q.name);
        const extension = extensionOf(fileName);
        const refuse = async (status: number, code: string, message: string, reason: string): Promise<never> => {
          await ctx.audit(req, {
            action: 'attachment.refused', recordType: parent.def.type, recordId: parent.row.id,
            summary: `File refused: ${fileName} (${reason})`,
          });
          return ctx.fail(status, code, message);
        };
        if (!extension || BLOCKED_EXTENSIONS.has(extension) || !settings.allowedExtensions.includes(extension)) {
          await refuse(
            415, 'type_not_allowed',
            extension
              ? `Files of type .${extension} cannot be attached. Allowed types: ${settings.allowedExtensions.join(', ')}.`
              : `The file name needs an extension such as .pdf. Allowed types: ${settings.allowedExtensions.join(', ')}.`,
            'type not allowed',
          );
        }
        const meta = validateDescriptive(ctx, q);
        const tooLarge = `The file is larger than the limit of ${formatBytes(settings.maxBytes)}.`;
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > settings.maxBytes) await refuse(413, 'too_large', tooLarge, 'too large');

        // Receive: straight to storage, counting and hashing on the way.
        let storage: FileStorage;
        try {
          storage = stores.current();
        } catch (err) {
          console.error('[attachments] no storage for uploads:', (err as Error).message);
          return ctx.fail(503, 'storage_unavailable', 'Files cannot be stored at the moment. Tell an administrator.');
        }
        const key = newStorageKey();
        const meter = new Meter(settings.maxBytes);
        body!.on('error', (err) => meter.destroy(err));
        try {
          await storage.put(key, body!.pipe(meter));
        } catch (err) {
          await storage.delete(key).catch(() => undefined);
          if (err instanceof TooLargeError) await refuse(413, 'too_large', tooLarge, 'too large');
          throw err;
        }
        const size = meter.size;
        const sha256 = meter.digest();
        const discard = async (status: number, code: string, message: string, reason: string) => {
          await storage.delete(key).catch(() => undefined);
          return refuse(status, code, message, reason);
        };
        if (size === 0) await discard(400, 'empty_file', 'The file is empty.', 'empty');

        // Check: the content against the name, then the malware scanner.
        const verdict = checkContent(extension, meter.head);
        if (!verdict.ok) await discard(415, verdict.code, verdict.message, verdict.code === 'executable' ? 'program or script' : 'content does not match the type');

        const scanner = scanners.current();
        let scan: ScanResult;
        try {
          scan = await scanner.scan({ fileName, extension, size, sha256, open: () => storage.get(key) });
        } catch (err) {
          scan = { verdict: 'error', detail: err instanceof Error ? err.message : 'scanner failed' };
        }
        if (scan.verdict === 'infected') {
          await discard(422, 'malware', 'This file was refused by the malware scanner.', `malware scanner ${scanner.name}: ${scan.detail ?? 'infected'}`);
        }
        let scanWarning: string | null = null;
        if (scan.verdict === 'error') {
          // The administrator decides: refuse the file, or accept it as "Not scanned" with a warning.
          const policy = (await readScanner(ctx)).whenUnavailable;
          if (policy === 'refuse') {
            await discard(503, 'scan_failed', 'The file could not be checked for malware, so it was not accepted. Try again later.', `malware scanner ${scanner.name} failed: ${scan.detail ?? 'no detail'}`);
          }
          scanWarning = 'The malware scanner could not check this file, so it was accepted without a scan and marked "Not scanned".';
          await ctx.audit(req, {
            action: 'attachment.scan_unavailable', recordType: parent.def.type, recordId: parent.row.id,
            summary: `File accepted without a malware scan: ${fileName} (malware scanner ${scanner.name} failed: ${scan.detail ?? 'no detail'})`,
          });
        }
        const scanned = scan.verdict === 'clean';

        // Accept.
        const row = (await db.one<Row>(
          `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256,
             storage_driver, storage_key, kind, description, collected_on, expires_on, scan_status, scan_engine, scanned_at,
             uploaded_by_name, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,${scanned ? 'now()' : 'null'},$16,$17,$17) returning *`,
          [
            parent.def.type, parent.row.id, fileName, extension, contentTypeFor(extension), size, sha256, storage.driver, key,
            meta.kind, meta.description, meta.collected_on, meta.expires_on, scanned ? 'clean' : 'not_scanned',
            scanned ? scanner.name : null, req.user!.displayName, req.user!.id,
          ],
        ))!;
        await ctx.audit(req, {
          action: 'attachment.upload', recordType: parent.def.type, recordId: parent.row.id,
          summary: `${meta.kind === 'evidence' ? 'Evidence file' : 'File'} attached: ${fileName} (${formatBytes(size)})`,
          after: {
            attachment_id: row.id, file_name: fileName, size_bytes: size, sha256, kind: meta.kind,
            collected_on: meta.collected_on, expires_on: meta.expires_on, scan_status: row.scan_status,
          },
        });
        reply.code(201);
        return scanWarning ? { ...present(row), scan_warning: scanWarning } : present(row);
      });
    });

    // ---------- download ----------

    app.get('/api/attachments/:id/download', {
      // Runs after the application-wide headers: a downloaded file gets the tightest policy there is.
      onSend: async (_req, reply, payload) => {
        reply.header('content-security-policy', "default-src 'none'; sandbox");
        return payload;
      },
    }, async (req, reply) => {
      const { att, parent } = await needAttachment(req, 'view');
      const problem = async (code: string, message: string, reason: string): Promise<never> => {
        await ctx.audit(req, {
          action: 'attachment.integrity_failure', recordType: parent.def.type, recordId: parent.row.id,
          summary: `File could not be served: ${att.file_name} (${reason})`, after: { attachment_id: att.id },
        });
        return ctx.fail(500, code, message);
      };
      let storage: FileStorage;
      try {
        storage = stores.forDriver(att.storage_driver);
      } catch (err) {
        console.error('[attachments] download:', (err as Error).message);
        return ctx.fail(503, 'storage_unavailable', 'The store that holds this file cannot be reached. Tell an administrator.');
      }
      const stat = await storage.stat(att.storage_key);
      if (!stat) await problem('file_missing', 'The stored file is missing. Tell an administrator.', 'stored file missing');

      // Verify before sending anything: read once to check the checksum, then again to send.
      const hash = createHash('sha256');
      for await (const chunk of await storage.get(att.storage_key)) hash.update(chunk as Buffer);
      if (hash.digest('hex') !== att.sha256) {
        await problem('integrity', 'This file failed its integrity check and was not sent. Tell an administrator.', 'checksum mismatch');
      }

      if (parent.restricted) {
        await ctx.audit(req, {
          action: 'attachment.download', recordType: parent.def.type, recordId: parent.row.id,
          summary: `File downloaded from a restricted record: ${att.file_name}`, after: { attachment_id: att.id },
        });
      }
      reply.header('content-type', downloadContentType(att.content_type));
      reply.header('content-length', stat!.size);
      reply.header('content-disposition', contentDisposition(att.file_name));
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cache-control', 'private, no-store');
      return reply.send(await storage.get(att.storage_key));
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
