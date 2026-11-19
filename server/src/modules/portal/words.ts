// Plain words for the portal: what a ticket's state means to the person who asked, and how the
// short "report a problem" answers map to impact and urgency.
import type { LookupValue, Row } from '../../core/module.ts';

export type Tone = 'blue' | 'purple' | 'amber' | 'green' | 'gray' | 'red';
export interface PlainStatus { key: string; label: string; hint: string; tone: Tone; done: boolean; waiting_on_you: boolean }

/** A status's category (open, paused, resolved, closed), as the service desk settings define it. */
const categoryOf = (meta: Row | undefined): string => String(meta?.category ?? 'open');

export function plainStatus(ticket: Row, statuses: LookupValue[]): PlainStatus {
  const s = statuses.find((x) => x.value === ticket.status);
  const cat = categoryOf(s?.meta);
  // An administrator may give a status its own portal wording (lookup meta `portal_label`).
  const own = typeof s?.meta?.portal_label === 'string' ? String(s.meta.portal_label) : null;
  const make = (key: string, label: string, hint: string, tone: Tone, extra: Partial<PlainStatus> = {}): PlainStatus =>
    ({ key, label: own ?? label, hint, tone, done: false, waiting_on_you: false, ...extra });

  if (ticket.status === 'cancelled') return make('cancelled', 'Canceled', 'This request was canceled. Nothing more will happen.', 'gray', { done: true });
  if (cat === 'closed') return make('closed', 'Closed', 'This request is finished.', 'gray', { done: true });
  if (cat === 'resolved') return make('resolved', 'Resolved', 'IT think this is sorted. If it is not, reopen it.', 'green', { done: true });
  if (ticket.approval_status === 'pending') return make('approval', 'Waiting for approval', 'A manager needs to approve this before work can start.', 'amber');
  if (ticket.approval_status === 'rejected') return make('rejected', 'Not approved', 'This request was not approved. See the messages for why.', 'red');
  if (ticket.status === 'waiting_requester') {
    return make('waiting_you', 'Waiting for you', 'IT have asked you something. Reply below so they can carry on.', 'amber', { waiting_on_you: true });
  }
  if (cat === 'paused') return make('on_hold', 'On hold', 'Work is paused while IT wait on someone else, such as a supplier.', 'purple');
  if (ticket.status === 'new' && !ticket.assignee_id) return make('received', 'Received', 'We have your request. Someone will pick it up soon.', 'blue');
  return make('in_progress', 'Being worked on', 'Someone in IT is working on this.', 'blue');
}

/** "Who is affected" answers, in the order they are offered, and the impact each one means. */
export const AFFECTS: { value: string; label: string; impact: string }[] = [
  { value: 'me', label: 'Just me', impact: 'individual' },
  { value: 'team', label: 'My team, depot or station', impact: 'department' },
  { value: 'service', label: 'Passengers, safety or the whole service', impact: 'organisation' },
];

/** "How urgent" answers and the urgency each one means. */
export const URGENCY: { value: string; label: string; urgency: string }[] = [
  { value: 'stopped', label: 'I cannot work at all', urgency: 'high' },
  { value: 'slowed', label: 'I can work, but it slows me down', urgency: 'medium' },
  { value: 'can_wait', label: 'It can wait', urgency: 'low' },
];
