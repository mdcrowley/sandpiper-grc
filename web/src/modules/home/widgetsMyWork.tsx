// "My work": personal lists. These need only the permission of their own area, never
// `dashboards.view`, and the two "mine" endpoints (acknowledgements, training) need no
// permission at all because they return the signed-in person's own records.
import {
  ApiError, Countdown, StatusChip, api, listQuery, lookupColor, relativeTime, useAuth, useFetch, useLookup,
} from '../../core';
import type { ListResult, Row } from '../../core';
import { useCallback, useContext } from 'react';
import { DueChip, WorkCard, WorkTally, type WorkItem } from './parts';
import { useWidgetCtx } from './sources';
import type { WidgetDef } from './types';

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
  // Everything except done and cancelled. The list of statuses is configurable, so read it.
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

/** What this person may approve: changes awaiting approval, requested exceptions, policies in review. */
function approvalRights(ctx: ReturnType<typeof useWidgetCtx>) {
  return {
    changes: ctx.sees('change') && ctx.can('changes.approve'),
    exceptions: ctx.sees('policy_exception') && ctx.can('exceptions.approve'),
    policies: ctx.sees('policy') && ctx.can('policies.approve'),
  };
}

function MyApprovals() {
  const ctx = useWidgetCtx();
  const rights = approvalRights(ctx);
  const changes = useFetch<ListResult>(rights.changes
    ? `/api/changes${listQuery({ sort: 'submitted_at', dir: 'asc', pageSize: 25, filters: { status: 'submitted' } })}` : null);
  const exceptions = useFetch<ListResult>(rights.exceptions
    ? `/api/exceptions${listQuery({ sort: 'created_at', dir: 'asc', pageSize: ROWS, filters: { status: 'requested' } })}` : null);
  const policies = useFetch<ListResult>(rights.policies
    ? `/api/policies${listQuery({ sort: 'updated_at', dir: 'asc', pageSize: ROWS, filters: { status: 'in_review' } })}` : null);

  const used = [
    ...(rights.changes ? [changes] : []), ...(rights.exceptions ? [exceptions] : []), ...(rights.policies ? [policies] : []),
  ];
  const failed = used.find((s) => s.error);
  const ready = used.every((s) => s.data);

  // A person cannot approve a change they raised themselves, so those are left out.
  const own = (row: Row) => row.created_by === ctx.userId;
  const changeRows = changes.data?.rows.filter((row) => !own(row)) ?? [];
  const changeCount = changes.data ? changes.data.total - (changes.data.rows.length - changeRows.length) : 0;

  const items: WorkItem[] = [
    ...changeRows.map((row): WorkItem => ({
      key: `change-${row.id}`, to: `/changes/${row.id}`, title: row.title, reference: row.ref,
      meta: <StatusChip color="blue" label={`Change${row.submitted_at ? `, submitted ${relativeTime(row.submitted_at)}` : ''}`} />,
    })),
    ...(exceptions.data?.rows ?? []).map((row): WorkItem => ({
      key: `exception-${row.id}`, to: `/exceptions/${row.id}`, title: row.title, reference: row.ref,
      meta: <StatusChip color="purple" label="Exception request" />,
    })),
    ...(policies.data?.rows ?? []).map((row): WorkItem => ({
      key: `policy-${row.id}`, to: `/policies/${row.id}`, title: row.title, reference: row.ref,
      meta: <StatusChip color="amber" label="Policy in review" />,
    })),
  ];
  const count = changeCount + (exceptions.data?.total ?? 0) + (policies.data?.total ?? 0);
  const to = rights.changes ? '/changes?view=awaiting'
    : rights.exceptions ? '/exceptions?f.status=requested' : '/policies?f.status=in_review';

  return (
    <WorkCard id="my-approvals" title="My approvals" icon="check-circle" to={to}
      items={ready ? items.slice(0, ROWS) : undefined} count={ready ? count : undefined}
      error={failed?.error} reload={() => used.forEach((s) => s.reload())}
      emptyText="Nothing is waiting for your approval." />
  );
}

interface MineAcks { awaiting: { id: string; policy_ref: string | null; policy_title: string; due_on: string | null }[] }

function MyAcknowledgements() {
  const { data, error, reload } = useFetch<MineAcks>('/api/policies/acknowledgements/mine');
  if (absent(error)) return null;
  const items = data?.awaiting.slice(0, ROWS).map((ack): WorkItem => ({
    key: ack.id, to: '/policies/acknowledgements', title: ack.policy_title, reference: ack.policy_ref, meta: <DueChip date={ack.due_on} />,
  }));
  return (
    <WorkCard id="my-acknowledgements" title="My acknowledgements" icon="file-text" to="/policies/acknowledgements"
      items={items} count={data?.awaiting.length} error={error} reload={reload} emptyText="You have no policies to acknowledge." />
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

function MyNotifications() {
  const { data, error, reload } = useFetch<MineNotifications>('/api/notifications?unread=true&pageSize=5');
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
    <WorkCard id="my-notifications" title="My notifications" icon="bell" to="/notifications"
      items={items} count={data?.total} error={error} reload={reload} emptyText="You have no unread notifications." />
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
    id: 'my-actions', title: 'My actions', group: 'mywork', description: 'Actions you own that are not done or cancelled.',
    visible: (ctx) => ctx.sees('action'), render: () => <MyActions />,
  },
  {
    id: 'my-approvals', title: 'My approvals', group: 'mywork',
    description: 'Changes, exception requests and policies waiting for an approval you can give.',
    visible: (ctx) => Object.values(approvalRights(ctx)).some(Boolean), render: () => <MyApprovals />,
  },
  {
    id: 'my-acknowledgements', title: 'My acknowledgements', group: 'mywork', description: 'Policies you have been asked to read and acknowledge.',
    visible: (ctx) => ctx.hasModule('policies'), render: () => <MyAcknowledgements />,
  },
  {
    id: 'my-training', title: 'My training', group: 'mywork', description: 'Courses assigned to you that you have not completed.',
    visible: (ctx) => ctx.hasModule('training'), render: () => <MyTraining />,
  },
  {
    id: 'my-notifications', title: 'My notifications', group: 'mywork', description: 'Your unread notifications.',
    visible: (ctx) => ctx.hasModule('notifications'), render: () => <MyNotifications />,
  },
  {
    id: 'my-watching', title: 'Watching', group: 'mywork', description: 'Records you watch, newest first. Not counted as work waiting.',
    visible: () => true, render: () => <MyWatching />,
  },
];
