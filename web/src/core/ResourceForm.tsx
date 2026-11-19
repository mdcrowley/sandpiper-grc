// Create or edit form for any registered record type, built from /api/meta field metadata.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { api, ApiError, errorMessage, type Row } from './api';
import { FieldControl, isMissing, toApiValue, toFormValue } from './FieldControl';
import { fieldMeta } from './FieldValue';
import { customFieldNames, useResource } from './meta';
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
  /**
   * Add the record type's custom fields (`custom: true` in /api/meta) after `fields`, grouped by their
   * own section. Default true; pass false for a short dialog that edits only a few fields.
   */
  customFields?: boolean;
}

type Values = Record<string, unknown>;

const WIDE_TYPES = ['longtext', 'json'];

export function ResourceForm({
  type, fields: given, initial = {}, id, onSaved, onCancel, submitLabel, sections: givenSections, hints, onDirtyChange, customFields = true,
}: ResourceFormProps) {
  const resource = useResource(type);
  // Custom fields the author did not place themselves follow the given ones, each under its own section.
  const extra = customFields ? customFieldNames(resource).filter((f) => !given.includes(f)) : [];
  const fields = extra.length ? [...given, ...extra] : given;
  const sections = useMemo<FormSection[] | undefined>(() => {
    if (!extra.length || !resource) return givenSections;
    const bySection = new Map<string, string[]>();
    for (const f of extra) {
      const title = resource.fields[f]?.section || 'More details';
      bySection.set(title, [...(bySection.get(title) ?? []), f]);
    }
    return [...(givenSections ?? []), ...[...bySection].map(([title, names]) => ({ title, fields: names }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [givenSections, resource, extra.join('|')]);
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
      if (isMissing(meta, value)) {
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
    return (
      <FieldControl
        meta={meta} value={values[field]} onChange={(v) => set(field, v)} error={errors[field]} hint={hints?.[field]}
        display={display} readOnlyText={meta.readOnly ? String(display ?? initial[field] ?? '') : undefined}
      />
    );
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
