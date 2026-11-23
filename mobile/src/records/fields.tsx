// One input per field type for the phone edit form (spec §5.4). Lists are radio buttons, people and
// records are chosen from a search, dates are typed (YYYY-MM-DD). Owner: APP-WORK.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fontSize, radius, space, useTheme } from '../theme';
import { recordOptions, userOptions, type Option } from './api';
import type { FieldMeta, LookupValue } from './types';
import { Body, Button, MIN_TOUCH, SwitchField, TextField } from './ui';

export const FIELD_TEXT = {
  none: 'None',
  clear: 'Clear',
  change: 'Change',
  cancel: 'Cancel',
  searchPeople: (label: string) => `Search for ${label.toLowerCase()}`,
  searchHint: 'Type two or more characters',
  noMatches: 'No matches.',
  dateHint: 'Year-month-day, for example 2027-03-14',
  badDate: 'Enter a date as year-month-day, for example 2027-03-14.',
  badNumber: 'Enter a number.',
  current: 'current',
};

export interface FieldInputProps {
  name: string;
  field: FieldMeta;
  value: unknown;
  /** The label of the current value for people and records. */
  valueLabel?: string | null;
  options?: LookupValue[];
  error?: string | null;
  onChange: (value: unknown, label?: string | null) => void;
}

/** Text typed in a number or date box, checked before saving: null when fine, otherwise the message. */
export function checkTyped(field: FieldMeta, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return FIELD_TEXT.badDate;
  if ((field.type === 'number' || field.type === 'currency') && !Number.isFinite(Number(value))) return FIELD_TEXT.badNumber;
  return null;
}

/** The value as the server takes it: numbers as numbers, empty as null. */
export function toServer(field: FieldMeta, value: unknown): unknown {
  if (value === '' || value === undefined) return null;
  if ((field.type === 'number' || field.type === 'currency') && value !== null) return Number(value);
  return value;
}

export function FieldInput({ name, field, value, valueLabel, options = [], error, onChange }: FieldInputProps) {
  switch (field.type) {
    case 'lookup':
      return <ChoiceField label={field.label} required={field.required} value={value as string | null} options={options} error={error} onChange={(v) => onChange(v)} />;
    case 'user':
    case 'ref':
      return (
        <PickerField
          label={field.label}
          required={field.required}
          valueLabel={value ? valueLabel ?? String(value) : null}
          find={field.type === 'user' ? userOptions : (q) => recordOptions(field.to ?? '', q)}
          error={error}
          onChange={(id, label) => onChange(id, label)}
        />
      );
    case 'boolean':
      return <SwitchField label={field.label} value={value === true} onChange={(v) => onChange(v)} />;
    case 'number':
    case 'currency':
      return (
        <TextField label={field.label} value={value === null || value === undefined ? '' : String(value)} keyboardType="decimal-pad"
          error={error} onChangeText={(t) => onChange(t)} testID={`field-${name}`} />
      );
    case 'date':
      return (
        <TextField label={field.label} hint={FIELD_TEXT.dateHint} value={value ? String(value).slice(0, 10) : ''} keyboardType="numbers-and-punctuation"
          error={error} onChangeText={(t) => onChange(t)} testID={`field-${name}`} />
      );
    default:
      return (
        <TextField label={field.label} value={value === null || value === undefined ? '' : String(value)} multiline={field.type === 'longtext'}
          error={error} onChangeText={(t) => onChange(t)} testID={`field-${name}`} />
      );
  }
}

/** A choice of a list (a radio button), or with `choose` a search result to pick (a button: it has no on or off). */
function Radio({ label, selected, onPress, choose = false }: { label: string; selected: boolean; onPress: () => void; choose?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={choose ? 'button' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={choose ? undefined : { checked: selected }}
      onPress={onPress}
      style={[styles.radio, { borderColor: selected ? colors.brand : colors.borderControl, backgroundColor: selected ? colors.brandSoft : colors.surface }]}
    >
      <View style={[styles.dot, choose && styles.hidden, { borderColor: selected ? colors.brand : colors.borderStrong }]}>
        {selected ? <View style={[styles.dotInner, { backgroundColor: colors.brand }]} /> : null}
      </View>
      <Text style={{ color: colors.text, fontSize: fontSize.md, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}

function ChoiceField({ label, value, options, required, error, onChange }: {
  label: string; value: string | null; options: LookupValue[]; required?: boolean; error?: string | null; onChange: (v: string | null) => void;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>{label}</Text>
      {required ? null : <Radio label={FIELD_TEXT.none} selected={!value} onPress={() => onChange(null)} />}
      {options.map((o) => <Radio key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />)}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.dangerText, fontSize: fontSize.sm }}>{error}</Text> : null}
    </View>
  );
}

function PickerField({ label, valueLabel, required, find, error, onChange }: {
  label: string; valueLabel: string | null; required?: boolean; find: (q: string) => Promise<Option[]>; error?: string | null;
  onChange: (id: string | null, label: string | null) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Option[] | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setFound(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      find(q.trim()).then((rows) => { if (live) setFound(rows); }).catch(() => { if (live) setFound([]); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [open, q, find]);

  return (
    <View style={styles.group}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>{label}</Text>
      <Body>{valueLabel ?? FIELD_TEXT.none}</Body>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.dangerText, fontSize: fontSize.sm }}>{error}</Text> : null}
      {!open ? (
        <View style={styles.buttons}>
          <Button label={`${FIELD_TEXT.change}: ${label}`} onPress={() => setOpen(true)} />
          {!required && valueLabel ? <Button label={`${FIELD_TEXT.clear}: ${label}`} onPress={() => onChange(null, null)} /> : null}
        </View>
      ) : (
        <View style={styles.group}>
          <TextField label={FIELD_TEXT.searchPeople(label)} hint={FIELD_TEXT.searchHint} value={q} onChangeText={setQ} autoFocus autoCorrect={false} />
          {found && found.length === 0 ? <Body muted>{FIELD_TEXT.noMatches}</Body> : null}
          {(found ?? []).map((o) => (
            <Radio key={o.id} choose label={[o.ref, o.label].filter(Boolean).join(' ')} selected={false}
              onPress={() => { onChange(o.id, o.label); setOpen(false); setQ(''); }} />
          ))}
          <Button label={FIELD_TEXT.cancel} kind="link" onPress={() => { setOpen(false); setQ(''); }} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[2] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  radio: {
    minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space[3], borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: space[3], paddingVertical: space[2],
  },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotInner: { width: 10, height: 10, borderRadius: 5 },
  hidden: { display: 'none' },
});
