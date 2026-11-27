// "My work": personal lists. These need only the permission of their own area, never
// `dashboards.view`, and the two "mine" endpoints (acknowledgments, training) need no
// permission at all because they return the signed-in person's own records.
import {
  ApiError, Countdown, StatusChip, api, listQuery, lookupColor, relativeTime, useAuth, useFetch, useLookup,
} from '../../core';
import type { ListResult } from '../../core';
import { useCallback, useContext } from 'react';
import { useApprovalInbox } from '../workflows/inbox';
import { DueChip, WorkCard, WorkTally, type WorkItem } from './parts';
import type { WidgetDef } from './types';
import type { MyDueWork } from '../../../../shared/work-api.ts';

const ROWS = 5;

/** The server module behind a "mine" endpoint is not loaded: show nothing rather than an error. */
const absent = (error: unknown) => error instanceof ApiError && error.status === 404;

function MyTickets() {
  const { user } = useAuth();
  const query = { sort: 'resolve_due_at', dir: 'asc' as const, filters: { assignee_id: user?.id ?? 'me', 'resolved_at.null': true } };
  const { data, error, reload } = useFetch<ListResult>(`/api/tickets${listQuery({ ...query, pageSize: ROWS })}`);
  const items = data?.rows.map((row): WorkItem => ({
    key: row.id,
    to: `/tickets/${row.id}`,
    title: row.title,
    reference: row.ref,
    meta: row.resolve_due_at
      ? <Countdown label="Resolve" deadline={row.resolve_due_at} start={row.opened_at} />
      : <StatusChip color={lookupColor('ticket_status', row.status)} label={row._display?.status ?? row.status} />,
  }));
  return (
    <WorkCard id="my-tickets" title="My tickets" icon="ticket" to={`/tickets${listQuery(query)}`}
      items={items} count={data?.total} error={error} reload={reload} emptyText="No open tickets are assigned to you." />
  );
}

function MyActions() {
  const { user } = useAuth();
  const statuses = useLookup('action_status');
  // Everything except done and canceled. The list of statuses is configurable, so read it.
  const open = statuses
    .filter((s) => !['done', 'cancelled'].includes(s.value) && (s as { meta?: { closed?: boolean } }).meta?.closed !== true)
    .map((s) => s.value);
  const query = {
    sort: 'due_on', dir: 'asc' as const,
    filters: { owner_id: user?.id ?? 'me', status: open.length ? open : ['open', 'in_progress', 'blocked'] },
  };
  const { data, error, reload } = useFetch<ListResult>(`/api/actions${listQuery({ ...query, pageSize: ROWS })}`);
  const items = data?.rows.map((row): WorkItem => ({
    key: row.id, to: `/actions/${row.id}`, title: row.title, reference: row.ref, meta: <DueChip date={row.due_on} />,
  }));
  return (
    <WorkCard id="my-actions" title="My actions" icon="check-square" to={`/actions${listQuery(query)}`}
      items={items} count={data?.total} error={error} reload={reload} emptyText="You have no actions to do." />
  );
}

/**
 * Everything waiting for this person's decision (E44-05): the same inbox, and so the same count, as
 * My work > Approvals and the Approvals page. Workflow steps (changes, disposals and every other approval
 * kind) where the person is a named approver, then exception requests and policies in review.
 */
function MyApprovals() {
  const inbox = useApprovalInbox();
  const items = inbox.count === undefined ? undefined : inbox.items.slice(0, ROWS).map((i): WorkItem => ({
    key: i.key, to: i.to, title: i.title, reference: i.reference,
    meta: i.dueAt ? <Countdown label="Due" deadline={i.dueAt} start={i.startedAt ?? undefined} /> : <StatusChip color={i.stepId ? 'blue' : 'purple'} label={i.kind} />,
  }));
  return (
    <WorkCard id="my-approvals" title="My approvals" icon="check-circle" to="/approvals"
      items={items} count={inbox.count} error={inbox.error} reload={inbox.reload}
      emptyText="Nothing is waiting for your approval." />
  );
}

/**
 * Due work of every other kind, from one list (E41-03): evidence requests, control tests, verifications,
 * inspections, obligation periods to attest, vendor reassessments, certifications and the rest. Each kind
 * is a calendar source its module registers on the server; switched-off areas are left out there.
 */
function MyDueWorkCard() {
  // Actions have a list of their own (My actions), so they are left out here.
  const { data, error, reload } = useFetch<MyDueWork>('/api/work/mine?limit=5&skip=actions.due');
  if (absent(error)) return null;
  const items = data?.sections.flatMap((s) => s.items)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.start.localeCompare(b.start))
    .slice(0, ROWS)
    .map((i): WorkItem => ({
      key: i.uid, to: i.url, title: i.title,
      meta: <DueChip date={i.start.slice(0, 10)} />,
    }));
  return (
    <WorkCard id="my-due-work" title="My due work" icon="calendar" to="/calendar?view=mine"
      items={items} count={data?.total} error={error} reload={reload}
      emptyText="Nothing of yours is overdue or due in the next 30 days." />
  );
}

interface MineAcks { awaiting: { id: string; policy_ref: string | null; policy_title: string; due_on: string | null }[] }

