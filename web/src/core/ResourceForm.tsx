// Create or edit form for any registered record type, built from /api/meta field metadata.
import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, type Row } from './api';
import {
  Checkbox, DateField, DateTimeField, LookupSelect, NumberField, RecordPicker, TextArea, TextField, UserPicker,
} from './fields';
import { fieldMeta } from './FieldValue';
import { currency } from './format';
import { useResource, type FieldMeta } from './meta';
import { Button, ErrorState } from './ui';

export interface ResourceFormProps {
  /** Record type key, e.g. "ticket". */
  type: string;
  /** Field names to show, in order. */
  fields: string[];
  /**
   * Starting values (pass the row when editing, so pickers can show `_display` labels).
   * On create, keys not listed in `fields` are sent as hidden values (e.g. a parent id).
   */
  initial?: Record<string, unknown>;
  /** Record id: PATCH when set (only changed fields are sent), POST when not. */
  id?: string;
  onSaved: (row: Row) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

type Values = Record<string, unknown>;

function toFormValue(meta: FieldMeta, value: unknown): unknown {
  if (meta.type === 'json') return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
  if (meta.type === 'boolean') return Boolean(value);
  if (meta.type === 'number' || meta.type === 'currency') return value === null || value === undefined || value === '' ? null : Number(value);
  if (meta.type === 'user' || meta.type === 'ref') return value ?? null;
  return value ?? '';
}

/** Form value to what the API stores; throws on invalid JSON. */
function toApiValue(meta: FieldMeta, value: unknown): unknown {
  if (meta.type === 'json') return value === '' ? null : JSON.parse(String(value));
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  return value;
}

export function ResourceForm({ type, fields, initial = {}, id, onSaved, onCancel, submitLabel }: ResourceFormProps) {
  const resource = useResource(type);
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(() =>
    resource ? Object.fromEntries(fields.map((f) => [f, toFormValue(fieldMeta(resource, f), initial[f])])) : {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;

  const set = (field: string, value: unknown) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors(({ [field]: _cleared, ...rest }) => rest);
  };

  const focusFirstError = () =>
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const found: Record<string, string> = {};
    const body: Values = {};
    if (!id) {
      for (const [key, value] of Object.entries(initial)) {
        if (!key.startsWith('_') && key !== 'id' && !fields.includes(key)) body[key] = value;
      }
    }
    for (const field of fields) {
      const meta = fieldMeta(resource, field);
      if (meta.readOnly) continue;
      let value: unknown;
      try {
        value = toApiValue(meta, values[field]);
      } catch {
        found[field] = `${meta.label} must be valid JSON.`;
        continue;
      }
      if (meta.required && meta.type !== 'boolean' && (value === null || value === undefined)) {
        found[field] = `${meta.label} is required.`;
      } else if (id) {
        // Only send what changed.
        if (JSON.stringify(value) !== JSON.stringify(toApiValue(meta, toFormValue(meta, initial[field])))) body[field] = value;
      } else if (value !== null && value !== undefined) {
        body[field] = value;
      }
    }
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) {
      focusFirstError();
      return;
    }

    setSaving(true);
    try {
      const row = id
        ? await api.patch<Row>(`${resource.path}/${id}`, body)
        : await api.post<Row>(resource.path, body);
      onSaved(row);
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? err.fields : {};
      setErrors(fieldErrors);
      // Show the general message unless every problem is already shown beside a field.
      const allShown = Object.keys(fieldErrors).length > 0 && Object.keys(fieldErrors).every((f) => fields.includes(f));
      setFormError(allShown ? '' : [errorMessage(err), ...Object.entries(fieldErrors).filter(([f]) => !fields.includes(f)).map(([, m]) => m)].join(' '));
      focusFirstError();
    } finally {
      setSaving(false);
    }
  };

  const control = (field: string) => {
    const meta = fieldMeta(resource, field);
    const display = (initial._display as Record<string, string> | undefined)?.[field];
    const common = { label: meta.label, required: meta.required, error: errors[field] };
    const value = values[field];
    if (meta.readOnly) {
      return <TextField {...common} required={false} disabled value={String(display ?? initial[field] ?? '')} onChange={() => {}} />;
    }
    switch (meta.type) {
      case 'longtext':
        return <TextArea {...common} value={value as string} onChange={(v) => set(field, v)} />;
      case 'json':
        return <TextArea {...common} className="field-mono" rows={6} hint="JSON" value={value as string} onChange={(v) => set(field, v)} />;
      case 'number':
        return <NumberField {...common} value={value as number | null} onChange={(v) => set(field, v)} />;
      case 'currency':
        return <NumberField {...common} prefix={currency()} step={0.01} min={0} value={value as number | null} onChange={(v) => set(field, v)} />;
      case 'date':
        return <DateField {...common} value={value as string} onChange={(v) => set(field, v)} />;
      case 'datetime':
        return <DateTimeField {...common} value={value as string} onChange={(v) => set(field, v)} />;
      case 'boolean':
        return <Checkbox label={meta.label} error={errors[field]} checked={value as boolean} onChange={(v) => set(field, v)} />;
      case 'lookup':
        return <LookupSelect {...common} list={meta.list ?? ''} value={value as string} onChange={(v) => set(field, v)} />;
      case 'user':
        return <UserPicker {...common} value={value as string | null} display={display} onChange={(v) => set(field, v)} />;
      case 'ref':
        return <RecordPicker {...common} type={meta.to ?? ''} value={value as string | null} display={display} onChange={(v) => set(field, v)} />;
      default:
        return <TextField {...common} value={value as string} onChange={(v) => set(field, v)} />;
    }
  };

  return (
    <form ref={formRef} className="form" onSubmit={submit} noValidate>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="form-grid">
        {fields.map((field) => {
          const wide = ['longtext', 'json'].includes(fieldMeta(resource, field).type);
          return <div key={field} className={wide ? 'form-cell form-cell-wide' : 'form-cell'}>{control(field)}</div>;
        })}
      </div>
      <div className="form-actions">
        {onCancel && <Button onClick={onCancel} disabled={saving}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={saving}>
          {submitLabel ?? (id ? 'Save changes' : `Create ${resource.label.toLowerCase()}`)}
        </Button>
      </div>
    </form>
  );
}
