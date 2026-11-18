// Create or edit form for any registered record type, built from /api/meta field metadata.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { api, ApiError, errorMessage, type Row } from './api';
import {
  Checkbox, DateField, DateTimeField, LookupSelect, NumberField, RecordPicker, TextArea, TextField, UserPicker,
} from './fields';
import { fieldMeta } from './FieldValue';
import { currency } from './format';
import { useResource, type FieldMeta } from './meta';
import { ErrorState } from './ui';
import './records.css';

export interface FormSection {
  /** Heading above the group. */
  title?: string;
  /** One line of help under the heading. */
  description?: string;
  /** Field names (each must also be in the form's `fields`). */
  fields: string[];
}

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
  /** Groups the fields under headings. Fields not named in any section come first, without a heading. */
  sections?: FormSection[];
  /** Help text under individual fields, by field name. */
  hints?: Record<string, string>;
  /** Told whenever the form gains or loses unsaved changes (e.g. to guard a dialog's close button). */
  onDirtyChange?: (dirty: boolean) => void;
}

type Values = Record<string, unknown>;

const WIDE_TYPES = ['longtext', 'json'];

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

export function ResourceForm({
  type, fields, initial = {}, id, onSaved, onCancel, submitLabel, sections, hints, onDirtyChange,
}: ResourceFormProps) {
  const resource = useResource(type);
  const formRef = useRef<HTMLFormElement>(null);
  const start = useMemo<Values>(
    () => (resource ? Object.fromEntries(fields.map((f) => [f, toFormValue(fieldMeta(resource, f), initial[f])])) : {}),
    // The starting values are fixed when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource],
  );
  const [values, setValues] = useState<Values>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(start), [values, start]);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);

  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;

  const set = (field: string, value: unknown) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors(({ [field]: _cleared, ...rest }) => rest);
    if (confirmDiscard) setConfirmDiscard(false);
  };

  /** Move to the first field with a problem (or the message above the form). */
  const focusFirstError = () =>
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form) return;
      const cell = form.querySelector<HTMLElement>('[data-invalid-field="true"]');
      const target = cell?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, button, select')
        ?? form.querySelector<HTMLElement>('.rc-form-error');
      target?.focus();
      (cell ?? target)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });

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
    const common = { label: meta.label, required: meta.required, error: errors[field], hint: hints?.[field] };
    const value = values[field];
    if (meta.readOnly) {
      return <TextField {...common} required={false} disabled value={String(display ?? initial[field] ?? '')} onChange={() => {}} />;
    }
    switch (meta.type) {
      case 'longtext':
        return <TextArea {...common} value={value as string} onChange={(v) => set(field, v)} />;
      case 'json':
        return <TextArea {...common} className="rc-field-mono" rows={6} hint={common.hint ?? 'JSON'} value={value as string} onChange={(v) => set(field, v)} />;
      case 'number':
        return <NumberField {...common} value={value as number | null} onChange={(v) => set(field, v)} />;
      case 'currency':
        return <NumberField {...common} prefix={currency()} thousands decimals={2} step={0.01} min={0} value={value as number | null} onChange={(v) => set(field, v)} />;
      case 'date':
        return <DateField {...common} value={value as string} onChange={(v) => set(field, v)} />;
      case 'datetime':
        return <DateTimeField {...common} value={value as string} onChange={(v) => set(field, v)} />;
      case 'boolean':
        return <Checkbox label={meta.label} error={errors[field]} hint={hints?.[field]} checked={value as boolean} onChange={(v) => set(field, v)} />;
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

  const grid = (names: string[]) => (
    <div className="rc-form-grid">
      {names.map((field) => {
        const meta = fieldMeta(resource, field);
        const wide = WIDE_TYPES.includes(meta.type) || field === resource.titleField;
        return (
          <div
            key={field}
            className={`rc-form-cell${wide ? ' rc-form-cell-wide' : ''}${meta.type === 'boolean' ? ' rc-form-cell-check' : ''}`}
            data-field={field}
            data-invalid-field={errors[field] ? 'true' : undefined}
          >
            {control(field)}
          </div>
        );
      })}
    </div>
  );

  const usable = (sections ?? []).map((s) => ({ ...s, fields: s.fields.filter((f) => fields.includes(f)) })).filter((s) => s.fields.length > 0);
  const sectioned = new Set(usable.flatMap((s) => s.fields));
  const loose = fields.filter((f) => !sectioned.has(f));

  const cancel = () => {
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onCancel?.();
  };

  return (
    <form ref={formRef} className="rc-form" onSubmit={submit} noValidate aria-busy={saving}>
      {formError && (
        <Alert className="rc-form-error" color="red" variant="light" role="alert" tabIndex={-1} icon={<IconAlertTriangle size={18} />}>
          {formError}
        </Alert>
      )}
      {loose.length > 0 && grid(loose)}
      {usable.map((section, i) => (
        <fieldset key={section.title ?? i} className="rc-form-section">
          {section.title && <legend className="rc-form-legend">{section.title}</legend>}
          {section.description && <Text size="sm" c="dimmed" mb="xs">{section.description}</Text>}
          {grid(section.fields)}
        </fieldset>
      ))}
      <div className="rc-form-actions">
        {confirmDiscard ? (
          <>
            {/* Keys keep React from reusing a button element as the submit button in the middle of a click. */}
            <Text key="ask" size="sm" fw={500} role="alert" className="rc-form-discard">Discard your unsaved changes?</Text>
            <Button key="keep" variant="default" onClick={() => setConfirmDiscard(false)} autoFocus>Keep editing</Button>
            <Button key="discard" color="red" variant="light" onClick={() => onCancel?.()}>Discard changes</Button>
          </>
        ) : (
          <>
            {onCancel && <Button key="cancel" variant="default" onClick={cancel} disabled={saving}>Cancel</Button>}
            <Button key="submit" type="submit" loading={saving}>
              {submitLabel ?? (id ? 'Save changes' : `Create ${resource.label.toLowerCase()}`)}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
