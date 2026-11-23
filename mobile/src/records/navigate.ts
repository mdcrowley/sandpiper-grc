// Where a My work item or a search result opens: a screen of the app when the app has one, otherwise
// the web page in the browser sheet. Owner: APP-WORK.
import type { MobileWorkItem, MobileWorkKey } from '../../../shared/mobile-api.ts';

export type Target = { app: string } | { web: string };

export const recordHref = (type: string, id: string) => `/record/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
export const approvalHref = (stepId: string) => `/approvals/step/${encodeURIComponent(stepId)}`;
export const acknowledgmentHref = (ackId: string) => `/approvals/acknowledgment/${encodeURIComponent(ackId)}`;

/**
 * My work items: approvals open the approval (item type `workflow_step`, id = the step), policy
 * acknowledgments the policy text (type `policy_acknowledgment`, id = the request), inspections the
 * Field work runner, condition assessments due the Field work assessment, record types the app can
 * show their record view, and anything else (training, say) the web page.
 */
export function workItemTarget(section: MobileWorkKey, item: MobileWorkItem, viewable: (type: string) => boolean): Target {
  if (item.type === 'workflow_step') return { app: approvalHref(item.id) };
  if (item.type === 'policy_acknowledgment') return { app: acknowledgmentHref(item.id) };
  if (section === 'approvals') return { app: '/approvals' };
  if (section === 'acknowledgments') return { app: '/approvals?show=acknowledgments' };
  if (section === 'inspections' && item.type === 'inspection') return { app: `/fieldwork/inspection/${encodeURIComponent(item.id)}` };
  if (section === 'condition') {
    return { app: `/fieldwork/condition?${new URLSearchParams({ type: item.type, id: item.id, label: item.label }).toString()}` };
  }
  if (viewable(item.type)) return { app: recordHref(item.type, item.id) };
  return { web: item.route };
}

/** Search results open in the app when the type has a record view the person may read. */
export function searchTarget(hit: { type: string; id: string; route: string }, viewable: (type: string) => boolean): Target {
  return viewable(hit.type) ? { app: recordHref(hit.type, hit.id) } : { web: hit.route };
}
