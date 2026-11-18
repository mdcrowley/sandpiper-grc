// Tickets list with quick views, starter saved views and the New ticket dialog.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, Badge, Button, LookupChip, PageHeader, recordHref, ResourceList, timeZone, useAuth } from '../../core';
import type { Row } from '../../core';
import { NewTicketDialog } from './NewTicketDialog';

const OPEN = { 'resolved_at.null': 'true' };

/** Quick views: plain links, so they can be bookmarked and shared. */
const QUICK: { label: string; filters: Record<string, string> }[] = [
  { label: 'All', filters: {} },
  { label: 'My open', filters: { assignee_id: 'me', ...OPEN } },
  { label: 'Unassigned', filters: { 'assignee_id.null': 'true', ...OPEN } },
  { label: 'Breaching', filters: { resolve_breached: 'true', ...OPEN } },
  { label: 'With vendor', filters: { with_vendor: 'true', ...OPEN } },
  { label: 'Major incidents', filters: { major_incident: 'true' } },
];

const href = (filters: Record<string, string>) => {
  const sp = new URLSearchParams();
  for (const [k, val] of Object.entries(filters)) sp.set(`f.${k}`, val);
  const s = sp.toString();
  return s ? `/tickets?${s}` : '/tickets';
};

/** Puts the four starter views into the list's saved views the first time this browser opens the list. */
function ensureStarterViews() {
  try {
    if (localStorage.getItem('grc.views.ticket.starter')) return;
    const existing: { name: string }[] = JSON.parse(localStorage.getItem('grc.views.ticket') ?? '[]');
    const starters = QUICK.slice(1, 5).filter((q) => !existing.some((e) => e.name === q.label)).map((q) => ({
      name: q.label,
      view: {
        q: '', sort: '', dir: 'asc',
        filters: Object.fromEntries(Object.entries(q.filters).map(([k, val]) => [k, [val]])),
        labels: q.filters.assignee_id === 'me' ? { assignee_id: 'Me' } : {},
      },
    }));
    localStorage.setItem('grc.views.ticket', JSON.stringify([...existing, ...starters]));
    localStorage.setItem('grc.views.ticket.starter', '1');
  } catch {
    // Storage unavailable: the quick views above the list still work.
  }
}

function slaCell(row: Row) {
  if (row.resolve_breached || row.response_breached) return <Badge color="red">Target missed</Badge>;
  if (row.paused_at) return <Badge color="gray">Paused</Badge>;
  if (row.resolved_at) return <Badge color="green">Met</Badge>;
  return <Badge color="blue">On track</Badge>;
}

export function TicketList() {
  useMemo(ensureStarterViews, []);
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<Record<string, unknown> | undefined>();

  // "?new=1" (global Create menu) and "?catalog=<id>" (catalogue) open the dialog.
  useEffect(() => {
    const wantsNew = params.get('new') === '1';
    const catalog = params.get('catalog');
    if (!wantsNew && !catalog) return;
    const next = new URLSearchParams(params);
    next.delete('new');
    next.delete('catalog');
    setParams(next, { replace: true });
    if (!catalog) { setInitial(undefined); setOpen(true); return; }
    api.get<Row>(`/api/catalog-items/${catalog}`)
      .then((item) => setInitial({ ...(item.defaults ?? {}), catalog_item_id: item.id }))
      .catch(() => setInitial(undefined))
      .finally(() => setOpen(true));
  }, [params, setParams]);

  const canon = (search: string) => [...new URLSearchParams(search)]
    .filter(([k]) => k.startsWith('f.') || k === 'q').map((p) => p.join('=')).sort().join('&');
  const filterKey = canon(location.search);
  const newButton = can('tickets.create')
    ? <Button variant="primary" icon="plus" onClick={() => { setInitial(undefined); setOpen(true); }}>New ticket</Button>
    : null;

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle="Incidents and service requests logged by IT on behalf of colleagues."
        actions={<><Link className="sd-link" to="/tickets/dashboard">Dashboard</Link>{newButton}</>}
      />
      <nav className="sd-quick" aria-label="Quick views">
        <span className="muted">Quick views:</span>
        {QUICK.map((q) => {
          const to = href(q.filters);
          const active = canon(to.split('?')[1] ?? '') === filterKey;
          return <Link key={q.label} to={to} className={active ? 'sd-quick-link is-active' : 'sd-quick-link'} aria-current={active ? 'page' : undefined}>{q.label}</Link>;
        })}
      </nav>
      <ResourceList
        // The list reads the address once, so remount it when a quick view changes the filters.
        key={filterKey}
        type="ticket"
        columns={[
          'ref', 'title',
          { field: 'priority', render: (row) => <LookupChip list="ticket_priority" value={row.priority} />, sortable: true },
          'status', 'type', 'requester_name', 'requester_department', 'assignee_id',
          { field: 'resolve_due_at', label: 'Resolve by', sortable: true,
            render: (row) => (row.resolved_at ? '—' : row.paused_at ? 'Paused' : <ResolveBy row={row} />) },
          { field: 'sla', label: 'Targets', render: slaCell },
          'opened_at',
        ]}
        filters={['status', 'priority', 'type', 'category', 'assignment_group', 'assignee_id', 'with_vendor', 'major_incident',
          'resolve_breached', 'response_breached', 'opened_at', 'resolve_due_at']}
      />
      <NewTicketDialog
        open={open}
        initial={initial}
        onClose={() => setOpen(false)}
        onCreated={(row) => { setOpen(false); navigate(recordHref('/tickets', row.id)); }}
      />
    </>
  );
}

function ResolveBy({ row }: { row: Row }) {
  if (!row.resolve_due_at) return <span className="muted">No target</span>;
  const late = new Date(row.resolve_due_at).getTime() < Date.now();
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(row.resolve_due_at));
  return <span className={late ? 'sd-late' : undefined}>{text}</span>;
}
