// Business processes: the list, and one process with what it depends on, its impact analyses and the
// plans that cover it.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, Loading, LookupChip, PageHeader, RecordPage,
  RecordPicker, ResourceList, Select, TextField, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import type { Row } from '../../core';
import { ContinuityTabs, hoursText } from './shared';

export function ProcessList() {
  return (
    <div className="stack">
      <PageHeader title="Business processes" subtitle="The organization's work, how critical it is, how long it can be down, and what it depends on." />
      <ContinuityTabs active="processes" />
      <ResourceList
        type="business_process"
        urlState
        columns={['ref', 'name', 'department', 'criticality', 'status', 'mtd_hours', 'owner_id', { field: 'rto_target_hours', hidden: true }, { field: 'next_bia_due', hidden: true }, { field: 'last_bia_on', hidden: true }]}
        filters={['criticality', 'status', 'owner_id', 'next_bia_due']}
        createFields={['name', 'department', 'owner_id', 'criticality', 'status', 'mtd_hours', 'rto_target_hours', 'rpo_target_hours', 'description']}
      />
    </div>
  );
}

const KIND_TYPE: Record<string, string> = { system: 'system', service: 'service', site: 'site', vendor: 'vendor', process: 'business_process', position: 'position' };

/** "a, b and c": the kinds offered, so a switched-off area is not named. */
const kindWords = (w: string[]) => (w.length < 2 ? (w[0] ?? 'records') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);

interface Dependency {
  id: string; dep_type: string; dep_id: string; critical: boolean; notes: string | null; record_type: string; type_label: string;
  label: string | null; ref: string | null; route: string | null; hidden: boolean; rto_hours?: number | null;
}

