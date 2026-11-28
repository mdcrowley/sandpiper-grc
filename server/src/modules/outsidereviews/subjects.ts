// What an outside reviewer can be given (E41-09): an audit engagement (audits module) or a funder
// compliance review (funding module). Each kind says which record type and permission module it
// belongs to, and reads exactly what the reviewer sees: the engagement or review itself, its
// evidence or document requests, the evidence files, and its findings or deficiencies. Nothing
// else of the organization is ever read for a reviewer. A kind whose record type is not loaded or
// is switched off (Administration > Features) is left out everywhere.
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate } from '../../core/timezone.ts';

export interface ReviewFile {
  id: string; file_name: string; size_bytes: number; extension: string | null; is_link: boolean;
  link_url: string | null; link_title: string | null; description: string | null; uploaded_at: string; scanned: boolean;
}

export interface Workspace {
  subject: {
    type: string; kind: string; ref: string | null; title: string;
    facts: { label: string; value: string | null }[];
    sections: { label: string; text: string }[];
  };
  requests: {
    id: string; ref: string | null; request: string; area: string | null; due_on: string | null;
    status: string; status_label: string; response_note: string | null; answered_at: string | null; asked_of: string | null;
    files: ReviewFile[];
  }[];
  findings: {
    id: string; ref: string | null; title: string; area: string | null; rating: string | null; status_label: string;
    due_on: string | null; parts: { label: string; text: string }[];
  }[];
  /** Evidence files on the engagement or review itself (files marked as evidence). */
  files: ReviewFile[];
  /**
   * Evidence records of the shared library linked to the engagement or review (E45-59), with their
   * files: for the whole record or a part of it (a review area, a document request, a workpaper step).
   * Restricted evidence records are never shown to an outside reviewer.
   */
  evidence: LibraryEvidence[];
  labels: { requests: string; findings: string };
}

export interface LibraryEvidence {
  id: string; ref: string | null; title: string; part: string; part_label: string | null; relation: string | null;
  valid_until: string | null; period: string | null; files: ReviewFile[];
}

/** The shared evidence library's record type (module evidence); left out while it is off or not loaded. */
const EVIDENCE_TYPE = 'evidence_record';

/** Library evidence records linked to a record, restricted ones left out (E45-59). */
async function linkedEvidence(ctx: ModuleContext, type: string, id: string): Promise<Row[]> {
  if (!ctx.resources.get(EVIDENCE_TYPE)) return [];
  return ctx.db.query<Row>(
    `select e.id, e.ref, e.title, e.valid_until::text as valid_until, e.period_start::text as period_start, e.period_end::text as period_end,
            l.part, l.relation
     from evidence_links l join evidence_records e on e.id = l.evidence_id and e.deleted_at is null and not coalesce(e.restricted, false)
     where l.record_type = $1 and l.record_id = $2 order by l.part, e.ref`, [type, id]);
}

/** The evidence of a workspace, each with its files and a label for the part it is used for. */
function evidenceView(rows: Row[], files: Row[], partLabel: (part: string) => string | null): LibraryEvidence[] {
  return rows.map((e) => ({
    id: e.id, ref: e.ref ?? null, title: e.title, part: String(e.part ?? ''), part_label: e.part ? partLabel(String(e.part)) : null,
    relation: e.relation ?? null, valid_until: e.valid_until ?? null, period: dates(e.period_start, e.period_end),
    files: files.filter((f) => f.record_type === EVIDENCE_TYPE && f.record_id === e.id).map(presentFile),
  }));
}

export interface SubjectKind {
  /** The record type invited to. */
  type: string;
  /** Its permission module: `<module>.view` lists its reviewers, `<module>.edit` invites and changes them. */
  module: string;
  /** "Audit engagement". */
  kind: string;
  /** The API base of the record type; the staff routes hang under it, so they follow its area. */
  path: string;
  /** Where staff open the record. */
  route: string;
  /** Reference and title, or null when the record is gone. */
  head(ctx: ModuleContext, id: string): Promise<{ ref: string | null; title: string } | null>;
  /** Everything the reviewer sees, or null when the record is gone. */
  workspace(ctx: ModuleContext, id: string): Promise<Workspace | null>;
  /** The files a reviewer may download: `record_type`, `record_id` pairs (and whether only evidence). */
  fileScope(ctx: ModuleContext, id: string): Promise<{ type: string; ids: string[]; evidenceOnly: boolean }[]>;
}

const labelOf = async (ctx: ModuleContext, list: string) => {
  const values = await ctx.lookups.values(list);
  return (v: unknown) => (v === null || v === undefined || v === '' ? null : values.find((x) => x.value === v)?.label ?? String(v));
};

/** "Nov 2, 2026", "Nov 2, 2026 to Dec 11, 2026", or null. */
const dates = (...days: unknown[]) => days.filter(Boolean).map((d) => displayDate(String(d))).join(' to ') || null;

const parts = (row: Row, fields: [string, string][]) =>
  fields.filter(([f]) => typeof row[f] === 'string' && row[f].trim()).map(([f, label]) => ({ label, text: String(row[f]) }));

