// Import wizard for any record type: choose a CSV or Excel file (and a sheet), match its columns
// to fields, check every row (a dry run that writes nothing), map values that matched nothing,
// then import. Opened from a record list's Import button, or with ?import=1 on the list's address.
// The server does the work (core/import); the file is sent again with each step.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api, ApiError, errorMessage } from './api';
import { Select } from './fields';
import { formatNumber } from './format';
import { useFetch } from './hooks';
import { Icon } from './Icon';
import {
  MappingTable, MODE_LABELS, PastImports, RowResults, SummaryTiles, ValueMapping,
  type ImportMode, type ImportSummary, type PastImport, type ReadResult,
} from './ImportWizardParts';
import { saveDownload } from './ListExport';
import type { ResourceMeta } from './meta';
import { Modal, useToast } from './overlay';
import { Button, Loading, Stepper } from './ui';
import './ImportWizard.css';

type StepKey = 'file' | 'map' | 'check' | 'done';
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'file', label: 'Choose a file' },
  { key: 'map', label: 'Match columns' },
  { key: 'check', label: 'Check' },
  { key: 'done', label: 'Import' },
];
const MAX_BYTES = 5 * 1024 * 1024;

interface Upload { name: string; content: string; size: number }

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export interface ImportWizardProps {
  resource: ResourceMeta;
  open: boolean;
  onClose: () => void;
  /** Called after records were created or updated. */
  onImported?: () => void;
}

