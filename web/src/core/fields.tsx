// Form controls. All are controlled: `value` + `onChange(value)`. Built on Mantine inputs.
import { useId, useMemo, type ReactNode } from 'react';
import {
  Button, Checkbox as MCheckbox, NumberInput, Popover, Select as MSelect, Stack, Switch as MSwitch,
  Text, Textarea, TextInput,
} from '@mantine/core';
import { DateInput, DateTimePicker } from '@mantine/dates';
import { IconCalendar, IconCheck, IconChevronDown, IconClock } from '@tabler/icons-react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { fromZonedInput, timeZone, toZonedInput } from './format';
import { fieldShell, type FieldProps } from './fieldShell';
import { toColorName, useLookup } from './meta';
import { usePopupHost } from './popups';

dayjs.extend(customParseFormat);

export type { FieldProps } from './fieldShell';
export { UserPicker, RecordPicker, type PickOption, type PickerProps } from './pickers';
export { InlinePopups } from './popups';

/** The small coloured dot that marks a lookup value. */
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
  /** Colour name (section 11 of the README): shows a dot beside the label. */
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
}

/** A Select filled from a configured lookup list, showing each value's colour. */
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
}

/** A compact dropdown of tick boxes, used for "any of" choices in toolbars. */
export function MultiSelect({ label, options, value, onChange, disabled, size = 'sm' }: MultiSelectProps) {
  const host = usePopupHost();
  const id = useId();
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Popover position="bottom-start" shadow="md" trapFocus returnFocus {...host.popup}>
      <Popover.Target>
        <Button
          ref={host.ref}
          variant={value.length > 0 ? 'light' : 'default'}
          size={size}
          disabled={disabled}
          aria-haspopup="true"
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

const TYPED_DATE_FORMATS = ['D MMM YYYY', 'D MMMM YYYY', 'YYYY-MM-DD', 'D/M/YYYY', 'D-M-YYYY', 'D.M.YYYY', 'D MMM YY'];

/** Accepts what people type: "18 Nov 2026", "2026-11-18", "18/11/2026". */
function parseTypedDate(text: string): string | null {
  for (const format of TYPED_DATE_FORMATS) {
    const d = dayjs(text.trim(), format, true);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return null;
}

export function DateField({ value, onChange, min, max, placeholder = 'Day Month Year', ...field }: DateFieldProps) {
  const host = usePopupHost();
  return (
    <DateInput
      {...fieldShell(field)}
      ref={host.ref}
      popoverProps={host.popup}
      value={value ? String(value).slice(0, 10) : null}
      valueFormat="D MMM YYYY"
      dateParser={parseTypedDate}
      placeholder={placeholder}
      minDate={min || undefined}
      maxDate={max || undefined}
      clearable={!field.required}
      leftSection={<IconCalendar size={16} aria-hidden="true" />}
      leftSectionPointerEvents="none"
      onChange={(v) => onChange(v ? String(v).slice(0, 10) : '')}
    />
  );
}

export interface DateTimeFieldProps extends FieldProps {
  /** ISO instant, or '' when empty. Edited as wall-clock time in the organisation's time zone. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * The picker works on wall-clock strings ("2026-11-18 14:05:00"), never on Date objects, so the
 * browser's own time zone plays no part: `toZonedInput` / `fromZonedInput` do the conversion.
 */
export function DateTimeField({ value, onChange, hint, placeholder = 'Pick a date and time', ...field }: DateTimeFieldProps) {
  const host = usePopupHost();
  const local = toZonedInput(value); // "YYYY-MM-DDTHH:mm" in the organisation's zone
  return (
    <DateTimePicker
      {...fieldShell({ ...field, hint: hint ?? `Time zone: ${timeZone().replace(/_/g, ' ')}` })}
      ref={host.ref}
      popoverProps={host.popup}
      value={local ? `${local.replace('T', ' ')}:00` : null}
      valueFormat="D MMM YYYY, HH:mm"
      placeholder={placeholder}
      clearable={!field.required}
      leftSection={<IconClock size={16} aria-hidden="true" />}
      leftSectionPointerEvents="none"
      onChange={(v) => onChange(v ? fromZonedInput(String(v).slice(0, 16).replace(' ', 'T')) : '')}
    />
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