export const presentFile = (f: Row): ReviewFile => {
  const link = f.storage_driver === 'link';
  return {
    id: f.id, file_name: f.file_name, size_bytes: Number(f.size_bytes ?? 0), extension: f.extension ?? null, is_link: link,
    link_url: link ? f.link_url ?? null : null, link_title: link ? f.link_title ?? null : null,
    description: f.description ?? null, uploaded_at: f.created_at instanceof Date ? f.created_at.toISOString() : String(f.created_at),
    scanned: f.scan_status === 'clean',
  };
};

/** The files of these records (only evidence when asked), oldest first. */
export async function filesOf(ctx: ModuleContext, scope: { type: string; ids: string[]; evidenceOnly: boolean }[]): Promise<Row[]> {
  const out: Row[] = [];
  if (!ctx.app.hasDecorator('attachmentStores')) return out;
  for (const s of scope) {
    if (!s.ids.length) continue;
    out.push(...await ctx.db.query<Row>(
      `select * from attachments where record_type = $1 and record_id = any($2::uuid[]) and deleted_at is null
         and ($3::boolean = false or kind = 'evidence') order by created_at, id`,
      [s.type, s.ids, s.evidenceOnly]));
  }
  return out;
}

const audit: SubjectKind = {
  type: 'audit_engagement', module: 'audits', kind: 'Audit engagement', path: '/api/audits', route: '/audits/engagements',
  async head(ctx, id) {
    const a = await ctx.db.one<Row>('select ref, title from audits where id = $1 and deleted_at is null', [id]);
    return a ? { ref: a.ref ?? null, title: a.title } : null;
  },
  async fileScope(ctx, id) {
    const requests = await ctx.db.query<{ id: string }>('select id from audit_requests where audit_id = $1 and deleted_at is null', [id]);
    return [
      { type: 'audit_engagement', ids: [id], evidenceOnly: true },
      { type: 'audit_request', ids: requests.map((r) => r.id), evidenceOnly: false },
      { type: EVIDENCE_TYPE, ids: [...new Set((await linkedEvidence(ctx, 'audit_engagement', id)).map((e) => String(e.id)))], evidenceOnly: false },
    ];
  },
  async workspace(ctx, id) {
    const a = await ctx.db.one<Row>(
      `select a.*, a.planned_start::text as planned_start, a.planned_end::text as planned_end, a.fieldwork_start::text as fieldwork_start,
         a.fieldwork_end::text as fieldwork_end, a.report_approved_on::text as report_approved_on, a.closed_on::text as closed_on,
         u.display_name as lead_name
       from audits a left join users u on u.id = a.lead_auditor_id where a.id = $1 and a.deleted_at is null`, [id]);
    if (!a) return null;
    const [type, status, opinion, reqStatus, rating, findStatus] = await Promise.all([
      labelOf(ctx, 'audit_type'), labelOf(ctx, 'audit_status'), labelOf(ctx, 'audit_opinion'),
      labelOf(ctx, 'audit_request_status'), labelOf(ctx, 'finding_rating'), labelOf(ctx, 'finding_status'),
    ]);
    // The report is shared once it is final: approved, or the audit closed.
    const reportFinal = Boolean(a.report_approved_on) || a.status === 'closed';
    const requests = await ctx.db.query<Row>(
      `select r.*, r.due_on::text as due_on, u.display_name as asked_of from audit_requests r left join users u on u.id = r.owner_id
       where r.audit_id = $1 and r.deleted_at is null order by r.due_on nulls last, r.ref`, [id]);
    const findings = await ctx.db.query<Row>(
      `select f.*, f.response_due::text as response_due from audit_findings f
       where f.source_type = 'audit_engagement' and f.source_id = $1 and f.deleted_at is null order by f.ref`, [id]);
    const files = await filesOf(ctx, await audit.fileScope(ctx, id));
    return {
      subject: {
        type: 'audit_engagement', kind: 'Audit engagement', ref: a.ref ?? null, title: a.title,
        facts: [
          { label: 'Type', value: type(a.audit_type) }, { label: 'Status', value: status(a.status) },
          { label: 'Lead auditor', value: a.lead_name ?? null },
          { label: 'Planned', value: dates(a.planned_start, a.planned_end) },
          { label: 'Fieldwork', value: dates(a.fieldwork_start, a.fieldwork_end) },
          ...(reportFinal ? [{ label: 'Overall opinion', value: opinion(a.opinion) }, { label: 'Report approved', value: dates(a.report_approved_on) }] : []),
        ],
        sections: [
          ...parts(a, [['scope', 'Scope'], ['criteria', 'Criteria']]),
          ...(reportFinal ? parts(a, [['report_summary', 'Report summary']]) : []),
        ],
      },
      requests: requests.map((r) => ({
        id: r.id, ref: r.ref ?? null, request: r.request, area: null, due_on: r.due_on ?? null, status: r.status,
        status_label: reqStatus(r.status) ?? '', response_note: r.response_note ?? null,
        answered_at: r.provided_at instanceof Date ? r.provided_at.toISOString() : r.provided_at ?? null, asked_of: r.asked_of ?? null,
        files: files.filter((f) => f.record_type === 'audit_request' && f.record_id === r.id).map(presentFile),
      })),
      findings: findings.map((f) => ({
        id: f.id, ref: f.ref ?? null, title: f.title, area: null, rating: rating(f.rating), status_label: findStatus(f.status) ?? '',
        due_on: f.response_due ?? null,
        parts: parts(f, [['criteria', 'Criteria'], ['condition', 'Condition'], ['cause', 'Cause'], ['effect', 'Effect'],
          ['recommendation', 'Recommendation'], ['management_response', 'Management response']]),
      })),
      files: files.filter((f) => f.record_type === 'audit_engagement').map(presentFile),
      evidence: evidenceView(await linkedEvidence(ctx, 'audit_engagement', id), files, (p) => (p.startsWith('step:') ? 'A workpaper step' : null)),
      labels: { requests: 'Evidence requests', findings: 'Findings' },
    };
  },
};