export function ImportWizard({ resource, open, onClose, onImported }: ImportWizardProps) {
  const toast = useToast();
  const plural = resource.plural.toLowerCase();
  const [step, setStep] = useState<StepKey>('file');
  const [upload, setUpload] = useState<Upload | null>(null);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ImportMode>('create');
  const [matchKey, setMatchKey] = useState('');
  const [valueMap, setValueMap] = useState<Record<string, Record<string, string>>>({});
  const [check, setCheck] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; fields?: Record<string, string> } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const history = useFetch<PastImport[]>(open ? `/api/import/history?type=${encodeURIComponent(resource.type)}` : null);

  const reset = () => {
    setStep('file'); setUpload(null); setRead(null); setMapping({}); setMode('create'); setMatchKey('');
    setValueMap({}); setCheck(null); setResult(null); setProblem(null);
  };
  useEffect(() => { if (!open) reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (err: unknown) => {
    const fields = err instanceof ApiError ? err.fields : undefined;
    setProblem({ message: errorMessage(err), fields: fields && Object.keys(fields).length ? fields : undefined });
  };

  /** Reads the file (or another sheet of it) on the server. */
  async function readFile(next: Upload, sheet?: string) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.post<ReadResult>(`/api/import/${encodeURIComponent(resource.type)}/read`, { fileName: next.name, content: next.content, sheet });
      setUpload(next);
      setRead(r);
      setMapping(Object.fromEntries(r.headers.map((h) => [h, r.suggested[h] ?? ''])));
      setMode(r.modes.includes('create') ? 'create' : r.modes[0] ?? 'create');
      // Duplicates are looked for by the reference, else the title, when the file has that column.
      const mappedNow = new Set(Object.values(r.suggested));
      const key = [resource.refField, resource.titleField].find((k) => k && mappedNow.has(k) && r.matchKeys.some((m) => m.name === k));
      setMatchKey(key ?? '');
      setCheck(null);
      setValueMap({});
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) { setProblem({ message: `The file is larger than ${MAX_BYTES / 1024 / 1024} MB. Split it into smaller files.` }); return; }
    try {
      await readFile({ name: file.name, size: file.size, content: await readAsBase64(file) });
    } catch (err) {
      fail(err);
    }
  }

  const body = (dryRun: boolean) => ({
    fileName: upload?.name, content: upload?.content, sheet: read?.sheet ?? undefined,
    mapping: Object.fromEntries(Object.entries(mapping).filter(([, f]) => f)),
    mode, matchKey: matchKey || null, valueMap, dryRun,
  });

  async function runCheck() {
    setBusy(true);
    setProblem(null);
    try {
      const s = await api.post<ImportSummary>(`/api/import/${encodeURIComponent(resource.type)}`, body(true));
      setCheck(s);
      setStep('check');
    } catch (err) {
      fail(err);
      setStep('map');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setProblem(null);
    try {
      const s = await api.post<ImportSummary>(`/api/import/${encodeURIComponent(resource.type)}`, body(false));
      setResult(s);
      setStep('done');
      history.reload();
      if (s.created + s.updated > 0) {
        toast.success(`${formatNumber(s.created)} created, ${formatNumber(s.updated)} updated.`);
        onImported?.();
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files?.[0]);
  };

  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const missing = read && mode !== 'update' ? read.fields.filter((f) => f.required && !mappedFields.has(f.name) && !(f.filledBy && mappedFields.has(f.filledBy))) : [];
  const keyOptions = read ? read.matchKeys.filter((k) => mappedFields.has(k.name)) : [];
  const needsKey = mode !== 'create';
  const canCheck = Boolean(read) && mappedFields.size > 0 && !missing.length && (!needsKey || Boolean(matchKey && mappedFields.has(matchKey)));
  const toWrite = check ? check.created + check.updated : 0;

  const footer = (
    <>
      {step !== 'file' && step !== 'done' && <Button onClick={() => setStep(step === 'check' ? 'map' : 'file')} disabled={busy}>Back</Button>}
      {step === 'done' && <Button onClick={reset}>Import another file</Button>}
      <Button onClick={onClose} disabled={busy && step !== 'file'}>{step === 'done' ? 'Close' : 'Cancel'}</Button>
      {step === 'file' && <Button variant="primary" disabled={!read || busy} onClick={() => setStep('map')}>Next: match columns</Button>}
      {step === 'map' && <Button variant="primary" loading={busy} disabled={!canCheck} onClick={() => void runCheck()}>Check the file</Button>}
      {step === 'check' && (
        <Button variant="primary" loading={busy} disabled={!toWrite} onClick={() => void runImport()}>
          {toWrite ? `Import ${formatNumber(toWrite)} ${toWrite === 1 ? 'row' : 'rows'}` : 'Nothing to import'}
        </Button>
      )}
    </>
  );

  return (
    <Modal open={open} title={`Import ${plural}`} size="lg" onClose={onClose} footer={<div className="iw-footer">{footer}</div>}>
      <div className="iw">
        <Stepper steps={step === 'done' ? STEPS.map((s) => ({ ...s, state: 'done' as const })) : STEPS} current={step} size="sm" label="Import steps" />

        {problem && (
          <div className="notice notice-warn iw-problem" role="alert">
            <strong>{problem.message}</strong>
            {problem.fields && (
              <ul>{Object.entries(problem.fields).map(([k, v]) => <li key={k}>{v}</li>)}</ul>
            )}
          </div>
        )}

        {step === 'file' && (
          <div className="iw-step">
            <label
              className={`iw-drop${dragging ? ' iw-drop-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={input} type="file" className="sr-only" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => { void choose(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
              <Icon name="upload" size={28} />
              <span className="iw-drop-title">{upload ? upload.name : 'Choose a CSV or Excel file'}</span>
              <span className="muted iw-small">
                {busy ? 'Reading the file…' : upload && read
                  ? `${formatNumber(read.rowCount)} rows and ${read.headers.length} columns${read.sheet ? ` on the sheet "${read.sheet}"` : ''}. Choose another file to replace it.`
                  : 'Drop it here or click to browse. .csv or .xlsx, up to 5 MB and 5,000 rows; the first row holds the column names.'}
              </span>
            </label>
            {read?.warnings?.map((w) => <p key={w} className="notice notice-warn iw-small">{w}</p>)}
            {read && read.sheets.length > 1 && (
              <div className="iw-sheet">
                <Select label="Sheet" value={read.sheet ?? ''} options={read.sheets.map((s) => ({ value: s, label: s }))}
                  onChange={(s) => upload && void readFile(upload, s)} hint="The workbook has more than one sheet." />
              </div>
            )}
            <p className="iw-small">
              <button type="button" className="iw-link" onClick={() => saveDownload(`/api/import/${encodeURIComponent(resource.type)}/template`, `${resource.type}-import-template.csv`).catch((err) => toast.error(errorMessage(err)))}>
                Download a template
              </button>{' '}
              with one column per field. An Excel export of this list can be imported again too.
            </p>
            <h3 className="iw-h3">Past imports</h3>
            {history.error ? <p className="muted iw-small">Past imports could not be loaded.</p>
              : !history.data ? <Loading lines={2} label="Loading past imports" /> : <PastImports rows={history.data} />}
          </div>
        )}

        {step === 'map' && read && (
          <div className="iw-step">
            <p className="iw-small">
              <strong>{upload?.name}</strong>{read.sheet ? ` (sheet "${read.sheet}")` : ''}: {formatNumber(read.rowCount)} rows.
              Columns were matched to fields by name; check each one. Empty cells leave a field as it is.
            </p>
            <MappingTable read={read} mapping={mapping} onChange={(h, f) => setMapping((m) => ({ ...m, [h]: f }))} />
            {missing.length > 0 && (
              <p className="notice notice-warn iw-small">Every new {resource.label.toLowerCase()} needs {missing.map((f) => f.label).join(', ')}. Match a column to {missing.length === 1 ? 'it' : 'each'}, or choose to update existing records only.</p>
            )}
            <div className="form-grid iw-options">
              <Select label="What to do" required value={mode} onChange={(v) => setMode(v as ImportMode)}
                options={read.modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
                hint={mode === 'create' ? 'Rows that match an existing record are skipped.' : mode === 'update' ? 'Rows that match nothing are skipped.' : 'Matching rows update the record; the rest become new records.'} />
              <Select label={needsKey ? 'Find existing records by' : 'Skip rows that match existing records by'} required={needsKey}
                value={matchKey} onChange={setMatchKey}
                options={[...(needsKey ? [] : [{ value: '', label: 'Do not check for duplicates' }]), ...keyOptions.map((k) => ({ value: k.name, label: k.label }))]}
                hint={keyOptions.length ? 'Compared without regard to capital letters. A row that repeats an earlier row is skipped.' : 'Match a column to the reference, ID or a name field first.'} />
            </div>
          </div>
        )}

        {step === 'check' && read && check && (
          <div className="iw-step">
            <p className="iw-small">Nothing has been saved yet. This is what importing would do:</p>
            {check.warnings?.map((w) => <p key={w} className="notice notice-warn iw-small">{w}</p>)}
            <SummaryTiles s={check} />
            <ValueMapping read={read} unmatched={check.unmatched} valueMap={valueMap}
              onChange={(field, raw, value) => setValueMap((vm) => {
                const next = { ...vm, [field]: { ...(vm[field] ?? {}) } };
                if (value) next[field][raw.toLowerCase()] = value; else delete next[field][raw.toLowerCase()];
                return next;
              })} />
            {Object.keys(check.unmatched).length > 0 && (
              <div className="iw-again"><Button icon="refresh" loading={busy} onClick={() => void runCheck()}>Check again</Button></div>
            )}
            <RowResults read={read} s={check} />
            {check.errors > 0 && <p className="muted iw-small">Rows with problems are left out; the rest can be imported now, or fix the file and check it again.</p>}
          </div>
        )}

        {step === 'done' && read && result && (
          <div className="iw-step">
            <p className="iw-done"><Icon name="check-circle" size={20} /> Import finished: {formatNumber(result.created)} created, {formatNumber(result.updated)} updated, {formatNumber(result.skipped)} skipped{result.errors ? `, ${formatNumber(result.errors)} not imported` : ''}.</p>
            <SummaryTiles s={result} />
            <RowResults read={read} s={result} />
            <p className="muted iw-small">Each record's history shows that it was imported, and the import is in the audit log.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
