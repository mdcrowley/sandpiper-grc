// Administration > Backups: the daily backup the server takes to a second location, its
// schedule, destination, retention and encryption, the last results, and "Back up now", which runs
// as a background job that this page follows (E40-11). On a PostgreSQL server, also the database
// dumps made by deploy/postgres/pg-backup.sh, which the server checks and records.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, NumberField, PageHeader,
  relativeTime, Select, Stat, StatusChip, Switch, TableWrap, TextField, useFetch, useToast,
} from '../../core';
import type { BackupProgress, BackupRun, BackupSettings as Settings, BackupsOverview } from './adminTypes';
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

/** One line about how far a running backup has got. */
export function progressText(p: BackupProgress | null | undefined): string {
  if (!p) return 'Starting.';
  switch (p.stage) {
    case 'export':
      return p.total ? `Copying the database: ${p.done ?? 0} of ${p.total} tables${p.rows ? ` (${p.rows.toLocaleString('en-US')} rows)` : ''}.` : 'Copying the database.';
    case 'files': return 'Copying attached files.';
    case 'archive': return 'Packing the backup into one file.';
    case 'upload': return 'Writing it to the destination.';
    case 'check': return 'Reading it back from the destination and checking it.';
    case 'prune': return 'Removing older backups beyond the number to keep.';
    default: return 'Starting.';
  }
}

