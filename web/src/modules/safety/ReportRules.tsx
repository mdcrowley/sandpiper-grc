// Administration > Safety reporting rules (E25-05): the organization's own rules for when a safety
// event must be reported, to whom and how fast. No rule of any jurisdiction is shipped.
import { useState } from 'react';
import {
  ApiError, api, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatNumber, IconButton, Loading,
  LookupChoices, Modal, NumberField, PageHeader, Select, StatusChip, TableWrap, TextArea, TextField, useAuth, useFetch, useLookup, useToast,
} from '../../core';

interface Condition { field: string; op: string; value: unknown }
interface Rule { id: string; key: string; name: string; conditions: Condition[]; party: string; deadline_hours: number; required: boolean; guidance: string | null; active: boolean; sort: number }
interface FieldInfo { key: string; label: string; kind: 'number' | 'list' | 'boolean'; list?: string; ops: { value: string; label: string }[] }
interface RulesResult { rules: Rule[]; fields: FieldInfo[] }

const BLANK = { name: '', party: '', deadline_hours: 24 as number | null, required: true, guidance: '', active: false, sort: 100 as number | null, conditions: [{ field: 'fatalities', op: 'gte', value: 1 }] as Condition[] };

function ConditionText({ c, fields }: { c: Condition; fields: FieldInfo[] }) {
  const f = fields.find((x) => x.key === c.field);
  const op = f?.ops.find((o) => o.value === c.op)?.label ?? c.op;
  const types = useLookup(f?.list ?? 'safety_event_type');
  const value = f?.kind === 'list' ? (Array.isArray(c.value) ? c.value.map((v) => types.find((t) => t.value === v)?.label ?? v).join(', ') : '')
    : f?.kind === 'boolean' ? (c.value ? 'yes' : 'no') : formatNumber(c.value as number);
  return <>{f?.label ?? c.field} {op} {value}</>;
}

function ConditionRow({ c, i, fields, error, onChange, onRemove }: { c: Condition; i: number; fields: FieldInfo[]; error?: string; onChange: (c: Condition) => void; onRemove?: () => void }) {
  const f = fields.find((x) => x.key === c.field) ?? fields[0];
  const pickField = (key: string) => {
    const nf = fields.find((x) => x.key === key)!;
    onChange({ field: key, op: nf.ops[0].value, value: nf.kind === 'list' ? [] : nf.kind === 'boolean' ? true : 1 });
  };
  return (
    <div className="sf-condition">
      <Select label={`Condition ${i + 1}: what`} required value={c.field} onChange={(v) => v && pickField(v)} options={fields.map((x) => ({ value: x.key, label: x.label }))} />
      <Select label="Comparison" required value={c.op} onChange={(v) => v && onChange({ ...c, op: v })} options={f.ops} />
      {f.kind === 'number' ? <NumberField label="Value" required min={0} thousands value={c.value === null || c.value === undefined ? null : Number(c.value)} onChange={(v) => onChange({ ...c, value: v })} error={error} />
        : f.kind === 'list' ? <LookupChoices label="Values" list={f.list!} value={Array.isArray(c.value) ? c.value as string[] : []} onChange={(v) => onChange({ ...c, value: v })} error={error} />
        : <Select label="Value" required value={c.value ? 'yes' : 'no'} onChange={(v) => onChange({ ...c, value: v === 'yes' })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} error={error} />}
      {onRemove ? <IconButton icon="trash" label={`Remove condition ${i + 1}`} onClick={onRemove} /> : <span />}
    </div>
  );
}

