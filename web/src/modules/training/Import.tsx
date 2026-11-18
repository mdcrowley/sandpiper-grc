// Completion import: paste or upload CSV, map columns, preview with errors and duplicates, then import.
import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, formatDate, PageHeader, Select, Stat, StatusChip, Stepper,
  TextArea, useFetch, useToast,
} from '../../core';
import type { ColorName, ListResult, Row } from '../../core';

interface PreviewRow {
  line: number;
  data: { course: string | null; person: string | null; has_account: boolean; person_department: string | null; completed_on?: string; score?: number | null; result?: string | null; evidence_note?: string | null };
  errors: Record<string, string>;
  duplicate: { of: 'file' | 'existing'; line?: number } | null;
  action: 'create' | 'skip' | 'error';
  outcome?: 'created' | 'completed';
}
interface ImportResult {
  dryRun: boolean; total: number; valid: number; errors: number; duplicates: number; created: number; updated: number; skipped: number;
  wouldCreate?: number; rows: PreviewRow[];
}

const FIELDS: { key: string; label: string; aliases: string[]; hint?: string }[] = [
  { key: 'person_email', label: 'Email', aliases: ['email', 'emailaddress', 'mail', 'username', 'user'] },
  { key: 'person_name', label: 'Name', aliases: ['name', 'fullname', 'person', 'learner', 'employee', 'staff'] },
  { key: 'person_department', label: 'Department', aliases: ['department', 'dept', 'team', 'division'] },
  { key: 'course', label: 'Course', aliases: ['course', 'coursename', 'coursetitle', 'training', 'module'] },
  { key: 'completed_on', label: 'Completed on', aliases: ['completedon', 'completed', 'completiondate', 'datecompleted', 'date'] },
  { key: 'score', label: 'Score', aliases: ['score', 'mark', 'grade', 'percent'] },
  { key: 'result', label: 'Result', aliases: ['result', 'outcome', 'status'] },
  { key: 'evidence_note', label: 'Evidence note', aliases: ['evidence', 'evidencenote', 'note', 'notes', 'certificate'] },
];
const ACTION: Record<PreviewRow['action'], { label: string; color: ColorName }> = {
  create: { label: 'New', color: 'green' },
  skip: { label: 'Duplicate, skipped', color: 'amber' },
  error: { label: 'Error', color: 'red' },
};

