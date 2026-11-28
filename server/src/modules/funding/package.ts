// Funder review readiness and the evidence package (E45-58).
//
// - Readiness: for each review area, whether it has an owner, a self-assessment, every question
//   answered, evidence linked and no open deficiency; and the document requests answered (evidence or
//   a status of provided or accepted) or overdue. The checks met give a readiness percentage. Counts
//   are figures (every evidence link counts, whoever asks); no evidence is named here.
// - Package: a ZIP for the funder or the reviewer: an index PDF (the review, its areas with their
//   self-assessment and answers, the evidence of each area and request, the requests) and the files of
//   the evidence records the caller may see, by area and request. A restricted evidence record the
//   caller may not see is counted, never named or included. Links are listed, never fetched. Files over
//   the package limit or found infected by the malware scanner are listed but left out. Audited.
import type { FastifyRequest } from 'fastify';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { PdfBuilder } from '../../core/export/pdf.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { idParam } from './shared.ts';

const EVIDENCE_TYPE = 'evidence_record';
/** The files of a package together stay under this. */
export const PACKAGE_MAX_BYTES = 200 * 1024 * 1024;
const LEFT_OUT_SCANS = ['infected', 'quarantined', 'pending', 'failed'];
const day = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';

interface Readiness {
  review: { id: string; ref: string | null; title: string; status: string };
  areas: { area_code: string; title: string; owner: boolean; assessed: boolean; self_assessment: string; questions: number; answered: number; evidence: number; open_deficiencies: number; ready: boolean; gaps: string[] }[];
  requests: { total: number; answered: number; open: number; overdue: number };
  checks: { met: number; total: number }; ready_pct: number | null;
}

export async function readinessOf(ctx: ModuleContext, review: Row): Promise<Readiness> {
  const { db } = ctx;
  const areas = await db.query<Row>('select * from compliance_review_areas where review_id = $1 order by sort, area_code', [review.id]);
  const evidenceOn = Boolean(ctx.resources.get(EVIDENCE_TYPE));
  const counts = evidenceOn ? await db.query<Row>(
    `select l.part, count(*)::int as n from evidence_links l join evidence_records e on e.id = l.evidence_id and e.deleted_at is null
     where l.record_type = 'compliance_review' and l.record_id = $1 group by l.part`, [review.id]) : [];
  const evidence = new Map(counts.map((c) => [String(c.part), Number(c.n)]));
  const closedDef = (await ctx.lookups.values('review_deficiency_status')).filter((v) => v.meta?.closed).map((v) => v.value);
  const defs = await db.query<Row>(
    `select area_code, count(*)::int as n from review_deficiencies where review_id = $1 and deleted_at is null and not (coalesce(status, '') = any($2::text[])) group by 1`,
    [review.id, closedDef.length ? closedDef : ['closed']]);
  const openDefs = new Map(defs.map((d) => [String(d.area_code ?? ''), Number(d.n)]));
  let met = 0;
  let total = 0;
  const out = areas.map((a) => {
    const questions = Array.isArray(a.questions) ? a.questions.length : 0;
    const answers = Array.isArray(a.answers) ? a.answers : [];
    const answered = Math.min(questions, answers.filter((x: unknown) => String((x as Row)?.answer ?? x ?? '').trim()).length);
    const na = a.self_assessment === 'not_applicable';
    const ev = evidence.get(`area:${a.area_code}`) ?? 0;
    const open = openDefs.get(String(a.area_code)) ?? 0;
    const checks: [boolean, string][] = [
      [Boolean(a.owner_id), 'no owner'],
      [a.self_assessment !== 'not_assessed', 'not self-assessed'],
      [na || answered >= questions, `${questions - answered} of ${questions} questions unanswered`],
      [na || !evidenceOn || ev > 0, 'no evidence linked'],
      [open === 0, `${open} open deficienc${open === 1 ? 'y' : 'ies'}`],
    ];
    for (const [ok] of checks) { total += 1; if (ok) met += 1; }
    return {
      area_code: String(a.area_code), title: String(a.title), owner: Boolean(a.owner_id), assessed: a.self_assessment !== 'not_assessed',
      self_assessment: String(a.self_assessment), questions, answered, evidence: ev, open_deficiencies: open,
      ready: checks.every(([ok]) => ok), gaps: checks.filter(([ok]) => !ok).map(([, g]) => g),
    };
  });
  const reqs = await db.query<Row>('select id, status, due_on::text as due_on from compliance_review_requests where review_id = $1', [review.id]);
  const today = dayInZone();
  const answeredReq = reqs.filter((r) => ['provided', 'accepted'].includes(String(r.status)) || (evidence.get(`request:${r.id}`) ?? 0) > 0);
  const requests = {
    total: reqs.length, answered: answeredReq.length, open: reqs.length - answeredReq.length,
    overdue: reqs.filter((r) => !answeredReq.includes(r) && r.due_on && r.due_on < today).length,
  };
  total += reqs.length;
  met += answeredReq.length;
  return {
    review: { id: String(review.id), ref: review.ref ?? null, title: String(review.title), status: String(review.status ?? '') },
    areas: out, requests, checks: { met, total }, ready_pct: total ? Math.round((met / total) * 100) : null,
  };
}

