// Bulk import of a document package (E43-11): a .zip with the files and a manifest.csv of one row
// per version. A dry run first shows what each row would do, with conversion warnings, and changes
// nothing; then the same package is loaded. With data load mode on, the dates and statuses in the
// manifest are kept and nobody is notified.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, Notice, PageHeader, ProgressBar, Stat, StatusChip,
  TableWrap, useAuth, useFetch, useToast,
} from '../../../core';
import { DocumentsTabs } from './DocumentsTabs';
import { uploadInParts, type Upload } from './upload';

interface ImportResult { row: number; doc_number: string | null; version: string | number | null; file: string | null; ok: boolean; action: string | null; message: string | null; warnings?: string[] }
interface ImportJob {
  id: string; status: 'running' | 'done' | 'failed'; dry_run: boolean; file_name: string | null; file_count: number | null;
  summary: { rows: number; ok: number; errors: number; documents_created: number; documents_updated: number; versions_created: number; skipped_files: number } | null;
  results: ImportResult[] | null; created_at: string; finished_at: string | null; error?: string | null;
}

export const MANIFEST_COLUMNS = [
  'doc_number', 'title', 'document_type', 'department', 'owner', 'parent_number', 'access', 'access_departments', 'access_roles', 'version',
  'version_label', 'status', 'approved_on', 'effective_on', 'superseded_on', 'withdrawn_on', 'approved_by_name', 'approval_body',
  'approval_reference', 'change_summary', 'file',
];

/** Follows an import job until it is no longer running. */
function useJob(id: string | null) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!id) { setJob(null); return undefined; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const j = await api.get<ImportJob>(`/api/documents/imports/${id}`);
        if (!live) return;
        setJob(j);
        if (j.status === 'running') timer = setTimeout(() => void poll(), 1500);
      } catch (err) {
        if (live) setError(err);
      }
    };
    void poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [id]);
  return { job, error };
}

