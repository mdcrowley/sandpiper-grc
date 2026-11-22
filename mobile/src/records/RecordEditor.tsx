// The phone edit form of a record (E38-07, spec §5.4): the type's phone fields only, saved with
// If-Match; a conflict shows the person's value beside the saved one to choose; anything the phone
// form cannot complete is sent to the web. Owner: APP-WORK.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/client';
import { fontSize, radius, space, useTheme } from '../theme';
import { errorText, fetchRecord, saveRecord, type LoadedRecord } from './api';
import { buildPatch, choicesFor, findConflicts, needsValue, resolvePatch, webOnlyRequirements, type Conflict } from './edit';
import { checkTyped, FieldInput } from './fields';
import { displayValue } from './format';
import { editableFields } from './layouts';
import { ReauthCanceled, withReauth } from './reauth';
import type { LookupValue, RecordRow, ResourceMeta } from './types';
import { Body, Button, Card, Heading, MIN_TOUCH, Notice } from './ui';

export const EDIT_TEXT = {
  title: (label: string) => `Edit ${label.toLowerCase()}`,
  save: 'Save',
  cancel: 'Cancel',
  nothing: 'Nothing has changed.',
  check: 'Check the highlighted fields.',
  finishOnWeb: 'Finish on the web',
  needsWeb: (fields: string[]) => `This also needs ${fields.join(', ')}, which the phone form does not show. Finish on the web.`,
  serverNeedsWeb: (fields: string[]) => `The server asks about ${fields.join(', ')}, which the phone form does not show. Finish on the web.`,
  conflictTitle: 'Someone else changed this record',
  conflictIntro: 'Since you opened it, someone saved other values. Choose what to keep for each field.',
  yours: 'Your value',
  saved: 'Saved now',
  keepMine: 'Keep mine',
  useSaved: 'Use the saved value',
  saveChoices: 'Save my choices',
  discard: 'Discard my changes',
  empty: 'Empty',
  held: 'Saved. The status change waits for an approval.',
  reauth: 'Sign in again to save. Nothing was changed.',
};

interface Props {
  meta: ResourceMeta;
  lookups: Record<string, LookupValue[]>;
  loaded: LoadedRecord;
  onSaved: (next: LoadedRecord, note?: string) => void;
  onCancel: () => void;
  onOpenWeb: () => void;
}

