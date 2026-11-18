// Import findings: file -> map columns (with a live preview) -> dry run -> import -> summary.
import { useMemo, useState } from 'react';
import { FileInput } from '@mantine/core';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, ErrorState, errorMessage, Icon, Loading, PageHeader, Select, Stepper, TextArea, TextField,
  useFetch, useToast,
} from '../../core';
import { detectDelimiter, firstRecords, guessMapping } from './csvPreview';
import { ImportResultView } from './ImportResult';
import type { ImportResult } from './ImportResult';
import { SectionTabs } from './shared';

interface Preset { id: string; name: string; source: string | null; delimiter: string; mapping: Record<string, string> }
interface FieldInfo { fields: { key: string; label: string }[]; maxBytes: number; maxRows: number }
type Step = 'file' | 'map' | 'check' | 'done';

const REQUIRED_HINT: Record<string, string> = {
  host_name: 'Host name or IP address is needed',
  plugin_id: 'Finding ID, CVE or Title is needed',
  severity: 'Severity or CVSS score is needed',
};
const DELIMITER_NAME: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'vertical bar' };

export function ImportWizard() {
  const toast = useToast();
  const info = useFetch<FieldInfo>('/api/vulnerabilities/import/fields');
  const presets = useFetch<Preset[]>('/api/vulnerabilities/import/presets');

  const [step, setStep] = useState<Step>('file');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [presetId, setPresetId] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dayFirst, setDayFirst] = useState('day');
  const [closeMissing, setCloseMissing] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const delimiter = useMemo(() => detectDelimiter(csv), [csv]);
  const records = useMemo(() => firstRecords(csv, delimiter, 6), [csv, delimiter]);
  const headers = useMemo(() => (records[0] ?? []).map((h) => h.trim()).filter(Boolean), [records]);
  const fields = info.data?.fields ?? [];
  const preset = presets.data?.find((p) => p.id === presetId);
  const mapped = (key: string) => !!mapping[key];
  const mappingComplete = (mapped('host_name') || mapped('host_ip')) && (mapped('plugin_id') || mapped('cves') || mapped('title')) && (mapped('severity') || mapped('cvss'));

  const title = (
    <>
      <PageHeader title="Import findings" subtitle="Nothing is written until you have seen the dry run and chosen Import."
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Imports', to: '/vulnerabilities/imports' }, { label: 'Import findings' }]} />
      <SectionTabs active="imports" />
    </>
  );
  if (info.error && !info.data) return <div className="stack">{title}<ErrorState error={info.error} onRetry={info.reload} /></div>;
  if (!info.data) return <div className="stack">{title}<Loading /></div>;
  const maxMb = Math.round(info.data.maxBytes / 1024 / 1024);

  function onFile(picked: File | null) {
    setError(null);
    setFile(null);
    if (!picked) { setCsv(''); setFileName(''); return; }
    if (!/\.(csv|txt|tsv)$/i.test(picked.name)) { setError(new Error('Choose a .csv file. If the findings are in a spreadsheet, save it as CSV first.')); return; }
    if (picked.size > info.data!.maxBytes) { setError(new Error(`That file is ${(picked.size / 1024 / 1024).toFixed(1)} MB. The limit is ${maxMb} MB: split it into smaller files and import them one after another.`)); return; }
    picked.text().then((text) => { setCsv(text); setFileName(picked.name); setFile(picked); }, () => setError(new Error('That file could not be read.')));
  }

  /** Mapping to start from: the chosen saved mapping (columns the file really has), else a guess from the column names. */
  function startMapping(): Record<string, string> | null {
    if (headers.length < 1 || records.length < 2) {
      setError(new Error('The file needs a header row with the column names, and at least one finding below it.'));
      return null;
    }
    const lower = new Map(headers.map((h) => [h.toLowerCase(), h]));
    const next = preset
      ? Object.fromEntries(Object.entries(preset.mapping).map(([k, col]) => [k, lower.get(col.toLowerCase()) ?? '']).filter(([, col]) => col))
      : guessMapping(headers, fields);
    setMapping(next);
    setFieldErrors({});
    setError(null);
    if (preset) setSaveName(preset.name);
    return next;
  }

  async function run(dryRun: boolean, over: { mapping?: Record<string, string>; closeMissing?: boolean } = {}) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await api.post<ImportResult>('/api/vulnerabilities/import', {
        csv, fileName, source: source.trim(), delimiter, dayFirst: dayFirst === 'day', dryRun,
        closeMissing: over.closeMissing ?? closeMissing, presetName: preset?.name,
        mapping: Object.fromEntries(Object.entries(over.mapping ?? mapping).filter(([, v]) => v)),
      });
      setResult(res);
      setStep(dryRun ? 'check' : 'done');
      if (!dryRun) toast.success(`Import finished: ${res.created} new, ${res.updated} updated.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mapping' && err.fields) { setFieldErrors(err.fields); setStep('map'); }
      else if (err instanceof ApiError && err.fields?.source) { setFieldErrors(err.fields); setStep('file'); }
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveMapping() {
    setSaving(true);
    try {
      await api.post('/api/vulnerabilities/import/presets', {
        name: saveName.trim(), source: source.trim(), delimiter, mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
      });
      toast.success(`Mapping "${saveName.trim()}" saved. Pick it on the first step next time.`);
      presets.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const restart = () => { setCsv(''); setFileName(''); setFile(null); setResult(null); setMapping({}); setError(null); setCloseMissing(false); setStep('file'); };
  const previewFields = fields.filter((f) => mapping[f.key]);
  const columnAt = (name: string) => headers.findIndex((h) => h === name);
  const ready = csv.trim() !== '' && source.trim() !== '';

  return (
    <div className="stack">
      {title}
      <Stepper label="Import steps" current={step} steps={[
        { key: 'file', label: 'File' }, { key: 'map', label: 'Map columns' }, { key: 'check', label: 'Dry run' }, { key: 'done', label: 'Imported' },
      ]} />
      {error != null && <ErrorState title="The import could not continue" error={error} />}

      {step === 'file' && (
        <Card title="1. Choose the file">
          <div className="stack">
            <FileInput label="CSV file" placeholder="Choose a file" accept=".csv,.tsv,.txt,text/csv" clearable value={file} onChange={onFile}
              leftSection={<Icon name="upload" size={16} />} className="vuln-file"
              description={`A scanner or assessment export, up to ${maxMb} MB and ${info.data.maxRows.toLocaleString('en-GB')} rows. The first row must hold the column names.`}
              inputWrapperOrder={['label', 'input', 'description', 'error']} />
            <TextArea label="Or paste the CSV text" value={csv} onChange={(v) => { setCsv(v); setFileName(''); setFile(null); }} rows={6}
              placeholder={'Host,IP,Port,Finding ID,Title,Severity,CVSS,First seen\nfiles01,10.0.0.5,445,1001,Outdated file service,High,8.1,2030-01-15'} />
            <div className="form-grid">
              <TextField label="Source" required value={source} onChange={setSource} error={fieldErrors.source} maxLength={120}
                hint="Where these findings come from, for example the name of the scan. Use the same name each time: a later import of the same source updates its findings." />
              <Select label="Saved mapping" value={presetId} placeholder="None: match columns by name"
                options={(presets.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                onChange={(id) => { setPresetId(id); const p = presets.data?.find((x) => x.id === id); if (p?.source && !source.trim()) setSource(p.source); }}
                hint={presets.data?.length ? 'A mapping saved from an earlier import of the same kind of file.' : 'None saved yet. You can save one on the next step.'} />
            </div>
            <div className="form-actions">
              <Link className="btn btn-secondary" to="/vulnerabilities/imports">Cancel</Link>
              <Button variant={preset ? 'secondary' : 'primary'} disabled={!ready} onClick={() => { if (startMapping()) setStep('map'); }}>
                {preset ? 'Review the mapping' : 'Next: map columns'}
              </Button>
              {preset && (
                <Button variant="primary" disabled={!ready} loading={busy} onClick={() => { const m = startMapping(); if (m) void run(true, { mapping: m }); }}>
                  Dry run with "{preset.name}"
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {step === 'map' && (
        <>
          <Card title="2. Match your columns">
            <p className="muted">
              {headers.length} columns found, separated by a {DELIMITER_NAME[delimiter] ?? delimiter}. Columns were matched {preset ? `from "${preset.name}"` : 'by name'} where possible; change any that are wrong.
              Severity may be a word or a number from 0 (informational) to 4 (critical); when it is empty the CVSS score is used.
            </p>
            <div className="vuln-map-grid">
              {fields.map((f) => (
                <Select key={f.key} label={f.label} value={mapping[f.key] ?? ''} placeholder="Not imported"
                  onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))} error={fieldErrors[f.key]}
                  hint={REQUIRED_HINT[f.key]} options={headers.map((h) => ({ value: h, label: h }))} />
              ))}
            </div>
          </Card>

          <Card title="Preview of the first rows" flush>
            {previewFields.length === 0 ? <p className="muted vuln-pad">Map a column to see how the first rows will be read.</p> : (
              <div className="table-wrap vuln-wrap">
                <table className="table">
                  <caption className="sr-only">The first rows of the file as they will be imported</caption>
                  <thead><tr>{previewFields.map((f) => <th key={f.key} scope="col">{f.label}</th>)}</tr></thead>
                  <tbody>
                    {records.slice(1).map((cells, i) => (
                      <tr key={i}>
                        {previewFields.map((f) => <td key={f.key}><span className="vuln-clip">{cells[columnAt(mapping[f.key])]?.trim() || '—'}</span></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Options">
            <div className="stack">
              <div className="form-grid">
                <Select label="Dates written like 03/04/2030 mean" value={dayFirst} placeholder="Choose"
                  options={[{ value: 'day', label: 'Day first (3 April)' }, { value: 'month', label: 'Month first (4 March)' }]}
                  onChange={(v) => setDayFirst(v || 'day')} hint="Dates written year first (2030-04-03) are always understood." />
                <div className="vuln-save">
                  <TextField label="Save this mapping as" value={saveName} onChange={setSaveName} maxLength={80} placeholder="For example: Monthly network scan export"
                    hint="Saving under an existing name replaces it." />
                  <Button loading={saving} disabled={!saveName.trim() || !Object.values(mapping).some(Boolean)} onClick={() => void saveMapping()}>Save mapping</Button>
                </div>
              </div>
              <Checkbox label="Close missing findings" checked={closeMissing} onChange={setCloseMissing}
                hint="Marks as fixed every open finding from an earlier import of this source that this file no longer reports. Only use it when the file is a complete scan. The dry run shows which findings would be closed." />
              <div className="form-actions">
                <Button onClick={() => setStep('file')}>Back</Button>
                <Button variant="primary" loading={busy} disabled={!mappingComplete} onClick={() => void run(true)}>Next: dry run</Button>
              </div>
              {!mappingComplete && <p className="field-error">Map at least a host (name or IP address), something that identifies the finding (Finding ID, CVE or Title) and Severity or CVSS score.</p>}
            </div>
          </Card>
        </>
      )}

      {(step === 'check' || step === 'done') && result && (
        <ImportResultView
          result={result} done={step === 'done'} busy={busy} closeMissing={closeMissing}
          onCloseMissing={(v) => { setCloseMissing(v); void run(true, { closeMissing: v }); }}
          onBack={() => setStep('map')} onImport={() => void run(false)} onRestart={restart}
        />
      )}
    </div>
  );
}
