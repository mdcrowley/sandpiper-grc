// Framework settings (E07-23): the target status, the weight each status carries in the score,
// and how many days ahead review reminders go out. Everyone who can see the board may read them;
// changing them needs frameworks.administer. Every change is audited by the server.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ApiError, Button, Card, ErrorState, Loading, NumberField, PageHeader, Select, api, errorMessage, useFetch, useToast,
} from '../../core';
import { statusVars } from './types';
import type { ColorName } from '../../core';

export interface FrameworkSettings {
  target_status: string;
  review_reminder_days: number;
  statuses: { value: string; label: string; color: string; weight: number }[];
  can_administer: boolean;
}

const pct = (w: number) => Math.round(w * 100);

export function SettingsPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<FrameworkSettings>('/api/frameworks/settings');
  const [target, setTarget] = useState('');
  const [weights, setWeights] = useState<Record<string, number | null>>({});
  const [lead, setLead] = useState<number | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setTarget(data.target_status);
    setWeights(Object.fromEntries(data.statuses.map((s) => [s.value, pct(s.weight)])));
    setLead(data.review_reminder_days);
    setFields({});
  }, [data]);

  const dirty = useMemo(() => Boolean(data) && (
    target !== data!.target_status || lead !== data!.review_reminder_days
    || data!.statuses.some((s) => weights[s.value] !== pct(s.weight))), [data, target, lead, weights]);

  const header = (
    <PageHeader
      title="Framework settings"
      subtitle="How outcomes are scored and when review reminders go out. Changes are recorded in the audit log."
      breadcrumbs={[{ label: 'Framework outcomes', to: '/frameworks' }, { label: 'Settings' }]}
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} label="Loading the settings" /></div>;

  const readOnly = !data.can_administer;
  const ordered = data.statuses;
  const targetWeight = weights[target] ?? 0;

  async function save() {
    const local: Record<string, string> = {};
    for (const s of ordered) {
      const w = weights[s.value];
      if (w === null || w === undefined || w < 0 || w > 100) local[`weights.${s.value}`] = 'Enter a percentage from 0 to 100.';
    }
    if (!targetWeight) local.target_status = 'The target status needs a weight above 0%, or no outcome can reach it.';
    if (lead === null || !Number.isInteger(lead) || lead < 0 || lead > 90) local.review_reminder_days = 'Enter a whole number of days from 0 to 90.';
    setFields(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api.put('/api/frameworks/settings', {
        target_status: target,
        weights: Object.fromEntries(ordered.map((s) => [s.value, (weights[s.value] ?? 0) / 100])),
        review_reminder_days: lead,
      });
      toast.success('Framework settings saved.');
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack fw-page">
      {header}
      {readOnly && <div className="notice">You can read these settings. Changing them needs the Administer permission on frameworks.</div>}

      <Card title="Scoring">
        <div className="stack">
          <p className="muted fw-settings-intro">
            Each status counts for part of an outcome in the score out of 100. The target status is the line drawn on the board,
            the progress chart and assessment reports: an outcome at that status, or one weighing more, counts as on target.
          </p>
          <div className="fw-weights" role="group" aria-label="Weight of each status">
            {ordered.map((s) => (
              <div key={s.value} className="fw-weight" style={statusVars(s.color as ColorName) as CSSProperties}>
                <span className="fw-weight-name"><span className="fw-pill-dot" />{s.label}</span>
                <NumberField
                  label={`Weight of ${s.label}`} hideLabel size="sm" min={0} max={100} step={1} decimals={0}
                  value={weights[s.value] ?? null} disabled={readOnly} error={fields[`weights.${s.value}`]}
                  onChange={(v) => setWeights((w) => ({ ...w, [s.value]: v }))}
                />
                <span className="fw-weight-unit" aria-hidden="true">%</span>
                <span className="fw-weight-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, weights[s.value] ?? 0))}%` }} /></span>
              </div>
            ))}
          </div>
          <Select
            label="Target status" required className="fw-settings-field" value={target} disabled={readOnly} error={fields.target_status}
            options={ordered.map((s) => ({ value: s.value, label: `${s.label} (${weights[s.value] ?? 0}%)`, color: s.color }))}
            onChange={(v) => v && setTarget(v)}
            hint={targetWeight ? `Outcomes weighing ${targetWeight}% or more count as on target; the target score is ${targetWeight}.` : undefined}
          />
        </div>
      </Card>

      <Card title="Review reminders">
        <NumberField
          label="Days before the review date" required className="fw-settings-field" min={0} max={90} step={1} decimals={0} value={lead} disabled={readOnly}
          error={fields.review_reminder_days} onChange={setLead}
          hint="The owner of an outcome (or, with no owner, everyone who may edit outcomes) is told this many days before its review date, and again on the day. 0 sends only the reminder on the day. The same setting is listed with the other reminders under Administration > Reminders."
        />
      </Card>

      {!readOnly && (
        <div className="fw-edit-foot">
          <span className="fw-edit-state" role="status">{dirty ? 'You have unsaved changes.' : 'No unsaved changes.'}</span>
          <Button disabled={!dirty || busy} onClick={reload}>Discard changes</Button>
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>Save settings</Button>
        </div>
      )}
    </div>
  );
}
