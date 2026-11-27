// Evidence by link (E36-05): a document kept in the organization's own document store is linked from
// a record instead of uploaded, with the date someone last checked it is still there and current.
//
// A link is an attachments row with storage_driver 'link' (stores.ts): it has an address and a title,
// no stored bytes, and follows the same rules as a file (seeing the record lets you see it; editing the
// record lets you add, change, check and remove it; a held record keeps it). The server never fetches
// the address: it only checks its shape (http or https, at most 1,000 characters, no user name or
// password in it). Audit events keep the address's host and a fingerprint, never the whole address,
// because sharing links often carry their own secret.
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { redactWebhookUrl } from '../../core/webhooks.ts';
import { present, validateDescriptive } from './service.ts';
import { LINK_DRIVER } from './stores.ts';

export const MAX_LINK_LENGTH = 1000;
export const MAX_TITLE_LENGTH = 200;
export const SETTING_LINK_CHECK_DAYS = 'attachments.link_check_days';
export const DEFAULT_LINK_CHECK_DAYS = 90;

interface Parent { def: ResourceDef; row: Row; restricted: boolean; label: string }
interface Helpers {
  needParent(req: FastifyRequest, type: unknown, id: unknown, action: 'view' | 'edit'): Promise<Parent>;
  needAttachment(req: FastifyRequest, action: 'view' | 'edit'): Promise<{ att: Row; parent: Parent }>;
}

export const isLink = (att: Row) => att.storage_driver === LINK_DRIVER;

/** Checks an address. Returns the normalized address, or a message for the person. */
export function checkLinkAddress(raw: unknown): { url: string } | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { error: 'Enter the address of the document.' };
  if (text.length > MAX_LINK_LENGTH) return { error: `Keep the address under ${MAX_LINK_LENGTH.toLocaleString('en-US')} characters.` };
  let u: URL;
  try { u = new URL(text); } catch { return { error: 'Enter a full address starting with https:// or http://.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only web addresses (https:// or http://) can be linked.' };
  if (!u.hostname) return { error: 'The address has no host name.' };
  if (u.username || u.password) return { error: 'Leave the user name and password out of the address; people sign in to the document store themselves.' };
  const url = u.toString();
  if (url.length > MAX_LINK_LENGTH) return { error: `Keep the address under ${MAX_LINK_LENGTH.toLocaleString('en-US')} characters.` };
  return { url };
}

/** The title shown for a link: the one given, or the address's host and last path segment. */
function titleOf(raw: unknown, url: string): { title: string } | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length > MAX_TITLE_LENGTH) return { error: `Keep the title under ${MAX_TITLE_LENGTH} characters.` };
  if (text) return { title: text };
  const u = new URL(url);
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').slice(0, 120);
  return { title: last ? `${last} (${u.hostname})` : u.hostname };
}

/** What the audit log keeps of an address: scheme, host and a fingerprint. */
const auditAddress = (url: string) => redactWebhookUrl(url) as string;

export function registerLinkRoutes(ctx: ModuleContext, h: Helpers) {
  const { app, db } = ctx;

  app.post('/api/attachments/link', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const parent = await h.needParent(req, b.record_type, b.record_id, 'edit');
    const fields: Record<string, string> = {};
    const address = checkLinkAddress(b.url);
    if ('error' in address) fields.url = address.error;
    const title = 'url' in address ? titleOf(b.title, address.url) : null;
    if (title && 'error' in title) fields.title = title.error;
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const meta = validateDescriptive(ctx, { ...b, kind: b.evidence === true || b.kind === 'evidence' ? 'evidence' : 'file' });
    const url = (address as { url: string }).url;
    const name = (title as { title: string }).title;
    const row = (await db.one<Row>(
      `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256, storage_driver, storage_key,
         kind, description, collected_on, expires_on, scan_status, uploaded_by_name, created_by, updated_by,
         link_url, link_title, last_checked_on, checked_by)
       values ($1, $2, $3, '', 'text/uri-list', 0, '', $4, $5, $6, $7, $8, $9, 'not_applicable', $10, $11, $11, $12, $3, $13, $11)
       returning *`,
      [parent.def.type, parent.row.id, name, LINK_DRIVER, `link/${randomUUID()}`, meta.kind, meta.description, meta.collected_on,
        meta.expires_on, actorOf(req).name, actorOf(req).id, url, todayInZone()],
    ))!;
    await ctx.audit(req, {
      action: 'attachment.link', recordType: parent.def.type, recordId: parent.row.id,
      summary: `${meta.kind === 'evidence' ? 'Evidence link' : 'Link'} added: ${name}`,
      after: { attachment_id: row.id, link: auditAddress(url), kind: meta.kind, collected_on: meta.collected_on, expires_on: meta.expires_on },
    });
    reply.code(201);
    return present({ ...row, checked_by_name: req.user!.displayName });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/attachments/link', summary: 'Link a document kept elsewhere to a record, instead of uploading a copy',
    body: '{ record_type, record_id, url, title?, evidence?, description?, collected_on?, expires_on? }',
    response: 'The new attachment, with is_link, link_url, link_title and last_checked_on',
    description: 'Needs edit permission on the record (the same check as an upload). The address must be http or https, at most 1,000 characters, with no user name or password; the server never fetches it. The link counts as checked today.',
  });

  app.post('/api/attachments/:id/checked', async (req) => {
    const { att, parent } = await h.needAttachment(req, 'edit');
    if (!isLink(att)) ctx.fail(409, 'not_a_link', 'Only a link has a date it was last checked.');
    const today = todayInZone();
    const row = (await db.one<Row>(
      `update attachments set last_checked_on = $2, checked_by = $3, link_reminded_for = null, updated_at = now(), updated_by = $3
       where id = $1 returning *`, [att.id, today, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'attachment.checked', recordType: parent.def.type, recordId: parent.row.id,
      summary: `Link checked and still current: ${att.file_name}`,
      before: { attachment_id: att.id, last_checked_on: att.last_checked_on ?? null }, after: { last_checked_on: today },
    });
    return present({ ...row, checked_by_name: req.user!.displayName });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/attachments/:id/checked', summary: 'Record that a linked document was checked today and is still current',
    response: 'The attachment', description: 'Needs edit permission on the record. 409 not_a_link for an uploaded file.',
  });
}

/** Validates a change to a link's address or title (PATCH /api/attachments/:id). Returns what to store. */
export function linkChange(ctx: ModuleContext, att: Row, body: Row): { link_url?: string; link_title?: string } {
  const out: { link_url?: string; link_title?: string } = {};
  const fields: Record<string, string> = {};
  if (body.url !== undefined) {
    const a = checkLinkAddress(body.url);
    if ('error' in a) fields.url = a.error;
    else if (a.url !== att.link_url) out.link_url = a.url;
  }
  if (body.title !== undefined) {
    const t = titleOf(body.title, out.link_url ?? att.link_url);
    if ('error' in t) fields.title = t.error;
    else if (t.title !== att.link_title) out.link_title = t.title;
  }
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  return out;
}

export { auditAddress };
