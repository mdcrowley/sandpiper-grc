import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError, Button, EmptyState, ErrorState, IconButton, Loading, Modal, TextField, api, errorMessage, useFetch, useLookup, useToast,
  useUnsavedChanges,
} from '../../core';
import type { Row } from '../../core';
import type { Mapping } from './types';

function EditMapping({ base, mapping, onDone, onCancel }: { base: string; mapping: Mapping; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(mapping.framework_name);
  const [reference, setReference] = useState(mapping.reference);
  // Tells the enclosing dialog, so closing it after a change asks first.
  useUnsavedChanges(name !== mapping.framework_name || reference !== mapping.reference);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErrors({ framework_name: 'Name the other framework or requirement.' }); return; }
    setBusy(true);
    setErrors({});
    try {
      await api.patch(`${base}/${mapping.id}`, { framework_name: name, reference });
      toast.success('Mapping changed.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <TextField label="Framework or requirement" required autoFocus value={name} onChange={setName} error={errors.framework_name} />
      <TextField label="Reference" value={reference} onChange={setReference} error={errors.reference}
        hint="The section, clause or control number, if there is one." />
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Save changes</Button>
      </div>
    </form>
  );
}

export function MappingsTab({ outcome, canEdit, onChanged }: { outcome: Row; canEdit: boolean; onChanged?: () => void }) {
  const toast = useToast();
  const base = `/api/framework-outcomes/${outcome.id}/mappings`;
  const { data, error, reload } = useFetch<Mapping[]>(base);
  const names = useFetch<string[]>(canEdit ? '/api/framework-mappings/names' : null);
  // The configurable list of other frameworks' names (Administration > Lists > Mapping framework).
  const listed = useLookup('mapping_framework');
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Mapping | null>(null);
  const suggestions = [...new Set([...(names.data ?? []), ...listed.map((l) => l.label)])].slice(0, 10);
  const changed = () => { reload(); names.reload(); onChanged?.(); };

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErrors({ framework_name: 'Name the other framework or requirement.' }); return; }
    setBusy(true);
    setErrors({});
    try {
      await api.post(base, { framework_name: name, reference });
      setReference('');
      changed();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Mapping) {
    try {
      await api.del(`${base}/${m.id}`);
      changed();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Other frameworks, laws and conditions that this outcome also satisfies, so one piece of evidence can be used for all of them.
        The <Link to="/frameworks/coverage">coverage view</Link> turns these around: pick another framework and see which outcomes meet each of its requirements.
      </p>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} label="Loading mappings" />
        : data.length === 0 ? (
          <EmptyState icon="link" title="Not mapped to anything else yet"
            message={canEdit ? 'Add the first mapping below.' : 'Nobody has mapped this outcome to another framework.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Framework or requirement</th><th scope="col">Reference</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td className="row-title"><Link to={`/frameworks/coverage?name=${encodeURIComponent(m.framework_name)}`}>{m.framework_name}</Link></td>
                    <td style={{ whiteSpace: 'normal' }}>{m.reference || '—'}</td>
                    <td className="num fw-row-actions">
                      {canEdit && (
                        <>
                          <IconButton icon="edit" label={`Edit mapping to ${m.framework_name} ${m.reference}`} variant="ghost" size="sm" onClick={() => setEditing(m)} />
                          <IconButton icon="trash" label={`Remove mapping to ${m.framework_name} ${m.reference}`} variant="ghost" size="sm" onClick={() => remove(m)} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {canEdit && (
        <form className="form fw-map-add" onSubmit={add} noValidate>
          <div className="form-grid">
            <TextField label="Framework or requirement" required value={name} onChange={setName} error={errors.framework_name}
              placeholder="For example: ISO/IEC 27001" />
            <TextField label="Reference" value={reference} onChange={setReference} error={errors.reference}
              placeholder="For example: 12.10.1" hint="The section, clause or control number, if there is one." />
          </div>
          <div className="fw-suggest">
            <span className="muted">Quick pick:</span>
            {suggestions.map((s) => (
              <Button key={s} size="sm" variant="ghost" onClick={() => setName(s)}>{s}</Button>
            ))}
          </div>
          <div className="form-actions">
            <Button type="submit" variant="primary" icon="plus" loading={busy}>Add mapping</Button>
          </div>
        </form>
      )}

      <Modal open={editing !== null} title="Edit mapping" size="sm" onClose={() => setEditing(null)}>
        {editing && <EditMapping base={base} mapping={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); changed(); }} />}
      </Modal>
    </div>
  );
}
