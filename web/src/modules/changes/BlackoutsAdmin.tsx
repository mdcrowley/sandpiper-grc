import { useState } from 'react';
import {
  api, ApiError, Badge, Button, Card, ConfirmDialog, DateField, DateTimeField, EmptyState, errorMessage, ErrorState, formatDate,
  formatDateTime, Icon, IconButton, Loading, Modal, RecordPicker, Select, TableWrap, TextArea, TextField, useFetch, useResource, useToast,
} from '../../core';
import type { Blackout } from './types';

interface Form {
  id?: string; name: string; starts_at: string; ends_at: string; reason: string;
  systems: { id: string; label: string }[]; repeat: string; repeat_until: string;
}

const REPEATS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];
const repeatLabel = (b: Blackout) => REPEATS.find((r) => r.value === (b.repeat ?? 'none'))?.label ?? '';

/** Picks several systems: a search box that adds, and chips that remove. */
function SystemsField({ value, onChange, error }: { value: Form['systems']; onChange: (v: Form['systems']) => void; error?: string }) {
  return (
    <div className="stack chg-systems-field">
      <RecordPicker label="Applies to systems" type="system" value={null} placeholder="All systems: search to limit it to some"
        error={error} hint="Leave empty for every change. Otherwise only changes that affect one of these systems are flagged."
        onChange={(id, option) => { if (id && !value.some((s) => s.id === id)) onChange([...value, { id, label: option?.label ?? 'System' }]); }} />
      {value.length > 0 && (
        <span className="row">
          {value.map((s) => (
            <span key={s.id} className="chip chip-blue chg-chip">
              {s.label}
              <button type="button" className="chg-chip-x" aria-label={`Remove ${s.label}`} onClick={() => onChange(value.filter((x) => x.id !== s.id))}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** Blackout periods: times when changes should not be made. */
export function BlackoutsAdmin() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Blackout[]>('/api/changes/blackouts');
  const hasSystems = Boolean(useResource('system'));
  const [form, setForm] = useState<Form | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Blackout | null>(null);
  const now = Date.now();

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  // What the dialog opened with, so closing it after a change asks first.
  const [start, setStart] = useState<Form | null>(null);
  const begin = (b?: Blackout) => {
    const first: Form = b
      ? {
        id: b.id, name: b.name, starts_at: b.starts_at, ends_at: b.ends_at, reason: b.reason ?? '',
        systems: b.systems ?? [], repeat: b.repeat ?? 'none', repeat_until: b.repeat_until ? String(b.repeat_until).slice(0, 10) : '',
      }
      : { name: '', starts_at: '', ends_at: '', reason: '', systems: [], repeat: 'none', repeat_until: '' };
    setForm(first); setStart(first);
    setFields({}); setFormError('');
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const missing: Record<string, string> = {};
    if (!form.name.trim()) missing.name = 'Name is required.';
    if (!form.starts_at) missing.starts_at = 'Start is required.';
    if (!form.ends_at) missing.ends_at = 'End is required.';
    else if (form.starts_at && new Date(form.ends_at) <= new Date(form.starts_at)) missing.ends_at = 'The end must be after the start.';
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    const { id, systems, ...rest } = form;
    const body = { ...rest, system_ids: systems.map((s) => s.id), repeat_until: rest.repeat === 'none' ? null : rest.repeat_until || null };
    try {
      if (id) await api.patch(`/api/changes/blackouts/${id}`, body); else await api.post('/api/changes/blackouts', body);
      toast.success(id ? 'Blackout period saved.' : 'Blackout period added.');
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
      await api.del(`/api/changes/blackouts/${removing.id}`);
      toast.success('Blackout period deleted.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Blackout periods" flush actions={<Button size="sm" variant="primary" icon="plus" onClick={() => begin()}>Add blackout period</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={4} />
        : data.length === 0 ? (
          <EmptyState icon="calendar" title="No blackout periods" message="Add the times when changes should not be made, such as a year-end close or a major event. A change planned in one is flagged as a conflict." />
        ) : (
          <TableWrap label="Blackout periods" className="chg-tw">
            <table className="table">
              <thead><tr><th>Name</th><th>Start</th><th>End</th><th>Repeats</th><th>Systems</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="row">
                        <strong>{b.name}</strong>
                        {new Date(b.ends_at).getTime() < now ? <Badge>Past</Badge> : new Date(b.starts_at).getTime() <= now ? <Badge color="amber">In force now</Badge> : null}
                      </span>
                    </td>
                    <td>{formatDateTime(b.starts_at)}</td>
                    <td>{formatDateTime(b.ends_at)}</td>
                    <td>
                      {repeatLabel(b)}
                      {b.repeat && b.repeat !== 'none' && <div className="muted">{b.repeat_until ? `Until ${formatDate(b.repeat_until)}` : 'No end date'}</div>}
                    </td>
                    <td>{b.systems?.length ? b.systems.map((s) => s.label).join(', ') : <span className="muted">All systems</span>}</td>
                    <td>{b.reason ?? '—'}</td>
                    <td className="num">
                      <span className="chg-rowactions">
                        <IconButton icon="edit" variant="ghost" label={`Edit ${b.name}`} onClick={() => begin(b)} />
                        <IconButton icon="trash" variant="ghost" label={`Delete ${b.name}`} onClick={() => setRemoving(b)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

      <Modal open={form !== null} title={form?.id ? 'Edit blackout period' : 'Add blackout period'} onClose={() => setForm(null)} size="md" dirty={form !== null && JSON.stringify(form) !== JSON.stringify(start)}>
        {form && (
          <form className="form" onSubmit={save} noValidate>
            <TextField label="Name" required value={form.name} onChange={(name) => set({ name })} error={fields.name} />
            <div className="form-grid">
              <DateTimeField label="Start" required value={form.starts_at} onChange={(starts_at) => set({ starts_at })} error={fields.starts_at} />
              <DateTimeField label="End" required value={form.ends_at} onChange={(ends_at) => set({ ends_at })} error={fields.ends_at} />
            </div>
            <div className="form-grid">
              <Select label="Repeats" value={form.repeat} options={REPEATS} required onChange={(repeat) => set({ repeat: repeat || 'none' })} error={fields.repeat}
                hint="For example every month-end, or each weekly timetable switch-over." />
              {form.repeat !== 'none' && (
                <DateField label="Repeat until" value={form.repeat_until} onChange={(repeat_until) => set({ repeat_until })} error={fields.repeat_until}
                  hint="Leave empty to repeat with no end." />
              )}
            </div>
            {hasSystems && <SystemsField value={form.systems} onChange={(systems) => set({ systems })} error={fields.system_ids} />}
            <TextArea label="Reason" value={form.reason} onChange={(reason) => set({ reason })} rows={2} hint="Shown wherever a change is flagged against this period." />
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="form-actions">
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy}>Save blackout period</Button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Delete blackout period"
        message={`Delete "${removing?.name}"? Changes planned in it will no longer be flagged.`}
        confirmLabel="Delete blackout period"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
