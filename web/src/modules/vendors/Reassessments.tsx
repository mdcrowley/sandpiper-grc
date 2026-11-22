// Reassessments and exclusion-list checks due (E35-01, E35-02), with the lifecycle settings.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, Modal, NumberField, PageHeader,
  Select, StatusChip, Switch, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import { DueChip, type LifecycleSettings } from './Lifecycle';

interface DueRow {
  id: string;
  ref: string | null;
  name: string;
  criticality: string | null;
  cadence_months: number | null;
  owner_name: string | null;
  last_assessed_on: string | null;
  next_assessment_due: string | null;
  assessment_overdue: boolean;
  last_exclusion_check_on: string | null;
  exclusion_due_on: string | null;
  exclusion_overdue: boolean;
}

const WINDOWS = [
  { value: '30', label: 'Due in the next 30 days' },
  { value: '90', label: 'Due in the next 90 days' },
  { value: '365', label: 'Due in the next year' },
  { value: 'all', label: 'Every vendor' },
];

function SettingsDialog({ settings, onClose, onSaved }: { settings: LifecycleSettings; onClose: () => void; onSaved: (s: LifecycleSettings) => void }) {
  const toast = useToast();
  const start = {
    cadence: settings.cadence.map((c) => ({ value: c.value, months: c.months })),
    reminder_days: settings.reminder_days as number | null, exclusion_months: settings.exclusion_months as number | null,
    exclusion_before_contract: settings.exclusion_before_contract,
  };
  const [v, setV] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);
  const unsaved = useUnsavedChanges(dirty);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put<LifecycleSettings>('/api/vendors/lifecycle-settings', {
        cadence: v.cadence, reminder_days: v.reminder_days, exclusion_months: v.exclusion_months, exclusion_before_contract: v.exclusion_before_contract,
      });
      unsaved.release();
      toast.success('Lifecycle settings saved.');
      onSaved(res);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally { setSaving(false); }
  }
  return (
    <Modal open title="Reassessment and exclusion-check settings" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="vnd-lc-fieldset">
          <legend>Reassess vendors every (months, by criticality)</legend>
          <p className="muted">Leave a box empty for a criticality that is never due. A change works every vendor&apos;s next date out again.</p>
          <div className="form-grid">
            {settings.cadence.map((c, i) => (
              <NumberField
                key={c.value} label={c.label} min={1} max={120} value={v.cadence[i].months}
                onChange={(n) => setV({ ...v, cadence: v.cadence.map((x, j) => (j === i ? { ...x, months: n } : x)) })}
              />
            ))}
          </div>
          {errors.cadence && <div className="form-error" role="alert">{errors.cadence}</div>}
        </fieldset>
        <div className="form-grid">
          <NumberField label="Remind owners this many days before" min={0} max={365} value={v.reminder_days} error={errors.reminder_days}
            onChange={(reminder_days) => setV({ ...v, reminder_days })} />
          <NumberField label="Exclusion-list checks due every (months)" min={1} max={120} value={v.exclusion_months} error={errors.exclusion_months}
            onChange={(exclusion_months) => setV({ ...v, exclusion_months })} />
        </div>
        <Switch
          label="Need a recent exclusion-list check before a contract becomes active"
          hint="With this on, a contract cannot be made active while the vendor's latest check is a match or older than the months above."
          checked={v.exclusion_before_contract} onChange={(exclusion_before_contract) => setV({ ...v, exclusion_before_contract })}
        />
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onClose)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Save settings</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Reassessments() {
  const [windowKey, setWindowKey] = useState('90');
  const { data, error, reload } = useFetch<{ today: string; rows: DueRow[]; exclusion_months: number }>(`/api/vendors/reassessments?due_within=${windowKey}`);
  const settings = useFetch<LifecycleSettings>('/api/vendors/lifecycle-settings');
  const [current, setCurrent] = useState<LifecycleSettings | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (settings.data) setCurrent(settings.data); }, [settings.data]);

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading reassessments due" />;
  else if (!data.rows.length) body = <EmptyState icon="check-circle" title="Nothing due" message="No vendor's reassessment or exclusion-list check falls in this window." />;
  else {
    body = (
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Vendors with a reassessment or exclusion-list check due</caption>
          <thead>
            <tr>
              <th scope="col">Vendor</th><th scope="col">Criticality</th><th scope="col">Last assessed</th><th scope="col">Next assessment</th>
              <th scope="col">Last exclusion check</th><th scope="col">Next check</th><th scope="col">Owner</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/vendors/${r.id}?tab=lifecycle`}>{r.name}</Link>{r.ref && <div className="muted">{r.ref}</div>}</td>
                <td>
                  {r.criticality ? <LookupChip list="vendor_criticality" value={r.criticality} /> : <span className="muted">Not set</span>}
                  <div className="muted">{r.cadence_months ? `Every ${r.cadence_months} months` : 'No cadence'}</div>
                </td>
                <td>{r.last_assessed_on ? formatDate(r.last_assessed_on) : <span className="muted">Never</span>}</td>
                <td><DueChip date={r.next_assessment_due} /></td>
                <td>{r.last_exclusion_check_on ? formatDate(r.last_exclusion_check_on) : <span className="muted">Never</span>}</td>
                <td>{r.exclusion_due_on ? <DueChip date={r.exclusion_due_on} /> : <StatusChip color="gray" label="Not active" />}</td>
                <td>{r.owner_name || <span className="muted">No owner</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const overdue = data ? data.rows.filter((r) => r.assessment_overdue).length : 0;
  const checksOverdue = data ? data.rows.filter((r) => r.exclusion_overdue).length : 0;
  return (
    <div className="stack">
      <PageHeader
        title="Reassessments due"
        subtitle="Vendors whose security assessment or exclusion-list check is coming due, by the cadence set for their criticality."
        actions={current?.can_edit ? <Button variant="secondary" icon="settings" onClick={() => setEditing(true)}>Settings</Button> : undefined}
      />
      <Card
        title={data ? `${data.rows.length} vendor${data.rows.length === 1 ? '' : 's'}` : 'Vendors'}
        actions={<Select label="Window" hideLabel value={windowKey} options={WINDOWS} onChange={setWindowKey} />}
        flush={Boolean(data?.rows.length)}
      >
        {data && data.rows.length > 0 && (
          <p className="vnd-lc-due">
            {overdue > 0 ? <StatusChip color="red" label={`${overdue} reassessment${overdue === 1 ? '' : 's'} overdue`} /> : <StatusChip color="green" label="No reassessment overdue" />}
            {checksOverdue > 0 && <StatusChip color="red" label={`${checksOverdue} exclusion check${checksOverdue === 1 ? '' : 's'} overdue`} />}
            {current && <span className="muted">Cadence: {current.cadence.map((c) => `${c.label} ${c.months ? `${c.months} months` : 'never'}`).join(' · ')}</span>}
          </p>
        )}
        {body}
      </Card>
      {editing && current && <SettingsDialog settings={current} onClose={() => setEditing(false)} onSaved={(s) => { setCurrent(s); setEditing(false); reload(); }} />}
    </div>
  );
}
