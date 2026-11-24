// The date and date-and-time pickers behind DateField and DateTimeField (core/fields.tsx). They
// sit in a file of their own so that the date pickers and their date library load with the first
// form that has a date, not with every page (vite.config.ts, "vendor-dates").
import { DateInput, DateTimePicker } from '@mantine/dates';
import { IconCalendar, IconClock } from '@tabler/icons-react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import type { DateFieldProps, DateTimeFieldProps } from './fields';
import { fieldShell } from './fieldShell';
import { fromZonedInput, timeZoneLabel, toZonedInput } from './format';
import { usePopupHost } from './popups';

dayjs.extend(customParseFormat);

// Numbers are read month first (US order); a month written as a word may come either side of the day.
const TYPED_DATE_FORMATS = ['MMM D, YYYY', 'MMMM D, YYYY', 'MMM D YYYY', 'MMMM D YYYY', 'YYYY-MM-DD', 'M/D/YYYY', 'M-D-YYYY', 'M/D/YY', 'D MMM YYYY', 'D MMMM YYYY', 'D MMM YY'];

/** Accepts what people type: "Nov 18, 2026", "11/18/2026", "2026-11-18", "18 Nov 2026". */
function parseTypedDate(text: string): string | null {
  for (const format of TYPED_DATE_FORMATS) {
    const d = dayjs(text.trim(), format, true);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return null;
}

export function DateFieldImpl({ value, onChange, min, max, placeholder = 'Month Day, Year', ...field }: DateFieldProps) {
  const host = usePopupHost();
  return (
    <DateInput
      {...fieldShell(field)}
      ref={host.ref}
      popoverProps={host.popup}
      value={value ? String(value).slice(0, 10) : null}
      valueFormat="MMM D, YYYY"
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

/**
 * The picker works on wall-clock strings ("2026-11-18 14:05:00"), never on Date objects, so the
 * browser's own time zone plays no part: `toZonedInput` / `fromZonedInput` do the conversion.
 */
export function DateTimeFieldImpl({ value, onChange, hint, placeholder = 'Pick a date and time', ...field }: DateTimeFieldProps) {
  const host = usePopupHost();
  const local = toZonedInput(value); // "YYYY-MM-DDTHH:mm" in the organization's zone
  return (
    <DateTimePicker
      {...fieldShell({ ...field, hint: hint ?? `Time zone: ${timeZoneLabel()}` })}
      ref={host.ref}
      popoverProps={host.popup}
      value={local ? `${local.replace('T', ' ')}:00` : null}
      valueFormat="MMM D, YYYY, HH:mm"
      placeholder={placeholder}
      clearable={!field.required}
      leftSection={<IconClock size={16} aria-hidden="true" />}
      leftSectionPointerEvents="none"
      onChange={(v) => onChange(v ? fromZonedInput(String(v).slice(0, 16).replace(' ', 'T')) : '')}
    />
  );
}