const review: SubjectKind = {
  type: 'compliance_review', module: 'funding', kind: 'Funder compliance review', path: '/api/compliance-reviews', route: '/funding/reviews',
  async head(ctx, id) {
    const r = await ctx.db.one<Row>('select ref, title from compliance_reviews where id = $1 and deleted_at is null', [id]);
    return r ? { ref: r.ref ?? null, title: r.title } : null;
  },
  async fileScope(ctx, id) {
    return [
      { type: 'compliance_review', ids: [id], evidenceOnly: true },
      { type: EVIDENCE_TYPE, ids: [...new Set((await linkedEvidence(ctx, 'compliance_review', id)).map((e) => String(e.id)))], evidenceOnly: false },
    ];
  },
  async workspace(ctx, id) {
    const r = await ctx.db.one<Row>(
      `select c.*, c.site_visit_on::text as site_visit_on, c.closed_on::text as closed_on, u.display_name as lead_name
       from compliance_reviews c left join users u on u.id = c.lead_id where c.id = $1 and c.deleted_at is null`, [id]);
    if (!r) return null;
    const [status, reqStatus, defStatus] = await Promise.all([
      labelOf(ctx, 'compliance_review_status'), labelOf(ctx, 'review_request_status'), labelOf(ctx, 'review_deficiency_status'),
    ]);
    const requests = await ctx.db.query<Row>(
      `select q.*, q.due_on::text as due_on, u.display_name as asked_of from compliance_review_requests q left join users u on u.id = q.owner_id
       where q.review_id = $1 order by q.area_code nulls last, q.due_on nulls last, q.created_at`, [id]);
    const deficiencies = await ctx.db.query<Row>(
      `select d.*, d.due_on::text as due_on from review_deficiencies d where d.review_id = $1 and d.deleted_at is null order by d.ref`, [id]);
    const files = await filesOf(ctx, await review.fileScope(ctx, id));
    return {
      subject: {
        type: 'compliance_review', kind: 'Funder compliance review', ref: r.ref ?? null, title: r.title,
        facts: [
          { label: 'Funder', value: r.funder_name ?? null }, { label: 'Period reviewed', value: r.period ?? null },
          { label: 'Site visit', value: dates(r.site_visit_on) }, { label: 'Status', value: status(r.status) },
          { label: 'Review lead', value: r.lead_name ?? null },
        ],
        sections: [],
      },
      requests: requests.map((q) => ({
        id: q.id, ref: null, request: q.request, area: q.area_code ?? null, due_on: q.due_on ?? null, status: q.status,
        status_label: reqStatus(q.status) ?? '', response_note: q.response_note ?? null, answered_at: null, asked_of: q.asked_of ?? null,
        files: [],
      })),
      findings: deficiencies.map((d) => ({
        id: d.id, ref: d.ref ?? null, title: d.title, area: d.area_code ?? null, rating: null, status_label: defStatus(d.status) ?? '',
        due_on: d.due_on ?? null,
        parts: parts(d, [['description', 'What the funder found'], ['required_action', 'Corrective action required']]),
      })),
      files: files.filter((f) => f.record_type === 'compliance_review').map(presentFile),
      evidence: evidenceView(await linkedEvidence(ctx, 'compliance_review', id), files, (p) => {
        if (p.startsWith('area:')) return `Area ${p.slice(5)}`;
        if (p.startsWith('request:')) { const q = requests.find((x) => x.id === p.slice(8)); return q ? `Request: ${String(q.request).slice(0, 80)}` : 'A document request'; }
        return null;
      }),
      labels: { requests: 'Document requests', findings: 'Deficiencies' },
    };
  },
};

export const SUBJECT_KINDS: readonly SubjectKind[] = [audit, review];

/** The kind for a record type, when that type is loaded and switched on. */
export const kindOf = (ctx: ModuleContext, type: unknown): SubjectKind | undefined =>
  SUBJECT_KINDS.find((k) => k.type === type && ctx.resources.get(k.type) !== undefined);

/** The kinds whose record types are loaded and switched on now. */
export const activeKinds = (ctx: ModuleContext) => SUBJECT_KINDS.filter((k) => ctx.resources.get(k.type) !== undefined);