/** Cells of the first line of a CSV text (quotes handled). */
function headerOf(text: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') break;
    else cell += c;
  }
  cells.push(cell);
  return cells.map((c) => c.trim()).filter(Boolean);
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function TrainingImport() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const courses = useFetch<ListResult<Row>>('/api/courses?pageSize=500&sort=title');
  const [csv, setCsv] = useState('');
  const [step, setStep] = useState<'paste' | 'map' | 'preview' | 'done'>('paste');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [courseId, setCourseId] = useState(params.get('course') ?? '');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mapErrors, setMapErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const headers = useMemo(() => headerOf(csv), [csv]);
  const back = courseId && params.get('course') ? `/training/courses/${courseId}?tab=people` : '/training';

  function toMapping() {
    if (headers.length < 1 || csv.trim().split(/\r?\n/).length < 2) {
      setError(new Error('The file needs a header row and at least one data row.'));
      return;
    }
    const guess: Record<string, string> = {};
    for (const f of FIELDS) {
      const hit = headers.find((h) => f.aliases.includes(norm(h)) || norm(h) === norm(f.label));
      if (hit && !Object.values(guess).includes(hit)) guess[f.key] = hit;
    }
    setMapping(guess);
    setMapErrors({});
    setError(null);
    setStep('map');
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>('/api/training/import', {
        csv, dryRun, course_id: mapping.course ? undefined : courseId || undefined,
        mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
      });
      setResult(res);
      setStep(dryRun ? 'preview' : 'done');
      if (!dryRun) toast.success(`Import finished: ${res.created + res.updated} completions recorded.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mapping' && err.fields) { setMapErrors(err.fields); setStep('map'); } else setError(err);
    } finally {
      setBusy(false);
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { setError(new Error('Choose a .csv file. Save a spreadsheet as CSV first.')); return; }
    file.text().then((text) => { setCsv(text); setError(null); }, () => setError(new Error('That file could not be read.')));
  }
  const restart = () => { setCsv(''); setResult(null); setMapping({}); setError(null); setStep('paste'); };

  const hasPerson = !!(mapping.person_email || mapping.person_name);
  const hasCourse = !!(mapping.course || courseId);
  const ready = hasPerson && hasCourse && !!mapping.completed_on;
  const shown = (result?.rows ?? []).filter((r) => !onlyProblems || r.action === 'error' || r.duplicate);
  const willWrite = result?.wouldCreate ?? 0;
  const KNOWN = ['course', 'person_email', 'person_name', 'completed_on', 'score', 'result'];

  return (
    <div className="stack">
      <PageHeader title="Import training completions" breadcrumbs={[{ label: 'Training overview', to: '/training' }, { label: 'Import' }]}
        subtitle="Load a completion report from a learning platform or a spreadsheet. Nothing is written until you have seen the preview and chosen Import." />
      <Stepper label="Import steps" current={step} steps={[
        { key: 'paste', label: 'File' }, { key: 'map', label: 'Map columns' }, { key: 'preview', label: 'Preview' }, { key: 'done', label: 'Imported' },
      ]} />
      {error != null && <ErrorState title="The import could not continue" error={error} />}

      {step === 'paste' && (
        <Card title="1. Choose or paste a CSV file">
          <div className="stack">
            <label className="field">
              <span className="field-label">CSV file</span>
              <input type="file" accept=".csv,text/csv,.txt" onChange={onFile} />
              <span className="field-hint">The first row must hold the column names. Dates as YYYY-MM-DD or month/day/year. Excel workbooks: save as CSV first.</span>
            </label>
            <TextArea label="Or paste the CSV text" value={csv} onChange={setCsv} rows={10}
              placeholder={'Email,Name,Department,Course,Completed,Score\njo@example.org,Jo Example,Finance,Security awareness,2031-03-14,92'} />
            <div className="form-actions">
              <Button onClick={() => navigate(back)}>Cancel</Button>
              <Button variant="primary" disabled={!csv.trim()} onClick={toMapping}>Next: map columns</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 'map' && (
        <Card title="2. Match your columns">
          <div className="stack">
            <p className="muted">
              {headers.length} columns found. Columns were matched by name where possible; change any that are wrong. A person whose email
              matches an account is recorded against that account; everyone else is kept by name, email and department.
            </p>
            <div className="trn-map-grid">
              {FIELDS.map((f) => (
                <Select key={f.key} label={f.label} value={mapping[f.key] ?? ''} placeholder="Not in the file"
                  required={f.key === 'completed_on'}
                  onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))} error={mapErrors[f.key]}
                  options={headers.map((h) => ({ value: h, label: h }))} />
              ))}
            </div>
            {!mapping.course && (
              <Select label="Course for every row" required value={courseId} placeholder="Choose a course" onChange={setCourseId}
                hint="Used because no column is matched to Course. Courses in a file are matched by title or reference."
                options={(courses.data?.rows ?? []).map((c) => ({ value: c.id, label: c.title }))} />
            )}
            {!ready && (
              <p className="field-error">
                {!hasPerson ? 'Match a column to Email or Name.' : !mapping.completed_on ? 'Match a column to Completed on.' : 'Choose a course, or match a column to Course.'}
              </p>
            )}
            <div className="form-actions">
              <Button onClick={() => setStep('paste')}>Back</Button>
              <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void run(true)}>Next: preview</Button>
            </div>
          </div>
        </Card>
      )}

      {(step === 'preview' || step === 'done') && result && (
        <>
          <div className="grid-stats">
            <Stat label="Rows in file" value={result.total} />
            {step === 'done' ? (
              <>
                <Stat label="Completions added" value={result.created} color="green" />
                <Stat label="Open records completed" value={result.updated} color="blue" />
              </>
            ) : <Stat label="Will be recorded" value={willWrite} color="green" />}
            <Stat label="Duplicates" value={result.duplicates} color={result.duplicates ? 'amber' : 'gray'} />
            <Stat label="Rows with errors" value={result.errors} color={result.errors ? 'red' : 'gray'} />
          </div>
          <Card
            title={step === 'done' ? 'Result' : '3. Preview (nothing has been written yet)'}
            actions={<Checkbox label="Only show problems" checked={onlyProblems} onChange={setOnlyProblems} />}
          >
            <div className="stack">
              {step === 'preview' && (
                <p className="muted">
                  Rows with errors are never imported; fix them in the file and try again, or import the rest now. A duplicate is a row
                  whose person, course and completion date match a record that already exists or an earlier row.
                </p>
              )}
              {shown.length === 0 ? <EmptyState icon="check" title="No problems found" message="Every row is ready to import." /> : (
                <div className="table-wrap trn-preview">
                  <table className="table">
                    <caption className="sr-only">Import preview, one row per line of the file</caption>
                    <thead>
                      <tr>
                        <th scope="col">Line</th><th scope="col">Result</th><th scope="col">Person</th><th scope="col">Course</th>
                        <th scope="col">Completed on</th><th scope="col">Score</th><th scope="col">Problems</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => {
                        const bad = (k: string) => r.errors[k] && <span className="trn-cell-error">{r.errors[k]}</span>;
                        return (
                          <tr key={r.line}>
                            <td className="num">{r.line}</td>
                            <td>
                              <StatusChip color={ACTION[r.action].color}
                                label={r.outcome === 'completed' ? 'Open record completed' : r.outcome === 'created' ? 'Added' : ACTION[r.action].label} />
                            </td>
                            <td>
                              {bad('person_email') || bad('person_name') || (
                                <>{r.data.person ?? '—'}{r.data.person && !r.data.has_account && <span className="muted trn-tag">no account</span>}</>
                              )}
                            </td>
                            <td>{bad('course') || r.data.course || '—'}</td>
                            <td>{bad('completed_on') || formatDate(r.data.completed_on)}</td>
                            <td>{bad('score') || (r.data.score ?? '—')}{bad('result')}</td>
                            <td>
                              {r.duplicate && (
                                <div>{r.duplicate.of === 'file' ? `Same person, course and date as line ${r.duplicate.line}` : 'Already recorded'}</div>
                              )}
                              {Object.entries(r.errors).filter(([k]) => !KNOWN.includes(k)).map(([k, m]) => <div key={k} className="trn-cell-error">{m}</div>)}
                              {!r.duplicate && Object.keys(r.errors).length === 0 && '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="form-actions">
                {step === 'preview' ? (
                  <>
                    <Button onClick={() => setStep('map')}>Back</Button>
                    <Button variant="primary" loading={busy} disabled={willWrite === 0} onClick={() => void run(false)}>
                      Import {willWrite} {willWrite === 1 ? 'completion' : 'completions'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={restart}>Import another file</Button>
                    <Button variant="primary" onClick={() => navigate(back)}>Done</Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        </>
      )}
      {step === 'paste' && (
        <p className="muted">
          To record a few people by hand instead, open a course from <Link to="/training/courses">Courses</Link> and select <strong>Record training</strong>.
        </p>
      )}
    </div>
  );
}
