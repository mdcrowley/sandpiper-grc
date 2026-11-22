// Emergency activations: the list with "Activate a plan", and the workspace of one activation with its
// log, roles, checklist and summary (stand down, after-action summary and corrective action plans).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDateTime, KeyValue, Loading, LookupChip, LookupSelect,
  Modal, MultiSelect, PageHeader, ProgressBar, RecordPage, RecordPicker, ResourceList, Select, Stepper, TextArea, TextField, useAuth, useFetch,
  useResource, useToast, UserPicker,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { AfterActionPlans, ContinuityTabs, PHASES } from './shared';

function ActivateDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const plans = useFetch<{ rows: Row[] }>('/api/continuity-plans?pageSize=200&sort=title&f.status=draft,in_review,approved');
  const [form, setForm] = useState({ title: '', event_type: '', level: 'partial', plan_ids: [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(form.title || form.event_type || form.plan_ids.length);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const row = await api.post<Row>('/api/emergency-activations', form);
      toast.success('Activation declared. Its checklist was copied from the plans.');
      onClose();
      navigate(`/continuity/activations/${row.id}`);
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title="Activate a plan" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Declare the activation</Button></>}>
      <div className="form-grid">
        <TextField className="form-cell-wide" label="What is happening" required value={form.title} error={errors.title} onChange={(v) => set({ title: v })} hint="For example Flooding at the south depot" />
        <LookupSelect label="Kind of event" list="emergency_event_type" required value={form.event_type} error={errors.event_type} onChange={(v) => set({ event_type: v })} />
        <LookupSelect label="Level" list="activation_level" value={form.level} onChange={(v) => set({ level: v || 'partial' })} />
        <div className="form-cell-wide">
          <MultiSelect label="Plans to activate" value={form.plan_ids} error={errors.plan_ids} onChange={(v) => set({ plan_ids: v })}
            options={(plans.data?.rows ?? []).map((p) => ({ value: String(p.id), label: `${p.ref} ${p.title}` }))} />
        </div>
      </div>
      <p className="muted bc-small">Each plan's checklist is copied into the activation. No one is paged or messaged: use the plans' call trees to call people.</p>
    </Modal>
  );
}

export function ActivationList() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (params.get('new') === '1') {
      if (can('continuity.create')) setOpen(true);
      const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true });
    }
  }, [params, setParams, can]);
  return (
    <div className="stack">
      <PageHeader title="Emergency activations" subtitle="Severe weather, power loss, major disruptions and other emergencies run under a plan, with a log, roles and a checklist."
        actions={can('continuity.create') && <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Activate a plan</Button>} />
      <ContinuityTabs active="activations" />
      <ResourceList type="emergency_activation" urlState
        columns={['ref', 'title', 'event_type', 'level', 'status', 'declared_at', 'declared_by', { field: 'stood_down_at', hidden: true }, { field: 'closed_at', hidden: true }]}
        filters={['event_type', 'level', 'status', 'declared_at']} />
      {open && <ActivateDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

// ---------- log ----------

function LogTab({ activation, onAdded }: { activation: Row; onAdded: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Row[]>(`/api/emergency-activations/${activation.id}/log`);
  const [entry, setEntry] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = can('continuity.edit') && activation.status !== 'closed';
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activation.updated_at]);
  const add = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!entry.trim()) { setProblem('Write the entry first.'); return; }
    setBusy(true); setProblem('');
    try { await api.post(`/api/emergency-activations/${activation.id}/log`, { entry }); setEntry(''); reload(); onAdded(); }
    catch (err) { setProblem(errorMessage(err)); toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      {canEdit && (
        <form className="bc-composer" onSubmit={add} noValidate onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); } }}>
          <TextArea label="Add a log entry" value={entry} rows={2} error={problem} onChange={(v) => { setEntry(v); if (problem) setProblem(''); }}
            placeholder="What happened, what was decided or done, and by whom" />
          <div className="row bc-between">
            <span className="muted bc-small">Stamped with your name and the time now. <kbd className="kbd">Ctrl</kbd> <kbd className="kbd">Enter</kbd> adds it.</span>
            <Button type="submit" variant="primary" icon="plus" loading={busy}>Add to log</Button>
          </div>
        </form>
      )}
      {error ? <ErrorState title="The log could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading label="Loading log" />
        : data.length === 0 ? <EmptyState icon="history" title="Nothing in the log yet" />
        : (
          <Card title="Log" flush>
            <p className="bc-pad muted bc-small">Newest first. Entries cannot be changed or removed; to correct one, add another.</p>
            <ol className="bc-log">
              {data.map((e) => (
                <li key={e.id}>
                  <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                  <div><p className="bc-log-entry">{e.entry}</p><span className="muted bc-small">{e.by_name ?? 'System'}</span></div>
                </li>
              ))}
            </ol>
          </Card>
        )}
    </div>
  );
}

// ---------- roles ----------

