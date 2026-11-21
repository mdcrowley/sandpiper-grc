// Review areas: the sets of funder review areas loaded from files, and loading a new one.
import { useId, useState } from 'react';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, PageHeader, useAuth, useFetch, useToast,
} from '../../core';
import { FundingTabs } from './shared';

interface AreaSet { id: string; name: string; version: string; description: string | null; source_file: string | null; updated_at: string; areas: number; reviews: number }
interface ImportResult { set_id: string | null; name: string; version: string; created: boolean; dry_run: boolean; areas: { total: number; added: number; updated: number; unchanged: number }; not_in_file: string[] }

function SetAreas({ id }: { id: string }) {
  const { data, error, reload } = useFetch<Omit<AreaSet, 'areas'> & { areas: { code: string; title: string; description: string | null; questions: string[] }[] }>(`/api/funding/review-area-sets/${id}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  return (
    <ol className="fd-set-areas">
      {data.areas.map((a) => (
        <li key={a.code}>
          <strong><span className="ref">{a.code}</span> {a.title}</strong>
          {a.description && <span className="muted fd-block fd-small">{a.description}</span>}
          {a.questions.length > 0 && <ul className="fd-small">{a.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
        </li>
      ))}
    </ol>
  );
}

function Loader({ onLoaded }: { onLoaded: () => void }) {
  const toast = useToast();
  const inputId = useId();
  const [file, setFile] = useState<{ name: string; content: unknown } | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async (content: unknown, sourceFile: string, dryRun: boolean) => {
    setBusy(true); setProblems([]);
    try {
      const r = await api.post<ImportResult>('/api/funding/review-area-sets/import', { file: content, dryRun, source_file: sourceFile });
      if (dryRun) setCheck(r);
      else {
        toast.success(`Review areas "${r.name}" loaded: ${r.areas.added} added, ${r.areas.updated} updated.`);
        setFile(null); setCheck(null); onLoaded();
      }
    } catch (err) {
      const list = err instanceof ApiError && err.fields?.file ? err.fields.file.split('\n') : [];
      setProblems(list.length ? list : [errorMessage(err)]);
    } finally { setBusy(false); }
  };

  const choose = async (f: File | undefined) => {
    setCheck(null); setProblems([]);
    if (!f) { setFile(null); return; }
    try {
      const content = JSON.parse(await f.text());
      setFile({ name: f.name, content });
      await send(content, f.name, true);
    } catch {
      setFile(null);
      setProblems(['The file is not valid JSON. Save the review areas as a JSON file in the format described below.']);
    }
  };

  const sample = async () => {
    try {
      const content = await api.get<unknown>('/api/funding/review-area-sets/sample');
      await send(content, 'review-areas.sample.json', false);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <Card title="Load review areas from a file">
      <div className="stack">
        <p className="muted">
          A funder's review areas are loaded from a JSON file: a name, an optional version, and a list of areas, each with a code, a title,
          an optional description and its questions. Loading the same name and version again updates the areas and adds new ones; none is removed.
        </p>
        <pre className="fd-format">{`{ "name": "Funder review areas", "version": "2027",
  "areas": [ { "code": "FM", "title": "Financial management",
               "questions": ["Are award funds recorded separately?"] } ] }`}</pre>
        <div className="fd-inline">
          <label className="fd-file" htmlFor={inputId}>
            <span>Choose a file</span>
            <input id={inputId} type="file" accept=".json,application/json" onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
          <Button loading={busy && !file} onClick={sample}>Load the invented sample</Button>
        </div>
        {problems.length > 0 && (
          <div className="notice notice-warn" role="alert">
            <strong>The file cannot be loaded as it stands:</strong>
            <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
        {check && file && (
          <div className="notice" role="status">
            <p><strong>{check.name}{check.version ? ` ${check.version}` : ''}</strong>: {check.areas.total} areas.{' '}
              {check.created ? 'A new set.' : `Already loaded: ${check.areas.added} new, ${check.areas.updated} changed, ${check.areas.unchanged} unchanged.`}
              {check.not_in_file.length > 0 && ` Not in the file (kept): ${check.not_in_file.join(', ')}.`}</p>
            <div className="form-actions">
              <Button onClick={() => { setFile(null); setCheck(null); }}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => send(file.content, file.name, false)}>Load {check.areas.total} areas</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ReviewAreas() {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<AreaSet[]>('/api/funding/review-area-sets');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack">
      <PageHeader title="Review areas" subtitle="The areas a funder reviews, loaded from a file. Each compliance review copies the areas of one set." />
      <FundingTabs active="areas" />
      {can('funding.administer') && <Loader onLoaded={reload} />}
      <Card title="Sets of review areas" flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="fd-pad"><Loading lines={4} /></div>
          : data.length === 0 ? <EmptyState icon="clipboard" title="No review areas loaded" message="An administrator of funding loads the funder's review areas from a file." />
          : (
            <ul className="fd-sets">
              {data.map((s) => (
                <li key={s.id}>
                  <div className="fd-list-head">
                    <div>
                      <strong>{s.name}{s.version ? ` ${s.version}` : ''}</strong>
                      <span className="muted fd-block fd-small">
                        {s.areas} areas · used by {s.reviews} review{s.reviews === 1 ? '' : 's'} · loaded {formatDateTime(s.updated_at)}{s.source_file ? ` from ${s.source_file}` : ''}
                      </span>
                      {s.description && <span className="muted fd-block fd-small">{s.description}</span>}
                    </div>
                    <Button size="sm" variant="ghost" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {open === s.id ? 'Hide areas' : 'Show areas'}
                    </Button>
                  </div>
                  {open === s.id && <SetAreas id={s.id} />}
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}
