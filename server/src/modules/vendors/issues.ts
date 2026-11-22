// The vendor issues register (E35-03): problems with a vendor (a service failure, a security or billing
// problem, a compliance gap) tracked to resolution, each of which may raise a corrective action plan
// (record type `cap`, risks module, contract C1; source `vendor`).
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';
import { localDate } from './dates.ts';

export const ISSUE_STATUSES: LookupValue[] = [
  { value: 'open', label: 'Open', color: 'red', sort: 10 },
  { value: 'in_progress', label: 'In progress', color: 'amber', sort: 20 },
  { value: 'resolved', label: 'Resolved', color: 'green', sort: 30, meta: { closed: true } },
  { value: 'closed', label: 'Closed', color: 'gray', sort: 40, meta: { closed: true } },
];

export async function ensureIssueLists(ctx: ModuleContext): Promise<void> {
  const own = { module: 'vendors' };
  await ctx.lookups.ensure('vendor_issue_category', [
    { value: 'service_failure', label: 'Service failure', color: 'orange', sort: 10 },
    { value: 'security', label: 'Security', color: 'red', sort: 20 },
    { value: 'billing', label: 'Billing', color: 'blue', sort: 30 },
    { value: 'compliance', label: 'Compliance', color: 'purple', sort: 40 },
    { value: 'safety', label: 'Safety', color: 'amber', sort: 50 },
    { value: 'other', label: 'Other', color: 'gray', sort: 60 },
  ], own);
  await ctx.lookups.ensure('vendor_issue_severity', [
    { value: 'critical', label: 'Critical', color: 'red', sort: 10 },
    { value: 'high', label: 'High', color: 'orange', sort: 20 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 30 },
    { value: 'low', label: 'Low', color: 'gray', sort: 40 },
  ], own);
  await ctx.lookups.ensure('vendor_issue_status', ISSUE_STATUSES, own);
}

const closedStatuses = async (ctx: ModuleContext) => {
  const out = (await ctx.lookups.values('vendor_issue_status')).filter((v) => (v.meta as Row | undefined)?.closed).map((v) => v.value);
  return out.length ? out : ['resolved', 'closed'];
};

