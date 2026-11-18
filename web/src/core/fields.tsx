// Form controls. All are controlled: `value` + `onChange(value)`.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, qs } from './api';
import { fromZonedInput, toZonedInput } from './format';
import { useDebounced, useDismiss } from './hooks';
import { Icon } from './Icon';
import { useLookup } from './meta';
import { cx } from './ui';

export interface FieldProps {
  label: string;
  required?: boolean;
  disabled?: boolean;
  /** Validation message shown under the control. */
  error?: string;
  /** Help text shown under the control. */
  hint?: string;
  /** Keep the label for assistive technology but hide it visually (filter bars). */
  hideLabel?: boolean;
  className?: string;
}

interface FieldShellProps extends FieldProps {
  children: (a11y: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; required?: boolean; disabled?: boolean }) => ReactNode;
}

function FieldShell({ label, required, disabled, error, hint, hideLabel, className, children }: FieldShellProps) {
  const id = useId();
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('field', error && 'field-invalid', className)}>
      <label htmlFor={id} className={cx('field-label', hideLabel && 'sr-only')}>
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, required, disabled })}
      {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </div>
  );
}

/* ---------- Text ---------- */

export interface TextFieldProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'url' | 'search' | 'tel';
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel' | 'url';
}

export function TextField({ value, onChange, type = 'text', placeholder, autoComplete, autoFocus, maxLength, inputMode, ...field }: TextFieldProps) {
  return (
    <FieldShell {...field}>
      {(a11y) => (
        <input
          {...a11y}
          className="input"
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          maxLength={maxLength}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export interface TextAreaProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}

export function TextArea({ value, onChange, rows = 4, placeholder, ...field }: TextAreaProps) {
  return (
    <FieldShell {...field}>
      {(a11y) => (
        <textarea {...a11y} className="input textarea" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldShell>
  );
}

/* ---------- Choice ---------- */

export interface Option {
  value: string;
  label: string;
}

export interface SelectProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /** Text of the empty choice. Shown unless the field is required and already has a value. */
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder = 'Select…', ...field }: SelectProps) {
  return (
    <FieldShell {...field}>
      {(a11y) => (
        <select {...a11y} className="input select" value={value} onChange={(e) => onChange(e.target.value)}>
          {!(field.required && value) && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </FieldShell>
  );
}

export interface LookupSelectProps extends Omit<SelectProps, 'options'> {
  /** Lookup list name from /api/meta. */
  list: string;
}

/** A Select filled from a configured lookup list. */
export function LookupSelect({ list, ...rest }: LookupSelectProps) {
  return <Select {...rest} options={useLookup(list)} />;
}

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  error?: string;
  className?: string;
}

export function Checkbox({ label, checked, onChange, disabled, hint, error, className }: CheckboxProps) {
  const id = useId();
  return (
    <div className={cx('field field-check', className)}>
      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint || error ? `${id}-note` : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {(error || hint) && <p id={`${id}-note`} className={error ? 'field-error' : 'field-hint'}>{error ?? hint}</p>}
    </div>
  );
}

export interface MultiSelectProps {
  label: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
}

/** A compact dropdown of checkboxes, used for "any of" filters. */
export function MultiSelect({ label, options, value, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={cx('btn btn-secondary btn-sm', value.length > 0 && 'btn-active')}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {value.length > 0 && <span className="tab-count">{value.length}</span>}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <fieldset className="menu-list menu-start multi-list">
          <legend className="sr-only">{label}</legend>
          {options.length === 0 && <p className="menu-empty">No values configured</p>}
          {options.map((o) => (
            <label key={o.value} className="check menu-check">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

/* ---------- Dates and numbers ---------- */

export interface DateFieldProps extends FieldProps {
  /** `YYYY-MM-DD`, or '' when empty. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}

export function DateField({ value, onChange, min, max, ...field }: DateFieldProps) {
  return (
    <FieldShell {...field}>
      {(a11y) => (
        <input {...a11y} className="input" type="date" value={value ? value.slice(0, 10) : ''} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldShell>
  );
}

export interface DateTimeFieldProps extends FieldProps {
  /** ISO instant, or '' when empty. Edited as wall-clock time in the organisation's time zone. */
  value: string;
  onChange: (value: string) => void;
}

export function DateTimeField({ value, onChange, hint = 'Eastern time', ...field }: DateTimeFieldProps) {
  return (
    <FieldShell {...field} hint={hint}>
      {(a11y) => (
        <input {...a11y} className="input" type="datetime-local" value={toZonedInput(value)} onChange={(e) => onChange(fromZonedInput(e.target.value))} />
      )}
    </FieldShell>
  );
}

export interface NumberFieldProps extends FieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  /** Text shown inside the control before the number, e.g. "$". */
  prefix?: string;
}

export function NumberField({ value, onChange, min, max, step = 'any', prefix, ...field }: NumberFieldProps) {
  return (
    <FieldShell {...field}>
      {(a11y) => (
        <span className={cx('input-wrap', prefix && 'input-prefixed')}>
          {prefix && <span className="input-prefix" aria-hidden="true">{prefix}</span>}
          <input
            {...a11y}
            className="input"
            type="number"
            value={value ?? ''}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(e.target.value === '' || Number.isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber)}
          />
        </span>
      )}
    </FieldShell>
  );
}

/* ---------- Pickers (search-as-you-type comboboxes) ---------- */

export interface PickOption {
  id: string;
  label: string;
  ref?: string | null;
}

interface ComboboxProps extends FieldProps {
  value: string | null;
  /** Label of the current value (from the row's `_display`), since only the id is stored. */
  display?: string;
  onChange: (id: string | null, option?: PickOption) => void;
  load: (q: string) => Promise<PickOption[]>;
  placeholder?: string;
}

function Combobox({ value, display, onChange, load, placeholder = 'Type to search…', ...field }: ComboboxProps) {
  const listId = useId();
  const [picked, setPicked] = useState<PickOption | null>(null);
  const shown = !value ? '' : picked?.id === value ? picked.label : display ?? '';
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PickOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(open && text !== shown ? text.trim() : '', 200);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setText(shown);
  }, [open, shown]);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    load(query).then(
      (found) => {
        if (stale) return;
        setOptions(found);
        setFailed(false);
        setActive(0);
      },
      () => { if (!stale) setFailed(true); },
    );
    return () => { stale = true; };
  }, [open, query, load]);

  const choose = (option: PickOption) => {
    setPicked(option);
    onChange(option.id, option);
    setOpen(false);
    setText(option.label);
  };
  const clear = () => {
    onChange(null);
    setText('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const count = options?.length ?? 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (count > 0) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (e.key === 'Enter' && open && options?.[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <FieldShell {...field}>
      {(a11y) => (
        <span className="input-wrap combo">
          <input
            {...a11y}
            ref={inputRef}
            className="input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options?.[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            placeholder={placeholder}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              if (e.target.value === '' && value) onChange(null);
            }}
            onFocus={(e) => e.target.select()}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {value && !field.disabled && (
            <button type="button" className="combo-clear" aria-label={`Clear ${field.label}`} onMouseDown={(e) => e.preventDefault()} onClick={clear}>
              <Icon name="x" size={14} />
            </button>
          )}
          <ul id={listId} className="combo-list" role="listbox" aria-label={field.label} hidden={!open}>
            {open && failed && <li className="menu-empty" role="presentation">The list could not be loaded</li>}
            {open && !failed && options === null && <li className="menu-empty" role="presentation">Searching…</li>}
            {open && !failed && options?.length === 0 && <li className="menu-empty" role="presentation">No matches</li>}
            {open && !failed && options?.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cx('combo-option', i === active && 'combo-option-active')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o.ref && <span className="ref">{o.ref}</span>}
                {o.label}
              </li>
            ))}
          </ul>
        </span>
      )}
    </FieldShell>
  );
}

export interface PickerProps extends FieldProps {
  /** The selected id, or null. */
  value: string | null;
  /** Label of the current value, e.g. `row._display?.assignee_id`. */
  display?: string;
  onChange: (id: string | null, option?: PickOption) => void;
  placeholder?: string;
}

/** Pick a user. Searches `/api/users/options`. */
export function UserPicker(props: PickerProps) {
  const load = useCallback((q: string) => api.get<PickOption[]>(`/api/users/options${qs({ q })}`), []);
  return <Combobox {...props} load={load} />;
}

/** Pick a record of the given type. Searches `/api/records/lookup`. */
export function RecordPicker({ type, ...props }: PickerProps & { type: string }) {
  const load = useCallback((q: string) => api.get<PickOption[]>(`/api/records/lookup${qs({ type, q })}`), [type]);
  return <Combobox {...props} load={load} />;
}
