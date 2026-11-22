// Administration > Asset tags > Series (E37-03): series for printing your own tags (prefix, digits,
// next number). Numbers are taken when tags are printed (Print tags). Owner: TAGS-CORE.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, Loading, Modal, NumberField, PageHeader, Select, StatusChip,
  TableWrap, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { AssetTagsTabs } from './AdminTabs';
import { sequenceValue, type TagFormat, type TagSeries, type TagSeriesInput } from './api';

interface Draft { name: string; formatId: string; prefix: string; digits: number | null; nextNumber: number | null; active: boolean }
const EMPTY: Draft = { name: '', formatId: '', prefix: '', digits: 6, nextNumber: 1, active: true };

export function SeriesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('tags.manage');
  const { data, error, reload } = useFetch<TagSeries[]>('/api/asset-tags/series');
  const { data: formats } = useFetch<TagFormat[]>('/api/asset-tags/formats');
  const [editing, setEditing] = useState<TagSeries | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const formatName = (id: string | null) => (id ? formats?.find((f) => f.id === id)?.name ?? '' : '');
  const format = formats?.find((f) => f.id === draft.formatId) ?? null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const startOf = (s: TagSeries | 'new'): Draft => (s === 'new' ? EMPTY : { name: s.name, formatId: s.formatId ?? '', prefix: s.prefix, digits: s.digits, nextNumber: s.nextNumber, active: s.active });
  const open = (s: TagSeries | 'new') => { setEditing(s); setDraft(startOf(s)); setErrors({}); };
  const dirty = editing !== null && JSON.stringify(draft) !== JSON.stringify(startOf(editing));
  const next = draft.digits && draft.nextNumber !== null && String(draft.nextNumber).length <= draft.digits
    ? sequenceValue(draft.nextNumber, { prefix: draft.prefix, digits: draft.digits, checkCharacter: format?.checkCharacter })
    : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: TagSeriesInput = { name: draft.name, formatId: draft.formatId || null, prefix: draft.prefix, digits: draft.digits ?? 0, nextNumber: draft.nextNumber ?? -1, active: draft.active };
    try {
      if (editing === 'new') await api.post('/api/asset-tags/series', body);
      else if (editing) await api.patch(`/api/asset-tags/series/${editing.id}`, body);
      toast.success('Series saved.');
      setEditing(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Tag series"
        subtitle="For printing your own tags: each print takes the next numbers of a series and registers them as stock, so two people printing at once never get the same numbers."
        actions={manage ? (
          <>
            <Link className="btn btn-secondary" to="/admin/asset-tags/print">Print tags</Link>
            <Button variant="primary" icon="plus" onClick={() => open('new')}>Add series</Button>
          </>
        ) : undefined}
      />
      <AssetTagsTabs />
      <Card title="Series" flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={3} label="Loading series" /></div>
          : data.length === 0 ? (
            <EmptyState icon="tag" title="No series" message="Add a series if your organization prints its own tags." action={manage ? <Button icon="plus" onClick={() => open('new')}>Add series</Button> : undefined} />
          ) : (
            <TableWrap label="Series">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th><th scope="col">Next value</th><th scope="col">Digits</th><th scope="col">Format</th><th scope="col">Status</th>
                    {manage && <th scope="col"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {data.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.nextValue ? <span className="tg-value">{s.nextValue}</span> : <span className="muted">No numbers left</span>}</td>
                      <td>{s.digits}</td>
                      <td>{formatName(s.formatId) || <span className="muted">None</span>}</td>
                      <td>{s.active ? <StatusChip color="green" label="Active" /> : <StatusChip color="gray" label="Off" />}</td>
                      {manage && <td className="tg-actions"><Button size="sm" variant="ghost" icon="edit" onClick={() => open(s)} aria-label={`Edit ${s.name}`}>Edit</Button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      <Modal open={editing !== null} title={editing === 'new' ? 'Add series' : 'Edit series'} onClose={() => setEditing(null)} dirty={dirty}>
        <form className="form" onSubmit={submit} noValidate>
          <div className="form-grid">
            <TextField label="Name" required maxLength={80} value={draft.name} onChange={(v) => set('name', v)} error={errors.name} />
            <Select
              label="Format" value={draft.formatId} onChange={(v) => set('formatId', v)} error={errors.formatId} placeholder="None"
              options={[{ value: '', label: 'None' }, ...(formats ?? []).filter((f) => f.active).map((f) => ({ value: f.id, label: f.name }))]}
              hint="Its check character is added to each number."
            />
            <TextField label="Prefix" maxLength={20} value={draft.prefix} onChange={(v) => set('prefix', v)} error={errors.prefix} />
            <NumberField label="Digits" required min={1} max={18} step={1} value={draft.digits} onChange={(v) => set('digits', v)} error={errors.digits} />
            <NumberField label="Next number" required min={0} step={1} value={draft.nextNumber} onChange={(v) => set('nextNumber', v)} error={errors.nextNumber} />
            <div className="field"><span className="field-label">Next value</span><span className="tg-value" aria-live="polite">{next ?? '—'}</span></div>
            <div className="form-cell-wide"><Checkbox label="Active" checked={draft.active} onChange={(v) => set('active', v)} hint="A series that is off cannot be printed from." /></div>
          </div>
          <div className="form-actions">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
