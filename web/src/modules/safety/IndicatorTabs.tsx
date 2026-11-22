// One indicator's values entered by hand (E25-07) and its yearly targets with their approval (E25-10).
import { useState } from 'react';
import {
  ApiError, api, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, formatNumber, Loading, Modal, NumberField,
  Select, StatusChip, TableWrap, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { ColorName } from '../../core';

const monthLabel = (p: string) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

interface Value { period: string; value: number; note: string | null; entered_by_name: string | null }

/** A grid of months, newest first, each with its value and an Enter or Edit button. */
export function ValuesTab({ indicatorId, periods, onSaved }: { indicatorId: string; periods: string[]; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Value[]>(`/api/safety-indicators/${indicatorId}/values`);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const prior = editing ? data?.find((x) => x.period === editing) : undefined;
  const dirty = !!editing && (value !== (prior?.value ?? null) || note !== (prior?.note ?? ''));
  const start = (p: string) => { const v = data?.find((x) => x.period === p); setValue(v?.value ?? null); setNote(v?.note ?? ''); setErr(undefined); setEditing(p); };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.put(`/api/safety-indicators/${indicatorId}/values/${editing}`, { value, note });
      toast.success(value === null ? 'Value removed.' : 'Value saved.'); setEditing(null); reload(); onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErr(e.fields.value ?? e.fields.period); else toast.error(errorMessage(e));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Values by month" flush>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <div className="sf-pad"><Loading lines={6} /></div> : (
        <TableWrap label="Values entered by month">
          <table className="table">
            <caption className="sr-only">Values entered by month</caption>
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Value</th><th scope="col">Note</th><th scope="col">Entered by</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {[...periods].reverse().map((p) => {
                const v = data.find((x) => x.period === p);
                return (
                  <tr key={p}>
                    <th scope="row">{monthLabel(p)}</th>
                    <td className="num">{v ? formatNumber(v.value) : <span className="muted">—</span>}</td>
                    <td>{v?.note ?? ''}</td>
                    <td>{v?.entered_by_name ?? ''}</td>
                    <td className="sf-actions">{can('safety.edit') && <Button size="sm" variant="ghost" onClick={() => start(p)}>{v ? 'Edit' : 'Enter'}</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Modal open={!!editing} size="sm" title={`Value for ${editing ? monthLabel(editing) : ''}`} onClose={() => setEditing(null)} dirty={dirty}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        <div className="form">
          <NumberField label="Value" min={0} thousands value={value} onChange={setValue} error={err} hint="Leave empty to remove the month's value." />
          <TextField label="Note" value={note} onChange={setNote} />
        </div>
      </Modal>
    </Card>
  );
}

interface Target {
  id: string; year: number; target: number; direction: string; status: string; approved_by_name: string | null; approved_on: string | null;
  approval_ref: string | null; note: string | null;
}
interface TargetsResult { approval_available: boolean; running: { id: string; workflow: string; year: number } | null; targets: Target[] }

const STATUS: Record<string, { label: string; color: ColorName }> = {
  proposed: { label: 'Proposed', color: 'blue' }, pending_approval: { label: 'Waiting for approval', color: 'amber' },
  approved: { label: 'Approved', color: 'green' }, rejected: { label: 'Rejected', color: 'red' },
};
const dirText = (d: string) => (d === 'at_least' ? 'At least' : 'At most');
const BLANK_DECISION = { decision: 'approved', approved_by_name: '', approved_on: '', approval_ref: '' };

export function TargetsTab({ indicatorId, defaultDirection, onChanged }: { indicatorId: string; defaultDirection: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<TargetsResult>(`/api/safety-indicators/${indicatorId}/targets`);
  const thisYear = new Date().getFullYear();
  const [editing, setEditing] = useState<Target | 'new' | null>(null);
  const [f, setF] = useState({ year: thisYear as number | null, target: null as number | null, direction: defaultDirection, note: '' });
  const [start, setStart] = useState(f);
  const [deciding, setDeciding] = useState<Target | null>(null);
  const [d, setD] = useState(BLANK_DECISION);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const done = (msg: string) => { toast.success(msg); reload(); onChanged(); };
  const fail = (e: unknown) => { if (e instanceof ApiError && e.fields) setErrors(e.fields); else toast.error(errorMessage(e)); };
  const open = (t: Target | 'new') => {
    setErrors({});
    const initial = t === 'new' ? { year: thisYear, target: null, direction: defaultDirection, note: '' } : { year: t.year, target: t.target, direction: t.direction, note: t.note ?? '' };
    setF(initial); setStart(initial);
    setEditing(t);
  };
  const save = async () => {
    setBusy(true);
    try {
      if (editing === 'new') await api.post(`/api/safety-indicators/${indicatorId}/targets`, f);
      else if (editing) await api.patch(`/api/safety-indicators/${indicatorId}/targets/${editing.year}`, { target: f.target, direction: f.direction, note: f.note });
      setEditing(null); done('Target saved.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const ask = async (t: Target) => {
    setBusy(true);
    try { await api.post(`/api/safety-indicators/${indicatorId}/targets/${t.year}/approval`, {}); done(`Approval of the ${t.year} target asked for.`); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const decide = async () => {
    if (!deciding) return;
    setBusy(true);
    try { await api.post(`/api/safety-indicators/${indicatorId}/targets/${deciding.year}/decision`, d); setDeciding(null); done('Decision recorded.'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  return (
    <Card title="Targets by year" flush actions={can('safety.edit') && <Button size="sm" icon="plus" onClick={() => open('new')}>Add a target</Button>}>
      <p className="muted sf-pad sf-hint">A year's target takes the place of the indicator's own target for the months of that year, unless it is rejected. Approve it through the approval workflow, or record a decision taken elsewhere, for example at a safety committee meeting.</p>
      {data.targets.length === 0 ? <EmptyState icon="target" title="No yearly targets" message="Set this year's target, then have it approved." /> : (
        <TableWrap label="Targets by year">
          <table className="table">
            <caption className="sr-only">Targets by year</caption>
            <thead><tr><th scope="col">Year</th><th scope="col">Target</th><th scope="col">Status</th><th scope="col">Decided</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.targets.map((t) => {
                const st = STATUS[t.status] ?? STATUS.proposed;
                return (
                  <tr key={t.id}>
                    <th scope="row">{t.year}</th>
                    <td>{dirText(t.direction)} {formatNumber(t.target)}</td>
                    <td><StatusChip color={st.color} label={st.label} /></td>
                    <td>{t.approved_by_name ? `${t.approved_by_name}${t.approved_on ? `, ${formatDate(t.approved_on)}` : ''}${t.approval_ref ? ` (${t.approval_ref})` : ''}` : <span className="muted">—</span>}</td>
                    <td className="sf-actions">
                      {can('safety.edit') && t.status !== 'pending_approval' && <Button size="sm" variant="ghost" onClick={() => open(t)}>Edit</Button>}
                      {can('safety.edit') && data.approval_available && !data.running && ['proposed', 'rejected'].includes(t.status) && <Button size="sm" loading={busy} onClick={() => ask(t)}>Ask for approval</Button>}
                      {can('safety.approve') && t.status !== 'approved' && <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setD(BLANK_DECISION); setDeciding(t); }}>Record a decision</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Modal open={!!editing} size="sm" title={editing === 'new' ? 'Add a yearly target' : `Target for ${editing ? (editing as Target).year : ''}`} onClose={() => setEditing(null)}
        dirty={JSON.stringify(f) !== JSON.stringify(start)}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        <div className="form">
          {editing === 'new' && <NumberField label="Year" required min={2000} max={2100} value={f.year} onChange={(v) => setF((x) => ({ ...x, year: v }))} error={errors.year} />}
          <Select label="Target is" required value={f.direction} onChange={(v) => setF((x) => ({ ...x, direction: v || 'at_most' }))}
            options={[{ value: 'at_most', label: 'At most (lower is better)' }, { value: 'at_least', label: 'At least (higher is better)' }]} />
          <NumberField label="Target" required min={0} thousands value={f.target} onChange={(v) => setF((x) => ({ ...x, target: v }))} error={errors.target} />
          <TextArea label="Note" value={f.note} onChange={(v) => setF((x) => ({ ...x, note: v }))} rows={2} />
          {editing !== 'new' && (editing as Target | null)?.status === 'approved' && <p className="muted sf-hint">Changing the figure sends the target back to Proposed: it needs approval again.</p>}
        </div>
      </Modal>
      <Modal open={!!deciding} title={`Record a decision on the ${deciding?.year ?? ''} target`} onClose={() => setDeciding(null)}
        dirty={JSON.stringify(d) !== JSON.stringify(BLANK_DECISION)}
        footer={<><Button onClick={() => setDeciding(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={decide}>Record</Button></>}>
        <div className="form">
          <Select label="Decision" required value={d.decision} onChange={(v) => setD((x) => ({ ...x, decision: v || 'approved' }))} options={[{ value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} />
          <TextField label="Decided by" required value={d.approved_by_name} onChange={(v) => setD((x) => ({ ...x, approved_by_name: v }))} error={errors.approved_by_name} hint="A person or a body, for example the safety committee." />
          <DateField label="Date of the decision" required value={d.approved_on} onChange={(v) => setD((x) => ({ ...x, approved_on: v }))} error={errors.approved_on} />
          <TextField label="Reference" required value={d.approval_ref} onChange={(v) => setD((x) => ({ ...x, approval_ref: v }))} error={errors.approval_ref} hint="For example the meeting and the item number." />
        </div>
      </Modal>
    </Card>
  );
}
