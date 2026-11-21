// The audit report: approval on the shared approval workflows (kind `audit_report`) and the
// report as a branded PDF (E24-10).
//
// An audit in Reporting closes only with a report summary and a management response or corrective
// action plan on every finding. Where an "Audit report approval" workflow is active, closing also
// waits for it: someone who may edit the audit asks for approval, and the approval closes the audit.
// Rejection leaves it in Reporting, with the reason in its history. Without the workflows module, or
// once an administrator has removed every workflow of the kind, the audit is closed by hand.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { PDF_TYPE, PdfBuilder } from '../../core/export/pdf.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { notePermission } from '../../core/permission-use.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';

export const REPORT_KIND = 'audit_report';

export const DEFAULT_REPORT_WORKFLOW = {
  name: 'Audit report approval',
  description: 'One approval from someone who may approve audits before the audit closes. Add a second step for an executive or a committee if your audit charter asks for one.',
  steps: [{ key: 'approve', name: 'Report approval', approvers: { kind: 'permission', permission: 'audits.approve' }, quorum: 'any', due_hours: 120 }],
};

/** What still stops an audit from closing, in plain sentences (empty when nothing does). */
export async function closingProblems(ctx: ModuleContext, audit: Row): Promise<string[]> {
  const problems: string[] = [];
  if (!String(audit.report_summary ?? '').trim()) problems.push('Write the report summary before closing the audit.');
  const open = await ctx.db.query<Row>(
    `select ref from audit_findings
     where deleted_at is null and source_type = 'audit_engagement' and source_id = $1
       and coalesce(trim(management_response), '') = '' and cap_id is null
     order by ref`, [audit.id]);
  if (open.length) {
    const refs = open.slice(0, 5).map((f) => f.ref).join(', ') + (open.length > 5 ? ` and ${open.length - 5} more` : '');
    problems.push(`Every finding needs a management response or a corrective action plan first (${refs}).`);
  }
  return problems;
}

/** Whether closing waits for an approval, and how that approval stands. */
export async function reportGate(ctx: ModuleContext, auditId: string): Promise<{ available: boolean; required: boolean; approved: boolean; running: boolean }> {
  const engine = approvalEngine(ctx.app);
  if (!engine) return { available: false, required: false, approved: false, running: false };
  const required = (await engine.definitions(REPORT_KIND)).length > 0;
  const latest = await engine.latest(REPORT_KIND, auditId);
  return { available: true, required, approved: latest?.status === 'approved', running: latest?.status === 'running' };
}