export function BackupSettings() {
  const toast = useToast();
  const confirm = usePasswordConfirm();
  const { data, error, reload } = useFetch<BackupsOverview>('/api/backups');
  const [form, setForm] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  /** The job of a "Back up now" this page started, until its result is told. */
  const following = useRef<string | null>(null);

  useEffect(() => { if (data) setForm(data.settings); }, [data]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  // While a backup waits or runs, look again every two seconds.
  const busy = Boolean(data && (data.running || data.queued));
  useEffect(() => {
    if (!busy) return undefined;
    const timer = window.setInterval(reload, 2000);
    return () => window.clearInterval(timer);
  }, [busy, reload]);

  // The backup this page started has finished: say how it went.
  useEffect(() => {
    const id = following.current;
    if (!id || !data || busy) return;
    const run = data.runs.find((r) => r.job_id === id);
    if (!run) return;
    following.current = null;
    if (run.status === 'ok') toast.success(`Backed up and checked: ${run.archive_name} (${formatBytes(run.bytes ?? 0)}).`);
    else toast.error(run.message ?? 'The backup failed.');
  }, [data, busy, toast]);

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
    setStarting(true);
    try {
      const { jobId } = await api.post<{ jobId: string }>('/api/backups/run', {});
      following.current = jobId;
      toast.success('The backup has started. This page follows it; you may leave it.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const last = data?.lastSuccess;
  const overdue = last ? ageHours(last.started_at) > 48 : false;
  const lastRun = data?.runs.find((r) => r.status !== 'running');
  const showPg = Boolean(data && (data.postgres || data.settings.pgDumpFolder));

  return (
    <div className="stack att-admin">
      {confirm.dialog}
      <PageHeader
        title="Backups"
        subtitle="A copy of everything, taken while the application keeps running, written to a second location and checked there."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Backups' }]}
        actions={(
          <Button
            variant="primary" icon="download" onClick={runNow} loading={starting || busy}
            disabled={!data || busy || (data.settings.destination === 'folder' && !data.settings.folder)}
          >
            {busy ? 'Backing up' : 'Back up now'}
          </Button>
        )}
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data || !form ? <Loading lines={6} label="Loading backups" /> : (
        <>
          {(data.active || data.queued) && (
            <div className="notice" role="status" aria-live="polite">
              {data.active
                ? <>Backing up, started {formatDateTime(data.active.started_at)}{data.active.created_by_name ? ` by ${data.active.created_by_name}` : ''}. {progressText(data.active.progress)}</>
                : <>The backup is waiting for the server's background jobs to start it.</>}
            </div>
          )}
          {!busy && lastRun?.status === 'failed' && (
            <div className="notice notice-warn" role="alert">
              The last backup, {formatDateTime(lastRun.started_at)}, failed: {lastRun.message}
            </div>
          )}
          {showPg && data.pgDumpOverdue && (
            <div className="notice notice-warn" role="alert">
              {data.lastPgDump
                ? `The newest checked PostgreSQL dump is from ${formatDateTime(data.lastPgDump.started_at)}, older than ${data.settings.pgDumpMaxAgeHours} hours.`
                : 'No checked PostgreSQL dump has been found yet.'} Check the schedule of the backup script.
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
            {showPg && (
              <Stat
                label="Last PostgreSQL dump" icon="database" color={data.pgDumpOverdue ? 'red' : 'green'}
                value={data.lastPgDump ? relativeTime(data.lastPgDump.started_at) : 'None found'}
                hint={data.lastPgDump ? formatDateTime(data.lastPgDump.started_at) : data.settings.pgDumpFolder ? 'Run the backup script' : 'Set the dump folder below'}
              />
            )}
          </div>

          <Card title="Schedule and destination">
            <form className="form" onSubmit={save}>
              <Switch
                label="Take a backup every day" checked={form.enabled} onChange={(v) => set('enabled', v)}
                hint="The server takes it while it keeps running: no one needs to be signed in and nothing stops. If a backup fails or none succeeds for two days, administrators are notified."
              />
              <div className="form-grid">
                <TextField label="Time of day" required value={form.time} onChange={(v) => set('time', v)} error={errors.time} placeholder="03:30" hint={`HH:mm, in ${data.timeZone}. Choose a quiet time: with the built-in database the application pauses briefly while the backup takes its snapshot.`} />
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
              {showPg && (
                <fieldset className="att-fieldset">
                  <legend>PostgreSQL database dumps</legend>
                  <p className="att-facts">
                    On a PostgreSQL server, take the database's own backup with <code>deploy/postgres/pg-backup.sh</code> on a schedule. Name the folder it
                    writes to, as the server sees it: each new dump is checked against the record the script writes beside it, and administrators are told
                    when the newest good one is older than the limit.
                  </p>
                  <div className="form-grid">
                    <TextField
                      className="form-cell-wide" label="Dump folder" value={form.pgDumpFolder} onChange={(v) => set('pgDumpFolder', v)} error={errors.pgDumpFolder}
                      placeholder="/srv/backups/grc" hint="Leave empty to stop checking."
                    />
                    <NumberField
                      label="Warn when the newest is older than (hours)" min={1} max={720} value={form.pgDumpMaxAgeHours}
                      onChange={(v) => set('pgDumpMaxAgeHours', v ?? 26)} error={errors.pgDumpMaxAgeHours} hint="26 suits a daily dump."
                    />
                  </div>
                </fieldset>
              )}
              <div className="form-actions">
                <Button type="submit" variant="primary" loading={saving}>Save backup settings</Button>
              </div>
            </form>
          </Card>

          <Card title="Recent backups" flush>
            {data.runs.length === 0 ? (
              <EmptyState icon="database" title="No backups taken yet" message="Choose where backups go, then use Back up now or switch on the daily backup." />
            ) : (
              <TableWrap label="The last 20 backups taken by the server">
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
                          {r.status === 'running' && <div className="att-run-message">{progressText(r.progress)}</div>}
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
              </TableWrap>
            )}
          </Card>

          {showPg && (
            <Card title="PostgreSQL dumps checked" flush>
              {data.pgDumps.length === 0 ? (
                <EmptyState icon="database" title="No dumps checked yet" message={data.settings.pgDumpFolder ? 'Run deploy/postgres/pg-backup.sh; new dumps are checked within five minutes.' : 'Set the dump folder above.'} />
              ) : (
                <TableWrap label="The last 10 PostgreSQL dumps checked">
                  <table className="table">
                    <caption className="sr-only">The last 10 PostgreSQL dumps checked</caption>
                    <thead><tr><th>Taken</th><th>Result</th><th>Dump</th><th className="num">Size</th></tr></thead>
                    <tbody>
                      {data.pgDumps.map((r) => (
                        <tr key={r.id}>
                          <td>{formatDateTime(r.started_at)}</td>
                          <td><StatusChip color={RESULT[r.status].color} label={RESULT[r.status].label} /></td>
                          <td className="att-run">
                            <span className="att-break">{r.archive_name}</span>
                            {r.message && <div className="att-run-message">{r.message}</div>}
                          </td>
                          <td className="num">{r.bytes ? formatBytes(r.bytes) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          )}
          <p className="att-facts">{data.secretKeyNote}</p>
          <p className="att-facts">
            To restore one, stop the server and run <code>.\grc.ps1 restore &lt;file&gt;</code> with the backup file (download it from the object store first).
            The data as it is now is kept as a safety copy. Files kept in the object store are not in these backups: use the store's own versioning.
            The recovery runbook in the operations guide says what to do, in order, after losing the server.
          </p>
        </>
      )}
    </div>
  );
}
