// Long file work run as background jobs (E14-27): scanning files attached without a scan, and
// moving every file to the other store. Both are started here and followed while they run; the
// application keeps working meanwhile. The same jobs show under Administration > Background jobs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Button, Card, errorMessage, formatDateTime, ProgressBar, useFetch, useToast } from '../../core';
import type { FilesOverview } from './adminTypes';
import { usePasswordConfirm } from './confirm';

interface Job {
  id: string;
  status: 'queued' | 'running' | 'failed' | 'dead' | 'done';
  progress: Record<string, number | string> | null;
  error: string | null;
  to: 'disk' | 's3' | null;
  created_at: string;
  finished_at: string | null;
}
interface Background { rescan: Job | null; move: Job | null; notScanned: number; scanning: boolean; poller: boolean }

const busy = (j: Job | null | undefined) => Boolean(j && (j.status === 'queued' || j.status === 'running'));
const n = (v: unknown) => (typeof v === 'number' ? v : 0);
const where = (to: string | null) => (to === 's3' ? 'the object store' : 'the local disk');

/** The latest scan and move, polled every few seconds while one is waiting or running. */
function useBackground(onFinished: () => void) {
  const { data, error, reload } = useFetch<Background>('/api/attachments/admin/background');
  const running = busy(data?.rescan) || busy(data?.move);
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [running, reload]);
  useEffect(() => {
    if (wasRunning && !running) onFinished();
    setWasRunning(running);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return { data, error, reload };
}

function Waiting({ job, poller }: { job: Job; poller: boolean }) {
  if (job.status !== 'queued') return null;
  return (
    <p className="att-facts">
      Waiting to start.{poller ? '' : ' The background job runner is not running in this server process, so it starts when one runs it.'}
    </p>
  );
}

function Failed({ job }: { job: Job }) {
  if (job.status !== 'failed' && job.status !== 'dead') return null;
  return (
    <div className="notice notice-warn" role="status">
      It stopped: {job.error ?? 'no reason was given'}. See <Link to="/admin/jobs?status=dead">Background jobs</Link>, then start it again.
    </div>
  );
}

export function RescanCard({ overview, onDone }: { overview: FilesOverview; onDone: () => void }) {
  const toast = useToast();
  const { data, reload } = useBackground(onDone);
  const [starting, setStarting] = useState(false);
  const job = data?.rescan ?? null;
  const p = job?.progress ?? {};
  const scannerOff = overview.activeScanner === 'none';

  const start = async () => {
    setStarting(true);
    try {
      await api.post('/api/attachments/admin/rescan/start', {});
      toast.success('The scan has started. You can leave this page; it carries on.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card title="Files attached without a scan">
      <div className="stack">
        <p className="att-facts">
          {overview.usage.notScanned === 0
            ? 'Every file in use has been scanned.'
            : `${overview.usage.notScanned} file${overview.usage.notScanned === 1 ? ' was' : 's were'} attached without a scan. Scanning them removes any that contain malware and tells administrators. It runs in the background.`}
        </p>
        {job && busy(job) && (
          <>
            <ProgressBar label="Scanning earlier files" value={n(p.checked)} max={Math.max(1, n(p.total))} valueText={`${n(p.checked)} of ${n(p.total)}`} animated striped />
            <Waiting job={job} poller={Boolean(data?.poller)} />
          </>
        )}
        {job?.status === 'done' && (
          <div className={n(p.infected) ? 'notice notice-warn' : 'notice notice-success'} role="status">
            Last scan, finished {job.finished_at ? formatDateTime(job.finished_at) : ''}: {n(p.checked)} checked, {n(p.clean)} clean,
            {' '}{n(p.infected)} infected and removed{n(p.errors) ? `, ${n(p.errors)} could not be checked` : ''}.
            {n(p.remaining) ? ` ${n(p.remaining)} still to scan.` : ''}
          </div>
        )}
        {job && <Failed job={job} />}
        <div className="row">
          <Button onClick={() => void start()} loading={starting} disabled={scannerOff || overview.usage.notScanned === 0 || busy(job)}>
            Scan files attached earlier
          </Button>
          {scannerOff && <span className="att-facts">Switch scanning on first.</span>}
        </div>
      </div>
    </Card>
  );
}

export function MoveFilesCard({ overview, onDone }: { overview: FilesOverview; onDone: () => void }) {
  const toast = useToast();
  const confirm = usePasswordConfirm();
  const { data, reload } = useBackground(onDone);
  const [starting, setStarting] = useState(false);
  const job = data?.move ?? null;
  const p = job?.progress ?? {};
  const target = overview.storage.driver;
  const toMove = overview.usage.byDriver.filter((d) => (target === 's3' ? d.driver !== 's3' : d.driver === 's3')).reduce((a, d) => a + d.files, 0);

  const start = async () => {
    setStarting(true);
    try {
      await confirm.run(() => api.post('/api/attachments/admin/storage/move', { to: target }));
      toast.success(`Moving files to ${where(target)}. You can leave this page; it carries on.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card title="Move stored files">
      {confirm.dialog}
      <div className="stack">
        <p className="att-facts">
          New files go to {where(target)}. {toMove
            ? `${toMove} file${toMove === 1 ? ' is' : 's are'} kept in the other place and stay readable there; moving them copies each one, checks the copy, then removes the original. The application keeps working meanwhile.`
            : 'Every stored file is already there.'}
        </p>
        {job && busy(job) && (
          <>
            <ProgressBar
              label={`Moving files to ${where(job.to)}`} value={n(p.moved) + n(p.failed)} max={Math.max(1, n(p.total))}
              valueText={`${n(p.moved) + n(p.failed)} of ${n(p.total)}`} animated striped
            />
            <Waiting job={job} poller={Boolean(data?.poller)} />
          </>
        )}
        {job?.status === 'done' && (
          <div className={n(p.failed) ? 'notice notice-warn' : 'notice notice-success'} role="status">
            Last move to {where(job.to)}, finished {job.finished_at ? formatDateTime(job.finished_at) : ''}: {n(p.moved)} moved
            {n(p.failed) ? `, ${n(p.failed)} could not be moved (see the server log) and are still readable where they were` : ''}.
          </div>
        )}
        {job && <Failed job={job} />}
        <div className="row">
          <Button onClick={() => void start()} loading={starting} disabled={!toMove || busy(job) || (target === 's3' && Boolean(overview.s3Problem))}>
            Move files to {where(target)}
          </Button>
        </div>
      </div>
    </Card>
  );
}
