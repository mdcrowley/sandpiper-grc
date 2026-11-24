// Audit log > Archive old events (E40-06): off by default. When on, events older than a number of
// months are written to a checked file in a folder outside the data folder, then removed; the archive
// itself is an audit event. Administrators only; changing it needs a recent password confirmation.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, errorMessage, formatDate, formatDateTime, NumberField, StatusChip, Switch, TextField, useFetch, useToast,
} from '../../core';
import { withReauth } from '../../core/reauth';

interface ArchiveSettings { enabled: boolean; olderThanMonths: number; folder: string }
interface ArchiveOverview {
  settings: ArchiveSettings;
  permitted: boolean;
  /** The command that archives as the database owner (E40-14). */
  ownerCommand?: string;
  oldest: string | null;
  runs: { id: number; at: string; summary: string | null }[];
  job: { id: string; status: string; last_error: string | null; result: { status?: string; events?: number; removed?: number; stage?: string } | null } | null;
}

const JOB_LABEL: Record<string, { label: string; color: 'blue' | 'green' | 'red' | 'gray' }> = {
  queued: { label: 'Waiting to start', color: 'blue' },
  running: { label: 'Running', color: 'blue' },
  failed: { label: 'Will try again', color: 'red' },
  dead: { label: 'Failed', color: 'red' },
  done: { label: 'Finished', color: 'green' },
};

export function AuditArchiveCard() {
  const toast = useToast();
  const { data, error, reload } = useFetch<ArchiveOverview>('/api/audit/archive');
  const [form, setForm] = useState<ArchiveSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => { if (data) setForm(data.settings); }, [data]);
  // While a run waits or runs, follow it.
  const active = data?.job && ['queued', 'running'].includes(data.job.status);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(reload, 2000);
    return () => window.clearInterval(timer);
  }, [active, reload]);

  if (error) return null; // not an administrator: the card is not shown
  if (!data || !form) return null;
  const set = <K extends keyof ArchiveSettings>(k: K, v: ArchiveSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await withReauth(() => api.put('/api/audit/archive', form));
      toast.success(form.enabled ? `Events older than ${form.olderThanMonths} months will be archived every day.` : 'Archive settings saved. Nothing is archived.');
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
      await api.post('/api/audit/archive/run', {});
      toast.success('The archive has started. This page follows it.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const job = data.job;
  const jobState = job ? JOB_LABEL[job.status] ?? { label: job.status, color: 'gray' as const } : null;

  return (
    <Card
      title="Archive old events"
      actions={data.settings.enabled && data.permitted ? <Button size="sm" icon="folder" loading={starting} disabled={Boolean(active)} onClick={() => void runNow()}>Archive now</Button> : undefined}
    >
      <form className="form" onSubmit={save}>
        <p className="muted">
          Off unless you switch it on: until then no event is ever removed. When on, every day the events older than the age below are written to a
          compressed file in the folder you choose, the file is read back and checked, and only then are those events removed. The archive is
          itself recorded here as an event. {data.oldest ? `The oldest event now is from ${formatDate(data.oldest)}.` : ''}
        </p>
        {!data.permitted && (
          <div className="notice notice-warn" role="alert">
            The database account the server uses may not remove audit events (a least-privilege set-up), so the server does not archive by
            itself. Switch the archive on and choose the age and folder here, then have the database owner run it from a scheduled task, for
            example once a week: <code>{data.ownerCommand ?? 'npm run cli -- audit-archive'}</code>. Administrators are told if old events
            wait more than a month past the age below.
          </div>
        )}
        <Switch label={data.permitted ? 'Archive old events every day' : 'Archive old events (run by the database owner)'} checked={form.enabled} onChange={(v) => set('enabled', v)} />
        <div className="form-grid">
          <NumberField
            label="Archive events older than (months)" required min={12} max={1200} value={form.olderThanMonths}
            onChange={(v) => set('olderThanMonths', v ?? 84)} error={errors.olderThanMonths}
            hint="At least 12. Match your retention schedule: the default, 84, is seven years."
          />
          <TextField
            className="form-cell-wide" label="Folder for archive files" value={form.folder} onChange={(v) => set('folder', v)} error={errors.folder}
            placeholder="D:\Archive\Sandpiper  or  /srv/archive/sandpiper"
            hint="A full path the server can write to, outside the data folder. Keep it with your other long-term records; the files are not in backups once removed here."
          />
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={saving}>Save archive settings</Button>
        </div>
      </form>
      {job && jobState && (
        <p className="adm-archive-job" role="status">
          Last run: <StatusChip color={jobState.color} label={jobState.label} />
          {job.status === 'running' && job.result?.events ? ` ${job.result.events.toLocaleString('en-US')} events ${job.result.stage === 'removing' ? `written, ${(job.result.removed ?? 0).toLocaleString('en-US')} removed` : 'written so far'}.` : ''}
          {job.status === 'done' && job.result?.status === 'nothing' ? ' Nothing was old enough.' : ''}
          {job.status === 'done' && job.result?.status === 'off' ? ' The archive was off.' : ''}
          {job.last_error && job.status !== 'done' ? ` ${job.last_error}` : ''}
        </p>
      )}
      {data.runs.length > 0 && (
        <ul className="adm-archive-runs">
          {data.runs.map((r) => <li key={r.id}><span className="muted">{formatDateTime(r.at)}</span> {r.summary}</li>)}
        </ul>
      )}
    </Card>
  );
}
