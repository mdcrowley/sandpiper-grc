// Controlled copies (E43): a version printed as a PDF with the document-control block on it, and the
// original file a version was made from.
//
// The PDF carries, under the title, the document number, version and its label, the status line
// (EFFECTIVE, DRAFT, SUPERSEDED, OBSOLETE), the dates, "Restricted distribution" for a restricted
// document, who printed it and when, and "Uncontrolled when printed: the current version is in the
// document library". Every page has the organization's footer and page numbers (core PdfBuilder,
// tagged PDF/UA); a restricted document also gets the builder's restricted marking on every page.
// Every print and download is audited. A version kept as a PDF prints as that PDF with the control block
// stamped on every page (header, footer with page numbers, DRAFT/SUPERSEDED/OBSOLETE mark); a text
// version printed by the builder carries the same word diagonally on every page (E43-16).
//
// An issued paper copy (E46-57, copies.ts) prints as the same PDF for its holder: "Controlled copy N" and
// who holds it (and where) at the top of every page and in the control block, in place of "Uncontrolled
// when printed", for the version the copy was issued of. A recalled copy, or one of a version no longer
// in force, is not printed again.
import type { FastifyRequest } from 'fastify';
import { addAttachmentGuard } from '../../core/attachment-guards.ts';
import { PDF_TYPE, PdfBuilder } from '../../core/export/pdf.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { readableSql, type AccessTables } from './access.ts';
import { stampPdf, StampError, type StampOptions } from './convert/index.ts';
import { READER_STATUSES } from './versions.ts';

/** Originals larger than this print as the cover sheet (the stamper refuses larger files anyway). */
const STAMP_SOURCE_MAX = 50 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const T = 'Documents';
const ymd = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const shown = (d: unknown) => { const s = ymd(d); return s ? displayDate(s) : ''; };

/** The status line of a printed version. */
export function statusMark(policy: Row, version: Row): string {
  if (policy.status === 'retired' || version.status === 'withdrawn') return 'OBSOLETE: not for use';
  if (version.status === 'superseded') return `SUPERSEDED on ${shown(version.superseded_on) || 'a later date'}: not for use`;
  if (version.status === 'published') return 'EFFECTIVE';
  if (version.status === 'approved') return 'APPROVED, NOT YET EFFECTIVE';
  return 'DRAFT: not approved';
}

/** The diagonal word on a printed version (E43-16): OBSOLETE, SUPERSEDED or DRAFT (not yet in force); none for the effective version. */
export function diagonalMark(policy: Row, version: Row): 'DRAFT' | 'OBSOLETE' | 'SUPERSEDED' | null {
  if (policy.status === 'retired' || version.status === 'withdrawn') return 'OBSOLETE';
  if (version.status === 'superseded') return 'SUPERSEDED';
  return READER_STATUSES.includes(version.status) ? null : 'DRAFT';
}

