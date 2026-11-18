import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, COLOR_NAMES, EmptyState, ErrorState, errorMessage, humanize, IconButton, Loading, Modal,
  PageHeader, StatusChip, TextField, useFetch, useMeta, useToast,
} from '../../core';
import type { ColorName } from '../../core';

interface ListSummary { list_key: string; count: number }
interface LookupRow { id: string; list_key: string; value: string; label: string; color: ColorName; sort: number; active: boolean }

const slug = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function ColorPicker({ value, onChange }: { value: ColorName; onChange: (c: ColorName) => void }) {
  return (
    <div>
      <span className="field-label" id="adm-colour-label">Colour</span>
      <div className="adm-swatches" role="group" aria-labelledby="adm-colour-label">
        {COLOR_NAMES.map((c) => (
          <button key={c} type="button" className="adm-swatch" aria-pressed={c === value} onClick={() => onChange(c)}>
            <span className={`chip chip-${c}`}>{humanize(c)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ListsPage() {
  const lists = useFetch<ListSummary[]>('/api/lookups');
  const [params, setParams] = useSearchParams();
  const selected = params.get('list') ?? lists.data?.[0]?.list_key ?? '';

  return (
    <>
      <PageHeader
        title="Lists"
        subtitle="The choices offered in drop-downs across the application: statuses, priorities, categories and so on. Changes apply at once, with no code."
      />
      {lists.error ? <ErrorState error={lists.error} onRetry={lists.reload} />
        : !lists.data ? <Loading lines={8} label="Loading lists" />
        : lists.data.length === 0 ? <EmptyState icon="clipboard" title="No lists yet" message="Lists appear here once a module that uses them is installed." />
        : (
          <div className="adm-lists">
            <Card title="Lists">
              <nav className="adm-list-nav" aria-label="Lists">
                {lists.data.map((l) => (
                  <button key={l.list_key} type="button" aria-current={l.list_key === selected} onClick={() => setParams({ list: l.list_key })}>
                    <span>{humanize(l.list_key)}</span><span className="muted">{l.count}</span>
                  </button>
                ))}
              </nav>
            </Card>
            {selected && <ListValues key={selected} list={selected} onChanged={lists.reload} />}
          </div>
        )}
    </>
  );
}

function ListValues({ list, onChanged }: { list: string; onChanged: () => void }) {
  const toast = useToast();
  const meta = useMeta();
  const { data, error, reload } = useFetch<LookupRow[]>(`/api/lookups/${encodeURIComponent(list)}`);
  const [editing, setEditing] = useState<LookupRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = () => { reload(); onChanged(); void meta.reload(); };
  const attempt = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** Moves one value and renumbers the whole list in steps of ten. */
  const move = (index: number, by: -1 | 1) => {
    if (!data) return;
    const order = [...data];
    const [row] = order.splice(index, 1);
    order.splice(index + by, 0, row);
    void attempt(async () => {
      for (const [i, r] of order.entries()) {
        if (r.sort !== (i + 1) * 10) await api.patch(`/api/lookups/${r.id}`, { sort: (i + 1) * 10 });
      }
    }, 'Order saved.');
  };

  return (
    <Card
      title={humanize(list)} flush
      actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>Add value</Button>}
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="card-body"><Loading lines={5} /></div>
        : data.length === 0 ? <EmptyState icon="clipboard" title="This list has no values" message="Add the first value." />
        : (
          <div className="table-wrap" aria-busy={busy}>
            <table className="table">
              <thead><tr><th scope="col">Order</th><th scope="col">Shown as</th><th scope="col">Stored value</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={r.id} className={r.active ? undefined : 'adm-retired'}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <IconButton size="sm" variant="ghost" icon="arrow-up" label={`Move ${r.label} up`} disabled={busy || i === 0} onClick={() => move(i, -1)} />
                      <IconButton size="sm" variant="ghost" icon="arrow-down" label={`Move ${r.label} down`} disabled={busy || i === data.length - 1} onClick={() => move(i, 1)} />
                    </td>
                    <td><StatusChip color={r.color} label={r.label} /></td>
                    <td><code>{r.value}</code></td>
                    <td>{r.active ? 'In use' : 'Retired'}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(r)}>Edit</Button>
                      {r.active
                        ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void attempt(() => api.del(`/api/lookups/${r.id}`), `“${r.label}” retired.`)}>Retire</Button>
                        : <Button size="sm" variant="ghost" disabled={busy} onClick={() => void attempt(() => api.patch(`/api/lookups/${r.id}`, { active: true }), `“${r.label}” restored.`)}>Restore</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="card-body muted">
        Values are retired, never deleted, so existing records keep their meaning. A retired value can no longer be chosen.
      </p>
      <ValueDialog
        list={list} row={editing === 'new' ? null : editing} open={editing !== null}
        nextSort={((data?.reduce((m, r) => Math.max(m, r.sort), 0) ?? 0)) + 10}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }}
      />
    </Card>
  );
}

function ValueDialog({ list, row, open, nextSort, onClose, onSaved }: {
  list: string; row: LookupRow | null; open: boolean; nextSort: number; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<ColorName>('gray');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLabel(row?.label ?? '');
    setColor(row?.color ?? 'gray');
    setErrors({});
  }, [open, row]);
  const value = row?.value ?? slug(label);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) { setErrors({ label: 'Enter the text people will see.' }); return; }
    if (!row && !value) { setErrors({ label: 'Use at least one letter or number.' }); return; }
    setBusy(true);
    try {
      if (row) await api.patch(`/api/lookups/${row.id}`, { label: label.trim(), color });
      else await api.post('/api/lookups', { list_key: list, value, label: label.trim(), color, sort: nextSort });
      toast.success(row ? 'Value saved.' : 'Value added.');
      onSaved();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors({ ...fields, label: fields.label ?? fields.value ?? '' });
      if (Object.keys(fields).length === 0) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={row ? `Edit “${row.label}”` : `Add a value to ${humanize(list)}`} size="sm" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <TextField
          label="Shown as" required autoFocus maxLength={80} value={label} onChange={setLabel} error={errors.label || undefined}
          hint={value ? `Stored as “${value}”. The stored value never changes, so renaming is safe.` : 'The text people will see.'}
        />
        <ColorPicker value={color} onChange={setColor} />
        <p>Preview: <StatusChip color={color} label={label.trim() || 'New value'} /></p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{row ? 'Save value' : 'Add value'}</Button>
        </div>
      </form>
    </Modal>
  );
}
