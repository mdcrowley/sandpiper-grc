// Strategy > Settings (strategy.administer): the statistics series the organization keeps, its fiscal
// year (E46-58), and the reminders before a statistical report is due.
import { useEffect, useState } from 'react';
import { Button, Card, ErrorState, errorMessage, Loading, Notice, NumberField, PageHeader, ResourceList, Select, TextField, useFetch, useToast, useUnsavedChanges } from '../../core';
import { api } from '../../core';
import type { StrategySettingsData as Settings } from './shared';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month the fiscal year starts and which calendar year names it: quarters and years everywhere in the area follow it. */
function FiscalYear() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Settings>('/api/strategy/settings');
  const [start, setStart] = useState('1');
  const [named, setNamed] = useState<'end' | 'start'>('end');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setStart(String(data.fiscal_year_start_month)); setNamed(data.fiscal_year_named_for); } }, [data]);
  const dirty = Boolean(data) && (start !== String(data!.fiscal_year_start_month) || (start !== '1' && named !== data!.fiscal_year_named_for));
  const unsaved = useUnsavedChanges(dirty);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const locked = data.fiscal_periods_in_use > 0;
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/strategy/settings', { fiscal_year_start_month: Number(start), fiscal_year_named_for: named });
      setErrors({});
      unsaved.release();
      toast.success('Fiscal year saved.');
      reload();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Fiscal year">
      <div className="stack">
        <p className="muted">Quarters and years of measures, statistics, status updates and the quarterly matrix follow the organization's fiscal year. Now: {data.fiscal_year_text}</p>
        {locked && (
          <Notice tone="info" title="Kept on the current fiscal year">
            {data.fiscal_periods_in_use} measure value{data.fiscal_periods_in_use === 1 ? '' : 's'}, statistic{data.fiscal_periods_in_use === 1 ? '' : 's'} or update{data.fiscal_periods_in_use === 1 ? ' is' : 's are'} kept on its fiscal periods, so the fiscal year cannot change under them.
          </Notice>
        )}
        <div className="form-grid">
          <Select label="The fiscal year starts in" required value={start} onChange={setStart} disabled={locked} error={errors.fiscal_year_start_month}
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: i === 0 ? 'January (the calendar year)' : m }))}
            hint="Periods entered on the calendar year keep their meaning when this changes; new ones are written FY2027-Q1 and FY2027." />
          {start !== '1' && (
            <Select label="Each fiscal year is named after" required value={named} onChange={(v) => setNamed(v === 'start' ? 'start' : 'end')} disabled={locked} error={errors.fiscal_year_named_for}
              options={[{ value: 'end', label: 'The calendar year it ends in' }, { value: 'start', label: 'The calendar year it starts in' }]}
              hint={`For a year from ${MONTHS[Number(start) - 1]} 2026: FY${named === 'start' ? 2026 : 2027}.`} />
          )}
        </div>
        <div><Button variant="primary" loading={busy} disabled={!dirty || locked} onClick={() => void save()}>Save</Button></div>
      </div>
    </Card>
  );
}

function Reminders() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Settings>('/api/strategy/settings');
  const [steps, setSteps] = useState('');
  const [soon, setSoon] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setSteps(data.submission_reminder_days.join(', ')); setSoon(data.due_soon_days); } }, [data]);
  const dirty = Boolean(data) && (steps !== data!.submission_reminder_days.join(', ') || soon !== data!.due_soon_days);
  const unsaved = useUnsavedChanges(dirty);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const save = async () => {
    setBusy(true);
    try {
      const days = steps.split(/[\s,;]+/).filter(Boolean).map(Number);
      await api.put('/api/strategy/settings', { submission_reminder_days: days, due_soon_days: soon });
      setErrors({});
      unsaved.release();
      toast.success('Settings saved.');
      reload();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Card title="Statistical reports">
      <div className="stack">
        <div className="form-grid">
          <TextField label="Remind the preparer this many days before the due date" value={steps} onChange={setSteps} error={errors.submission_reminder_days}
            hint="Up to six steps, separated by commas; 0 is the due date itself. Each step reminds once." />
          <NumberField label="Due soon means within (days)" value={soon} onChange={setSoon} min={1} max={365} error={errors.due_soon_days}
            hint="Used for the figures on the Strategy page and the Overview." />
        </div>
        <div><Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>Save</Button></div>
      </div>
    </Card>
  );
}

export function StrategySettings() {
  return (
    <div className="stack">
      <PageHeader title="Strategy settings" subtitle="The operating statistics your organization keeps, its fiscal year, and the reminders before a statistical report is due." />
      <Card title="Statistics series">
        <p className="muted">Each series is one statistic you count by period, for example passenger trips, revenue miles or hours, vehicles in service, or incidents per 100,000 miles. Breakdowns split it, for example by mode or service. Values are entered on the Statistics tab.</p>
        <ResourceList
          type="stat_series"
          urlState={false}
          defaultSort={{ field: 'sort', dir: 'asc' }}
          columns={['code', 'name', 'unit', 'frequency', 'breakdown_label', 'active', { field: 'owner_id', priority: 3 }, { field: 'sort', priority: 3 }]}
          filters={['frequency', 'active']}
          createFields={['code', 'name', 'description', 'unit', 'frequency', 'breakdown_label', 'breakdowns', 'decimals', 'owner_id', 'sort']}
        />
      </Card>
      <FiscalYear />
      <Reminders />
    </div>
  );
}