export function registerReviewPackage(ctx: ModuleContext) {
  const { app, db } = ctx;
  const needReview = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('compliance_review', idParam(ctx, req), req.user)) ?? ctx.fail(404, 'not_found', 'Compliance review not found.');

  app.get('/api/compliance-reviews/:id/readiness', { preHandler: ctx.requirePerm('funding.view') }, async (req) => readinessOf(ctx, await needReview(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/compliance-reviews/:id/readiness', tag: 'Funding', permission: 'funding.view',
    summary: 'How ready a funder review is: per area the owner, self-assessment, questions answered, evidence and open deficiencies, and the document requests answered or overdue',
    description: 'A figure: evidence is counted for everyone, never named. `ready_pct` is the share of checks met (five per area, one per request).',
    response: '{ review, areas: [{ area_code, title, owner, assessed, self_assessment, questions, answered, evidence, open_deficiencies, ready, gaps }], requests: { total, answered, open, overdue }, checks: { met, total }, ready_pct }',
  });

  app.get('/api/compliance-reviews/:id/package', { preHandler: ctx.requirePerm('funding.export') }, async (req, reply) => {
    const review = await needReview(req);
    const readiness = await readinessOf(ctx, review);
    const areas = await db.query<Row>('select area_code, title, self_assessment, questions, answers, notes from compliance_review_areas where review_id = $1 order by sort, area_code', [review.id]);
    const requests = await db.query<Row>('select id, area_code, request, status, due_on::text as due_on, response_note from compliance_review_requests where review_id = $1 order by due_on nulls last, created_at', [review.id]);
    const labels = new Map((await ctx.lookups.values('review_self_assessment')).map((v) => [v.value, v.label]));
    // The evidence linked to the review that the caller may see; the rest is counted.
    const def = ctx.resources.get(EVIDENCE_TYPE);
    const links = def ? await db.query<Row>(
      `select l.part, e.id, e.ref, e.title, e.valid_until::text as valid_until, (${ctx.resources.visibleWhere(EVIDENCE_TYPE, req.user, 'e')}) as visible
       from evidence_links l join evidence_records e on e.id = l.evidence_id and e.deleted_at is null
       where l.record_type = 'compliance_review' and l.record_id = $1 order by l.part, e.ref`, [review.id]) : [];
    const mayEvidence = ctx.can(req.user, 'evidence.view');
    const shown = links.filter((l) => l.visible && mayEvidence);
    const hiddenCount = links.length - shown.length;
    const ids = [...new Set(shown.map((l) => String(l.id)))];
    const files = ids.length && app.hasDecorator('attachmentStores') ? await db.query<Row>(
      `select id, record_id, file_name, size_bytes, storage_driver, storage_key, scan_status, link_url from attachments
       where record_type = $1 and record_id = any($2::uuid[]) and deleted_at is null order by created_at`, [EVIDENCE_TYPE, ids]) : [];

    const zip: Zippable = {};
    const included = new Map<string, string[]>();
    const leftOut: string[] = [];
    let bytes = 0;
    const seen = new Set<string>();
    for (const l of shown) {
      const folder = String(l.part).startsWith('area:') ? `areas/${safe(String(l.part).slice(5))}` : String(l.part).startsWith('request:') ? `requests/${safe(String(l.part).slice(8))}` : 'review';
      for (const f of files.filter((x) => String(x.record_id) === String(l.id))) {
        const path = `${folder}/${safe(`${l.ref ?? ''} ${f.file_name}`)}`;
        if (seen.has(path)) continue;
        seen.add(path);
        if (f.storage_driver === 'link') { leftOut.push(`${l.ref} ${f.file_name}: a link (${String(f.link_url ?? '').split('/')[2] ?? 'elsewhere'}), not included`); continue; }
        if (LEFT_OUT_SCANS.includes(String(f.scan_status))) { leftOut.push(`${l.ref} ${f.file_name}: not included (malware scan: ${f.scan_status})`); continue; }
        if (bytes + Number(f.size_bytes) > PACKAGE_MAX_BYTES) { leftOut.push(`${l.ref} ${f.file_name}: not included (the package would pass ${PACKAGE_MAX_BYTES / 1024 / 1024} MB)`); continue; }
        const chunks: Buffer[] = [];
        try {
          for await (const c of await app.attachmentStores.forDriver(f.storage_driver).get(f.storage_key)) chunks.push(c as Buffer);
        } catch {
          leftOut.push(`${l.ref} ${f.file_name}: could not be read from storage`);
          continue;
        }
        const buf = Buffer.concat(chunks);
        bytes += buf.length;
        zip[path] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        included.set(String(l.id), [...(included.get(String(l.id)) ?? []), path]);
      }
    }

    // The index.
    const pdf = new PdfBuilder({
      title: `Evidence package: ${review.title}`,
      subtitle: review.ref ?? null,
      meta: [
        `Readiness ${readiness.ready_pct ?? 0}% (${readiness.checks.met} of ${readiness.checks.total} checks met)`,
        `Prepared ${displayDate(dayInZone())} by ${req.user!.displayName}`,
        ...(hiddenCount ? [`${hiddenCount} evidence ${hiddenCount === 1 ? 'link is' : 'links are'} to records you may not see: counted, not included.`] : []),
      ],
      appName: String(await ctx.settings.get('app.name', 'Sandpiper GRC')), branding: await printBranding(db),
    });
    const evidenceRows = (part: string) => shown.filter((l) => l.part === part).map((l) => [
      String(l.ref ?? ''), String(l.title ?? ''), l.valid_until ? displayDate(day(l.valid_until)!) : '', (included.get(String(l.id)) ?? []).join('\n') || 'No file',
    ]);
    pdf.heading('Review areas', 1);
    for (const a of areas) {
      const r = readiness.areas.find((x) => x.area_code === a.area_code);
      pdf.heading(`${a.area_code}: ${a.title}`, 2);
      pdf.keyValues([
        { label: 'Self-assessment', value: labels.get(a.self_assessment) ?? String(a.self_assessment) },
        { label: 'Ready', value: r?.ready ? 'Yes' : `No: ${r?.gaps.join('; ') ?? ''}` },
      ]);
      const qs = Array.isArray(a.questions) ? a.questions : [];
      const ans = Array.isArray(a.answers) ? a.answers : [];
      if (qs.length) pdf.table([{ header: 'Question', weight: 3 }, { header: 'Answer', weight: 4 }], qs.map((q: unknown, i: number) => [String(q), String((ans[i] as Row)?.answer ?? ans[i] ?? '')]));
      if (a.notes) pdf.paragraph(String(a.notes));
      const ev = evidenceRows(`area:${a.area_code}`);
      if (ev.length) pdf.table([{ header: 'Evidence', weight: 1.2 }, { header: 'Title', weight: 3 }, { header: 'Valid until', weight: 1.2 }, { header: 'File in this package', weight: 3 }], ev);
      else pdf.paragraph('No evidence linked.', { muted: true });
    }
    if (requests.length) {
      pdf.heading('Document requests', 1);
      for (const q of requests) {
        pdf.heading(String(q.request).slice(0, 160), 2);
        pdf.keyValues([
          { label: 'Status', value: String(q.status) }, ...(q.due_on ? [{ label: 'Due', value: displayDate(q.due_on) }] : []),
          ...(q.area_code ? [{ label: 'Area', value: String(q.area_code) }] : []),
        ]);
        if (q.response_note) pdf.paragraph(String(q.response_note));
        const ev = evidenceRows(`request:${q.id}`);
        if (ev.length) pdf.table([{ header: 'Evidence', weight: 1.2 }, { header: 'Title', weight: 3 }, { header: 'Valid until', weight: 1.2 }, { header: 'File in this package', weight: 3 }], ev);
      }
    }
    if (leftOut.length) { pdf.heading('Not included', 1); for (const l of leftOut) pdf.paragraph(l); }
    zip['index.pdf'] = new Uint8Array(await pdf.finish());
    zip['README.txt'] = strToU8(`Evidence package for ${review.ref ?? ''} ${review.title}\r\nPrepared ${dayInZone()}. Start with index.pdf; evidence files are in areas/ and requests/.\r\n`);
    const out = Buffer.from(zipSync(zip, { level: 6 }));
    await ctx.audit(req, {
      action: 'compliance_review.package', recordType: 'compliance_review', recordId: review.id,
      summary: `Evidence package of ${review.ref ?? review.title} downloaded: ${Object.keys(zip).length - 2} files${leftOut.length ? `, ${leftOut.length} left out` : ''}${hiddenCount ? `, ${hiddenCount} restricted not included` : ''}`,
      after: { files: Object.keys(zip).length - 2, bytes: out.length, left_out: leftOut.length, hidden: hiddenCount },
    });
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${safe(String(review.ref ?? 'review')).replace(/ /g, '-')}-evidence-package.zip"`);
    reply.header('cache-control', 'no-store');
    return reply.send(out);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/compliance-reviews/:id/package', tag: 'Funding', permission: 'funding.export',
    summary: 'The review\'s evidence package as a ZIP: an index PDF (areas, self-assessment, answers, evidence, requests, readiness) and the evidence files the caller may see, by area and request',
    description: `Evidence the caller may not see is counted, never named or included. Links are listed, not fetched; files the malware scanner found infected, or beyond ${PACKAGE_MAX_BYTES / 1024 / 1024} MB in all are listed under "Not included". Audited.`,
    response: 'application/zip',
  });
}