export function registerIssues(ctx: ModuleContext): void {
  const { app, db } = ctx;

  async function check(merged: Row, patch: Row, existing: Row | null) {
    const fields: Record<string, string> = {};
    if (!(await ctx.resources.find('vendor', merged.vendor_id))) fields.vendor_id = 'Vendor not found.';
    if (merged.contract_id && (patch.contract_id !== undefined || patch.vendor_id !== undefined)) {
      const contract = await ctx.resources.find('contract', merged.contract_id);
      if (!contract) fields.contract_id = 'Contract not found.';
      else if (contract.vendor_id !== merged.vendor_id) fields.contract_id = 'This contract belongs to a different vendor.';
    }
    const closed = await closedStatuses(ctx);
    const closing = closed.includes(merged.status) && (!existing || !closed.includes(existing.status));
    if (closing && !String(merged.resolution ?? '').trim()) fields.resolution = 'Say how the issue was resolved.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (closing && !merged.resolved_on) patch.resolved_on = localDate();
    if (!existing && !patch.raised_on) patch.raised_on = localDate();
  }

  ctx.defineResource({
    type: 'vendor_issue', table: 'vendor_issues', module: 'vendors', label: 'Vendor issue', plural: 'Vendor issues',
    path: '/api/vendor-issues', route: '/vendors/issues', titleField: 'title', ref: { field: 'ref', prefix: 'VIS-' },
    searchable: ['title', 'description', 'resolution'],
    defaultSort: { field: 'raised_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Issue', type: 'text', required: true },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', required: true },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
      category: { label: 'Category', type: 'lookup', list: 'vendor_issue_category', default: 'service_failure' },
      severity: { label: 'Severity', type: 'lookup', list: 'vendor_issue_severity', default: 'medium' },
      status: { label: 'Status', type: 'lookup', list: 'vendor_issue_status', default: 'open' },
      owner_id: { label: 'Owner', type: 'user' },
      raised_on: { label: 'Raised on', type: 'date' },
      description: { label: 'What happened', type: 'longtext' },
      resolution: { label: 'Resolution', type: 'longtext' },
      resolved_on: { label: 'Resolved on', type: 'date' },
      cap_id: { label: 'Corrective action plan', type: 'ref', to: 'cap', readOnly: true },
    },
    hooks: {
      beforeCreate: async (_req, data) => { await check(data, data, null); return data; },
      beforeUpdate: async (_req, existing, patch) => { await check({ ...existing, ...patch }, patch, existing); return patch; },
    },
  });

  const needIssue = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id ?? '');
    if (!UUID_RE.test(id)) ctx.fail(404, 'not_found', 'Vendor issue not found.');
    return (await ctx.resources.find('vendor_issue', id, req.user)) ?? ctx.fail(404, 'not_found', 'Vendor issue not found.');
  };

  app.post('/api/vendor-issues/:id/cap', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const issue = await needIssue(req);
    const capDef = ctx.resources.get('cap');
    if (!capDef) ctx.fail(409, 'caps_unavailable', 'Corrective action plans are not part of this installation.');
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'Raising a corrective action plan also needs permission to create actions.');
    if (issue.cap_id && (await ctx.resources.find('cap', issue.cap_id))) ctx.fail(409, 'cap_exists', 'This issue already has a corrective action plan.');
    if ((await closedStatuses(ctx)).includes(issue.status)) ctx.fail(409, 'closed', 'This issue is resolved or closed.');
    const vendor = await db.one<Row>('select name from vendors where id = $1', [issue.vendor_id]);
    const b = (req.body ?? {}) as Row;
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const data: Row = {
      title: (text(b.title, 200) ?? `${vendor?.name ?? 'Vendor'}: ${issue.title}`).slice(0, 200),
      source: 'vendor', source_type: 'vendor_issue', source_id: issue.id,
      problem_statement: text(b.problem_statement, 8000)
        ?? [issue.description, `Raised from vendor issue ${issue.ref} with ${vendor?.name ?? 'a vendor'}.`].filter(Boolean).join('\n\n'),
      responsible_id: b.responsible_id ?? issue.owner_id ?? null,
      due_on: b.due_on ?? null,
    };
    for (const k of Object.keys(data)) if (!(k in capDef!.fields) || data[k] === null) delete data[k];
    const cap = await ctx.resources.create('cap', data, req);
    // The record-change listener below links the plan and moves the issue on.
    await ctx.audit(req, {
      action: 'vendor_issue.cap', recordType: 'vendor_issue', recordId: issue.id,
      summary: `Corrective action plan ${cap.ref ?? cap.title} raised from vendor issue ${issue.ref}`, after: { cap_id: cap.id },
    });
    reply.code(201);
    return { cap: { id: cap.id, ref: cap.ref ?? null, title: cap.title, route: capDef!.route ? `${capDef!.route}/${cap.id}` : null } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-issues/:id/cap', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Raise a corrective action plan from a vendor issue (also needs actions.create); the plan\'s source is Vendor and the issue records it',
    description: '409 `caps_unavailable` when corrective action plans are not loaded or switched off; 409 `cap_exists` when the issue already has one; 409 `closed` when the issue is resolved or closed.',
    body: '{ title?, problem_statement?, responsible_id?, due_on? }', response: '{ cap: { id, ref, title, route } }',
  });

  // However a plan is raised for an issue (here, or from the plan panel on the issue's page), the issue
  // records the first one and is in progress.
  ctx.resources.onChange?.(async (c) => {
    if (c.action !== 'create' || c.def.type !== 'cap' || c.row.source_type !== 'vendor_issue' || !c.row.source_id || !UUID_RE.test(String(c.row.source_id))) return;
    const issue = await db.one<Row>('select id, cap_id, status from vendor_issues where id = $1 and deleted_at is null', [String(c.row.source_id)]);
    if (!issue || issue.cap_id) return;
    await ctx.resources.update('vendor_issue', issue.id, { cap_id: c.row.id, ...(issue.status === 'open' ? { status: 'in_progress' } : {}) }, null);
  });
}
