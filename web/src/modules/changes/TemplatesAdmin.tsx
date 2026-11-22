import { useState } from 'react';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, IconButton, Loading,
  LookupChip, LookupSelect, Modal, NumberField, RecordPicker, TableWrap, TextArea, TextField, useFetch, useResource, useToast,
} from '../../core';
import type { Template } from './types';

type Form = Omit<Template, 'id' | 'uses' | 'uses_90_days' | 'last_used_at' | 'system_label'> & { id?: string; system_label?: string | null };
const blank = (): Form => ({
  name: '', summary: '', title: '', description: '', reason: '', implementation_plan: '', test_plan: '', backout_plan: '',
  risk_level: 'low', duration_minutes: 60, system_id: null, active: true,
});

/** Standard change templates: pre-approved, filled-in changes for routine work. */
export function TemplatesAdmin() {
  const toast = useToast();
  const hasSystems = Boolean(useResource('system'));
  const { data, error, reload } = useFetch<Template[]>('/api/changes/templates?all=true');
  const [form, setForm] = useState<Form | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Template | null>(null);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  // What the dialog opened with, so closing it after a change asks first.
  const [start, setStart] = useState<Form | null>(null);
  const begin = (t?: Template) => { const first = t ? { ...t } : blank(); setForm(first); setStart(first); setFields({}); setFormError(''); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const missing: Record<string, string> = {};
    if (!form.name.trim()) missing.name = 'Name is required.';
    if (!form.title.trim()) missing.title = 'Change title is required.';
    if (!String(form.implementation_plan ?? '').trim()) missing.implementation_plan = 'Implementation plan is required.';
    if (!String(form.backout_plan ?? '').trim()) missing.backout_plan = 'Back-out plan is required.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    const { id, system_label: _label, ...body } = form;
    try {
      if (id) await api.patch(`/api/changes/templates/${id}`, body); else await api.post('/api/changes/templates', body);
      toast.success(id ? 'Template saved.' : 'Template added.');
      setForm(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/changes/templates/${removing.id}`);
      toast.success('Template deleted.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Standard change templates" flush actions={<Button size="sm" variant="primary" icon="plus" onClick={() => begin()}>Add template</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={4} />
        : data.length === 0 ? (
          <EmptyState icon="clipboard" title="No templates yet" message="A template describes routine, low-risk work that has been approved in advance. A change raised from it needs no further approval." />
        ) : (
          <TableWrap label="Standard change templates" className="chg-tw">
            <table className="table">
              <thead><tr><th>Template</th><th>Risk</th><th className="num">Duration</th><th className="num">Used, last 90 days</th><th className="num">Used in total</th><th>Last used</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="row"><strong>{t.name}</strong>{!t.active && <Badge>Not in use</Badge>}</span>
                      {t.summary && <div className="muted">{t.summary}</div>}
                    </td>
                    <td><LookupChip list="change_risk" value={t.risk_level} /></td>
                    <td className="num">{t.duration_minutes} min</td>
                    <td className="num">{t.uses_90_days}</td>
                    <td className="num">{t.uses}</td>
                    <td>{formatDate(t.last_used_at)}</td>
                    <td className="num">
                      <span className="chg-rowactions">
                        <IconButton icon="edit" variant="ghost" label={`Edit ${t.name}`} onClick={() => begin(t)} />
                        <IconButton icon="trash" variant="ghost" label={`Delete ${t.name}`} onClick={() => setRemoving(t)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      <p className="muted chg-card-foot">The usage counts show how often each template is raised, so a template that is being used for work it was not approved for can be spotted.</p>

      <Modal open={form !== null} title={form?.id ? 'Edit template' : 'Add template'} onClose={() => setForm(null)} size="lg" dirty={form !== null && JSON.stringify(form) !== JSON.stringify(start)}>
        {form && (
          <form className="form" onSubmit={save} noValidate>
            <div className="form-grid">
              <TextField label="Name" required value={form.name} onChange={(name) => set({ name })} error={fields.name} />
              <TextField label="When to use it" value={form.summary ?? ''} onChange={(summary) => set({ summary })} error={fields.summary} />
              <TextField className="form-cell-wide" label="Change title" required value={form.title} onChange={(title) => set({ title })} error={fields.title} hint="The title given to each change raised from this template." />
              <TextArea label="What will be done" value={form.description ?? ''} onChange={(description) => set({ description })} rows={3} />
              <TextArea label="Why it is needed" value={form.reason ?? ''} onChange={(reason) => set({ reason })} rows={3} />
              <TextArea className="form-cell-wide" label="Implementation plan" required value={form.implementation_plan ?? ''} onChange={(implementation_plan) => set({ implementation_plan })} rows={4} error={fields.implementation_plan} />
              <TextArea label="Test plan" value={form.test_plan ?? ''} onChange={(test_plan) => set({ test_plan })} rows={3} />
              <TextArea label="Back-out plan" required value={form.backout_plan ?? ''} onChange={(backout_plan) => set({ backout_plan })} rows={3} error={fields.backout_plan} />
              <LookupSelect label="Risk" list="change_risk" value={form.risk_level} onChange={(risk_level) => set({ risk_level: risk_level || 'low' })} error={fields.risk_level} />
              <NumberField label="Usual duration in minutes" min={5} step={5} value={form.duration_minutes} onChange={(n) => set({ duration_minutes: n ?? 60 })} error={fields.duration_minutes} />
              {hasSystems && <RecordPicker label="Main system" type="system" value={form.system_id} display={form.system_label ?? undefined} onChange={(id, o) => set({ system_id: id, system_label: o?.label })} hint="Optional: leave empty to choose when the change is raised." />}
              <Checkbox label="In use" hint="Clear this to stop new changes being raised from this template." checked={form.active} onChange={(active) => set({ active })} />
            </div>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="form-actions">
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy}>Save template</Button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Delete template"
        message={`Delete "${removing?.name}"? Changes already raised from it are kept.`}
        confirmLabel="Delete template"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
