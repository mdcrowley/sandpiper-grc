import { z } from 'zod';
import { ToolError } from './caller.ts';
import { fail, isUuid, plural, type ToolContext, type ToolSpec } from './toolkit.ts';

// Approval workflows (E14-06): what is waiting for the caller's decision, and deciding it. Both go
// through /api/workflows with the caller's token, so the same rules apply as in the application:
// nobody decides their own request, restricted records stay hidden, a rejection needs a reason.

interface Approval {
  step_id: string; workflow: string; step: string; position: number; steps_total: number; record_type: string; record_id: string; record_type_label: string;
  record_ref: string | null; record_title: string; route: string; requested_by_name: string | null; due_at: string | null;
  overdue: boolean; escalated: boolean; approvals: number; required: number;
}

const NOT_HERE = 'Approval workflows are not available on this server.';

async function waiting(t: ToolContext): Promise<Approval[]> {
  try {
    return (await t.api.get<{ rows: Approval[] }>('/api/workflows/approvals')).rows;
  } catch (err) {
    if (err instanceof ToolError && err.status === 404) fail(NOT_HERE, 'unavailable');
    throw err;
  }
}

const line = (a: Approval) => `- ${a.record_type_label} ${a.record_ref ?? ''} "${a.record_title}": ${a.workflow}, step ${a.position + 1} of ${a.steps_total} (${a.step}), `
  + `${a.approvals} of ${a.required} approvals${a.due_at ? `, due ${a.due_at}${a.overdue ? ' (overdue)' : ''}` : ''}${a.requested_by_name ? `, asked by ${a.requested_by_name}` : ''} [step_id ${a.step_id}]`;

const myApprovals: ToolSpec = {
  name: 'my_approvals', title: 'My pending approvals', group: 'Work and insight', idempotent: true,
  description: 'Lists the approval steps waiting for your decision (from the approval workflows an administrator set up), '
    + 'soonest due first, with the record, the workflow and step, how many approvals the step has and needs, and its step_id for decide_approval.',
  input: {},
  async run(_args, t) {
    const rows = await waiting(t);
    const items = rows.map((a) => ({ ...a, url: `${t.baseUrl}${a.route}` }));
    return {
      text: rows.length ? `${plural(rows.length, 'approval')} waiting for you:\n${rows.map(line).join('\n')}` : 'Nothing is waiting for your approval.',
      data: { total: rows.length, approvals: items },
    };
  },
};

const decideApproval: ToolSpec = {
  name: 'decide_approval', title: 'Approve or reject', group: 'Changes', write: true,
  description: 'Approves or rejects one approval step waiting for you (use my_approvals for the step_id). A rejection needs a comment saying why. '
    + 'You cannot decide a request you made yourself. Confirm with the person before deciding on their behalf.',
  input: {
    step_id: z.string().min(1).describe('The step_id from my_approvals.'),
    decision: z.enum(['approve', 'reject']).describe('approve or reject.'),
    comment: z.string().max(2000).optional().describe('Why; required when rejecting.'),
  },
  async run(args, t) {
    if (!isUuid(args.step_id)) fail('Give the step_id from my_approvals.', 'validation', { step_id: 'Not a step id.' });
    if (args.decision === 'reject' && !args.comment?.trim()) fail('Say why you reject it.', 'validation', { comment: 'Say why you reject it.' });
    const item = (await waiting(t)).find((a) => a.step_id === args.step_id);
    if (!item) fail('That step is not waiting for your decision. Use my_approvals for the current list.', 'not_found');
    const res = await t.api.post<{ stepOutcome: string; approvalsReceived: number; approvalsRequired: number; instance: { status: string } }>(
      `/api/workflows/steps/${args.step_id}/decision`, { decision: args.decision === 'approve' ? 'approved' : 'rejected', comment: args.comment ?? null });
    const name = `${item!.record_type_label.toLowerCase()} ${item!.record_ref ?? `"${item!.record_title}"`}`;
    const what = args.decision === 'approve' ? 'Approved' : 'Rejected';
    const after = res.instance?.status === 'running'
      ? res.stepOutcome === 'pending' ? ` The step now has ${res.approvalsReceived} of ${res.approvalsRequired} approvals.` : ' The workflow moved on to its next step.'
      : ` The workflow is now ${res.instance?.status}.`;
    return {
      text: `${what} "${item!.step}" of ${item!.workflow} on ${name}.${after} Open: ${t.baseUrl}${item!.route}`,
      data: { step_id: args.step_id, decision: args.decision, step_outcome: res.stepOutcome, workflow_status: res.instance?.status ?? null, url: `${t.baseUrl}${item!.route}` },
      audit: { recordType: item!.record_type, recordId: item!.record_id, summary: `${what} step "${item!.step}" of ${item!.workflow} on ${name}` },
    };
  },
};

export const APPROVAL_TOOLS: ToolSpec[] = [myApprovals, decideApproval];
