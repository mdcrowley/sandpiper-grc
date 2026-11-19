// Administration > Reminders (/admin/reminders): how far ahead each module's reminders go out,
// the action and ticket thresholds of the daily reminders, the daily email hour and how long
// read notifications are kept. Every change is audited by the server (setting.change).
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, Checkbox, ErrorState, errorMessage, Loading, NumberField, PageHeader, TextField, useFetch, useToast,
} from '../../core';
import './notifications.css';

type Value = number | number[] | string[];

interface Setting {
  key: string;
  label: string;
  description: string;
  kind: 'number' | 'steps' | 'statuses';
  unit: string | null;
  min: number | null;
  max: number | null;
  default: Value;
  value: Value;
  options?: { value: string; label: string }[];
}
interface Overview { groups: { label: string; settings: Setting[] }[] }

/** What the form holds: numbers as numbers (or null while empty), steps as the text typed. */
type Draft = Record<string, number | null | string | string[]>;

const toDraft = (s: Setting): Draft[string] =>
  s.kind === 'steps' ? (s.value as number[]).join(', ') : s.kind === 'statuses' ? [...(s.value as string[])] : (s.value as number);

function parseSteps(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map(Number);
}

function fromDraft(s: Setting, d: Draft[string]): Value | null {
  if (s.kind === 'steps') return parseSteps(String(d ?? ''));
  if (s.kind === 'statuses') return d as string[];
  return typeof d === 'number' ? d : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const defaultText = (s: Setting) =>
  s.kind === 'statuses'
    ? (s.default as string[]).map((v) => s.options?.find((o) => o.value === v)?.label ?? v).join(', ')
    : s.kind === 'steps' ? `${(s.default as number[]).join(', ')} ${s.unit ?? ''}`.trim()
      : s.unit === 'hour of the day' ? `${s.default}:00` : `${s.default} ${s.unit ?? ''}`.trim();

function SettingControl({ s, value, error, onChange }: { s: Setting; value: Draft[string]; error?: string; onChange: (v: Draft[string]) => void }) {
  const hint = `${s.description} Default: ${defaultText(s)}.`;
  if (s.kind === 'statuses') {
    const chosen = (value as string[]) ?? [];
    return (
      <fieldset className="ntf-rem-statuses">
        <legend className="ntf-rem-legend">{s.label}</legend>
        <p className="muted ntf-small">{hint}</p>
        <div className="ntf-rem-checks">
          {(s.options ?? []).map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={chosen.includes(o.value)}
              onChange={(on) => onChange(on ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))}
            />
          ))}
        </div>
        {error && <p className="ntf-rem-error" role="alert">{error}</p>}
      </fieldset>
    );
  }
  if (s.kind === 'steps') {
    return (
      <TextField
        label={`${s.label} (${s.unit ?? 'days'}, separated by commas)`}
        value={String(value ?? '')}
        onChange={(v) => onChange(v)}
        hint={hint}
        error={error}
        inputMode="numeric"
      />
    );
  }
  return (
    <NumberField
      label={`${s.label} (${s.unit ?? 'days'})`}
      value={typeof value === 'number' ? value : null}
      onChange={(v) => onChange(v)}
      min={s.min ?? undefined}
      max={s.max ?? undefined}
      step={1}
      decimals={0}
      hint={hint}
      error={error}
    />
  );
}

function ReminderForm({ initial, onSaved }: { initial: Overview; onSaved: (o: Overview) => void }) {
  const toast = useToast();
  const all = initial.groups.flatMap((g) => g.settings);
  const fresh = () => Object.fromEntries(all.map((s) => [s.key, toDraft(s)])) as Draft;
  const [draft, setDraft] = useState<Draft>(fresh);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(fresh()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initial]);

  const changed = all.filter((s) => !same(fromDraft(s, draft[s.key]), s.value));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    const values: Record<string, Value> = {};
    for (const s of changed) {
      const v = fromDraft(s, draft[s.key]);
      if (v === null) local[s.key] = s.kind === 'steps' ? 'Enter whole numbers of days, separated by commas.' : 'Enter a whole number.';
      else values[s.key] = v;
    }
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const saved = await api.patch<Overview>('/api/notifications/reminder-settings', { values });
      onSaved(saved);
      toast.success(`Reminder settings saved (${changed.length} changed).`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      {initial.groups.map((g) => (
        <Card key={g.label} title={g.label}>
          <div className="stack">
            {g.settings.map((s) => (
              <SettingControl
                key={s.key}
                s={s}
                value={draft[s.key]}
                error={errors[s.key]}
                onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
              />
            ))}
          </div>
        </Card>
      ))}
      <div className="ntf-rem-actions">
        <Button type="submit" variant="primary" icon="check" loading={busy} disabled={!changed.length}>Save changes</Button>
        <Button disabled={!changed.length || busy} onClick={() => { setDraft(fresh()); setErrors({}); }}>Undo changes</Button>
        <span className="muted ntf-small" aria-live="polite">{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}` : 'No unsaved changes'}</span>
      </div>
    </form>
  );
}

export function ReminderSettingsPage() {
  const { data, error, reload } = useFetch<Overview>('/api/notifications/reminder-settings');
  const [saved, setSaved] = useState<Overview | null>(null);
  const shown = saved ?? data;
  return (
    <div className="stack ntf-page">
      <PageHeader
        title="Reminders"
        subtitle="How far ahead reminders go out, and how long read notifications are kept. Each reminder still goes to a person once."
      />
      {error && !shown ? <ErrorState title="Reminder settings could not be loaded" error={error} onRetry={reload} />
        : !shown ? <Loading lines={8} label="Loading reminder settings" />
          : <ReminderForm initial={shown} onSaved={setSaved} />}
    </div>
  );
}
