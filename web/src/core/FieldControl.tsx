// One form control for one field, chosen by the field's type in /api/meta. Shared by ResourceForm
// and useCustomFieldInputs, so a hand-written form shows a field exactly as the generic form does.
import {
  Checkbox, DateField, DateTimeField, LookupChoices, LookupSelect, NumberField, RecordPicker, TextArea, TextField, UserPicker,
} from './fields';
import { currency } from './format';
import type { FieldMeta } from './meta';

/** A stored value as the control holds it. */
export function toFormValue(meta: FieldMeta, value: unknown): unknown {
  if (meta.multiple) return Array.isArray(value) ? value.map(String) : [];
  if (meta.type === 'json') return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
  if (meta.type === 'boolean') return Boolean(value);
  if (meta.type === 'number' || meta.type === 'currency') return value === null || value === undefined || value === '' ? null : Number(value);
  if (meta.type === 'user' || meta.type === 'ref') return value ?? null;
  return value ?? '';
}

/** A control's value as the API stores it; throws on invalid JSON. Empty becomes null. */
export function toApiValue(meta: FieldMeta, value: unknown): unknown {
  if (meta.multiple) return Array.isArray(value) && value.length > 0 ? value : null;
  if (meta.type === 'json') return value === '' ? null : JSON.parse(String(value));
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  return value;
}

/** Whether a required field is missing a value (a checkbox is never missing). */
export function isMissing(meta: FieldMeta, apiValue: unknown): boolean {
  return Boolean(meta.required) && meta.type !== 'boolean' && (apiValue === null || apiValue === undefined);
}

export interface FieldControlProps {
  meta: FieldMeta;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  /** Help under the control. Default: the field's own `help`. */
  hint?: string;
  /** Label of the current user or record, for pickers (the row's `_display` entry). */
  display?: string;
  /** Shown as text that cannot be changed (a `readOnly` field). */
  readOnlyText?: string;
  /** A lookup field: offer only these values (the statuses a record may move to, E14-31). */
  allowed?: string[];
}

export function FieldControl({ meta, value, onChange, error, hint, display, readOnlyText, allowed }: FieldControlProps) {
  const common = { label: meta.label, required: meta.required, error, hint: hint ?? meta.help };
  if (meta.readOnly) {
    return <TextField {...common} required={false} disabled value={readOnlyText ?? String(display ?? value ?? '')} onChange={() => {}} />;
  }
  switch (meta.type) {
    case 'longtext':
      return <TextArea {...common} value={value as string} onChange={onChange} />;
    case 'json':
      return <TextArea {...common} className="rc-field-mono" rows={6} hint={common.hint ?? 'JSON'} value={value as string} onChange={onChange} />;
    case 'number':
      return <NumberField {...common} value={value as number | null} onChange={onChange} />;
    case 'currency':
      return <NumberField {...common} prefix={currency()} thousands decimals={2} step={0.01} min={0} value={value as number | null} onChange={onChange} />;
    case 'date':
      return <DateField {...common} value={value as string} onChange={onChange} />;
    case 'datetime':
      return <DateTimeField {...common} value={value as string} onChange={onChange} />;
    case 'boolean':
      return <Checkbox label={meta.label} error={error} hint={common.hint} checked={value as boolean} onChange={onChange} />;
    case 'lookup':
      if (meta.multiple) return <LookupChoices {...common} list={meta.list ?? ''} value={value as string[]} onChange={onChange} />;
      return <LookupSelect {...common} list={meta.list ?? ''} only={allowed} value={value as string} onChange={onChange} />;
    case 'user':
      return <UserPicker {...common} value={value as string | null} display={display} onChange={(v) => onChange(v)} />;
    case 'ref':
      return <RecordPicker {...common} type={meta.to ?? ''} value={value as string | null} display={display} onChange={(v) => onChange(v)} />;
    default:
      return <TextField {...common} value={value as string} onChange={onChange} />;
  }
}
