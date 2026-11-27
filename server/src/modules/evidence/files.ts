// Filing evidence from a file (E45-06): a finished chunked upload (attachments module, /api/attachments/uploads)
// becomes a new evidence record holding that file, optionally linked at once to the record (or part)
// it was uploaded for. Used by the library's own "Upload" and by the funder document requests.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { checkPart, EVIDENCE_TYPE, findTarget, mayLinkTo, storeLink, validPart, type Target } from './links.ts';

const T = 'Evidence';

const EDITABLE = ['title', 'description', 'owner_id', 'department_id', 'period_start', 'period_end', 'collected_on', 'valid_until', 'restricted', 'notes'];

/**
 * Creates an evidence record from the caller's finished upload, then links it. The caller has checked
 * that the person may file it and link it; the record is theirs. Everything is one transaction, so a
 * refused upload leaves no empty record behind.
 */
export async function evidenceFromUpload(
  ctx: ModuleContext, req: FastifyRequest, uploadId: string, data: Row,
  link?: { target: Target; part: string; relation: string; note?: string | null },
): Promise<{ evidence: Row; attachment_id: string; link_id: string | null }> {
  const claim = (ctx.app as unknown as { claimUpload?: (r: FastifyRequest, id: string, to: { recordType: string; recordId: string; description?: string | null }) => Promise<{ attachment_id: string; file_name: string }> }).claimUpload;
  if (!claim) ctx.fail(503, 'files_unavailable', 'Files are not available in this installation.');
  if (typeof uploadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(uploadId)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { upload_id: 'Upload the file first.' });
  const work = async () => {
    const input: Row = { source: 'file', collected_on: todayInZone() };
    for (const k of EDITABLE) if (k in data && data[k] !== undefined) input[k] = data[k];
    if (!input.title) input.title = 'Uploaded evidence';
    const evidence = await ctx.resources.create(EVIDENCE_TYPE, input, req);
    const file = await claim!(req, uploadId, { recordType: EVIDENCE_TYPE, recordId: evidence.id, description: input.description ?? null });
    let linkId: string | null = null;
    if (link) linkId = (await storeLink(ctx, req, evidence, link.target, { part: link.part, relation: link.relation, note: link.note ?? null })).row.id;
    return { evidence, attachment_id: file.attachment_id, link_id: linkId };
  };
  return ctx.db.atomic ? ctx.db.atomic(work) : work();
}

export function registerEvidenceFiles(ctx: ModuleContext) {
  ctx.app.post('/api/evidence-library/upload', { preHandler: ctx.requirePerm('evidence.create') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    let link: Parameters<typeof evidenceFromUpload>[4];
    if (b.record_type || b.record_id) {
      const target = await findTarget(ctx, req.user, b.record_type, b.record_id) ?? ctx.fail(404, 'not_found', 'Record not found.');
      const part = validPart(b.part);
      if (part === '\u0000') ctx.fail(400, 'validation', 'Check the highlighted fields.', { part: 'Give a part such as area:FM, or leave it empty.' });
      if (!(await mayLinkTo(ctx, req, target, part))) ctx.fail(403, 'forbidden', `Linking evidence changes this ${target.def.label.toLowerCase()}: it needs permission to edit it.`);
      await checkPart(ctx, target, part);
      const relation = b.relation ? String(b.relation) : 'supports';
      if (!(await ctx.lookups.values('evidence_relation')).some((x) => x.value === relation)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { relation: 'Choose how the evidence relates from the list.' });
      link = { target, part, relation, note: b.note == null ? null : String(b.note).slice(0, 2000) };
    }
    const out = await evidenceFromUpload(ctx, req, String(b.upload_id ?? ''), b, link);
    reply.code(201);
    return { ...out.evidence, attachment_id: out.attachment_id, link_id: out.link_id };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/evidence-library/upload', tag: T, permission: 'evidence.create',
    summary: 'File a finished chunked upload as a new evidence record, and optionally use it for a record (or part) at once',
    description: 'Upload the file first with /api/attachments/uploads (start, parts, finish). Linking needs edit permission on the record (or the part\'s own rule), as POST /api/evidence-links does.',
    body: '{ upload_id, title?, description?, owner_id?, department_id?, period_start?, period_end?, collected_on?, valid_until?, restricted?, notes?, record_type?, record_id?, part?, relation?, note? }',
    response: 'the evidence record, with attachment_id and link_id',
  });
}
