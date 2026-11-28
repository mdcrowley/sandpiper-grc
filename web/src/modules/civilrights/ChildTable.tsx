// Rows that belong to one record (a program's elements, notices and language items, a complaint's
// steps and letters, an award's firms): a table with add, change and remove, all through the
// record's own routes (`<url>`, `<url>/<id>`). The server checks who may see and change them.
import { useState, type ReactNode } from 'react';
import {
  api, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, Loading, LookupSelect, Modal, NumberField, RecordPicker,
  Switch, TableWrap, TextArea, TextField, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';

export interface ChildField {
  name: string;
  label: string;
  kind: 'text' | 'longtext' | 'date' | 'lookup' | 'ref' | 'bool' | 'number';
  list?: string;
  to?: string;
  required?: boolean;
  hint?: string;
}

export interface ChildColumn {
  label: string;
  render: (row: Row) => ReactNode;
  /** Kept when the table is narrow (1), or left out first (3). */
  priority?: 1 | 2 | 3;
}

interface Props {
  url: string;
  kind?: string;
  title: string;
  /** What one row is called, in buttons and dialogs ("element"). */
  noun: string;
  columns: ChildColumn[];
  fields: ChildField[];
  canEdit: boolean;
  emptyTitle: string;
  emptyMessage?: string;
  /** Called after a change (figures on the page). */
  onChange?: () => void;
  /** An extra control in each row (evidence of an element). */
  rowAction?: (row: Row) => ReactNode;
  /** Something under the table (a total). */
  footer?: (rows: Row[]) => ReactNode;
}

type Form = Record<string, unknown>;

const initialOf = (fields: ChildField[], row: Row | null): Form =>
  Object.fromEntries(fields.map((f) => [f.name, row ? (f.kind === 'date' ? String(row[f.name] ?? '').slice(0, 10) : row[f.name] ?? (f.kind === 'bool' ? false : f.kind === 'number' || f.kind === 'ref' ? null : ''))
    : f.kind === 'bool' ? false : f.kind === 'number' || f.kind === 'ref' ? null : '']));

function RowDialog({ props, row, onClose, onSaved }: { props: Props; row: Row | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => initialOf(props.fields, row));
  const [start] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (name: string, v: unknown) => setForm((f) => ({ ...f, [name]: v }));
  const save = async () => {
    setBusy(true); setErrors({});
    const body: Form = Object.fromEntries(props.fields.map((f) => [f.name, form[f.name] === '' ? null : form[f.name]]));
    try {
      if (row) await api.patch(`${props.url}/${row.id}`, body);
      else await api.post(props.url, { ...body, ...(props.kind ? { kind: props.kind } : {}) });
      toast.success(row ? `The ${props.noun} was saved.` : `The ${props.noun} was added.`);
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={row ? `Change the ${props.noun}` : `Add ${/^[aeiou]/i.test(props.noun) ? 'an' : 'a'} ${props.noun}`} onClose={onClose}
      dirty={JSON.stringify(form) !== JSON.stringify(start)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{row ? 'Save' : 'Add'}</Button></>}>
      <div className="form-grid">
        {props.fields.map((f) => {
          const common = { label: f.label, required: f.required, error: errors[f.name], hint: f.hint };
          switch (f.kind) {
            case 'longtext': return <TextArea key={f.name} {...common} value={String(form[f.name] ?? '')} onChange={(v) => set(f.name, v)} />;
            case 'date': return <DateField key={f.name} {...common} value={String(form[f.name] ?? '')} onChange={(v) => set(f.name, v)} />;
            case 'lookup': return <LookupSelect key={f.name} {...common} list={f.list!} value={String(form[f.name] ?? '')} onChange={(v) => set(f.name, v)} />;
            case 'ref': return <RecordPicker key={f.name} {...common} type={f.to!} value={(form[f.name] as string | null) ?? null} display={row?.[`${f.name}_label`] ?? undefined} onChange={(v) => set(f.name, v)} />;
            case 'bool': return <Switch key={f.name} label={f.label} hint={f.hint} checked={Boolean(form[f.name])} onChange={(v) => set(f.name, v)} />;
            case 'number': return <NumberField key={f.name} {...common} min={0} value={(form[f.name] as number | null) ?? null} onChange={(v) => set(f.name, v)} />;
            default: return <TextField key={f.name} {...common} value={String(form[f.name] ?? '')} onChange={(v) => set(f.name, v)} />;
          }
        })}
      </div>
    </Modal>
  );
}

export function ChildTable(props: Props) {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ rows: Row[] }>(`${props.url}${props.kind ? `?kind=${props.kind}` : ''}`);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = () => { reload(); props.onChange?.(); };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`${props.url}/${removing.id}`); toast.success(`The ${props.noun} was removed.`); setRemoving(null); changed(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const name = (r: Row) => String(r.title ?? r.firm_name ?? props.noun);
  return (
    <Card title={props.title} flush actions={props.canEdit && <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="cr-pad"><Loading lines={3} /></div>
        : data.rows.length === 0 ? <EmptyState icon="clipboard" title={props.emptyTitle} message={props.emptyMessage} />
        : (
          <>
            <TableWrap fit label={props.title}>
              <table className="table">
                <caption className="sr-only">{props.title}</caption>
                <thead><tr>
                  {props.columns.map((c, i) => <th key={c.label} scope="col" data-priority={c.priority ?? (i === 0 ? 1 : 2)}>{c.label}</th>)}
                  {(props.canEdit || props.rowAction) && <th scope="col" data-priority={1}><span className="sr-only">Actions</span></th>}
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      {props.columns.map((c) => <td key={c.label} className="cr-wrap">{c.render(r)}</td>)}
                      {(props.canEdit || props.rowAction) && (
                        <td className="cr-actions">
                          {props.rowAction?.(r)}
                          {props.canEdit && <Button size="sm" variant="ghost" aria-label={`Change: ${name(r)}`} onClick={() => setEditing(r)}>Change</Button>}
                          {props.canEdit && <Button size="sm" variant="ghost" aria-label={`Remove: ${name(r)}`} onClick={() => setRemoving(r)}>Remove</Button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {props.footer?.(data.rows)}
          </>
        )}
      {editing && <RowDialog props={props} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }} />}
      <ConfirmDialog open={!!removing} title={`Remove this ${props.noun}?`} busy={busy} confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
        message={`${removing ? name(removing) : ''} will be removed. The record's history keeps a note of it.`} />
    </Card>
  );
}
