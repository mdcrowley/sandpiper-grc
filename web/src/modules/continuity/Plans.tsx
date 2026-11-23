// Continuity and emergency plans: the list, and one plan with the processes it covers, its call tree,
// its checklist, its approval and the exercises that tested it.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, IconButton, KeyValue, Loading, LookupChip, Modal,
  PageHeader, RecordPage, RecordPicker, ResourceList, Select, TableWrap, TextArea, TextField, useAuth, useFetch, useResource, useToast, useUnsavedChanges,
  UserPicker,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { ContinuityTabs, hoursText, PHASES } from './shared';

export function PlanList() {
  return (
    <div className="stack">
      <PageHeader title="Continuity plans" subtitle="Continuity, emergency operations and disaster recovery plans, with their review cycle and approval." />
      <ContinuityTabs active="plans" />
      <ResourceList
        type="continuity_plan"
        urlState
        columns={['ref', 'title', 'plan_type', 'status', 'owner_id', 'next_review_on', 'approved_on', { field: 'review_months', hidden: true }]}
        filters={['plan_type', 'status', 'owner_id', 'next_review_on']}
        createFields={['title', 'plan_type', 'owner_id', 'review_months', 'scope', 'activation_criteria', 'recovery_strategies']}
      />
    </div>
  );
}

// ---------- processes covered ----------

