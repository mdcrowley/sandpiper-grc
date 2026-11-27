// One approvals inbox (E44-05, review item 7.1): what waits for the signed-in person's decision,
// counted the same way on the Overview ("My approvals"), on My work and on the Approvals page.
//
// Two kinds of item: steps of approval workflows the person is named on (changes, disposals, risk
// acceptances, gates and every other approval kind run on them), and the two decisions that are
// not workflows: exception requests (exceptions.approve) and policies in review (policies.approve).
// Changes awaiting approval are workflow steps, so they are not listed again from the change list.
import { listQuery, moduleOn, modules, useAuth, useFetch, useMeta } from '../../core';
import type { ListResult } from '../../core';
import type { Approval } from './data';

export interface InboxItem {
  key: string;
  to: string;
  title: string;
  reference: string | null;
  /** What kind of decision: the workflow's record type, "Exception request" or "Policy in review". */
  kind: string;
  /** For a workflow step: the step's id, to decide it in place. */
  stepId?: string;
  dueAt?: string | null;
  startedAt?: string | null;
}

const PAGE = 25;

export function useApprovalInbox() {
  const { can, areaOn } = useAuth();
  const { resources } = useMeta();
  const has = (key: string) => modules.some((m) => m.key === key) && moduleOn(key, areaOn);
  const sees = (type: string) => Boolean(resources[type]) && can(`${resources[type].module}.view`);
  const rights = {
    exceptions: has('policies') && sees('policy_exception') && can('exceptions.approve'),
    policies: has('policies') && sees('policy') && can('policies.approve'),
  };
  const steps = useFetch<{ rows: Approval[] }>(has('workflows') ? '/api/workflows/approvals' : null);
  const exceptions = useFetch<ListResult>(rights.exceptions
    ? `/api/exceptions${listQuery({ sort: 'created_at', dir: 'asc', pageSize: PAGE, filters: { status: 'requested' } })}` : null);
  const policies = useFetch<ListResult>(rights.policies
    ? `/api/policies${listQuery({ sort: 'updated_at', dir: 'asc', pageSize: PAGE, filters: { status: 'in_review' } })}` : null);

  const used = [...(has('workflows') ? [steps] : []), ...(rights.exceptions ? [exceptions] : []), ...(rights.policies ? [policies] : [])];
  const error = used.find((s) => s.error)?.error;
  const ready = used.every((s) => s.data);

  const workflowItems = (steps.data?.rows ?? []).map((a): InboxItem => ({
    key: `step-${a.step_id}`, to: a.route, title: a.record_title || 'Untitled', reference: a.record_ref, kind: a.record_type_label,
    stepId: a.step_id, dueAt: a.due_at, startedAt: a.started_at,
  }));
  const otherItems: InboxItem[] = [
    ...(exceptions.data?.rows ?? []).map((row): InboxItem => ({
      key: `exception-${row.id}`, to: `/exceptions/${row.id}`, title: String(row.title ?? ''), reference: (row.ref as string) ?? null, kind: 'Exception request',
    })),
    ...(policies.data?.rows ?? []).map((row): InboxItem => ({
      key: `policy-${row.id}`, to: `/policies/${row.id}`, title: String(row.title ?? ''), reference: (row.ref as string) ?? null, kind: 'Policy in review',
    })),
  ];
  const workflowCount = steps.data?.rows.length ?? 0;
  const otherCount = (exceptions.data?.total ?? 0) + (policies.data?.total ?? 0);
  return {
    /** Workflow steps first, then the other decisions. */
    items: [...workflowItems, ...otherItems],
    workflowItems,
    otherItems,
    otherCount,
    /** Everything waiting, undefined until every list has answered. */
    count: ready ? workflowCount + otherCount : undefined,
    /** Whether the person may decide anything outside workflows (else the inbox is workflow steps only). */
    decidesOthers: rights.exceptions || rights.policies,
    error,
    reload: () => used.forEach((s) => s.reload()),
    /** The rows behind the workflow steps (the Approvals page draws them in full). */
    steps,
  };
}
