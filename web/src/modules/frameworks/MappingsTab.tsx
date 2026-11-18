import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ApiError, Button, EmptyState, ErrorState, IconButton, Loading, TextField, api, errorMessage, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import type { Mapping } from './types';

/** Starting suggestions; names already used elsewhere are added from the server. */
const COMMON = ['PCI DSS', 'HIPAA Security Rule', 'ISO/IEC 27001', 'CIS Controls', 'SOC 2'];

export function MappingsTab({ outcome, canEdit }: { outcome: Row; canEdit: boolean }) {
  const toast = useToast();
  const base = `/api/framework-outcomes/${outcome.id}/mappings`;
  const { data, error, reload } = useFetch<Mapping[]>(base);
  const names = useFetch<string[]>(canEdit ? '/api/framework-mappings/names' : null);
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const suggestions = [...new Set([...COMMON, ...(names.data ?? [])])].slice(0, 10);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErrors({ framework_name: 'Name the other framework or requirement.' }); return; }
    setBusy(true);
    setErrors({});
    try {
      await api.post(base, { framework_name: name, reference });
      setReference('');
      reload();
      names.reload();
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
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Other frameworks, laws and conditions that this outcome also satisfies, so one piece of evidence can be used for all of them.
      </p>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} label="Loading mappings" />
        : data.length === 0 ? (
          <EmptyState icon="link" title="Not mapped to anything else yet"
            message={canEdit ? 'Add the first mapping below.' : 'Nobody has mapped this outcome to another framework.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Framework or requirement</th><th>Reference</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td className="row-title">{m.framework_name}</td>
                    <td style={{ whiteSpace: 'normal' }}>{m.reference || '—'}</td>
                    <td className="num">
                      {canEdit && <IconButton icon="trash" label={`Remove mapping to ${m.framework_name} ${m.reference}`} variant="ghost" size="sm" onClick={() => remove(m)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {canEdit && (
        <form className="form" onSubmit={add} noValidate>
          <div className="form-grid">
            <TextField label="Framework or requirement" required value={name} onChange={setName} error={errors.framework_name}
              placeholder="For example: PCI DSS" />
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
    </div>
  );
}