function Results({ job }: { job: ImportJob }) {
  const s = job.summary;
  const rows = job.results ?? [];
  return (
    <div className="stack">
      {s && (
        <div className="grid-stats">
          <Stat label="Rows" value={s.rows} size="sm" />
          <Stat label="Without problems" value={s.ok} color="green" size="sm" />
          <Stat label="With errors" value={s.errors} color={s.errors ? 'red' : undefined} size="sm" />
          <Stat label={job.dry_run ? 'Documents to create' : 'Documents created'} value={s.documents_created} size="sm" />
          <Stat label={job.dry_run ? 'Versions to create' : 'Versions created'} value={s.versions_created} size="sm" />
          {s.skipped_files > 0 && <Stat label="Files not in the manifest" value={s.skipped_files} color="amber" size="sm" />}
        </div>
      )}
      {rows.length > 0 && (
        <TableWrap label="Result of each manifest row" fit>
          <table className="table">
            <caption className="sr-only">Result of each manifest row</caption>
            <thead><tr>
              <th scope="col" data-priority="1">Row</th><th scope="col" data-priority="1">Number</th><th scope="col" data-priority="2">Version</th>
              <th scope="col" data-priority="3">File</th><th scope="col" data-priority="1">Result</th><th scope="col" data-priority="1">Message</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.doc_number ?? '—'}</td>
                  <td>{r.version ?? '—'}</td>
                  <td className="pol-wrap">{r.file ?? '—'}</td>
                  <td>{r.ok ? <StatusChip color="green" label={r.action ?? 'OK'} /> : <StatusChip color="red" label="Error" />}</td>
                  <td className="pol-wrap">
                    {r.message ?? ''}
                    {(r.warnings ?? []).length > 0 && <ul className="doc-warnings">{r.warnings!.map((w) => <li key={w}>{w}</li>)}</ul>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

export function DocumentImport() {
  const { dataLoadUntil } = useAuth();
  const toast = useToast();
  const input = useRef<HTMLInputElement | null>(null);
  const history = useFetch<ImportJob[] | { rows: ImportJob[] }>('/api/documents/imports');
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { job, error } = useJob(jobId);

  const start = async (dryRun: boolean, up: Upload, f: File) => {
    setBusy(true);
    setMessage('');
    try {
      let use = up;
      let out: { id: string };
      try {
        out = await api.post<{ id: string }>('/api/documents/imports', { upload_id: use.id, dry_run: dryRun });
      } catch (err) {
        // A package already used by a dry run is sent again for the real load.
        if (!(err instanceof ApiError) || !['upload_used', 'not_found'].includes(err.code)) throw err;
        setProgress(0);
        use = await uploadInParts(f, setProgress);
        setUpload(use);
        setProgress(null);
        out = await api.post<{ id: string }>('/api/documents/imports', { upload_id: use.id, dry_run: dryRun });
      }
      setJobId(out.id);
      if (!dryRun) toast.success('Loading started. The results appear below when it finishes.');
      history.reload();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f); setUpload(null); setJobId(null); setMessage(''); setProgress(0);
    try {
      const up = await uploadInParts(f, setProgress);
      setUpload(up);
      setProgress(null);
      await start(true, up, f);
    } catch (err) {
      setMessage(errorMessage(err));
      setProgress(null);
    }
  };

  const past = Array.isArray(history.data) ? history.data : history.data?.rows ?? [];
  const dryDone = job?.status === 'done' && job.dry_run;

  return (
    <div className="stack">
      <PageHeader
        title="Import documents"
        subtitle="Load a whole document package at once: the files in a .zip, with a manifest that says what each file is."
      />
      <DocumentsTabs active="import" />
      {dataLoadUntil
        ? <Notice tone="info" title="Data load mode is on">Dates, statuses and numbers in the manifest are kept as given, historical versions create no acknowledgment requests, and nobody is notified. Every record loaded can be undone under Administration &gt; Data loads.</Notice>
        : <Notice tone="warning">Data load mode is off: versions are loaded as drafts under today's date. Switch it on under Administration &gt; Data loads to keep the package's own dates and statuses.</Notice>}
      <Card title="Package">
        <div className="stack">
          <p className="muted">
            The .zip holds the documents' files (.docx are converted to text; .pdf and .doc are kept as files) and a <code>manifest.csv</code> with one row per version.
            Its columns: {MANIFEST_COLUMNS.map((c, i) => <span key={c}><code>{c}</code>{i < MANIFEST_COLUMNS.length - 1 ? ', ' : '.'}</span>)}
          </p>
          <input ref={input} type="file" className="sr-only" accept=".zip" aria-label="Choose the package" onChange={(e) => void choose(e)} />
          <span className="row">
            <Button icon="upload" variant={file ? 'secondary' : 'primary'} disabled={progress !== null || busy} onClick={() => input.current?.click()}>
              {file ? 'Choose another package' : 'Choose a package'}
            </Button>
            {file && <span>{file.name}</span>}
          </span>
          {progress !== null && <ProgressBar value={Math.round(progress * 100)} label="Upload progress" />}
          {message && <Notice tone="error">{message}</Notice>}
        </div>
      </Card>
      {jobId && (
        <Card title={job ? (job.dry_run ? 'Dry run: nothing has been changed' : 'Loaded') : 'Checking the package'}
          actions={dryDone && upload && file ? <Button variant="primary" loading={busy} disabled={(job?.summary?.ok ?? 0) === 0} onClick={() => void start(false, upload, file)}>Load the package</Button> : undefined}>
          {error ? <ErrorState error={error} /> : !job || job.status === 'running' ? <Loading lines={4} label="Working through the manifest" />
            : job.status === 'failed' ? <Notice tone="error">{job.error ?? 'The package could not be read.'}</Notice>
            : (
              <div className="stack">
                {dryDone && (job.summary?.errors ?? 0) > 0 && <Notice tone="warning">Rows with errors are left out when loading. Correct the manifest and choose the package again to include them.</Notice>}
                {!job.dry_run && <p><Link to="/documents/register">Open the register</Link> to see what was loaded.</p>}
                <Results job={job} />
              </div>
            )}
        </Card>
      )}
      <Card title="Earlier imports" flush>
        {history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : !history.data ? <Loading lines={3} />
          : !past.length ? <EmptyState icon="upload" title="No imports yet" message="Each dry run and load is listed here with its results." />
          : (
            <TableWrap label="Earlier imports" fit>
              <table className="table">
                <caption className="sr-only">Earlier imports</caption>
                <thead><tr>
                  <th scope="col" data-priority="1">Started</th><th scope="col" data-priority="1">Package</th><th scope="col" data-priority="1">Kind</th>
                  <th scope="col" data-priority="2">Rows</th><th scope="col" data-priority="2">Errors</th><th scope="col" data-priority="1">Status</th>
                  <th scope="col" data-priority="1"><span className="sr-only">Results</span></th>
                </tr></thead>
                <tbody>
                  {past.map((j) => (
                    <tr key={j.id}>
                      <td>{formatDateTime(j.created_at)}</td>
                      <td className="pol-wrap">{j.file_name ?? '—'}</td>
                      <td>{j.dry_run ? 'Dry run' : 'Load'}</td>
                      <td>{j.summary?.rows ?? '—'}</td>
                      <td>{j.summary?.errors ?? '—'}</td>
                      <td><StatusChip color={j.status === 'done' ? 'green' : j.status === 'failed' ? 'red' : 'blue'} label={j.status === 'done' ? 'Finished' : j.status === 'failed' ? 'Failed' : 'Running'} /></td>
                      <td><Button size="sm" variant="ghost" onClick={() => setJobId(j.id)}>Show<span className="sr-only"> the results of {j.file_name ?? 'this import'}</span></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
    </div>
  );
}