function CoveredProcesses({ plan }: { plan: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Row[]>(`/api/continuity-plans/${plan.id}/processes`);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('continuity.edit');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const put = async (ids: string[], done: string) => {
    setBusy(true);
    try { await api.put(`/api/continuity-plans/${plan.id}/processes`, { process_ids: ids }); toast.success(done); setPicked(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Processes this plan covers" flush>
      {data.length === 0 ? <EmptyState icon="shield" title="No processes yet" message="Add the business processes this plan recovers." /> : (
        <TableWrap label="Processes covered">
          <table className="table">
            <caption className="sr-only">Processes covered</caption>
            <thead><tr><th scope="col">Process</th><th scope="col">Criticality</th><th scope="col">Tolerable downtime</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td><Link className="row-title" to={`/continuity/processes/${p.id}`}><span className="ref">{p.ref}</span> {p.name}</Link></td>
                  <td>{p.criticality ? <LookupChip list="process_criticality" value={p.criticality} /> : <span className="muted">Not set</span>}</td>
                  <td>{hoursText(p.mtd_hours)}</td>
                  {canEdit && <td className="bc-actions"><Button size="sm" variant="ghost" aria-label={`Remove: ${p.name}`} disabled={busy} onClick={() => void put(data.filter((x) => x.id !== p.id).map((x) => x.id), 'Process removed from the plan.')}>Remove</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {canEdit && (
        <div className="bc-pad bc-add-row">
          <RecordPicker label="Add a process" type="business_process" value={picked} onChange={(id) => setPicked(id)} />
          <Button icon="plus" loading={busy} disabled={!picked} onClick={() => void put([...data.map((x) => x.id), picked!], 'Process added to the plan.')}>Add</Button>
        </div>
      )}
    </Card>
  );
}

// ---------- call tree ----------

interface Node {
  id: string; parent_id: string | null; depth: number; sort: number; role: string | null; user_id: string | null; person_id: string | null;
  linked: 'person' | 'user' | null; name: string | null; phone: string | null; alternate_phone: string | null; notes: string | null;
}

function NodeDialog({ planId, node, parentId, onClose, onSaved }: { planId: string; node: Node | null; parentId: string | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const people = useResource('person');
  const { can } = useAuth();
  const canPeople = Boolean(people) && can('people.view');
  const start = {
    role: node?.role ?? '', link: node?.linked ?? (canPeople ? 'person' : 'typed'), person_id: node?.person_id ?? null, user_id: node?.user_id ?? null,
    name: node?.linked ? '' : node?.name ?? '', phone: node?.linked ? '' : node?.phone ?? '', alternate_phone: node?.alternate_phone ?? '', notes: node?.notes ?? '',
  };
  const [form, setForm] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    setBusy(true); setErrors({});
    const body: Record<string, unknown> = {
      role: form.role, alternate_phone: form.alternate_phone, notes: form.notes,
      person_id: form.link === 'person' ? form.person_id : null, user_id: form.link === 'user' ? form.user_id : null,
      name: form.link === 'typed' ? form.name : null, phone: form.link === 'typed' ? form.phone : null,
    };
    if (!node) body.parent_id = parentId;
    try {
      if (node) await api.patch(`/api/continuity-plans/${planId}/call-tree/${node.id}`, body); else await api.post(`/api/continuity-plans/${planId}/call-tree`, body);
      toast.success(node ? 'Call tree entry saved.' : 'Added to the call tree.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const links = [...(canPeople ? [{ value: 'person', label: 'A person on the roster' }] : []), { value: 'user', label: 'A user account' }, { value: 'typed', label: 'Type a name and phone' }];
  return (
    <Modal open title={node ? 'Change call tree entry' : 'Add to the call tree'} onClose={onClose} dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{node ? 'Save' : 'Add'}</Button></>}>
      <div className="form-grid">
        <TextField label="Role" value={form.role} error={errors.role} onChange={(v) => set({ role: v })} hint="For example Operations lead" />
        <Select label="Who" required value={form.link} options={links} onChange={(v) => set({ link: (v || 'typed') as typeof form.link })} />
        {form.link === 'person' && <RecordPicker className="form-cell-wide" label="Person" type="person" value={form.person_id} error={errors.person_id} onChange={(id) => set({ person_id: id })} hint="Their name and phone are read from the roster." />}
        {form.link === 'user' && <UserPicker className="form-cell-wide" label="User account" value={form.user_id} error={errors.user_id} onChange={(id) => set({ user_id: id })} />}
        {form.link === 'typed' && <>
          <TextField label="Name" required value={form.name} error={errors.name} onChange={(v) => set({ name: v })} />
          <TextField label="Phone" type="tel" value={form.phone} error={errors.phone} onChange={(v) => set({ phone: v })} />
        </>}
        <TextField label="Other phone" type="tel" value={form.alternate_phone} onChange={(v) => set({ alternate_phone: v })} />
        <TextArea className="form-cell-wide" label="Notes" value={form.notes} onChange={(v) => set({ notes: v })} />
      </div>
    </Modal>
  );
}

function CallTree({ plan }: { plan: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Node[]>(`/api/continuity-plans/${plan.id}/call-tree`);
  const [editing, setEditing] = useState<{ node: Node | null; parent: string | null } | null>(null);
  const [removing, setRemoving] = useState<Node | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('continuity.edit');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const siblings = (n: Node) => data.filter((x) => x.parent_id === n.parent_id);
  const patch = async (n: Node, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api.patch(`/api/continuity-plans/${plan.id}/call-tree/${n.id}`, body); toast.success(done); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const move = (n: Node, by: -1 | 1) => {
    const list = siblings(n);
    const other = list[list.findIndex((x) => x.id === n.id) + by];
    if (!other) return;
    void (async () => {
      await patch(n, { sort: other.sort }, 'Moved.');
      await api.patch(`/api/continuity-plans/${plan.id}/call-tree/${other.id}`, { sort: n.sort }).catch(() => undefined);
      reload();
    })();
  };
  const indent = (n: Node) => {
    const list = siblings(n);
    const before = list[list.findIndex((x) => x.id === n.id) - 1];
    if (before) void patch(n, { parent_id: before.id }, `${n.name ?? 'The entry'} is now called by ${before.name ?? 'the entry above'}.`);
  };
  const outdent = (n: Node) => {
    const parent = data.find((x) => x.id === n.parent_id);
    if (parent) void patch(n, { parent_id: parent.parent_id }, 'Moved up a level.');
  };
  return (
    <Card title="Call tree" flush actions={<div className="row">
      {can('continuity.export') && data.length > 0 && <a className="btn btn-sm" href={`/api/continuity-plans/${plan.id}/call-tree.pdf`} download>Print (PDF)</a>}
      {canEdit && <Button size="sm" icon="plus" onClick={() => setEditing({ node: null, parent: null })}>Add at the top</Button>}
    </div>}>
      <p className="bc-pad muted">Each person calls the people listed under them. Names and phones of roster people and user accounts are read from their records.</p>
      {data.length === 0 ? <EmptyState icon="users" title="No call tree yet" message="Start with whoever activates the plan, then add the people they call." /> : (
        <ol className="bc-tree" aria-label="Call tree">
          {data.map((n) => {
            const list = siblings(n);
            const i = list.findIndex((x) => x.id === n.id);
            return (
              <li key={n.id} className="bc-tree-node" style={{ paddingInlineStart: `calc(${n.depth} * 1.75rem + 1rem)` }} aria-level={n.depth + 1}>
                <div className="bc-tree-main">
                  <strong>{n.name ?? <span className="muted">No name</span>}</strong>
                  {n.role && <span className="muted"> · {n.role}</span>}
                  <div className="bc-tree-phones">
                    {n.phone ? <a href={`tel:${n.phone.replace(/[^\d+]/g, '')}`}>{n.phone}</a> : <span className="muted">No phone</span>}
                    {n.alternate_phone && <> · <a href={`tel:${n.alternate_phone.replace(/[^\d+]/g, '')}`}>{n.alternate_phone}</a></>}
                  </div>
                  {n.notes && <div className="muted bc-small">{n.notes}</div>}
                </div>
                {canEdit && (
                  <div className="bc-actions">
                    <IconButton icon="arrow-up" label={`Move ${n.name ?? 'entry'} up`} size="sm" disabled={busy || i === 0} onClick={() => move(n, -1)} />
                    <IconButton icon="arrow-down" label={`Move ${n.name ?? 'entry'} down`} size="sm" disabled={busy || i === list.length - 1} onClick={() => move(n, 1)} />
                    <IconButton icon="chevron-left" label={`Move ${n.name ?? 'entry'} up a level`} size="sm" disabled={busy || !n.parent_id} onClick={() => outdent(n)} />
                    <IconButton icon="chevron-right" label={`Place ${n.name ?? 'entry'} under the entry above`} size="sm" disabled={busy || i === 0} onClick={() => indent(n)} />
                    <Button size="sm" variant="ghost" aria-label={`Add under: ${n.name ?? 'entry'}`} onClick={() => setEditing({ node: null, parent: n.id })}>Add under</Button>
                    <Button size="sm" variant="ghost" aria-label={`Change: ${n.name ?? 'entry'}`} onClick={() => setEditing({ node: n, parent: n.parent_id })}>Change</Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove: ${n.name ?? 'entry'}`} onClick={() => setRemoving(n)}>Remove</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {editing && <NodeDialog planId={plan.id} node={editing.node} parentId={editing.parent} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <ConfirmDialog open={!!removing} title="Remove from the call tree?" danger busy={busy} confirmLabel="Remove"
        message={`${removing?.name ?? 'This entry'} will be removed. The people they call move up to whoever calls them.`}
        onConfirm={async () => {
          setBusy(true);
          try { await api.del(`/api/continuity-plans/${plan.id}/call-tree/${removing!.id}`); toast.success('Removed from the call tree.'); setRemoving(null); reload(); }
          catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
        onCancel={() => setRemoving(null)} />
    </Card>
  );
}

// ---------- checklist ----------

interface Item { id?: string; phase: string; item: string; role: string | null }

function Checklist({ plan }: { plan: Row }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Item[]>(`/api/continuity-plans/${plan.id}/checklist`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  return <ChecklistEditor key={JSON.stringify(data)} planId={plan.id} saved={data} canEdit={can('continuity.edit')} onSaved={reload} />;
}

function ChecklistEditor({ planId, saved, canEdit, onSaved }: { planId: string; saved: Item[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>(saved);
  const [phase, setPhase] = useState('activate');
  const [text, setText] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(items) !== JSON.stringify(saved);
  const guard = useUnsavedChanges(dirty);
  const ordered = useMemo(() => PHASES.flatMap((p) => items.filter((i) => i.phase === p.value)), [items]);
  const save = async () => {
    setBusy(true);
    try { await api.put(`/api/continuity-plans/${planId}/checklist`, { items: ordered }); guard.release(); toast.success('Checklist saved.'); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <p className="muted">Copied into each activation of this plan, where each step is checked off with who and when.</p>
      {items.length === 0 && <EmptyState icon="check-square" title="No checklist yet" message="Add the steps to take when the plan is activated, by phase." />}
      {PHASES.map((p) => {
        const list = items.filter((i) => i.phase === p.value);
        if (!list.length) return null;
        return (
          <Card key={p.value} title={p.label} flush>
            <ul className="bc-checklist">
              {list.map((i) => (
                <li key={`${i.id ?? ''}-${i.item}`}>
                  <span>{i.item}{i.role && <span className="muted"> · {i.role}</span>}</span>
                  {canEdit && <Button size="sm" variant="ghost" aria-label={`Remove: ${i.item}`} onClick={() => setItems((xs) => xs.filter((x) => x !== i))}>Remove</Button>}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {canEdit && (
        <Card title="Add a step">
          <div className="form-grid">
            <Select label="Phase" required value={phase} onChange={(v) => setPhase(v || 'activate')} options={PHASES} />
            <TextField label="Role" value={role} onChange={setRole} hint="Who does it" />
            <TextField className="form-cell-wide" label="Step" value={text} onChange={setText} />
          </div>
          <div className="form-actions">
            <Button icon="plus" disabled={!text.trim()} onClick={() => { setItems((xs) => [...xs, { phase, item: text.trim(), role: role.trim() || null }]); setText(''); }}>Add step</Button>
            <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save checklist</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- approval ----------

function submitPlan(id: string) { return api.post(`/api/continuity-plans/${id}/submit`); }

function Approval({ row, canEdit, reload }: RecordContext) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await submitPlan(row.id); toast.success('Sent for approval.'); reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const overdue = row.next_review_on && String(row.next_review_on) < new Date().toISOString().slice(0, 10);
  return (
    <Card title="Approval and review">
      <KeyValue items={[
        { label: 'Status', value: <LookupChip list="continuity_plan_status" value={row.status} /> },
        { label: 'Approved', value: row.approved_on ? `${formatDate(row.approved_on)}${row.approved_by_name ? ` by ${row.approved_by_name}` : ''}` : 'Not yet' },
        { label: 'Reviewed every', value: `${row.review_months ?? 12} months` },
        { label: 'Next review', value: row.next_review_on ? <span className={overdue ? 'bc-bad' : undefined}>{formatDate(row.next_review_on)}{overdue ? ' (overdue)' : ''}</span> : 'Set when the plan is approved' },
      ]} />
      <p className="muted bc-small">Approval goes through the Continuity plan approval workflow; its progress shows at the top of this page. Approval sets the next review date from the review cycle.</p>
      {canEdit && row.status !== 'in_review' && row.status !== 'retired' && (
        <div className="form-actions"><Button variant="primary" loading={busy} onClick={submit}>{row.status === 'approved' ? 'Submit the reviewed plan for approval' : 'Submit for approval'}</Button></div>
      )}
    </Card>
  );
}

// ---------- exercises ----------

function Exercises({ plan }: { plan: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<{ available: boolean; last_exercised_on: string | null; exercises: Row[] }>(`/api/continuity-plans/${plan.id}/exercises`);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (!data.available) return <Card title="Exercises"><p className="muted">Exercises are not part of this installation.</p></Card>;
  const add = async () => {
    setBusy(true);
    try { await api.post(`/api/continuity-plans/${plan.id}/exercises`, { exercise_id: picked }); toast.success('Exercise linked.'); setPicked(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Exercises that tested this plan" flush>
      <p className="bc-pad">Last exercised: <strong>{data.last_exercised_on ? formatDate(data.last_exercised_on) : 'never'}</strong></p>
      {data.exercises.length === 0 ? <EmptyState icon="target" title="No exercises linked" message="Link the tabletop and continuity tests that used this plan." /> : (
        <ul className="bc-list bc-pad">
          {data.exercises.map((e) => (
            <li key={e.id}>
              <Link className="row-title" to={`/exercises/${e.id}`}><span className="ref">{e.ref}</span> {e.title}</Link>
              <span className="bc-list-meta">{e.status && <LookupChip list="exercise_status" value={e.status} />}<span className="muted"> {e.exercise_date ? formatDate(e.exercise_date) : 'No date'}</span></span>
            </li>
          ))}
        </ul>
      )}
      {can('continuity.edit') && can('exercises.view') && (
        <div className="bc-pad bc-add-row">
          <RecordPicker label="Link an exercise" type="exercise" value={picked} onChange={(id) => setPicked(id)} />
          <Button icon="plus" loading={busy} disabled={!picked} onClick={add}>Link</Button>
        </div>
      )}
    </Card>
  );
}

function PlanActions({ row, canEdit, reload }: RecordContext) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!canEdit || row.status !== 'draft') return null;
  return (
    <Button loading={busy} onClick={async () => {
      setBusy(true);
      try { await submitPlan(row.id); toast.success('Sent for approval.'); reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
    }}>Submit for approval</Button>
  );
}

export function PlanDetail() {
  const exercises = useResource('exercise');
  return (
    <RecordPage
      type="continuity_plan"
      actions={(rec) => <PlanActions {...rec} />}
      banner={({ row }) => (row.next_review_on && String(row.next_review_on) < new Date().toISOString().slice(0, 10) && row.status !== 'retired'
        ? <p className="notice notice-warn">This plan was due for review on {formatDate(row.next_review_on)}.</p> : null)}
      summaryFields={['title', 'plan_type', 'owner_id', 'review_months', 'next_review_on', 'policy_id', 'scope', 'activation_criteria', 'recovery_strategies']}
      tabs={[
        { key: 'processes', label: 'Processes', content: ({ row }) => <CoveredProcesses plan={row} /> },
        { key: 'call-tree', label: 'Call tree', content: ({ row }) => <CallTree plan={row} /> },
        { key: 'checklist', label: 'Checklist', content: ({ row }) => <Checklist plan={row} /> },
        { key: 'approval', label: 'Approval', content: (rec) => <Approval {...rec} /> },
        ...(exercises ? [{ key: 'exercises', label: 'Exercises', content: ({ row }: RecordContext) => <Exercises plan={row} /> }] : []),
      ]}
    />
  );
}