function Dependencies({ process }: { process: Row }) {
  const { can } = useAuth();
  const { resources } = useMeta();
  const toast = useToast();
  const { data, error, reload } = useFetch<{ kinds: string[]; dependencies: Dependency[] }>(`/api/business-processes/${process.id}/dependencies`);
  const [kind, setKind] = useState('system');
  const [picked, setPicked] = useState<string | null>(null);
  const [critical, setCritical] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Dependency | null>(null);
  const canEdit = can('continuity.edit');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  // Only kinds whose records the person may look up can be added.
  const kinds = data.kinds.filter((k) => resources[KIND_TYPE[k]] && can(`${resources[KIND_TYPE[k]].module}.view`));
  const shown = data.dependencies.filter((d) => !d.hidden);

  const save = async (list: { dep_type: string; dep_id: string; critical: boolean; notes: string | null }[], done: string) => {
    setBusy(true);
    try { await api.put(`/api/business-processes/${process.id}/dependencies`, { dependencies: list }); toast.success(done); reload(); return true; }
    catch (err) { toast.error(errorMessage(err)); return false; }
    finally { setBusy(false); }
  };
  const current = () => shown.map((d) => ({ dep_type: d.dep_type, dep_id: d.dep_id, critical: d.critical, notes: d.notes }));
  const add = async () => {
    if (!picked) return;
    if (await save([...current(), { dep_type: kind, dep_id: picked, critical, notes: notes.trim() || null }], 'Dependency added.')) {
      setPicked(null); setNotes(''); setCritical(true);
    }
  };
  const toggle = (d: Dependency) => save(current().map((c) => (c.dep_type === d.dep_type && c.dep_id === d.dep_id ? { ...c, critical: !d.critical } : c)), 'Dependency changed.');

  return (
    <div className="stack">
      <Card title="What this process depends on" flush>
        {shown.length === 0 ? (
          <EmptyState icon="link" title="No dependencies yet" message={`Add the ${kindWords(kinds.map((k) => (k === 'process' ? 'other processes' : resources[KIND_TYPE[k]].plural.toLowerCase())))} this process needs to run.`} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Dependencies</caption>
              <thead><tr><th scope="col">Kind</th><th scope="col">Record</th><th scope="col">Recovery time</th><th scope="col">Critical</th><th scope="col">Notes</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id}>
                    <td>{d.type_label}</td>
                    <td>{d.route ? <Link to={d.route}>{d.ref ? <span className="ref">{d.ref} </span> : null}{d.label}</Link> : d.label}</td>
                    <td>{d.dep_type === 'system' ? (d.rto_hours === null || d.rto_hours === undefined ? <span className="bc-warn">Not known</span> : hoursText(d.rto_hours)) : <span className="muted">-</span>}</td>
                    <td>{canEdit
                      ? <Checkbox label={`${d.label ?? 'Dependency'} is critical`} checked={d.critical} disabled={busy} onChange={() => void toggle(d)} className="bc-inline-check" />
                      : d.critical ? 'Yes' : 'No'}</td>
                    <td>{d.notes ?? <span className="muted">None</span>}</td>
                    {canEdit && <td className="bc-actions"><Button size="sm" variant="ghost" onClick={() => setRemoving(d)}>Remove</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.dependencies.length > shown.length && (
          <p className="bc-pad muted">{data.dependencies.length - shown.length} more {data.dependencies.length - shown.length === 1 ? 'dependency is' : 'dependencies are'} on records you cannot see. They are kept when you change the list.</p>
        )}
      </Card>
      {canEdit && kinds.length > 0 && (
        <Card title="Add a dependency">
          <div className="form-grid">
            <Select label="Kind of record" required value={kind} onChange={(v) => { setKind(v || 'system'); setPicked(null); }}
              options={kinds.map((k) => ({ value: k, label: resources[KIND_TYPE[k]]?.label ?? k }))} />
            <RecordPicker key={kind} label={resources[KIND_TYPE[kind]]?.label ?? 'Record'} type={KIND_TYPE[kind]} value={picked} onChange={(id) => setPicked(id)} />
            <TextField label="Notes" value={notes} onChange={setNotes} hint="For example what it is needed for" />
            <Checkbox label="Critical: the process stops without it" checked={critical} onChange={setCritical} />
          </div>
          <div className="form-actions"><Button variant="primary" icon="plus" loading={busy} disabled={!picked} onClick={add}>Add dependency</Button></div>
        </Card>
      )}
      <ConfirmDialog open={!!removing} title="Remove this dependency?" message={`${removing?.type_label ?? ''} "${removing?.label ?? ''}" will no longer be listed as something this process depends on.`}
        confirmLabel="Remove" danger busy={busy}
        onConfirm={async () => {
          const r = removing!;
          if (await save(current().filter((c) => !(c.dep_type === r.dep_type && c.dep_id === r.dep_id)), 'Dependency removed.')) setRemoving(null);
        }}
        onCancel={() => setRemoving(null)} />
    </div>
  );
}

function ImpactAnalyses({ process }: { process: Row }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const row = await api.post<Row>('/api/bias', { process_id: process.id, assessed_on: new Date().toISOString().slice(0, 10), mtd_hours: process.mtd_hours ?? null, rto_target_hours: process.rto_target_hours ?? null, rpo_target_hours: process.rpo_target_hours ?? null });
      navigate(`/continuity/impact-analyses/${row.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <ResourceList type="bia" baseFilter={{ process_id: process.id }} urlState={false} bulkFields={[]}
        columns={['ref', 'assessed_on', 'status', 'mtd_hours', 'rto_target_hours', 'assessor_id', 'signed_off_on']}
        actions={can('continuity.create') && <Button icon="plus" loading={busy} onClick={start}>Start an impact analysis</Button>} />
      <p className="muted bc-small">Last signed off: {process.last_bia_on ? formatDate(process.last_bia_on) : 'never'}{process.next_bia_due ? ` · next due ${formatDate(process.next_bia_due)}` : ''}</p>
    </div>
  );
}

function CoveringPlans({ processId }: { processId: string }) {
  const { data, error, reload } = useFetch<Row[]>(`/api/business-processes/${processId}/plans`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  return (
    <Card title="Plans that cover this process" flush>
      {data.length === 0 ? <EmptyState icon="clipboard" title="No plan covers this process" message="Open a plan and add this process on its Processes tab." /> : (
        <ul className="bc-list bc-pad">
          {data.map((p) => (
            <li key={p.id}>
              <Link className="row-title" to={`/continuity/plans/${p.id}`}><span className="ref">{p.ref}</span> {p.title}</Link>
              <span className="bc-list-meta"><LookupChip list="continuity_plan_status" value={p.status} />{p.next_review_on && <span className="muted"> review {formatDate(p.next_review_on)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ProcessDetail() {
  return (
    <RecordPage
      type="business_process"
      summaryFields={['name', 'department', 'owner_id', 'criticality', 'status', 'peak_periods', 'mtd_hours', 'rto_target_hours', 'rpo_target_hours', 'minimum_staff', 'last_bia_on', 'next_bia_due', 'description', 'manual_workaround']}
      tabs={[
        { key: 'dependencies', label: 'Dependencies', content: ({ row }) => <Dependencies process={row} /> },
        { key: 'bia', label: 'Impact analysis', content: ({ row }) => <ImpactAnalyses process={row} /> },
        { key: 'plans', label: 'Plans', content: ({ row }) => <CoveringPlans processId={row.id} /> },
      ]}
    />
  );
}
