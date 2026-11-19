import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiError, api, Button, Checkbox, ConfirmDialog, DateTimeField, EmptyState, ErrorState, errorMessage, formatDateTime,
  IconButton, Loading, Modal, NumberField, Select, TextArea, TextField, useFetch, useToast,
} from '../../core';
import type { IconName } from '../../core';

export interface Column {
  field: string;
  label: string;
  /** Shorter heading for the table column (default: the label). */
  header?: string;
  type?: 'text' | 'longtext' | 'datetime' | 'number' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  /** Table cell; defaults to the value formatted by type. */
  render?: (row: any) => ReactNode;
  /** Leave out of the table (still in the form). */
  formOnly?: boolean;
  /** A worked-out column: in the table, never in the form. */
  tableOnly?: boolean;
  /** In the form only when changing an existing row. */
  editOnly?: boolean;
  /** Value for a new row. */
  initial?: unknown;
}

interface Props {
  /** Collection URL: GET lists, POST adds, PATCH and DELETE on `${url}/${id}`. */
  url: string;
  noun: string;
  columns: Column[];
  canEdit: boolean;
  canDelete?: boolean;
  emptyTitle: string;
  emptyMessage?: string;
  emptyIcon?: IconName;
  /** Client-side filter on the loaded rows. */
  filter?: (row: any) => boolean;
  /** Extra values sent when adding. */
  createExtra?: Record<string, unknown>;
  onChanged?: () => void;
  /** Bump to reload. */
  version?: string;
  /** A sentence beside the Add button saying what the list is for. */
  intro?: ReactNode;
  /** Word for removing a row, on the button and in the confirmation (default "Remove"). */
  removeLabel?: string;
  removeMessage?: string;
  /** Rows that cannot be removed (the remove button is left out). */
  canRemoveRow?: (row: any) => boolean;
  /** Class for a row, e.g. to mute one that is switched off. */
  rowClass?: (row: any) => string | undefined;
}

function cell(col: Column, row: any): ReactNode {
  if (col.render) return col.render(row);
  const v = row[col.field];
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (col.type === 'datetime') return formatDateTime(v);
  if (col.type === 'boolean') return v ? 'Yes' : 'No';
  if (col.type === 'select') return col.options?.find((o) => o.value === v)?.label ?? String(v);
  return String(v);
}

/** A small table with add, edit and remove dialogs for the simple lists in this module. */
export function EditableTable({
  url, noun, columns, canEdit, canDelete = canEdit, emptyTitle, emptyMessage, emptyIcon = 'folder', filter, createExtra, onChanged, version,
  intro, removeLabel = 'Remove', removeMessage = 'It is removed from this list. The change stays in the history.', canRemoveRow, rowClass,
}: Props) {
  const toast = useToast();
  const { data, error, reload } = useFetch<any[]>(url);
  const [editing, setEditing] = useState<any | null>(null);   // row being edited, or {} for a new one
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<any | null>(null);
  const base = url.split('?')[0];
  const lower = noun.toLowerCase();

  useEffect(() => { if (version !== undefined) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  const formColumns = columns.filter((c) => !c.tableOnly && !(c.editOnly && !editing?.id));

  function open(row: any | null) {
    const start: Record<string, any> = {};
    for (const c of columns) start[c.field] = row ? row[c.field] : c.initial ?? (c.type === 'boolean' ? false : c.type === 'number' ? null : '');
    setValues(start);
    setErrors({});
    setEditing(row ?? {});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    for (const c of formColumns) {
      const v = values[c.field];
      if (c.required && (v === null || v === undefined || String(v).trim() === '')) found[c.field] = `${c.label} is required.`;
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: Record<string, unknown> = {};
    for (const c of formColumns) body[c.field] = values[c.field] === '' ? null : values[c.field];
    setBusy(true);
    try {
      if (editing?.id) await api.patch(`${base}/${editing.id}`, body);
      else await api.post(base, { ...body, ...createExtra });
      toast.success(`${noun} saved.`);
      setEditing(null);
      reload();
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`${base}/${removing.id}`);
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(null);
      setBusy(false);
    }
  }

  const set = (field: string) => (v: unknown) => setValues((old) => ({ ...old, [field]: v }));
  const shown = columns.filter((c) => !c.formOnly);
  const rows = data ? (filter ? data.filter(filter) : data) : null;

  return (
    <div className="stack">
      {(canEdit || intro) && (
        <div className="si-table-bar">
          {intro ? <p className="si-table-intro">{intro}</p> : <span />}
          {canEdit && <Button icon="plus" onClick={() => open(null)}>Add {lower}</Button>}
        </div>
      )}
      {error ? <ErrorState error={error} onRetry={reload} />
        : !rows ? <Loading />
        : !rows.length ? <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
        : (
          <div className="table-wrap">
            <table className="table si-table">
              <thead>
                <tr>
                  {shown.map((c) => <th key={c.field} scope="col">{c.header ?? c.label}</th>)}
                  {canEdit && <th scope="col" className="si-table-actions"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={rowClass?.(r)}>
                    {shown.map((c) => <td key={c.field}>{cell(c, r)}</td>)}
                    {canEdit && (
                      <td className="si-table-actions">
                        <div className="si-row-actions">
                          <IconButton icon="edit" label={`Edit ${lower}`} variant="ghost" size="sm" onClick={() => open(r)} />
                          {canDelete && (canRemoveRow?.(r) ?? true) && (
                            <IconButton icon="trash" label={`${removeLabel} ${lower}`} variant="ghost" size="sm" onClick={() => setRemoving(r)} />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <Modal open={!!editing} title={editing?.id ? `Edit ${lower}` : `Add ${lower}`} onClose={() => setEditing(null)}>
        <form className="form" onSubmit={submit} noValidate>
          <div className="form-grid">
            {formColumns.map((c) => {
              const common = { label: c.label, required: c.required, error: errors[c.field], hint: c.hint };
              const v = values[c.field];
              if (c.type === 'longtext') return <TextArea key={c.field} {...common} className="form-cell-wide" value={v ?? ''} onChange={set(c.field)} rows={3} />;
              if (c.type === 'datetime') return <DateTimeField key={c.field} {...common} value={v ?? ''} onChange={set(c.field)} />;
              if (c.type === 'number') return <NumberField key={c.field} {...common} value={v ?? null} onChange={set(c.field)} min={0} />;
              if (c.type === 'boolean') return <Checkbox key={c.field} label={c.label} hint={c.hint} error={errors[c.field]} checked={!!v} onChange={set(c.field)} />;
              if (c.type === 'select') return <Select key={c.field} {...common} value={v ?? ''} onChange={set(c.field)} options={c.options ?? []} />;
              return <TextField key={c.field} {...common} value={v ?? ''} onChange={set(c.field)} />;
            })}
          </div>
          <div className="form-actions">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy}>Save</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!removing} title={`${removeLabel} this ${lower}?`}
        message={removeMessage} confirmLabel={removeLabel} danger busy={busy}
        onConfirm={remove} onCancel={() => setRemoving(null)} />
    </div>
  );
}
