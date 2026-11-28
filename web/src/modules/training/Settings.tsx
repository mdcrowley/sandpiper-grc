// Training settings (/training/settings, E44-10): the overdue-training reminder interval, which was a
// dialog on the Training overview with no address of its own. It is the last tab of Training and a card
// on the Administration page. Certification reminders are set with the other reminders.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';

export function TrainingSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<{ reminder_interval_days: number }>('/api/training/settings');
  const [value, setValue] = useState<number | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const days = value ?? data?.reminder_interval_days ?? null;
  const dirty = value !== null && value !== data?.reminder_interval_days;
  const unsaved = useUnsavedChanges(dirty);

  const save = async () => {
    setBusy(true);
    setFieldError('');
    try {
      await api.put('/api/training/settings', { reminder_interval_days: days });
      unsaved.release();
      toast.success('Reminder interval saved.');
      setValue(null);
      reload();
    } catch (err) {
      setFieldError(err instanceof ApiError && err.fields?.reminder_interval_days ? err.fields.reminder_interval_days : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Training settings" subtitle="When people are reminded of training that is past its due date." />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} label="Loading training settings" /> : (
        <Card title="Overdue training reminders"
          actions={<Button size="sm" variant="primary" loading={busy} disabled={!dirty || days === null} onClick={() => void save()}>Save</Button>}>
          <div className="stack">
            <p className="muted">
              People are told when training is assigned to them. Once it is past its due date they are reminded through their notifications,
              then again after this many days until it is completed.
            </p>
            <NumberField label="Days between reminders" value={days} min={1} max={90} step={1} onChange={setValue} error={fieldError} hint="From 1 to 90." />
            {can('admin.administer') && (
              <p className="muted">Reminders before a certification expires are set with the other reminders, under <Link to="/admin/reminders">Administration &gt; Reminders</Link>.</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
