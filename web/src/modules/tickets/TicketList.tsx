// The queue: presets with live counts (also offered to every agent as shared views of the list,
// E03-20: see server/src/modules/tickets/views.ts), the ticket list with bulk
// edit, and the New ticket dialog.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Countdown, LookupChip, PageHeader, recordHref, ResourceList, useAuth, useFetch,
} from '../../core';
import type { Row } from '../../core';
import { NewTicketDialog } from './NewTicketDialog';
import type { QueueCounts } from './util';

const OPEN = { 'resolved_at.null': 'true' };

interface Preset { label: string; count?: keyof QueueCounts; tone?: 'red' | 'amber'; filters: Record<string, string>; hint: string }

/** Queue presets: plain links, so each can be bookmarked, shared and reached with Back. */
const PRESETS: Preset[] = [
  { label: 'My open', count: 'mine', filters: { assignee_id: 'me', ...OPEN }, hint: 'Unresolved tickets assigned to you' },
  { label: 'Unassigned', count: 'unassigned', filters: { 'assignee_id.null': 'true', ...OPEN }, hint: 'Unresolved tickets nobody has picked up' },
  { label: 'At risk', count: 'at_risk', tone: 'amber', filters: { resolve_warned: 'true', resolve_breached: 'false', ...OPEN }, hint: 'Close to the resolution target' },
  { label: 'Breaching', count: 'breaching', tone: 'red', filters: { resolve_breached: 'true', ...OPEN }, hint: 'Past the resolution target and still open' },
  { label: 'With vendor', count: 'with_vendor', filters: { with_vendor: 'true', ...OPEN }, hint: 'Unresolved tickets held by a vendor' },
  { label: 'Awaiting approval', count: 'awaiting_approval', filters: { approval_status: 'pending', ...OPEN }, hint: 'Requests that cannot start until approved' },
  { label: 'Major incidents', count: 'major', tone: 'red', filters: { major_incident: 'true', ...OPEN }, hint: 'Open major incidents' },
  { label: 'All open', count: 'open', filters: { ...OPEN }, hint: 'Every unresolved ticket' },
  { label: 'All', filters: {}, hint: 'Every ticket, open or not' },
];

const href = (filters: Record<string, string>) => {
  const sp = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) sp.set(`f.${key}`, filters[key]);
  const s = sp.toString();
  return s ? `/tickets?${s}` : '/tickets';
};

/** Search and filters of an address, in one comparable string. */
const canon = (search: string) => [...new URLSearchParams(search)]
  .filter(([k]) => k.startsWith('f.') || k === 'q').map((p) => p.join('=')).sort().join('&');


/** One cell for both clocks' outcome: time left on the resolution target, or how it ended. */
function TargetCell({ row }: { row: Row }) {
  if (!row.resolve_due_at) return <span className="muted">No target</span>;
  return <Countdown deadline={row.resolve_due_at} start={row.opened_at} completedAt={row.resolved_at} paused={Boolean(row.paused_at) && !row.resolved_at} />;
}

function TitleCell({ row }: { row: Row }) {
  return (
    <span className="sd-title-cell">
      <Link className="sd-title-link" to={recordHref('/tickets', row.id)}>{row.title}</Link>
      {row.major_incident && <Badge color="red">Major</Badge>}
      {row.with_vendor && !row.resolved_at && <Badge color="orange">Vendor</Badge>}
      {row.approval_status === 'pending' && <Badge color="amber">Approval</Badge>}
      {row.escalated_at && !row.resolved_at && <Badge color="purple">Escalated</Badge>}
    </span>
  );
}

export function TicketList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<Record<string, unknown> | undefined>();
  const counts = useFetch<QueueCounts>('/api/tickets/queue-counts');

  // "?new=1" (global Create menu) and "?catalog=<id>" (catalog) open the dialog.
  useEffect(() => {
    const wantsNew = params.get('new') === '1';
    const catalog = params.get('catalog');
    if (!wantsNew && !catalog) return;
    const next = new URLSearchParams(params);
    next.delete('new');
    next.delete('catalog');
    setParams(next, { replace: true });
    setInitial(catalog ? { catalog_item_id: catalog } : undefined);
    setOpen(true);
  }, [params, setParams]);

  // "n" starts a new ticket from anywhere on the page that is not a text box.
  useEffect(() => {
    if (!can('tickets.create')) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || open) return;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('[role=dialog]'))) return;
      e.preventDefault();
      setInitial(undefined);
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [can, open]);

  const filterKey = canon(location.search);
  const reloadCounts = counts.reload;
  // The counts follow the list: refresh them whenever the address (and so the list) changes.
  useEffect(() => { reloadCounts(); }, [location.search, reloadCounts]);

  return (
    <div className="sd-queue">
      <PageHeader
        title="Tickets"
        subtitle="Incidents and service requests logged by IT on behalf of colleagues."
        actions={(
          <>
            <Link className="btn btn-secondary" to="/tickets/dashboard">Dashboard</Link>
            {can('tickets.create') && (
              <Button variant="primary" icon="plus" title="Shortcut: N" onClick={() => { setInitial(undefined); setOpen(true); }}>New ticket</Button>
            )}
          </>
        )}
      />
      <nav className="sd-presets" aria-label="Queues">
        {PRESETS.map((p) => {
          const to = href(p.filters);
          const active = canon(to.split('?')[1] ?? '') === filterKey;
          const n = p.count ? counts.data?.[p.count] : undefined;
          return (
            <Link key={p.label} to={to} title={p.hint} aria-current={active ? 'page' : undefined}
              className={`sd-preset${active ? ' is-active' : ''}${p.tone && n ? ` sd-preset-${p.tone}` : ''}`}>
              <span>{p.label}</span>
              {p.count && <span className="sd-preset-count" aria-label={n === undefined ? undefined : `${n} tickets`}>{n ?? '–'}</span>}
            </Link>
          );
        })}
      </nav>
      <ResourceList
        type="ticket"
        urlState
        columns={[
          'ref',
          { field: 'title', sortable: true, render: (row) => <TitleCell row={row} /> },
          { field: 'priority', sortable: true, render: (row) => <LookupChip list="ticket_priority" value={row.priority} /> },
          'status',
          { field: 'resolve_due_at', label: 'Resolution target', sortable: true, render: (row) => <TargetCell row={row} /> },
          { field: 'assignee_id', sortable: true, render: (row) => row._display?.assignee_id ?? <span className="muted">Unassigned</span> },
          'requester_name',
          { field: 'requester_department', hidden: true },
          { field: 'type', hidden: true },
          { field: 'category', hidden: true },
          { field: 'assignment_group', hidden: true },
          'opened_at',
          { field: 'updated_at', hidden: true },
        ]}
        filters={['status', 'priority', 'type', 'category', 'assignment_group', 'assignee_id', 'with_vendor', 'major_incident',
          'resolve_breached', 'response_breached', 'resolve_warned', 'approval_status', 'opened_at', 'resolve_due_at']}
        bulkFields={['assignee_id', 'assignment_group', 'status', 'priority', 'category', 'type']}
      />
      <NewTicketDialog
        open={open}
        initial={initial}
        onClose={() => setOpen(false)}
        onCreated={(row, another) => {
          counts.reload();
          if (another) return;
          setOpen(false);
          navigate(recordHref('/tickets', row.id));
        }}
      />
    </div>
  );
}
