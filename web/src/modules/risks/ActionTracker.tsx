import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SegmentedControl, TextInput } from '@mantine/core';
import {
  api, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Icon, Loading, LookupSelect, Modal, PageHeader,
  ResourceForm, ResourceList, Select, useAuth, useDebounced, useFetch, useLookup, useMeta, UserPicker, useToast,
} from '../../core';
import type { ListResult, Row } from '../../core';
import { ActionRows, QuickAdd } from './ActionRows';
import { ActionStatus } from './ActionStatus';

interface Group { value: string | null; label: string; open: number; overdue: number; owner_id?: string | null }
export interface ActionSummary {
  open: number;
  overdue: number;
  due_this_week: number;
  unassigned: number;
  today: string;
  week_end: string;
  open_statuses: string[];
  mine: { open: number; overdue: number; due_this_week: number };
  by_owner: Group[];
  by_source: Group[];
  by_department: Group[];
}

type GroupKey = 'week' | 'owner' | 'source' | 'list';
type Show = 'open' | 'overdue' | 'week' | 'unassigned';
const GROUPS: { value: GroupKey; label: string }[] = [
  { value: 'week', label: 'By due week' },
  { value: 'owner', label: 'By owner' },
  { value: 'source', label: 'By source' },
  { value: 'list', label: 'List' },
];
const SHOW_LABEL: Record<Show, string> = { open: 'Open', overdue: 'Overdue', week: 'Due this week', unassigned: 'Unassigned' };

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Monday of the week a date falls in. */
const weekStart = (ymd: string) => addDays(ymd, -((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7));

interface Section { key: string; label: string; hint?: string; rows: Row[]; tone?: 'red' }

/** Splits open actions into sections for the chosen grouping, in the order a review reads them. */
function sections(rows: Row[], group: Exclude<GroupKey, 'list'>, today: string, sourceLabel: (v: string) => string): Section[] {
  const map = new Map<string, Section>();
  const put = (key: string, label: string, row: Row, extra: Partial<Section> = {}) => {
    const s = map.get(key) ?? { key, label, rows: [], ...extra };
    s.rows.push(row);
    map.set(key, s);
  };
  if (group === 'week') {
    const thisWeek = weekStart(today);
    for (const r of rows) {
      if (!r.due_on) put('9999-none', 'No due date', r);
      else if (r.due_on < today) put('0000-overdue', 'Overdue', r, { tone: 'red' });
      else {
        const start = weekStart(r.due_on);
        const label = start === thisWeek ? 'This week' : start === addDays(thisWeek, 7) ? 'Next week' : `Week of ${formatDate(start)}`;
        put(start, label, r, { hint: `${formatDate(start)} to ${formatDate(addDays(start, 6))}` });
      }
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  for (const r of rows) {
    if (group === 'owner') put(r.owner_id ?? '', r._display?.owner_id ?? 'Unassigned', r);
    else put(r.source ?? '', r.source ? sourceLabel(r.source) : 'No source', r);
  }
  // Most overdue first, then the busiest; "Unassigned" stays visible near the top when it has work.
  const overdue = (s: Section) => s.rows.filter((r) => r.due_on && r.due_on < today).length;
  return [...map.values()].sort((a, b) => overdue(b) - overdue(a) || b.rows.length - a.rows.length || a.label.localeCompare(b.label));
}

type BulkField = 'status' | 'priority' | 'owner_id' | 'due_on';
const BULK_LABEL: Record<BulkField, string> = { status: 'Status', priority: 'Priority', owner_id: 'Owner', due_on: 'Due date' };

/** One change applied to every selected action: a PATCH each, so validation, hooks and audit apply to each. */
function BulkBar({ rows, onClear, onDone }: { rows: Row[]; onClear: () => void; onDone: () => void }) {
  const toast = useToast();
  const [field, setField] = useState<BulkField>('status');
  const [value, setValue] = useState<string | null>('');
  const [busy, setBusy] = useState(false);
  const pickField = (f: string) => { setField((f || 'status') as BulkField); setValue(''); };
  const apply = async () => {
    setBusy(true);
    let changed = 0;
    const failed: string[] = [];
    for (const row of rows) {
      if ((row[field] ?? '') === (value ?? '')) continue;
      try {
        await api.patch(`/api/actions/${row.id}`, { [field]: value || null });
        changed += 1;
      } catch (err) {
        failed.push(`${row.ref}: ${errorMessage(err)}`);
      }
    }
    setBusy(false);
    if (failed.length) toast.error(`${failed.length} could not be changed. ${failed[0]}`);
    toast.success(`${changed} ${changed === 1 ? 'action' : 'actions'} updated.`);
    onDone();
  };
  const needsValue = field === 'status' || field === 'priority';
  return (
    <div className="rk-bulk" role="region" aria-label="Change the selected actions">
      <strong>{rows.length} selected</strong>
      <Select hideLabel required size="xs" label="Field to change" value={field} options={Object.entries(BULK_LABEL).map(([v, label]) => ({ value: v, label }))} onChange={pickField} />
      <span className="rk-bulk-value">
        {field === 'status' && <LookupSelect hideLabel size="xs" label="New status" list="action_status" value={value ?? ''} onChange={setValue} />}
        {field === 'priority' && <LookupSelect hideLabel size="xs" label="New priority" list="action_priority" value={value ?? ''} onChange={setValue} />}
        {field === 'owner_id' && <UserPicker hideLabel size="xs" label="New owner" placeholder="Unassigned" value={value || null} onChange={(id) => setValue(id)} />}
        {field === 'due_on' && <DateField hideLabel size="xs" label="New due date" placeholder="No date" value={value ?? ''} onChange={setValue} />}
      </span>
      <Button size="sm" variant="primary" loading={busy} disabled={needsValue && !value} onClick={apply}>
        {needsValue || value ? 'Apply' : field === 'owner_id' ? 'Clear owner' : 'Clear date'}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear selection</Button>
    </div>
  );
}

/** The weekly review screen: every open action, grouped the way the meeting walks through them. */
export function ActionTracker() {
  const { can } = useAuth();
  const { resources } = useMeta();
  const sources = useLookup('action_source');
  const [params, setParams] = useSearchParams();
  const summary = useFetch<ActionSummary>('/api/actions/summary');
  const data = summary.data;

  const group = (GROUPS.find((g) => g.value === params.get('group'))?.value ?? 'week') as GroupKey;
  const show = (Object.keys(SHOW_LABEL).find((k) => k === params.get('show')) ?? 'open') as Show;
  const set = (patch: Record<string, string | null>) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v); }
    return next;
  });

  const [text, setText] = useState('');
  const q = useDebounced(text, 250).trim();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const quickRef = useRef<HTMLInputElement>(null);

  // Every open action in one request (the review reads them all); the List view pages for itself.
  const openUrl = data && group !== 'list'
    ? `/api/actions?f.status=${data.open_statuses.join(',')}&sort=due_on&dir=asc&pageSize=500${q ? `&q=${encodeURIComponent(q)}` : ''}`
    : null;
  const open = useFetch<ListResult>(openUrl, { keepPrevious: true });
  const reloadAll = () => { summary.reload(); open.reload(); };

  // "n" jumps to the quick-add box, "/" is the shell's search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || !el || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      quickRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (params.get('new') === '1') { setCreating(true); set({ new: null }); } });

  const shown = useMemo(() => {
    const rows = open.data?.rows ?? [];
    if (!data) return rows;
    if (show === 'overdue') return rows.filter((r) => r.due_on && r.due_on < data.today);
    if (show === 'week') return rows.filter((r) => r.due_on && r.due_on >= data.today && r.due_on <= data.week_end);
    if (show === 'unassigned') return rows.filter((r) => !r.owner_id);
    return rows;
  }, [open.data, data, show]);

  const listFilter = useMemo(() => {
    if (!data) return undefined;
    const f: Record<string, string> = {};
    if (show === 'overdue') { f['due_on.lt'] = data.today; f.status = data.open_statuses.join(','); }
    if (show === 'week') { f['due_on.gte'] = data.today; f['due_on.lte'] = data.week_end; f.status = data.open_statuses.join(','); }
    if (show === 'unassigned') { f['owner_id.null'] = 'true'; f.status = data.open_statuses.join(','); }
    return f;
  }, [data, show]);

  if (summary.error) return <><PageHeader title="Action tracker" /><ErrorState error={summary.error} onRetry={summary.reload} /></>;
  if (!data) return <><PageHeader title="Action tracker" /><Loading /></>;

  const sourceLabel = (v: string) => sources.find((s) => s.value === v)?.label ?? v;
  const groups = group === 'list' ? [] : sections(shown, group, data.today, sourceLabel);
  const picked = shown.filter((r) => selected.has(r.id));
  const toggle = (key: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const tile = (key: Show, value: number, tone: string, hint: string) => (
    <button type="button" className={`stat stat-${tone} rk-tile`} aria-pressed={show === key && !(key === 'open' && group === 'list')} onClick={() => set({ show: key === 'open' || show === key ? null : key })}>
      <span className="stat-label">{SHOW_LABEL[key]}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-trend">{hint}</span>
    </button>
  );
  const sourceLink = (row: Row) => {
    const target = row.source_type ? resources[row.source_type] : undefined;
    return target && row.source_id
      ? <Link to={`${target.route}/${row.source_id}`} onClick={(e) => e.stopPropagation()}>{target.label}</Link>
      : null;
  };

  return (
    <div className="stack rk-tracker">
      <PageHeader
        title="Action tracker"
        subtitle="Follow-up work from every part of the application, in one place for the weekly review."
        actions={(
          <>
            <Link className="btn btn-secondary" to="/actions/mine">My actions{data.mine.open > 0 ? ` (${data.mine.open})` : ''}</Link>
            {can('actions.create') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New action</Button>}
          </>
        )}
      />

      <div className="grid-stats" role="group" aria-label="Show">
        {tile('open', data.open, 'blue', 'Everything not done or canceled')}
        {tile('overdue', data.overdue, data.overdue > 0 ? 'red' : 'green', 'Open and past the due date')}
        {tile('week', data.due_this_week, 'amber', `Due by ${formatDate(data.week_end)}`)}
        {tile('unassigned', data.unassigned, 'gray', 'No owner yet')}
      </div>

      <div className="rk-tracker-bar">
        <SegmentedControl size="sm" aria-label="Group actions" value={group} data={GROUPS} onChange={(v) => { set({ group: v === 'week' ? null : v }); setSelected(new Set()); }} />
        {group !== 'list' && (
          <TextInput
            className="rk-tracker-search" type="search" size="sm" aria-label="Search open actions" placeholder="Search open actions" value={text}
            leftSection={<Icon name="search" size={16} />} onChange={(e) => setText(e.currentTarget.value)}
          />
        )}
        {show !== 'open' && <Button size="sm" variant="ghost" icon="x" onClick={() => set({ show: null })}>{SHOW_LABEL[show]}: clear</Button>}
      </div>

      {group !== 'list' && can('actions.create') && (
        <div className="rk-tracker-quick">
          <QuickAdd inputRef={quickRef} onAdded={reloadAll} />
          <span className="muted rk-keyhint">Press <kbd className="kbd">N</kbd> to add</span>
        </div>
      )}

      {group !== 'list' && picked.length > 0 && (
        <BulkBar rows={picked} onClear={() => setSelected(new Set())} onDone={() => { setSelected(new Set()); reloadAll(); }} />
      )}

      {group === 'list' ? (
        <div>
          <ResourceList
            key={`${show}-${version}`}
            type="action"
            urlState
            columns={[
              'ref', 'title',
              { field: 'status', label: 'Status', sortable: true, render: (row) => <ActionStatus row={row} onChanged={summary.reload} /> },
              'priority', 'owner_id', 'department',
              {
                field: 'due_on', label: 'Due', sortable: true,
                render: (row) => {
                  const overdue = Boolean(row.due_on) && row.due_on < data.today && data.open_statuses.includes(row.status);
                  return <span className={overdue ? 'is-overdue' : undefined}>{formatDate(row.due_on)}{overdue ? ' (overdue)' : ''}</span>;
                },
              },
              'source',
              { field: 'source_type', label: 'Arose from', render: sourceLink },
              { field: 'completed_on', hidden: true },
            ]}
            filters={['status', 'priority', 'source', 'owner_id', 'due_on']}
            bulkFields={['status', 'priority', 'owner_id', 'due_on', 'source']}
            baseFilter={listFilter}
          />
        </div>
      ) : open.error ? <ErrorState error={open.error} onRetry={open.reload} />
        : !open.data ? <Loading lines={8} label="Loading actions" />
        : groups.length === 0 ? (
          <Card>
            <EmptyState
              icon="check-square"
              title={q || show !== 'open' ? 'No open actions match' : 'No open actions'}
              message={q || show !== 'open' ? 'Try a different search, or clear the tile you chose.' : 'Add one above, or raise one from a risk, an incident or any other record.'}
            />
          </Card>
        ) : groups.map((g) => {
          const overdue = g.rows.filter((r) => r.due_on && r.due_on < data.today).length;
          const isOpen = !collapsed.has(g.key);
          return (
            <section key={g.key} className={`card rk-group${g.tone === 'red' ? ' rk-group-red' : ''}`}>
              <h2 className="rk-group-head">
                <button type="button" className="rk-group-toggle" aria-expanded={isOpen} onClick={() => toggle(g.key)}>
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} />
                  <span className="rk-group-name">{g.label}</span>
                  <span className="tab-count">{g.rows.length}</span>
                  {overdue > 0 && g.tone !== 'red' && <span className="chip chip-red">{overdue} overdue</span>}
                  {g.hint && <span className="muted rk-group-hint">{g.hint}</span>}
                </button>
              </h2>
              {isOpen && (
                <ActionRows
                  rows={g.rows} today={data.today} openStatuses={data.open_statuses} onChanged={reloadAll}
                  caption={`${g.label} actions`} show={{ priority: true, source: group !== 'source' }}
                  selected={selected} onSelect={setSelected}
                />
              )}
            </section>
          );
        })}
      {group !== 'list' && open.data && open.data.total > open.data.rows.length && (
        <p className="muted">Showing the first {open.data.rows.length} of {open.data.total} open actions. Use the List view to page through them all.</p>
      )}

      <Modal open={creating} title="New action" size="lg" onClose={() => setCreating(false)}>
        <ResourceForm
          type="action"
          fields={['title', 'description', 'priority', 'owner_id', 'due_on', 'source', 'department', 'notes']}
          onCancel={() => setCreating(false)}
          onSaved={() => { setCreating(false); setVersion((n) => n + 1); reloadAll(); }}
        />
      </Modal>
    </div>
  );
}