export function ReportRules() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<RulesResult>('/api/safety/report-rules');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [f, setF] = useState(BLANK);
  const [start, setStart] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const mayAdmin = can('safety.administer');
  const open = (r: Rule | 'new') => {
    setErrors({});
    const initial = r === 'new' ? BLANK : { name: r.name, party: r.party, deadline_hours: Number(r.deadline_hours), required: r.required, guidance: r.guidance ?? '', active: r.active, sort: r.sort, conditions: r.conditions };
    setF(initial); setStart(initial);
    setEditing(r);
  };
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      if (editing === 'new') await api.post('/api/safety/report-rules', f);
      else if (editing) await api.patch(`/api/safety/report-rules/${editing.id}`, f);
      toast.success('Rule saved.'); setEditing(null); reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  const toggle = async (r: Rule) => {
    try { await api.patch(`/api/safety/report-rules/${r.id}`, { active: !r.active }); toast.success(r.active ? 'Rule switched off.' : 'Rule switched on.'); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`/api/safety/report-rules/${removing.id}`); toast.success('Rule removed.'); setRemoving(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <PageHeader title="Safety reporting rules" breadcrumbs={[{ label: 'Administration' }, { label: 'Safety reporting rules' }]}
        subtitle="When a safety event must be reported, to whom and within how many hours. Write the rules your organization must follow: none are built in."
        actions={mayAdmin && <Button variant="primary" icon="plus" onClick={() => open('new')}>New rule</Button>} />
      <p className="muted">Every time a safety event is saved, its figures are checked against the rules that are switched on. A rule that applies starts a notification clock on the event, counted from the time of the event, and tells the safety team. Changing a rule does not change clocks already started.</p>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={6} /> : data.rules.length === 0
        ? <EmptyState icon="clock" title="No reporting rules" message="Add the reporting duties your organization has, for example a fatality to be reported to an oversight body within a few hours." />
        : (
          <Card flush>
            <TableWrap label="Safety reporting rules">
              <table className="table sf-wrap">
                <caption className="sr-only">Safety reporting rules</caption>
                <thead><tr><th scope="col">Rule</th><th scope="col">Applies when</th><th scope="col">Notify</th><th scope="col" className="num">Within</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.rules.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong>{r.guidance && <div className="muted sf-hint">{r.guidance}</div>}</td>
                      <td><ul className="sf-rule-conditions">{r.conditions.map((c, i) => <li key={i}><ConditionText c={c} fields={data.fields} /></li>)}</ul></td>
                      <td>{r.party} <Badge color={r.required ? 'blue' : 'gray'}>{r.required ? 'Required' : 'Recommended'}</Badge></td>
                      <td className="num">{formatNumber(r.deadline_hours)} hours</td>
                      <td>{r.active ? <StatusChip color="green" label="On" /> : <StatusChip color="gray" label="Off" />}</td>
                      <td className="sf-actions">{mayAdmin && <>
                        <Button size="sm" variant="ghost" aria-label={`${r.active ? 'Switch off' : 'Switch on'}: ${r.name}`} onClick={() => toggle(r)}>{r.active ? 'Switch off' : 'Switch on'}</Button>
                        <Button size="sm" variant="ghost" aria-label={`Edit: ${r.name}`} onClick={() => open(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" aria-label={`Remove: ${r.name}`} onClick={() => setRemoving(r)}>Remove</Button>
                      </>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}
      <Modal open={!!editing} size="lg" title={editing === 'new' ? 'New reporting rule' : 'Edit reporting rule'} onClose={() => setEditing(null)}
        dirty={JSON.stringify(f) !== JSON.stringify(start)}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        {data && (
          <div className="form">
            <div className="form-grid">
              <div className="form-cell-wide"><TextField label="Name" required value={f.name} onChange={(v) => set('name', v)} error={errors.name} /></div>
              <TextField label="Who must be notified" required value={f.party} onChange={(v) => set('party', v)} error={errors.party} />
              <NumberField label="Within (hours from the event)" required min={0} value={f.deadline_hours} onChange={(v) => set('deadline_hours', v)} error={errors.deadline_hours} />
            </div>
            <fieldset className="stack">
              <legend>Applies when all of these hold</legend>
              {errors.conditions && <p className="field-error" role="alert">{errors.conditions}</p>}
              {f.conditions.map((c, i) => (
                <ConditionRow key={i} c={c} i={i} fields={data.fields} error={errors[`conditions.${i}`]}
                  onChange={(nc) => set('conditions', f.conditions.map((x, j) => (j === i ? nc : x)))}
                  onRemove={f.conditions.length > 1 ? () => set('conditions', f.conditions.filter((_, j) => j !== i)) : undefined} />
              ))}
              <div><Button size="sm" icon="plus" onClick={() => set('conditions', [...f.conditions, { field: 'people_transported', op: 'gte', value: 1 }])}>Add a condition</Button></div>
            </fieldset>
            <TextArea label="Guidance" value={f.guidance} onChange={(v) => set('guidance', v)} rows={3} hint="How to notify: the number or address to use, what to include." />
            <div className="form-grid">
              <Checkbox label="Required (not only recommended)" checked={f.required} onChange={(v) => set('required', v)} />
              <Checkbox label="Switched on" checked={f.active} onChange={(v) => set('active', v)} />
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!removing} title="Remove this rule?" message="Clocks the rule already started stay on their events." confirmLabel="Remove" danger busy={busy}
        onConfirm={remove} onCancel={() => setRemoving(null)} />
    </div>
  );
}