function RolesTab({ activation, onChanged }: { activation: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const people = useResource('person');
  const canPeople = Boolean(people) && can('people.view');
  const { data, error, reload } = useFetch<Row[]>(`/api/emergency-activations/${activation.id}/roles`);
  const [form, setForm] = useState({ role: '', link: canPeople ? 'person' : 'user', person_id: null as string | null, user_id: null as string | null, name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ending, setEnding] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('continuity.edit') && activation.status !== 'closed';
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const add = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post(`/api/emergency-activations/${activation.id}/roles`, {
        role: form.role, person_id: form.link === 'person' ? form.person_id : null, user_id: form.link === 'user' ? form.user_id : null, name: form.link === 'typed' ? form.name : null,
      });
      toast.success('Role assigned.');
      setForm((f) => ({ ...f, role: '', person_id: null, user_id: null, name: '' }));
      reload(); onChanged();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  return (
    <div className="stack">
      <Card title="Who is doing what" flush>
        {data.length === 0 ? <EmptyState icon="users" title="No roles assigned" message="Assign an emergency manager, an operations lead, communications and a scribe." /> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Roles</caption>
              <thead><tr><th scope="col">Role</th><th scope="col">Person</th><th scope="col">Phone</th><th scope="col">Since</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.role}</strong></td>
                    <td>{r.name ?? <span className="muted">Not known</span>}</td>
                    <td>{r.phone ? <a href={`tel:${String(r.phone).replace(/[^\d+]/g, '')}`}>{r.phone}</a> : <span className="muted">None</span>}</td>
                    <td>{formatDateTime(r.assigned_at)}</td>
                    {canEdit && <td className="bc-actions"><Button size="sm" variant="ghost" onClick={() => setEnding(r)}>End role</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {canEdit && (
        <Card title="Assign a role">
          <div className="form-grid">
            <TextField label="Role" required value={form.role} error={errors.role} onChange={(v) => set({ role: v })} hint="For example Emergency manager" />
            <Select label="Who" value={form.link} onChange={(v) => set({ link: v || 'user' })}
              options={[...(canPeople ? [{ value: 'person', label: 'A person on the roster' }] : []), { value: 'user', label: 'A user account' }, { value: 'typed', label: 'Type a name' }]} />
            {form.link === 'person' && <RecordPicker label="Person" type="person" value={form.person_id} error={errors.person_id ?? errors.name} onChange={(id) => set({ person_id: id })} />}
            {form.link === 'user' && <UserPicker label="User account" value={form.user_id} error={errors.user_id ?? errors.name} onChange={(id) => set({ user_id: id })} />}
            {form.link === 'typed' && <TextField label="Name" value={form.name} error={errors.name} onChange={(v) => set({ name: v })} />}
          </div>
          <div className="form-actions"><Button variant="primary" icon="plus" loading={busy} onClick={add}>Assign</Button></div>
        </Card>
      )}
      <ConfirmDialog open={!!ending} title="End this role?" confirmLabel="End role" busy={busy}
        message={`${ending?.name ?? 'This person'} will no longer be listed as ${ending?.role ?? ''}. The handover is written to the log.`}
        onConfirm={async () => {
          setBusy(true);
          try { await api.del(`/api/emergency-activations/${activation.id}/roles/${ending!.id}`); setEnding(null); reload(); onChanged(); }
          catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}
        onCancel={() => setEnding(null)} />
    </div>
  );
}

// ---------- checklist ----------

function ChecklistTab({ activation, onChanged }: { activation: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Row[]>(`/api/emergency-activations/${activation.id}/checklist`);
  const [saving, setSaving] = useState<string | null>(null);
  const [step, setStep] = useState('');
  const [phase, setPhase] = useState('respond');
  const canEdit = can('continuity.edit') && activation.status !== 'closed';
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const tick = async (item: Row, done: boolean) => {
    setSaving(item.id);
    try { await api.post(`/api/emergency-activations/${activation.id}/checklist/${item.id}`, { done }); reload(); onChanged(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setSaving(null); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post(`/api/emergency-activations/${activation.id}/checklist`, { phase, item: step }); setStep(''); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const done = data.filter((i) => i.done_at).length;
  return (
    <div className="stack">
      {data.length === 0
        ? <EmptyState icon="check-square" title="No checklist" message="The plans activated had no checklist. Add the steps for this activation below." />
        : <ProgressBar label="All steps" value={done} max={data.length} color={done === data.length ? 'green' : 'blue'} valueText={`${done} of ${data.length} done`} />}
      {PHASES.map((p) => {
        const items = data.filter((i) => i.phase === p.value);
        if (!items.length) return null;
        return (
          <Card key={p.value} title={p.label} flush>
            <ul className="bc-checklist">
              {items.map((i) => (
                <li key={i.id}>
                  <Checkbox label={`${i.item}${i.role ? ` (${i.role})` : ''}`} checked={Boolean(i.done_at)} disabled={!canEdit || saving === i.id} onChange={(v) => void tick(i, v)} />
                  {i.done_at && <span className="muted bc-small">{i.done_by_name ?? 'Someone'} · {formatDateTime(i.done_at)}</span>}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {canEdit && (
        <form className="bc-add-row" onSubmit={add}>
          <TextField label="Add a step for this activation" value={step} onChange={setStep} />
          <Select label="Phase" required value={phase} onChange={(v) => setPhase(v || 'respond')} options={PHASES} />
          <Button type="submit" icon="plus" disabled={!step.trim()}>Add step</Button>
        </form>
      )}
    </div>
  );
}

// ---------- summary ----------

function SummaryTab({ row, reload }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canEdit = can('continuity.edit');
  const finish = async (path: 'stand-down' | 'close') => {
    setBusy(true); setError('');
    try {
      await api.post(`/api/emergency-activations/${row.id}/${path}`, path === 'close' ? { after_action_summary: text } : { summary: text });
      toast.success(path === 'close' ? 'Activation closed.' : 'Activation stood down.');
      setText(''); reload();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields ?? {};
      setError(fields.summary ?? fields.after_action_summary ?? errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <Card title="Summary">
        <KeyValue items={[
          { label: 'Declared', value: formatDateTime(row.declared_at) },
          { label: 'Stood down', value: row.stood_down_at ? formatDateTime(row.stood_down_at) : 'Not yet' },
          { label: 'Closed', value: row.closed_at ? formatDateTime(row.closed_at) : 'Not yet' },
        ]} />
        {row.summary && <><h3 className="bc-h">Stand-down summary</h3><p className="prose">{row.summary}</p></>}
        {row.after_action_summary && <><h3 className="bc-h">After-action summary</h3><p className="prose">{row.after_action_summary}</p></>}
      </Card>
      {canEdit && row.status === 'active' && (
        <Card title="Stand down">
          <TextArea label="Stand-down summary" required value={text} error={error} onChange={setText} hint="What happened, and the state things are left in." />
          <div className="form-actions"><Button variant="primary" loading={busy} onClick={() => void finish('stand-down')}>Stand down</Button></div>
        </Card>
      )}
      {canEdit && row.status === 'stood_down' && (
        <Card title="Close with the after-action summary">
          <TextArea label="After-action summary" required value={text} error={error} onChange={setText} hint="What went well and what to improve. Raise a corrective action plan below for each finding." />
          <div className="form-actions"><Button variant="primary" loading={busy} onClick={() => void finish('close')}>Close the activation</Button></div>
        </Card>
      )}
      {row.status !== 'active' && <AfterActionPlans activationId={row.id} />}
    </div>
  );
}

const STEPS = [{ key: 'active', label: 'Active' }, { key: 'stood_down', label: 'Stood down' }, { key: 'closed', label: 'Closed' }];

export function ActivationDetail() {
  return (
    <RecordPage
      type="emergency_activation"
      banner={({ row }) => (
        <div className="stack">
          {row.status === 'active' && <p className="notice notice-warn">This emergency is active. Log what happens as it happens.</p>}
          <Stepper label="Progress" current={row.status} steps={STEPS} />
        </div>
      )}
      summary={({ row }) => (
        <Card title="Activation">
          <KeyValue items={[
            { label: 'Kind of event', value: <LookupChip list="emergency_event_type" value={row.event_type} /> },
            { label: 'Level', value: <LookupChip list="activation_level" value={row.level} /> },
            { label: 'Plans activated', value: <PlanNames ids={row.plan_ids} /> },
          ]} />
        </Card>
      )}
      tabs={[
        { key: 'log', label: 'Log', content: ({ row, reload }) => <LogTab activation={row} onAdded={reload} /> },
        { key: 'roles', label: 'Roles', content: ({ row, reload }) => <RolesTab activation={row} onChanged={reload} /> },
        { key: 'checklist', label: 'Checklist', content: ({ row, reload }) => <ChecklistTab activation={row} onChanged={reload} /> },
        { key: 'summary', label: 'Summary', content: (rec) => <SummaryTab {...rec} /> },
      ]}
    />
  );
}

function PlanNames({ ids }: { ids: unknown }) {
  const list = Array.isArray(ids) ? ids as string[] : [];
  const { data } = useFetch<{ rows: Row[] }>(list.length ? '/api/continuity-plans?pageSize=500&sort=title' : null);
  if (!list.length) return <span className="muted">None</span>;
  if (!data) return <span className="muted">Loading</span>;
  const shown = data.rows.filter((p) => list.includes(String(p.id)));
  if (!shown.length) return <span className="muted">None you can see</span>;
  return <>{shown.map((p, i) => <span key={p.id}>{i ? ', ' : ''}<Link to={`/continuity/plans/${p.id}`}>{p.ref} {p.title}</Link></span>)}</>;
}
