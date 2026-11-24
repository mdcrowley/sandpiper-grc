// Administration > Background jobs (/admin/jobs): what the job queue has run, what failed, and the schedules.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Drawer, EmptyState, ErrorState, errorMessage, formatDateTime, KeyValue, Loading, PageHeader, qs, relativeTime,
  Select, Stat, StatusChip, TableWrap, useFetch, useToast,
} from '../../core';
import type { ColorName } from '../../core';
import './notifications.css';

type Status = 'queued' | 'running' | 'failed' | 'dead' | 'done';
interface Job {
  id: string;
  type: string;
  status: Status;
  attempts: number;
  max_attempts: number;
  run_at: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  locked_until: string | null;
  last_error: string | null;
  schedule: string | null;
}
interface Schedule { name: string; type: string; every_seconds: number; next_run_at: string; last_run_at: string | null; enabled: boolean; last_status: Status | null; handled: boolean }
interface JobsResponse {
  rows: Job[]; total: number; page: number; pageSize: number;
  counts: Record<Status, number>; schedules: Schedule[]; types: string[]; pollerRunning: boolean;
}
interface JobDetail extends Job { payload: unknown; result: unknown; handled: boolean; locked_by: string | null; backoff_seconds: number }

const STATUS: Record<Status, { color: ColorName; label: string }> = {
  queued: { color: 'blue', label: 'Waiting' },
  running: { color: 'teal', label: 'Running' },
  failed: { color: 'amber', label: 'Failed, will retry' },
  dead: { color: 'red', label: 'Gave up' },
  done: { color: 'green', label: 'Done' },
};
const TYPE_LABELS: Record<string, string> = {
  'mail.send': 'Send an email',
  'notifications.reminders': 'Daily reminders (actions due and other dates)',
  'notifications.email_digest': 'Daily email summaries',
  'jobs.cleanup': 'Clear out old jobs',
};
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t;
const everyText = (s: number) => (s % 86400 === 0 ? `Every ${s / 86400 === 1 ? 'day' : `${s / 86400} days`}`
  : s % 3600 === 0 ? `Every ${s / 3600 === 1 ? 'hour' : `${s / 3600} hours`}` : `Every ${Math.round(s / 60)} minutes`);
const when = (v: string | null) => (v ? <span title={formatDateTime(v)}>{relativeTime(v)}</span> : <span className="muted">—</span>);

function JobDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<JobDetail>(`/api/admin/jobs/${id}`);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      const after = await api.post<JobDetail>(`/api/admin/jobs/${id}/retry`);
      if (after.status === 'done') toast.success('The job ran again and finished.');
      else toast.error(`The job ran again and did not finish: ${after.last_error ?? STATUS[after.status].label}`);
      reload();
      onChanged();
    } catch (err) {
      // 409 already_queued: "A newer run of this job is waiting or running." Show that newer run in the list.
      toast.error(errorMessage(err));
      if (err instanceof ApiError && err.code === 'already_queued') onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open title={data ? typeLabel(data.type) : 'Job'} onClose={onClose} size="lg"
      footer={data && (data.status === 'failed' || data.status === 'dead')
        ? <Button variant="primary" icon="refresh" loading={busy} disabled={!data.handled} onClick={() => void retry()}>Try again now</Button>
        : undefined}
    >
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={6} label="Loading the job" /> : (
        <div className="stack">
          <KeyValue items={[
            { label: 'Status', value: <StatusChip color={STATUS[data.status].color} label={STATUS[data.status].label} /> },
            { label: 'Type', value: <span className="ml-mono">{data.type}</span> },
            { label: 'Attempts', value: `${data.attempts} of ${data.max_attempts}` },
            { label: 'Queued', value: formatDateTime(data.created_at) },
            { label: data.status === 'failed' ? 'Next attempt' : 'Run from', value: formatDateTime(data.run_at) },
            { label: 'Started', value: data.started_at ? formatDateTime(data.started_at) : '' },
            { label: 'Finished', value: data.finished_at ? formatDateTime(data.finished_at) : '' },
            { label: 'Schedule', value: data.schedule ?? '' },
          ]} />
          {!data.handled && <p className="notice notice-warn">No part of the application loaded on this server runs this type of job, so it waits.</p>}
          {data.last_error && (
            <div className="stack" style={{ gap: 'var(--s-1)' }}>
              <h3 className="card-title">Last error</h3>
              <p className="ml-error">{data.last_error}</p>
            </div>
          )}
          <div className="stack" style={{ gap: 'var(--s-1)' }}>
            <h3 className="card-title">Details</h3>
            <pre className="ml-payload">{JSON.stringify(data.payload, null, 2)}</pre>
          </div>
          {data.result !== null && data.result !== undefined && (
            <div className="stack" style={{ gap: 'var(--s-1)' }}>
              <h3 className="card-title">Result</h3>
              <pre className="ml-payload">{JSON.stringify(data.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** A problem with background work that the administrators were told about (E40-04). */
interface OpsAlert { key: string; title: string; detail: string | null; route: string | null; opened_at: string; last_seen_at: string; notified_at: string | null; occurrences: number }

/** Problems still open: background work that keeps failing. Each was told to administrators once. */
function OpenProblems() {
  const { data } = useFetch<{ alerts: OpsAlert[] }>('/api/admin/jobs/alerts');
  if (!data || data.alerts.length === 0) return null;
  return (
    <Card title="Problems being watched">
      <p className="muted">Administrators were told about each of these once, in the application and by email. Each clears by itself when the work succeeds again, and is told again if it comes back.</p>
      <ul className="ml-problems">
        {data.alerts.map((a) => (
          <li key={a.key} className="notice notice-warn">
            <div>
              <strong>{a.title}</strong>
              {a.detail && <div>{a.detail}</div>}
              <div className="muted">Since {formatDateTime(a.opened_at)}; last seen {relativeTime(a.last_seen_at)}{a.route && a.route !== '/admin/jobs' ? <> · <Link to={a.route}>Open</Link></> : null}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function JobsPage() {
  const toast = useToast();
  const [search, setSearch] = useSearchParams();
  const status = search.get('status') ?? '';
  const [page, setPage] = useState(1);
  const [running, setRunning] = useState('');
  const { data, error, reload, loading } = useFetch<JobsResponse>(`/api/admin/jobs${qs({ status, page, pageSize: 25 })}`, { keepPrevious: true });
  const open = search.get('job');
  const setParam = (key: string, value: string | null) => setSearch((p) => { if (value) p.set(key, value); else p.delete(key); return p; }, { replace: key === 'job' });

  const runNow = async (s: Schedule) => {
    setRunning(s.name);
    try {
      const job = await api.post<Job>(`/api/admin/jobs/schedules/${encodeURIComponent(s.name)}/run`);
      if (job.status === 'done') toast.success(`"${typeLabel(s.type)}" ran now.`);
      else toast.error(`"${typeLabel(s.type)}" did not finish: ${job.last_error ?? STATUS[job.status].label}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRunning('');
    }
  };

  return (
    <div className="stack ml-page">
      <PageHeader
        title="Background jobs"
        subtitle="Work the application does by itself: sending email, daily reminders and summaries. Failed jobs are retried; ones that keep failing wait here for you."
        actions={<Button icon="refresh" loading={loading} onClick={reload}>Refresh</Button>}
      />
      {error ? <ErrorState title="Jobs could not be loaded" error={error} onRetry={reload} /> : !data ? <Loading lines={10} label="Loading jobs" /> : (
        <>
          <div className="grid-stats">
            <Stat label="Waiting" value={data.counts.queued} color="blue" />
            <Stat label="Running" value={data.counts.running} color="teal" />
            <Stat label="Failed, will retry" value={data.counts.failed} color="amber" />
            <Stat label="Gave up" value={data.counts.dead} color="red" hint={data.counts.dead ? 'Open one to see why and try again' : undefined} />
            <Stat label="Done" value={data.counts.done} color="green" hint="Kept for 30 days" />
          </div>
          {!data.pollerRunning && (
            <p className="notice">The queue is not being worked on by this server process (it starts when the server starts listening). Jobs still run when you use <strong>Run now</strong> or <strong>Try again now</strong>.</p>
          )}

          <OpenProblems />

          <Card title="Schedules" flush>
            {data.schedules.length === 0 ? <EmptyState icon="clock" title="No schedules" message="Parts of the application add their own regular work here." /> : (
              <TableWrap label="Schedules">
                <table className="table ml-table">
                  <thead><tr><th scope="col">Work</th><th scope="col">How often</th><th scope="col">Last run</th><th scope="col">Next run</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.schedules.map((s) => (
                      <tr key={s.name}>
                        <td className="ml-wrap">{typeLabel(s.type)}<div className="muted ml-small ml-mono">{s.name}</div></td>
                        <td className="ml-small">{everyText(s.every_seconds)}</td>
                        <td className="ml-small">{when(s.last_run_at)}{s.last_status && <div><StatusChip color={STATUS[s.last_status].color} label={STATUS[s.last_status].label} /></div>}</td>
                        <td className="ml-small">{s.enabled ? when(s.next_run_at) : 'Switched off'}</td>
                        <td>
                          <Button size="sm" loading={running === s.name} disabled={!s.handled || running !== ''} onClick={() => void runNow(s)}
                            title={s.handled ? undefined : 'The part of the application that runs this is not loaded'}>Run now</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Recent jobs" flush>
            <div className="ml-toolbar" style={{ padding: 'var(--s-3) var(--s-4) 0' }}>
              <Select
                label="Status" value={status} placeholder="Any status"
                options={[{ value: '', label: 'Any status' }, ...(Object.keys(STATUS) as Status[]).map((s) => ({ value: s, label: STATUS[s].label, color: STATUS[s].color }))]}
                onChange={(v) => { setParam('status', v || null); setPage(1); }}
              />
            </div>
            {data.total === 0 ? (
              <EmptyState icon="check-circle" title={status ? 'No jobs with this status' : 'No jobs yet'} message={status === 'dead' ? 'Nothing has given up. Good.' : 'Jobs appear here as the application queues work.'} />
            ) : (
              <TableWrap label="Recent jobs" style={{ marginTop: 'var(--s-3)' }}>
                <table className="table ml-table">
                  <thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Queued</th><th scope="col">Finished or next</th></tr></thead>
                  <tbody>
                    {data.rows.map((j) => (
                      <tr key={j.id}>
                        <td className="ml-wrap">
                          <button type="button" className="ml-link-button" onClick={() => setParam('job', j.id)}>{typeLabel(j.type)}</button>
                          {j.last_error && j.status !== 'done' && <div className="ml-error">{j.last_error}</div>}
                        </td>
                        <td><StatusChip color={STATUS[j.status].color} label={STATUS[j.status].label} /></td>
                        <td className="num">{j.attempts} / {j.max_attempts}</td>
                        <td className="ml-small">{when(j.created_at)}</td>
                        <td className="ml-small">{j.status === 'done' || j.status === 'dead' ? when(j.finished_at) : when(j.run_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          {data.total > data.pageSize && (
            <div className="ntf-pager">
              <span className="muted">Page {data.page} of {Math.ceil(data.total / data.pageSize)} · {data.total} jobs</span>
              <Button size="sm" icon="chevron-left" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
              <Button size="sm" disabled={data.page * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>Older</Button>
            </div>
          )}
        </>
      )}
      {open && <JobDrawer id={open} onClose={() => setParam('job', null)} onChanged={reload} />}
    </div>
  );
}