function MyAcknowledgments() {
  const { data, error, reload } = useFetch<MineAcks>('/api/policies/acknowledgments/mine');
  if (absent(error)) return null;
  const items = data?.awaiting.slice(0, ROWS).map((ack): WorkItem => ({
    key: ack.id, to: '/policies/acknowledgments', title: ack.policy_title, reference: ack.policy_ref, meta: <DueChip date={ack.due_on} />,
  }));
  return (
    <WorkCard id="my-acknowledgments" title="My acknowledgments" icon="file-text" to="/policies/acknowledgments"
      items={items} count={data?.awaiting.length} error={error} reload={reload} emptyText="You have no documents to acknowledge." />
  );
}

interface MineTraining { rows: { id: string; course_title: string; course_ref: string | null; due_on: string | null; completed_on: string | null }[] }

function MyTraining() {
  const { data, error, reload } = useFetch<MineTraining>('/api/training/mine');
  if (absent(error)) return null;
  const todo = data?.rows.filter((r) => !r.completed_on);
  const items = todo?.slice(0, ROWS).map((r): WorkItem => ({
    key: r.id, to: '/training/mine', title: r.course_title, reference: r.course_ref, meta: <DueChip date={r.due_on} />,
  }));
  return (
    <WorkCard id="my-training" title="My training" icon="graduation" to="/training/mine"
      items={items} count={todo?.length} error={error} reload={reload} emptyText="You have no training to complete." />
  );
}

interface MineNotifications {
  rows: { id: string; title: string; route: string | null; created_at: string }[];
  total: number;
}

/** Unread notifications. Not counted as work waiting (E44-05): the bell already counts them, and the work they tell of is counted in its own list. */
function MyNotifications() {
  const { data, error, reload } = useFetch<MineNotifications>('/api/notifications?unread=true&pageSize=5');
  const parent = useContext(WorkTally);
  const report = useCallback((id: string, n: number | null) => parent(id, n === null ? null : 0), [parent]);
  if (absent(error)) return null;
  const items = data?.rows.map((n): WorkItem => ({
    key: n.id,
    to: n.route ?? '/notifications',
    title: n.title,
    meta: <span className="muted">{relativeTime(n.created_at)}</span>,
    // Opening a notification from here marks it as read, as the bell does.
    onOpen: () => { api.post(`/api/notifications/${n.id}/read`, {}).catch(() => {}); },
  }));
  return (
    <WorkTally.Provider value={report}>
      <WorkCard id="my-notifications" title="My notifications" icon="bell" to="/notifications"
        items={items} count={data?.total} error={error} reload={reload} emptyText="You have no unread notifications." />
    </WorkTally.Provider>
  );
}

interface Watched { type: string; typeLabel: string; id: string; label: string; ref: string | null; route: string; since: string }

/** Records the person follows (the Watch button on a record page). Not counted as work waiting. */
function MyWatching() {
  const { data, error, reload } = useFetch<Watched[]>('/api/me/watching');
  const parent = useContext(WorkTally);
  // Following a record is not work to do: tell the section "nothing waiting" once loaded.
  const report = useCallback((id: string, n: number | null) => parent(id, n === null ? null : 0), [parent]);
  if (absent(error)) return null;
  const items = data?.slice(0, ROWS).map((w): WorkItem => ({
    key: `${w.type}-${w.id}`, to: `${w.route}/${w.id}`, title: w.label, reference: w.ref,
    meta: <span className="muted">{w.typeLabel}</span>,
  }));
  return (
    <WorkTally.Provider value={report}>
      <WorkCard id="my-watching" title="Watching" icon="eye"
        items={items} count={data?.length} error={error} reload={reload}
        emptyText="You are not watching any records. Use Watch on a record to be told when it changes." />
    </WorkTally.Provider>
  );
}

export const MY_WORK_WIDGETS: WidgetDef[] = [
  {
    id: 'my-tickets', title: 'My tickets', group: 'mywork', description: 'Open tickets assigned to you.',
    visible: (ctx) => ctx.sees('ticket'), render: () => <MyTickets />,
  },
  {
    id: 'my-actions', title: 'My actions', group: 'mywork', description: 'Actions you own that are not done or canceled.',
    visible: (ctx) => ctx.sees('action'), render: () => <MyActions />,
  },
  {
    id: 'my-approvals', title: 'My approvals', group: 'mywork',
    description: 'Approval steps where you are an approver (changes, disposals and the rest), exception requests and policies in review: the same list as Approvals.',
    visible: () => true, render: () => <MyApprovals />,
  },
  {
    id: 'my-due-work', title: 'My due work', group: 'mywork',
    description: 'Evidence requests, control tests, verifications, inspections, attestations, reassessments, certifications and other work of yours that is overdue or due in the next 30 days.',
    visible: (ctx) => ctx.hasModule('work'), render: () => <MyDueWorkCard />,
  },
  {
    id: 'my-acknowledgments', title: 'My acknowledgments', group: 'mywork', description: 'Policies you have been asked to read and acknowledge.',
    visible: (ctx) => ctx.hasModule('policies'), render: () => <MyAcknowledgments />,
  },
  {
    id: 'my-training', title: 'My training', group: 'mywork', description: 'Courses assigned to you that you have not completed.',
    visible: (ctx) => ctx.hasModule('training'), render: () => <MyTraining />,
  },
  {
    id: 'my-notifications', title: 'My notifications', group: 'mywork', description: 'Your unread notifications. Not counted as work waiting.',
    visible: (ctx) => ctx.hasModule('notifications'), render: () => <MyNotifications />,
  },
  {
    id: 'my-watching', title: 'Watching', group: 'mywork', description: 'Records you watch, newest first. Not counted as work waiting.',
    visible: () => true, render: () => <MyWatching />,
  },
];