export function registerPrintRoutes(ctx: ModuleContext, tables: AccessTables): void {
  const { app, db } = ctx;
  const editor = (req: FastifyRequest) => ctx.can(req.user, 'policies.edit') || ctx.can(req.user, 'policies.approve');

  async function docAndVersion(req: FastifyRequest): Promise<{ policy: Row; version: Row }> {
    const { id, vid } = req.params as Row;
    const policy = typeof id === 'string' && UUID.test(id)
      ? await db.one<Row>(`select * from policies p where p.id = $1 and p.deleted_at is null and ${readableSql(req.user, 'p', tables)}`, [id]) : undefined;
    if (!policy) ctx.fail(404, 'not_found', 'Document not found.');
    const version = typeof vid === 'string' && UUID.test(vid)
      ? await db.one<Row>('select * from policy_versions where id = $1 and policy_id = $2', [vid, policy!.id]) : undefined;
    // Readers print what has been in force; drafts only for people who write or approve documents.
    if (!version || (!READER_STATUSES.includes(version.status) && !editor(req))) ctx.fail(404, 'not_found', 'Version not found.');
    return { policy: policy!, version: version! };
  }

  // The originals of versions (E43-17): one that a released version was made from stays, and its Word
  // original (an editable copy outside document control) goes only to people who write or approve
  // documents. Readers read the text, the PDF and its preview.
  const originalOf = (attId: string) => db.one<Row>(
    `select status from policy_versions where source_attachment_id = $1 or rendition_attachment_id = $1
      order by case when status in ('approved','published','superseded','withdrawn') then 0 else 1 end limit 1`, [attId]);
  addAttachmentGuard(app, {
    recordType: 'policy',
    async beforeRemove(_req, att) {
      const v = await originalOf(att.id);
      if (v && ['approved', 'published', 'superseded', 'withdrawn'].includes(v.status)) {
        ctx.fail(409, 'in_use', 'This file is the original of an approved version and cannot be removed.');
      }
    },
    async beforeDownload(req, att) {
      if (editor(req)) return;
      const v = await originalOf(att.id);
      if (!v) return;
      // Readers may keep the PDF of a version that has been in force; never a draft, never a Word file.
      if (String(att.extension ?? '').toLowerCase() === 'pdf' && READER_STATUSES.includes(v.status)) return;
      ctx.fail(403, 'forbidden', 'The original file of a version is only for the people who write or approve documents.');
    },
  });

  /** The version's original PDF with the control block stamped on, or null when it has none or cannot be stamped. */
  async function stampedOriginal(policy: Row, version: Row, options: StampOptions): Promise<Buffer | null> {
    const id = version.rendition_attachment_id ?? version.source_attachment_id;
    if (!id) return null;
    const att = await db.one<Row>(
      `select * from attachments where id = $1 and record_type = 'policy' and record_id = $2 and deleted_at is null and storage_driver <> 'link'`,
      [id, policy.id]);
    if (!att || String(att.extension ?? '').toLowerCase() !== 'pdf' || Number(att.size_bytes) > STAMP_SOURCE_MAX) return null;
    const chunks: Buffer[] = [];
    for await (const c of await app.attachmentStores.forDriver(att.storage_driver).get(att.storage_key)) chunks.push(c as Buffer);
    try {
      return await stampPdf(Buffer.concat(chunks), options);
    } catch (err) {
      if (err instanceof StampError) return null;
      throw err;
    }
  }

  /** The controlled-copy PDF of a version; for an issued paper copy, with its number and holder. */
  async function versionPdf(req: FastifyRequest, policy: Row, version: Row, copy: Row | null): Promise<{ file: Buffer; mark: string; vlabel: string; number: string | null }> {
    const appName = String(await ctx.settings.get('app.name', 'Sandpiper GRC'));
    const number = policy.doc_number ?? policy.ref;
    const restricted = policy.access === 'restricted';
    const mark = statusMark(policy, version);
    const vlabel = `Version ${version.version}${version.version_label ? ` (${version.version_label})` : ''}`;
    const dates = [
      version.effective_on ? `Effective ${shown(version.effective_on)}` : null,
      version.superseded_on ? `in force until ${shown(version.superseded_on)}` : null,
      version.approved_on ? `approved ${shown(version.approved_on)}${version.approved_by_name ? ` by ${version.approved_by_name}` : ''}` : null,
      version.approval_body ? [version.approval_body, version.approval_reference].filter(Boolean).join(', ') : null,
    ].filter(Boolean).join(' · ');
    const printed = `Printed ${displayDate(dayInZone())} by ${req.user!.displayName}`;
    const holder = copy ? `${copy.holder_name}${copy.location ? ` (${copy.location})` : ''}` : '';
    const copyLine = copy ? `Controlled copy ${copy.copy_number} · ${holder}` : null;
    const pdf = new PdfBuilder({
      title: policy.title, subtitle: [number, vlabel].filter(Boolean).join(' · '),
      meta: [
        mark,
        ...(dates ? [dates] : []),
        ...(restricted ? ['Restricted distribution: only for the people this document is issued to.'] : []),
        copy
          ? `Controlled copy ${copy.copy_number}, issued to ${holder} on ${shown(copy.issued_on)}. ${printed}. Return this copy when it is recalled; the current version is in the document library.`
          : `${printed}. Uncontrolled when printed: the current version is in the document library.`,
      ],
      watermark: restricted ? `${number ?? ''} · Restricted distribution` : null,
      pageLine: copyLine,
      // A printed text version carries its status diagonally, as a stamped PDF original does (E43-16).
      mark: diagonalMark(policy, version),
      appName, author: appName, branding: await printBranding(db),
    });
    // A version kept as a PDF prints as that PDF with the control block stamped on every page
    // (E43-08); a PDF that cannot be stamped (protected, too large) falls back to the cover sheet.
    const stamped = version.content_kind === 'file' && !String(version.body ?? '').trim()
      ? await stampedOriginal(policy, version, {
        header: [number, policy.title, vlabel, copyLine].filter(Boolean).join(' · '),
        footer: copy
          ? `${mark.split(':')[0]} · Controlled copy ${copy.copy_number} · ${printed} · Page {page} of {pages}`
          : `${mark.split(':')[0]} · ${printed} · Uncontrolled when printed · Page {page} of {pages}`,
        watermark: diagonalMark(policy, version),
        restricted,
      })
      : null;
    if (version.status !== 'published' || policy.status === 'retired') pdf.note(`${mark}.`);
    if (stamped) {
      // Nothing more to build: the stamped original is the controlled copy.
    } else if (version.content_kind === 'file' && !String(version.body ?? '').trim()) {
      pdf.paragraph('This version is kept as a file (its original). Download the original from the document library to read it; this page is its cover sheet.');
    } else {
      pdf.markdown(String(version.body ?? ''));
    }
    if (version.change_summary) { pdf.heading('Changes in this version', 2); pdf.paragraph(String(version.change_summary)); }
    return { file: stamped ?? await pdf.finish(), mark, vlabel, number: number ?? null };
  }

  app.get('/api/policies/:id/versions/:vid/pdf', async (req, reply) => {
    const { policy, version } = await docAndVersion(req);
    const { file, mark, vlabel, number } = await versionPdf(req, policy, version, null);
    await ctx.audit(req, {
      action: 'policy.print', recordType: 'policy', recordId: policy.id,
      summary: `${[number, policy.title].filter(Boolean).join(' ')} ${vlabel.toLowerCase()} printed (${mark.split(':')[0].toLowerCase()})`,
      after: { version: Number(version.version), status: version.status },
    });
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="${String(number ?? 'document').replace(/[^A-Za-z0-9-]/g, '')}-v${version.version}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(file);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/versions/:vid/pdf', tag: T,
    summary: 'A version as a controlled-copy PDF (readers of the document; drafts only for people who write or approve documents). Audited.',
    description: 'Under the title: number, version, status line (EFFECTIVE, DRAFT, SUPERSEDED, OBSOLETE), dates, restricted distribution, who printed it and "Uncontrolled when printed".',
  });

  // An issued paper copy printed for its holder (E46-57): its number and holder on every page.
  app.get('/api/policies/:id/copies/:cid/pdf', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => {
    const { id, cid } = req.params as Row;
    const policy = typeof id === 'string' && UUID.test(id)
      ? await db.one<Row>(`select * from policies p where p.id = $1 and p.deleted_at is null and ${readableSql(req.user, 'p', tables)}`, [id]) : undefined;
    if (!policy || !(await ctx.resources.find('policy', policy.id, req.user))) return ctx.fail(404, 'not_found', 'Document not found.');
    const copy = typeof cid === 'string' && UUID.test(cid)
      ? await db.one<Row>('select * from document_copies where id = $1 and policy_id = $2 and deleted_at is null', [cid, policy.id]) : undefined;
    if (!copy) return ctx.fail(404, 'not_found', 'Copy not found.');
    if (copy.recalled_on) return ctx.fail(409, 'recalled', `Copy ${copy.copy_number} was recalled, so it is not printed again.`);
    const version = await db.one<Row>('select * from policy_versions where id = $1 and policy_id = $2', [copy.version_id, policy.id]);
    if (!version) return ctx.fail(404, 'not_found', 'Version not found.');
    if (policy.status === 'retired' || version.status !== 'published') {
      return ctx.fail(409, 'recall_due', `Copy ${copy.copy_number} is of a version no longer in force: recall it and issue a copy of the version in force.`);
    }
    const { file, vlabel, number } = await versionPdf(req, policy, version, copy);
    await ctx.audit(req, {
      action: 'policy.copy_print', recordType: 'policy', recordId: policy.id,
      summary: `Paper copy ${copy.copy_number} of ${[number, policy.title].filter(Boolean).join(' ')} ${vlabel.toLowerCase()} printed for ${copy.holder_name}`,
      after: { copy_id: copy.id, copy_number: Number(copy.copy_number), version: Number(version.version) },
    });
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="${String(number ?? 'document').replace(/[^A-Za-z0-9-]/g, '')}-v${version.version}-copy${copy.copy_number}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(file);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/copies/:cid/pdf', tag: T, permission: 'policies.edit',
    summary: 'An issued paper copy as its controlled-copy PDF: "Controlled copy N" and its holder on every page (E46-57). Audited.',
    description: 'The version the copy was issued of, printed as the version PDF is, with the copy number, holder and place in the control block and at the top of every page (a PDF original is stamped with them). 409 recalled for a recalled copy; 409 recall_due for a copy of a version no longer in force.',
    response: 'application/pdf',
  });

  app.get('/api/policies/:id/versions/:vid/original', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => {
    const { policy, version } = await docAndVersion(req);
    if (!(await ctx.resources.find('policy', policy.id, req.user))) ctx.fail(404, 'not_found', 'Document not found.');
    const id = version.source_attachment_id;
    if (!id || !(await db.one(`select 1 from attachments where id = $1 and deleted_at is null`, [id]).catch(() => undefined))) {
      ctx.fail(404, 'not_found', 'This version has no original file.');
    }
    await ctx.audit(req, {
      action: 'policy.original_download', recordType: 'policy', recordId: policy.id,
      summary: `Original file of version ${version.version} of ${[policy.doc_number ?? policy.ref, policy.title].filter(Boolean).join(' ')} downloaded`,
      after: { version: Number(version.version), attachment_id: id },
    });
    return reply.redirect(`/api/attachments/${id}/download`);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/versions/:vid/original', tag: T, permission: 'policies.edit',
    summary: 'The original file of a version (the .docx or PDF it came from): a redirect to the file\'s download. Audited.',
  });
}
