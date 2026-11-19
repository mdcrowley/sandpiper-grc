// The policy library: tiles for the usual questions, then every policy with its status and
// review date, with ready-made saved views. Administrators set the reminder interval here.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, errorMessage, Modal, NumberField, PageHeader, ResourceList, Stat, useAuth, useFetch, useToast,
  type ListResult, type StatsResult,
} from '../../core';
import { ReviewChip, isoDay } from './shared';
import { ensureStarterViews } from './views';

const NOT_RETIRED = 'draft,in_review,approved,published';

/** The acknowledgement reminder interval (`policies.reminder_interval_days`). */
function ReminderSettings({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data } = useFetch<{ reminder_interval_days: number }>('/api/policies/settings');
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const days = value ?? data?.reminder_interval_days ?? null;
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.put('/api/policies/settings', { reminder_interval_days: days });
      toast.success('Reminder interval saved.');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.reminder_interval_days ? err.fields.reminder_interval_days : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Acknowledgement reminders" onClose={onClose} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={days === null} onClick={() => void save()}>Save</Button></>}>
      <div className="stack">
        <p className="muted">
          Once an acknowledgement is past its due date, the person is reminded through their notifications, then again after this many days
          until they acknowledge. Each reminder is recorded in the policy's history.
        </p>
        <NumberField label="Days between reminders" value={days} min={1} max={90} step={1} onChange={setValue} error={error} hint="From 1 to 90." />
      </div>
    </Modal>
  );
}

export function PolicyLibrary() {
  const { can } = useAuth();
  const [settings, setSettings] = useState(false);
  useMemo(() => ensureStarterViews('policy', [
    { name: 'Published', filters: { status: 'published' } },
    { name: 'Being written or approved', filters: { status: 'draft,in_review,approved' } },
    { name: 'Owned by me', filters: { owner_id: 'me' }, labels: { owner_id: 'Me' } },
    { name: 'Retired', filters: { status: 'retired' } },
  ]), []);
  const reviewBy = isoDay(61);
  const stats = useFetch<StatsResult>('/api/policies/stats?group=status');
  const review = useFetch<ListResult>(`/api/policies?pageSize=1&f.status=${NOT_RETIRED}&f.review_date.lt=${reviewBy}`);
  const count = (s: string) => stats.data?.groups.filter((g) => s.split(',').includes(String(g.value))).reduce((n, g) => n + g.count, 0) ?? '–';

  return (
    <div className="stack">
      <PageHeader
        title="Policies"
        subtitle="The policy library: what is in force, what is being written, and what is due for review."
        actions={(
          <>
            <Link className="btn btn-secondary" to="/policies/acknowledgements">My acknowledgements</Link>
            {can('policies.administer') && <Button icon="settings" onClick={() => setSettings(true)}>Reminder settings</Button>}
          </>
        )}
      />
      <div className="grid-stats">
        <Stat label="Published" icon="check-circle" value={count('published')} color="green" to="/policies?f.status=published" />
        <Stat label="Being written or approved" icon="edit" value={count('draft,in_review,approved')} color="amber" to="/policies?f.status=draft,in_review,approved" />
        <Stat label="Due for review" icon="clock" value={review.data?.total ?? '–'} color={review.data?.total ? 'red' : undefined}
          hint="Within 60 days, or overdue" to={`/policies?f.status=${NOT_RETIRED}&f.review_date.lt=${reviewBy}&sort=review_date&dir=asc`} />
        <Stat label="Retired" icon="history" value={count('retired')} to="/policies?f.status=retired" />
      </div>
      <ResourceList
        type="policy"
        urlState
        columns={[
          'ref', 'title', 'category', 'status',
          { field: 'current_version', label: 'In force', sortable: true, render: (row) => (row.current_version ? `Version ${row.current_version}` : <span className="muted">None</span>) },
          { field: 'review_date', label: 'Review', sortable: true, render: (row) => <ReviewChip date={row.review_date} status={row.status} /> },
          { field: 'owner_id', hidden: true },
          { field: 'approver_name', hidden: true },
          { field: 'ack_days', hidden: true },
          { field: 'updated_at', hidden: true },
        ]}
        filters={['status', 'category', 'owner_id', 'review_date']}
        bulkFields={['category', 'owner_id', 'review_date']}
        createFields={['title', 'summary', 'category', 'owner_id', 'approver_name', 'approver_role', 'review_date']}
      />
      {settings && <ReminderSettings onClose={() => setSettings(false)} />}
    </div>
  );
}
