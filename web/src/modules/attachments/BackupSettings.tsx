// Administration > Backups: the daily backup the server takes to a second location, its
// schedule, destination, retention and encryption, the last results, and "Back up now".
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, NumberField, PageHeader,
  relativeTime, Select, Stat, StatusChip, Switch, TextField, useFetch, useToast,
} from '../../core';
import type { BackupRun, BackupSettings as Settings, BackupsOverview } from './adminTypes';
import { usePasswordConfirm } from './confirm';
import { formatBytes } from './shared';
import './attachments.css';

const RESULT: Record<BackupRun['status'], { label: string; color: 'green' | 'red' | 'blue' }> = {
  ok: { label: 'Checked', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  running: { label: 'Running', color: 'blue' },
};

function ageHours(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 36e5;
}

export function BackupSettings() {
  const toast = useToast();
  const confirm = usePasswordConfirm();
  const { data, error, reload } = useFetch<BackupsOverview>('/api/backups');
  const [form, setForm] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => { if (data) setForm(data.settings); }, [data]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setErrors({});
    try {
      await confirm.run(() => api.patch('/api/backups/settings', form));
      toast.success(form.enabled ? `Backups will be taken every day at ${form.time}.` : 'Backup settings saved. Daily backups are off.');
      reload();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { run } = await api.post<{ run: BackupRun }>('/api/backups/run', {});
      if (run.status === 'ok') toast.success(`Backed up and checked: ${run.archive_name} (${formatBytes(run.bytes ?? 0)}).`);
      else toast.error(run.message ?? 'The backup failed.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const last = data?.lastSuccess;
  const overdue = last ? ageHours(last.started_at) > 48 : false;
  const lastRun = data?.runs[0];

  return (
    <div className="stack att-admin">
      {confirm.dialog}
      <PageHeader
        title="Backups"
        subtitle="A copy of everything, taken while the application keeps running, written to a second location and checked there."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Backups' }]}
        actions={<Button variant="primary" icon="download" onClick={runNow} loading={running} disabled={!data || (data.settings.destination === 'folder' && !data.settings.folder)}>Back up now</Button>}
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data || !form ? <Loading lines={6} label="Loading backups" /> : (
        <>
          {lastRun?.status === 'failed' && (
            <div className="notice notice-warn" role="alert">
              The last backup, {formatDateTime(lastRun.started_at)}, failed: {lastRun.message}
            </div>
          )}
          <div className="grid-stats">
            <Stat
              label="Last good backup" icon="check-circle" color={!last || overdue ? 'red' : 'green'}
              value={last ? relativeTime(last.started_at) : 'None yet'}
              hint={last ? `${formatDateTime(last.started_at)}${overdue ? ' - overdue' : ''}` : 'Take one with Back up now'}
            />
            <Stat label="Schedule" icon="clock" value={data.settings.enabled ? `Daily at ${data.settings.time}` : 'Off'} hint={data.settings.enabled ? `${data.timeZone}; keeping ${data.settings.keep}` : 'Switch it on below'} />
            <Stat label="Goes to" icon="database" value={data.settings.destination === 's3' ? 'Object store' : 'Folder'} hint={<span className="att-break">{data.destination ?? 'Not chosen yet'}</span>} />
            <Stat label="Encryption" icon="lock" value={data.settings.encrypt ? 'On' : 'Off'} hint={data.keySource ? `Key: ${data.keySource}` : 'No key is set on the server'} color={data.settings.encrypt ? 'green' : undefined} />
          </div>

          <Card title="Schedule and destination">
            <form className="form" onSubmit={save}>
              <Switch
                label="Take a backup every day" checked={form.enabled} onChange={(v) => set('enabled', v)}
                hint="The server takes it while it keeps running: no one needs to be signed in and nothing stops. If a backup fails or none succeeds for two days, administrators are notified."
              />
              <div className="form-grid">
                <TextField label="Time of day" required value={form.time} onChange={(v) => set('time', v)} error={errors.time} placeholder="02:00" hint={`HH:mm, in ${data.timeZone}. Choose a quiet time: the application pauses for a moment while the database is read.`} />
                <NumberField label="Backups to keep" required min={1} max={365} value={form.keep} onChange={(v) => set('keep', v ?? 14)} error={errors.keep} hint="The newest ones at the destination; older ones are deleted after each good backup." />
                <Select
                  className="form-cell-wide" label="Write backups to" required value={form.destination} onChange={(v) => set('destination', v as Settings['destination'])} error={errors.destination}
                  options={[
                    { value: 'folder', label: 'A folder (another disk, or a network share)' },
                    { value: 's3', label: data.s3Available ? 'The object store set up on the File settings page' : 'The object store (set it up on the File settings page first)' },
                  ]}
                />
                {form.destination === 'folder' ? (
                  <TextField
                    className="form-cell-wide" label="Folder" required value={form.folder} onChange={(v) => set('folder', v)} error={errors.folder}
                    placeholder="D:\Backups\Sandpiper  or  \\fileserver\backups\sandpiper"
                    hint="A full path the server can write to, outside the data folder. Use another disk or machine, so one failure cannot take both."
                  />
                ) : (
                  <TextField className="form-cell-wide" label="Prefix in the object store" value={form.s3Prefix} onChange={(v) => set('s3Prefix', v)} error={errors.s3Prefix} hint="Backups are kept apart from attached files under this prefix." />
                )}
              </div>
              <Switch
                label="Encrypt each backup" checked={form.encrypt} onChange={(v) => set('encrypt', v)} error={errors.encrypt}
                hint={data.keySource
                  ? `With the ${data.keySource}. Keep a copy of that key somewhere safe and separate: without it the backups cannot be read.`
                  : 'Needs a key on the server: start it with GRC_BACKUP_KEY_FILE (make one with .\\grc.ps1 new-key), GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE.'}
              />
              <Switch
                label="Include the application's secret key" checked={form.includeSecretKey} onChange={(v) => set('includeSecretKey', v)} error={errors.includeSecretKey}
                disabled={!form.encrypt || !data.secretKeyFile}
                hint={`Encrypted backups only. The secret key protects second-factor keys and webhook secrets in the database and is kept outside the data folder. With this on, a restore puts it back too; with it off, keep a copy of it yourself.`}
              />
              <div className="form-actions">
                <Button type="submit" variant="primary" loading={saving}>Save backup settings</Button>
              </div>
            </form>
          </Card>

          <Card title="Recent backups" flush>
            {data.runs.length === 0 ? (
              <EmptyState icon="database" title="No backups taken yet" message="Choose where backups go, then use Back up now or switch on the daily backup." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">The last 20 backups taken by the server</caption>
                  <thead>
                    <tr><th>Started</th><th>Result</th><th>Backup</th><th className="num">Size</th><th>How</th></tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id}>
                        <td><span title={formatDateTime(r.started_at)}>{formatDateTime(r.started_at)}</span></td>
                        <td><StatusChip color={RESULT[r.status].color} label={RESULT[r.status].label} /></td>
                        <td className="att-run">
                          {r.archive_name ? <span className="att-break">{r.archive_name}</span> : null}
                          {r.message && <div className="att-run-message">{r.message}</div>}
                          {r.pruned.length > 0 && <div className="att-facts">{r.pruned.length} older removed</div>}
                        </td>
                        <td className="num">{r.bytes ? formatBytes(r.bytes) : '—'}</td>
                        <td>
                          {r.trigger === 'scheduled' ? 'Daily' : `By ${r.created_by_name ?? 'an administrator'}`}
                          {r.encrypted ? <div className="att-facts">Encrypted</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="att-facts">{data.secretKeyNote}</p>
          <p className="att-facts">
            To restore one, stop the server and run <code>.\grc.ps1 restore &lt;file&gt;</code> with the backup file (download it from the object store first).
            The data as it is now is kept as a safety copy. Files kept in the object store are not in these backups: use the store's own versioning.
          </p>
        </>
      )}
    </div>
  );
}