export function registerReport(ctx: ModuleContext) {
  // Approvers of the kind must hold audits.approve (checked by the workflows engine at each decision).
  notePermission('audits.approve');
  const { app, db } = ctx;

  const needAudit = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('audit_engagement', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Audit not found.');

  defineApprovalKind(app, {
    key: REPORT_KIND, recordType: 'audit_engagement', label: 'Audit report approval',
    startsWhen: 'Someone who may edit an audit in Reporting asks for its report to be approved (with a report summary and a response or plan on every finding)',
    outcome: 'Approved: the approval is recorded on the audit and the audit closes; rejected: the audit stays in Reporting, with the reason in its history',
    approverPermission: 'audits.approve',
    route: (id) => `/audits/engagements/${id}?tab=approval`,
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_REPORT_WORKFLOW);
    },
    async onFinish(e) {
      if (e.outcome === 'canceled') return;
      const audit = await db.one<Row>('select * from audits where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!audit) throw new Error('The audit no longer exists.');
      const who = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'audit_engagement.report_rejected', recordType: 'audit_engagement', recordId: audit.id,
          summary: `Report of ${audit.ref} rejected by ${who}: ${e.comment ?? 'no reason given'}`,
          after: { workflow: e.instance.name, reason: e.comment },
        });
        return;
      }
      // System work, as the engine applies every outcome: the approval already passed the checks.
      await ctx.resources.update('audit_engagement', audit.id, {
        report_approved_on: dayInZone(), report_approved_by_name: who.slice(0, 200), ...(audit.status === 'closed' ? {} : { status: 'closed' }),
      }, null);
      await ctx.audit(e.req, {
        action: 'audit_engagement.report_approved', recordType: 'audit_engagement', recordId: audit.id,
        summary: `Report of ${audit.ref} approved by ${who}; the audit is closed`, after: { workflow: e.instance.name },
      });
    },
  });

  app.get('/api/audits/:id/report-approval', { preHandler: ctx.requirePerm('audits.view') }, async (req) => {
    const audit = await needAudit(req);
    const gate = await reportGate(ctx, audit.id);
    const engine = approvalEngine(app);
    const latest = engine ? await engine.latest(REPORT_KIND, audit.id) : null;
    return {
      ...gate,
      problems: await closingProblems(ctx, audit),
      request: latest ? { id: latest.id, workflow: latest.name, status: latest.status, started_at: latest.startedAt, finished_at: latest.finishedAt, note: latest.note } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/:id/report-approval', tag: 'Audits', permission: 'audits.view',
    summary: 'Whether closing the audit waits for report approval, what still stops it closing, and the newest approval request',
    response: '{ available, required, approved, running, problems: string[], request: { id, workflow, status, started_at, finished_at, note } | null }',
  });

  app.post('/api/audits/:id/report-approval', { preHandler: ctx.requirePerm('audits.edit') }, async (req, reply) => {
    const audit = await needAudit(req);
    const engine = approvalEngine(app);
    if (!engine) ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available, so close the audit by hand.');
    if (audit.status !== 'reporting') ctx.fail(409, 'not_reporting', 'Only an audit in Reporting can have its report approved.');
    const problems = await closingProblems(ctx, audit);
    if (problems.length) ctx.fail(400, 'validation', problems.join(' '));
    if (await engine!.running(REPORT_KIND, audit.id)) ctx.fail(409, 'already_requested', 'The report is already waiting for approval.');
    const note = String(((req.body ?? {}) as Row).note ?? '').trim().slice(0, 2000) || null;
    const started = await engine!.start(REPORT_KIND, audit, { requester: req.user!.id, req, note });
    if (!started) ctx.fail(409, 'no_workflow', 'No active Audit report approval workflow applies to this audit. An administrator can set one up under Administration > Approval workflows, or close the audit by hand.');
    await ctx.audit(req, {
      action: 'audit_engagement.report_approval_requested', recordType: 'audit_engagement', recordId: audit.id,
      summary: `Approval of the report of ${audit.ref} asked for`, after: { workflow: started!.name, note },
    });
    reply.code(201);
    return { instance_id: started!.id, workflow: started!.name, status: (await engine!.latest(REPORT_KIND, audit.id))?.status ?? started!.status };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/:id/report-approval', tag: 'Audits', permission: 'audits.edit',
    summary: 'Ask for the audit report to be approved: starts the Audit report approval workflow; approval closes the audit',
    description: '409 `not_reporting` unless the audit is in Reporting; 400 when the report summary or a finding response is missing; 409 `already_requested` or `no_workflow`.',
    body: '{ note?: string }', response: '{ instance_id, workflow, status }',
  });

  // ---------- the report as a PDF ----------
  app.get('/api/audits/:id/report.pdf', { preHandler: ctx.requirePerm('audits.export') }, async (req, reply) => {
    const audit = await needAudit(req);
    const label = async (list: string, v: unknown) => (v ? (await ctx.lookups.values(list)).find((x) => x.value === v)?.label ?? String(v) : '');
    const name = async (id: unknown) => (id ? (await db.one<Row>('select display_name from users where id = $1', [id]))?.display_name ?? '' : '');
    const area = audit.area_id ? await db.one<Row>('select name from audit_areas where id = $1', [audit.area_id]) : null;
    const team = Array.isArray(audit.team_ids) && audit.team_ids.length
      ? (await db.query<Row>('select display_name from users where id = any($1::uuid[]) order by display_name', [audit.team_ids])).map((u) => u.display_name)
      : [];
    const findings = await db.query<Row>(
      `select * from audit_findings where deleted_at is null and source_type = 'audit_engagement' and source_id = $1 order by ref`, [audit.id]);
    const ratings = await ctx.lookups.values('finding_rating');
    const statuses = await ctx.lookups.values('finding_status');
    const requests = await db.query<Row>(
      `select status, count(*)::int as n from audit_requests where deleted_at is null and audit_id = $1 group by status`, [audit.id]);
    const answers = await db.query<Row>(
      `select answer, count(*)::int as n from checklist_responses where parent_type = 'audit_engagement' and parent_id = $1 group by answer`, [audit.id]);
    const caps = new Map<string, string>();
    if (ctx.resources.get('cap')) {
      for (const f of findings.filter((x) => x.cap_id)) caps.set(f.id, (await ctx.resources.labelFor('cap', f.cap_id)) ?? '');
    }
    const appName = String(await ctx.settings.get('app.name', 'Sandpiper GRC'));
    const pdf = new PdfBuilder({
      title: `Audit report: ${audit.title}`,
      subtitle: [audit.ref, await label('audit_type', audit.audit_type)].filter(Boolean).join(' · '),
      meta: [`Produced ${displayDate(dayInZone())} by ${req.user!.displayName}`, `Status: ${await label('audit_status', audit.status)}`],
      watermark: audit.restricted ? 'Restricted record' : null,
      appName, author: appName, branding: await printBranding(db),
    });
    pdf.keyValues([
      { label: 'Audit area', value: area?.name ?? '' },
      { label: 'Plan year', value: audit.plan_year ? String(audit.plan_year) : '' },
      { label: 'Lead auditor', value: await name(audit.lead_auditor_id) },
      { label: 'Audit team', value: team.join(', ') },
      { label: 'Auditee', value: await name(audit.auditee_id) },
      { label: 'Fieldwork', value: [audit.fieldwork_start, audit.fieldwork_end].filter(Boolean).map((d) => displayDate(String(d))).join(' to ') },
      { label: 'Overall opinion', value: await label('audit_opinion', audit.opinion) },
      { label: 'Report approved', value: audit.report_approved_on ? `${displayDate(String(audit.report_approved_on))} by ${audit.report_approved_by_name ?? ''}` : 'Not yet' },
    ].filter((r) => r.value));
    pdf.heading('Scope and criteria', 2);
    pdf.paragraph(String(audit.scope ?? '').trim() || 'No scope recorded.');
    if (String(audit.criteria ?? '').trim()) pdf.paragraph(String(audit.criteria));
    pdf.heading('Summary', 2);
    pdf.paragraph(String(audit.report_summary ?? '').trim() || 'The report summary has not been written yet.');
    const n = (rows: Row[], k: string, v: string) => rows.find((r) => r[k] === v)?.n ?? 0;
    pdf.figures([
      { label: 'Findings', value: String(findings.length) },
      { label: 'Major nonconformities', value: String(findings.filter((f) => f.rating === 'major_nonconformity').length) },
      { label: 'Checklist items met', value: `${n(answers, 'answer', 'yes')} of ${n(answers, 'answer', 'yes') + n(answers, 'answer', 'no')}` },
      { label: 'Evidence requests', value: String(requests.reduce((t, r) => t + r.n, 0)) },
    ]);
    pdf.heading('Findings', 2);
    if (!findings.length) pdf.note('No findings were raised.');
    for (const f of findings) {
      pdf.heading(`${f.ref} ${f.title}`, 2);
      pdf.keyValues([
        { label: 'Rating', value: ratings.find((r) => r.value === f.rating)?.label ?? String(f.rating ?? '') },
        { label: 'Status', value: statuses.find((r) => r.value === f.status)?.label ?? String(f.status ?? '') },
        { label: 'Criteria', value: String(f.criteria ?? '') },
        { label: 'Condition', value: String(f.condition ?? '') },
        { label: 'Cause', value: String(f.cause ?? '') },
        { label: 'Effect', value: String(f.effect ?? '') },
        { label: 'Recommendation', value: String(f.recommendation ?? '') },
        { label: 'Management response', value: String(f.management_response ?? '') },
        { label: 'Response owner', value: await name(f.response_owner_id) },
        { label: 'Response due', value: f.response_due ? displayDate(String(f.response_due)) : '' },
        { label: 'Corrective action plan', value: caps.get(f.id) ?? '' },
      ].filter((r) => r.value));
    }
    const file = await pdf.finish();
    await ctx.audit(req, { action: 'audit_engagement.report_pdf', recordType: 'audit_engagement', recordId: audit.id, summary: `Audit report PDF made for ${audit.ref}` });
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="audit-report-${String(audit.ref ?? 'audit').replace(/[^A-Za-z0-9-]/g, '')}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(file);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/:id/report.pdf', tag: 'Audits', permission: 'audits.export',
    summary: 'The audit report as a PDF with the organization\'s branding: scope, summary, opinion and every finding with its response',
    description: 'A restricted audit also needs `security.view`, and its PDF is marked restricted on every page. Audited.', response: 'application/pdf',
  });
}
