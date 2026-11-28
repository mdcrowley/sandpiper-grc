// Strategy > Settings (strategy.administer): the statistics series the organization keeps, and the
// reminders before a statistical report is due.
import { useEffect, useState } from 'react';
import { Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, ResourceList, TextField, useFetch, useToast, useUnsavedChanges } from '../../core';
import { api } from '../../core';

interface Settings { submission_reminder_days: number[]; due_soon_days: number }

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
      <PageHeader title="Strategy settings" subtitle="The operating statistics your organization keeps, and the reminders before a statistical report is due." />
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
      <Reminders />
    </div>
  );
}
