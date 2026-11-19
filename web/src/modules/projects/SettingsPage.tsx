import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Card, errorMessage, ErrorState, IconButton, Loading, NumberField, PageHeader, Select, TextField, useFetch, useToast,
} from '../../core';
import { currencySymbol } from './bits';
import { GateTemplates } from './GateTemplates';
import type { Criterion, ProjectSettings } from './types';

type Saved = ProjectSettings & { recalculated?: number };

const INTAKE_OPTIONS = [
  { value: 'create', label: 'People who can create projects' },
  { value: 'view', label: 'Everyone who can view projects' },
  { value: 'everyone', label: 'Everyone who can sign in' },
];

/** Tier thresholds, the work-in-progress limit, scoring criteria and gate templates. Needs projects.administer. */
export function SettingsPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<ProjectSettings>('/api/projects/settings');
  const [tier3Below, setTier3Below] = useState<number | null>(null);
  const [tier1Above, setTier1Above] = useState<number | null>(null);
  const [wipLimit, setWipLimit] = useState<number | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [intakeOpenTo, setIntakeOpenTo] = useState('create');
  const [reportDays, setReportDays] = useState<number | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!data) return;
    setTier3Below(data.tiers.tier3Below);
    setTier1Above(data.tiers.tier1Above);
    setWipLimit(data.wipLimit);
    setIntakeOpenTo(data.intakeOpenTo);
    setReportDays(data.reportIntervalDays);
    setCriteria(data.criteria.map((c) => ({ ...c })));
  }, [data]);

  async function save(section: string, body: Record<string, unknown>, local: Record<string, string>) {
    setFields(local);
    if (Object.keys(local).length) return;
    setBusy(section);
    try {
      const res = await api.patch<Saved>('/api/projects/settings', body);
      toast.success(res.recalculated ? `Saved. ${res.recalculated} ${res.recalculated === 1 ? 'project was' : 'projects were'} recalculated.` : 'Saved.');
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  const header = (
    <PageHeader
      title="Project settings"
      subtitle="Rules that apply to every project. Changes are recorded in the audit log."
      breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: 'Settings' }]}
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} /></div>;

  const setCriterion = (i: number, patch: Partial<Criterion>) => setCriteria((list) => list.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const totalWeight = criteria.reduce((n, c) => n + (Number(c.weight) > 0 ? Number(c.weight) : 0), 0);

  const saveTiers = () => {
    const local: Record<string, string> = {};
    if (tier3Below === null || tier3Below < 0) local['tiers.tier3Below'] = 'Enter an amount of zero or more.';
    if (tier1Above === null || tier1Above < 0) local['tiers.tier1Above'] = 'Enter an amount of zero or more.';
    else if (tier3Below !== null && tier1Above < tier3Below) local['tiers.tier1Above'] = 'The Tier 1 threshold cannot be below the Tier 3 threshold.';
    return save('tiers', { tiers: { tier3Below, tier1Above } }, local);
  };
  const saveWip = () => save('wip', { wipLimit }, wipLimit === null || !Number.isInteger(wipLimit) || wipLimit < 1 ? { wipLimit: 'Enter a whole number of 1 or more.' } : {});
  const saveCriteria = () => {
    const local: Record<string, string> = {};
    criteria.forEach((c, i) => {
      if (!c.label.trim()) local[`criteria.${i}.label`] = 'Give the criterion a name.';
      if (!(Number(c.weight) >= 0)) local[`criteria.${i}.weight`] = 'Weight must be zero or more.';
    });
    if (!criteria.length) local.criteria = 'Add at least one scoring criterion.';
    else if (!Object.keys(local).length && !totalWeight) local.criteria = 'At least one criterion needs a weight above zero.';
    return save('criteria', { criteria }, local);
  };

  return (
    <div className="stack prj-narrow">
      {header}

      <Card title="Tier thresholds">
        <div className="form">
          <p className="muted">
            Tier 3 is below the first amount, Tier 2 runs from the first amount to the second, and Tier 1 is above the second.
            Any project that touches payment, personal data or operational systems is Tier 1 whatever its budget.
            Saving recalculates the tier of every project.
          </p>
          <div className="form-grid">
            <NumberField label="Tier 3 is below" prefix={currencySymbol()} thousands min={0} step={1000} value={tier3Below} onChange={setTier3Below} error={fields['tiers.tier3Below']} />
            <NumberField label="Tier 1 is above" prefix={currencySymbol()} thousands min={0} step={1000} value={tier1Above} onChange={setTier1Above} error={fields['tiers.tier1Above']} />
          </div>
          <div className="form-actions">
            <Button variant="primary" loading={busy === 'tiers'} onClick={saveTiers}>Save thresholds</Button>
          </div>
        </div>
      </Card>

      <Card title="Work-in-progress limit">
        <div className="form">
          <p className="muted">The portfolio shows a warning when more active projects than this are in the Deliver stage at once.</p>
          <div className="form-grid">
            <NumberField label="Active projects in delivery" min={1} step={1} value={wipLimit} onChange={setWipLimit} error={fields.wipLimit} />
          </div>
          <div className="form-actions">
            <Button variant="primary" loading={busy === 'wip'} onClick={saveWip}>Save limit</Button>
          </div>
        </div>
      </Card>

      <Card title="Requests and reminders">
        <div className="form">
          <p className="muted">
            Who sees a working request form, and how long a project may go without a status report before its manager is reminded.
            A requester can follow their own requests but cannot change the project afterwards.
          </p>
          <div className="form-grid">
            <Select
              label="Who may submit a project request"
              required
              value={intakeOpenTo}
              onChange={setIntakeOpenTo}
              options={INTAKE_OPTIONS}
              error={fields.intakeOpenTo}
            />
            <NumberField
              label="Status report due after (days)"
              min={1}
              max={366}
              step={1}
              value={reportDays}
              onChange={setReportDays}
              error={fields.reportIntervalDays}
              hint="Counted from the period end of the last report"
            />
          </div>
          <div className="form-actions">
            <Button
              variant="primary"
              loading={busy === 'intake'}
              onClick={() => save('intake', { intakeOpenTo, reportIntervalDays: reportDays },
                reportDays === null || !Number.isInteger(reportDays) || reportDays < 1 || reportDays > 366 ? { reportIntervalDays: 'Enter a whole number of days from 1 to 366.' } : {})}
            >
              Save requests and reminders
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Scoring criteria">
        <div className="form">
          <p className="muted">
            Each project is scored 0 to {data.maxScore} on every criterion. The priority score is the weighted average out of 100.
            Saving recalculates every project's score.
          </p>
          {criteria.map((c, i) => (
            <div key={i} className="prj-settings-row">
              <TextField label="Criterion" value={c.label} onChange={(label) => setCriterion(i, { label })} error={fields[`criteria.${i}.label`] ?? fields[`criteria.${i}.key`]} />
              <TextField label="What it means" value={c.description ?? ''} onChange={(description) => setCriterion(i, { description })} />
              <NumberField
                label="Weight"
                min={0}
                value={c.weight}
                onChange={(weight) => setCriterion(i, { weight: weight ?? 0 })}
                error={fields[`criteria.${i}.weight`]}
                hint={totalWeight && c.weight > 0 ? `${Math.round((c.weight / totalWeight) * 100)}%` : undefined}
              />
              <IconButton icon="trash" label={`Remove ${c.label || 'criterion'}`} variant="ghost" onClick={() => setCriteria((list) => list.filter((_, n) => n !== i))} />
            </div>
          ))}
          {fields.criteria && <p className="form-error" role="alert">{fields.criteria}</p>}
          <div className="form-actions">
            <Button icon="plus" onClick={() => setCriteria((list) => [...list, { key: '', label: '', weight: 10 }])}>Add criterion</Button>
            <Button variant="primary" loading={busy === 'criteria'} onClick={saveCriteria}>Save criteria</Button>
          </div>
        </div>
      </Card>

      <GateTemplates />
    </div>
  );
}
