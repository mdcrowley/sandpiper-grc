// Form controls. All are controlled: `value` + `onChange(value)`. Built on Mantine inputs.
import { lazy, Suspense, useId, useMemo, type ReactNode } from 'react';
import {
  Button, Checkbox as MCheckbox, MultiSelect as MMultiSelect, NumberInput, Popover, Select as MSelect, Stack, Switch as MSwitch,
  Text, Textarea, TextInput,
} from '@mantine/core';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';
import { fieldShell, type FieldProps } from './fieldShell';
import { toZonedInput } from './format';
import { toColorName, useLookup } from './meta';
import { usePopupHost } from './popups';

export type { FieldProps } from './fieldShell';
export { UserPicker, RecordPicker, type PickOption, type PickerProps } from './pickers';
export { InlinePopups } from './popups';

/** The small colored dot that marks a lookup value. */
export function ColorDot({ color }: { color?: string | null }) {
  return <span className="rc-dot" style={{ background: `var(--c-${toColorName(color)}-solid)` }} aria-hidden="true" />;
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
  /** Shown inside the control, before the text (an icon). */
  leftSection?: ReactNode;
  /** Shown inside the control, after the text. */
  rightSection?: ReactNode;
}

export function TextField({
  value, onChange, type = 'text', placeholder, autoComplete, autoFocus, maxLength, inputMode, leftSection, rightSection, ...field
}: TextFieldProps) {
  return (
    <TextInput
      {...fieldShell(field)}
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      maxLength={maxLength}
      inputMode={inputMode}
      leftSection={leftSection}
      rightSection={rightSection}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

export interface TextAreaProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Starting height in lines (default 4). The box grows with its content. */
  rows?: number;
  /** Tallest the box grows to, in lines (default 16). */
  maxRows?: number;
  placeholder?: string;
}

export function TextArea({ value, onChange, rows = 4, maxRows = 16, placeholder, ...field }: TextAreaProps) {
  return (
    <Textarea
      {...fieldShell(field)}
      autosize
      minRows={rows}
      maxRows={Math.max(rows, maxRows)}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

/* ---------- Choice ---------- */

export interface Option {
  value: string;
  label: string;
  /** Color name (section 11 of the README): shows a dot beside the label. */
  color?: string;
}

export interface SelectProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /** Text shown while nothing is chosen. */
  placeholder?: string;
  /** Type-to-filter. Default: on when there are more than eight options. */
  searchable?: boolean;
}

export function Select({ value, onChange, options, placeholder = 'Select…', searchable, ...field }: SelectProps) {
  const host = usePopupHost();
  // Mantine needs unique, non-empty values: an option with value '' becomes the placeholder.
  const { data, colors, blank } = useMemo(() => {
    const seen = new Set<string>();
    const colorOf: Record<string, string | undefined> = {};
    let empty: string | undefined;
    const list: { value: string; label: string }[] = [];
    for (const o of options) {
      const v = String(o.value ?? '');
      if (v === '') { empty = o.label; continue; }
      if (seen.has(v)) continue;
      seen.add(v);
      colorOf[v] = o.color;
      list.push({ value: v, label: String(o.label ?? v) });
    }
    return { data: list, colors: colorOf, blank: empty };
  }, [options]);
  const hasColors = Object.values(colors).some(Boolean);
  const current = value === null || value === undefined || value === '' ? null : String(value);

  return (
    <MSelect
      {...fieldShell(field)}
      ref={host.ref}
      comboboxProps={host.popup}
      data={data}
      value={current}
      placeholder={blank ?? placeholder}
      searchable={searchable ?? data.length > 8}
      clearable={!field.required}
      allowDeselect={!field.required}
      nothingFoundMessage={data.length === 0 ? 'No values configured' : 'No matches'}
      maxDropdownHeight={280}
      leftSection={hasColors && current && colors[current] ? <ColorDot color={colors[current]} /> : undefined}
      leftSectionPointerEvents="none"
      renderOption={hasColors ? ({ option, checked }) => (
        <span className="rc-option">
          <ColorDot color={colors[option.value]} />
          <span className="rc-option-label">{option.label}</span>
          {checked && <IconCheck size={15} aria-hidden="true" />}
        </span>
      ) : undefined}
      onChange={(v) => onChange(v ?? '')}
    />
  );
}

export interface LookupSelectProps extends Omit<SelectProps, 'options'> {
  /** Lookup list name from /api/meta. */
  list: string;
  /** Offer only these values (the statuses a record may move to, E14-31). */
  only?: string[];
}

export interface ChoicesFieldProps extends FieldProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: Option[];
  placeholder?: string;
}

/** Several values from a fixed set, as a form control with a label (pills in the box). */
export function ChoicesField({ value, onChange, options, placeholder, ...field }: ChoicesFieldProps) {
  const host = usePopupHost();
  const data = useMemo(() => {
    const seen = new Set<string>();
    return options.filter((o) => o.value !== '' && !seen.has(o.value) && seen.add(o.value)).map((o) => ({ value: o.value, label: o.label }));
  }, [options]);
  return (
    <MMultiSelect
      {...fieldShell(field)}
      ref={host.ref}
      comboboxProps={host.popup}
      data={data}
      value={Array.isArray(value) ? value : []}
      placeholder={value?.length ? undefined : placeholder ?? 'Choose any'}
      searchable={data.length > 8}
      clearable
      hidePickedOptions
      nothingFoundMessage={data.length === 0 ? 'No values configured' : 'No matches'}
      maxDropdownHeight={280}
      onChange={onChange}
    />
  );
}

/** ChoicesField filled from a configured lookup list. */
export function LookupChoices({ list, ...rest }: Omit<ChoicesFieldProps, 'options'> & { list: string }) {
  return <ChoicesField {...rest} options={useLookup(list)} />;
}

/** A Select filled from a configured lookup list, showing each value's color. */
export function LookupSelect({ list, only, ...rest }: LookupSelectProps) {
  const values = useLookup(list);
  const options = useMemo(() => (only ? values.filter((v) => only.includes(v.value)) : values), [values, only]);
  return <Select {...rest} options={options} />;
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
  return (
    <MCheckbox
      className={['rc-field rc-field-check', className].filter(Boolean).join(' ')}
      label={label}
      checked={Boolean(checked)}
      disabled={disabled}
      description={hint}
      error={error || undefined}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  );
}

/** Same contract as Checkbox, drawn as an on/off switch: use for settings that apply at once. */
export function Switch({ label, checked, onChange, disabled, hint, error, className }: CheckboxProps) {
  return (
    <MSwitch
      className={['rc-field rc-field-check', className].filter(Boolean).join(' ')}
      label={label}
      checked={Boolean(checked)}
      disabled={disabled}
      description={hint}
      error={error || undefined}
      onChange={(e) => onChange(e.currentTarget.checked)}
    />
  );
}

export interface MultiSelectProps {
  label: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md';
  /** A message under the button (for example a server `error.fields` entry), like every other control. */
  error?: string;
}

/** A compact dropdown of tick boxes, used for "any of" choices in toolbars. */
export function MultiSelect({ label, options, value, onChange, disabled, size = 'sm', error }: MultiSelectProps) {
  const host = usePopupHost();
  const id = useId();
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const picker = (
    <Popover position="bottom-start" shadow="md" trapFocus returnFocus {...host.popup}>
      <Popover.Target>
        <Button
          ref={host.ref}
          variant={value.length > 0 ? 'light' : 'default'}
          size={size}
          disabled={disabled}
          aria-haspopup="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={error ? 'rc-multi-invalid' : undefined}
          rightSection={<IconChevronDown size={14} aria-hidden="true" />}
        >
          {label}
          {value.length > 0 && <span className="rc-count" aria-label={`${value.length} selected`}>{value.length}</span>}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <fieldset className="rc-multi" aria-labelledby={id}>
          <legend id={id} className="rc-sr-only">{label}</legend>
          {options.length === 0 && <Text size="sm" c="dimmed">No values configured</Text>}
          <Stack gap={8}>
            {options.map((o) => (
              <MCheckbox
                key={o.value}
                size="sm"
                checked={value.includes(o.value)}
                onChange={() => toggle(o.value)}
                label={o.color ? <span className="rc-option"><ColorDot color={o.color} />{o.label}</span> : o.label}
              />
            ))}
          </Stack>
        </fieldset>
      </Popover.Dropdown>
    </Popover>
  );
  if (!error) return picker;
  return (
    <div className="rc-multi-field">
      {picker}
      <p id={`${id}-error`} className="field-error" role="alert">{error}</p>
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
  placeholder?: string;
}

// The pickers themselves (core/dateFields.tsx) load with the first date field shown, so that the
// date library is not part of every page. Until they arrive (a moment, once), the field is drawn
// read-only with the same label and value, so the form does not jump.
const LazyDate = lazy(() => import('./dateFields').then((m) => ({ default: m.DateFieldImpl })));
const LazyDateTime = lazy(() => import('./dateFields').then((m) => ({ default: m.DateTimeFieldImpl })));

function DatePlaceholder({ value, placeholder, ...field }: FieldProps & { value: string; placeholder?: string }) {
  return <TextInput {...fieldShell(field)} value={value} placeholder={placeholder} readOnly aria-busy="true" onChange={() => undefined} />;
}

export function DateField(props: DateFieldProps) {
  const { value, onChange: _change, min: _min, max: _max, placeholder = 'Month Day, Year', ...field } = props;
  return (
    <Suspense fallback={<DatePlaceholder {...field} value={value ? String(value).slice(0, 10) : ''} placeholder={placeholder} />}>
      <LazyDate {...props} />
    </Suspense>
  );
}

export interface DateTimeFieldProps extends FieldProps {
  /** ISO instant, or '' when empty. Edited as wall-clock time in the organization's time zone. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Edited as wall-clock time in the organization's time zone (see core/dateFields.tsx). */
export function DateTimeField(props: DateTimeFieldProps) {
  const { value, onChange: _change, placeholder = 'Pick a date and time', ...field } = props;
  return (
    <Suspense fallback={<DatePlaceholder {...field} value={toZonedInput(value).replace('T', ' ')} placeholder={placeholder} />}>
      <LazyDateTime {...props} />
    </Suspense>
  );
}

export interface NumberFieldProps extends FieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  /** Text shown inside the control before the number, e.g. a currency code. */
  prefix?: string;
  /** Group thousands ("12,500"). */
  thousands?: boolean;
  /** Fixed number of decimal places. */
  decimals?: number;
  placeholder?: string;
}

export function NumberField({ value, onChange, min, max, step = 'any', prefix, thousands, decimals, placeholder, ...field }: NumberFieldProps) {
  return (
    <NumberInput
      {...fieldShell(field)}
      classNames={{ input: 'rc-num-input' }}
      value={value ?? ''}
      min={min}
      max={max}
      step={step === 'any' ? undefined : step}
      placeholder={placeholder}
      hideControls
      thousandSeparator={thousands ? ',' : undefined}
      decimalScale={decimals}
      leftSection={prefix ? <span className="rc-prefix" aria-hidden="true">{prefix}</span> : undefined}
      leftSectionWidth={prefix ? Math.max(34, 14 + prefix.length * 9) : undefined}
      leftSectionPointerEvents="none"
      onChange={(v) => {
        if (v === '' || v === null || v === undefined) return onChange(null);
        const n = typeof v === 'number' ? v : Number(v);
        onChange(Number.isFinite(n) ? n : null);
      }}
    />
  );
}