export function RecordEditor({ meta, lookups, loaded, onSaved, onCancel, onOpenWeb }: Props) {
  const { colors } = useTheme();
  const fields = useMemo(() => editableFields(meta), [meta]);
  const row = loaded.row;
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map(([n]) => [n, row[n] ?? null])));
  const [labels, setLabels] = useState<Record<string, string | null>>(() => ({ ...(row._display ?? {}) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [webOnly, setWebOnly] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ fresh: LoadedRecord; list: Conflict[]; patch: Record<string, unknown> } | null>(null);
  const [keepMine, setKeepMine] = useState<Record<string, boolean>>({});

  const onForm = fields.map(([n]) => n);

  const save = async (base: LoadedRecord, patch: Record<string, unknown>, retried = false): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await withReauth(() => saveRecord(meta, base, patch));
      const held = (next.row as RecordRow & { _pending_move?: unknown })._pending_move;
      onSaved(next, held ? EDIT_TEXT.held : undefined);
    } catch (err) {
      if (err instanceof ReauthCanceled) { setMessage(EDIT_TEXT.reauth); return; }
      if (err instanceof ApiError && err.code === 'version_conflict') {
        const fresh = await fetchRecord(meta, row.id).catch(() => null);
        if (!fresh) { setMessage(errorText(err)); return; }
        const list = findConflicts(meta, base.row, patch, fresh.row);
        if (list.length === 0 && !retried) {
          // Someone changed other fields only: the person's changes still apply on top.
          const again = resolvePatch(patch, [], {}, fresh.row);
          if (Object.keys(again).length === 0) { onSaved(fresh); return; }
          await save(fresh, again, true);
          return;
        }
        setKeepMine(Object.fromEntries(list.map((c) => [c.name, true])));
        setConflict({ fresh, list, patch });
        return;
      }
      if (err instanceof ApiError && err.code === 'validation' && Object.keys(err.fields).length) {
        const mine = Object.fromEntries(Object.entries(err.fields).filter(([f]) => onForm.includes(f)));
        const others = Object.keys(err.fields).filter((f) => !onForm.includes(f)).map((f) => meta.fields[f]?.label ?? f);
        setErrors(mine);
        if (others.length) setWebOnly(EDIT_TEXT.serverNeedsWeb(others));
        setMessage(err.message || EDIT_TEXT.check);
        return;
      }
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const typed: Record<string, string> = {};
    for (const [name, field] of fields) {
      const problem = checkTyped(field, values[name]);
      if (problem) typed[name] = problem;
    }
    setErrors(typed);
    setWebOnly(null);
    if (Object.keys(typed).length) { setMessage(EDIT_TEXT.check); return; }
    const patch = buildPatch(fields, row, values);
    if (Object.keys(patch).length === 0) { setMessage(EDIT_TEXT.nothing); return; }
    const missing = webOnlyRequirements(meta, row, values, onForm);
    if (missing.length) { setWebOnly(EDIT_TEXT.needsWeb(missing)); return; }
    void save(loaded, patch);
  };

  const shown = (name: string, value: unknown, label: string | null | undefined) => {
    const field = meta.fields[name];
    if (!field) return String(value ?? '');
    const named = field.type === 'user' || field.type === 'ref' ? label ?? null : null;
    return displayValue(name, field, { id: row.id, [name]: value, _display: named ? { [name]: named } : {} }, lookups) ?? EDIT_TEXT.empty;
  };

  if (conflict) {
    return (
      <View style={styles.form}>
        <Heading level={2}>{EDIT_TEXT.conflictTitle}</Heading>
        <Body>{EDIT_TEXT.conflictIntro}</Body>
        {conflict.list.map((c) => (
          <Card key={c.name} accessibilityLabel={c.label}>
            <Heading level={3}>{c.label}</Heading>
            <Body>{`${EDIT_TEXT.yours}: ${shown(c.name, c.mine, labels[c.name])}`}</Body>
            <Body>{`${EDIT_TEXT.saved}: ${shown(c.name, c.theirs, conflict.fresh.row._display?.[c.name])}`}</Body>
            <View accessibilityRole="radiogroup" accessibilityLabel={c.label} style={styles.choices}>
              {[true, false].map((mine) => (
                <Pressable
                  key={String(mine)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${c.label}: ${mine ? EDIT_TEXT.keepMine : EDIT_TEXT.useSaved}`}
                  accessibilityState={{ checked: keepMine[c.name] === mine }}
                  onPress={() => setKeepMine((k) => ({ ...k, [c.name]: mine }))}
                  style={[styles.choice, {
                    borderColor: keepMine[c.name] === mine ? colors.brand : colors.borderControl,
                    backgroundColor: keepMine[c.name] === mine ? colors.brandSoft : colors.surface,
                  }]}
                >
                  <Text style={{ color: colors.text, fontSize: fontSize.md }}>{mine ? EDIT_TEXT.keepMine : EDIT_TEXT.useSaved}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        ))}
        {message ? <Notice>{message}</Notice> : null}
        <Button kind="primary" label={EDIT_TEXT.saveChoices} busy={busy} onPress={() => {
          const patch = resolvePatch(conflict.patch, conflict.list, keepMine, conflict.fresh.row);
          const fresh = conflict.fresh;
          setConflict(null);
          if (Object.keys(patch).length === 0) { onSaved(fresh); return; }
          void save(fresh, patch);
        }} />
        <Button label={EDIT_TEXT.discard} onPress={() => onSaved(conflict.fresh)} />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Heading level={2}>{EDIT_TEXT.title(meta.label)}</Heading>
      {fields.map(([name, field]) => (
        <FieldInput
          key={name}
          name={name}
          field={{ ...field, required: needsValue(meta, name, field) }}
          value={values[name]}
          valueLabel={labels[name]}
          options={field.type === 'lookup' ? choicesFor(meta, name, field, row[name], lookups) : undefined}
          error={errors[name]}
          onChange={(v, label) => {
            setValues((s) => ({ ...s, [name]: v }));
            if (label !== undefined) setLabels((s) => ({ ...s, [name]: label }));
          }}
        />
      ))}
      {message ? <Notice>{message}</Notice> : null}
      {webOnly ? (
        <Notice kind="info">{webOnly}</Notice>
      ) : null}
      {webOnly ? <Button label={EDIT_TEXT.finishOnWeb} onPress={onOpenWeb} /> : null}
      <View style={styles.buttons}>
        <Button kind="primary" label={EDIT_TEXT.save} busy={busy} onPress={submit} />
        <Button label={EDIT_TEXT.cancel} onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  choices: { gap: space[2] },
  choice: { minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2], justifyContent: 'center' },
});
