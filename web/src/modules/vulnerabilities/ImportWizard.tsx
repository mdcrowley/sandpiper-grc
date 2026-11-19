// Import findings: file -> map columns (with a live preview) -> dry run -> import -> result.
import { useMemo, useState } from 'react';
import { FileInput, SegmentedControl } from '@mantine/core';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ErrorState, errorMessage, Icon, KeyValue, Loading, PageHeader, Select, Stepper, TextArea, TextField,
  useFetch, UserPicker, useToast,
} from '../../core';
import { detectDelimiter, firstRecords, guessMapping } from './csvPreview';
import { ImportResultView } from './ImportResult';
import type { ImportResult } from './ImportResult';
import { SectionTabs } from './shared';

interface Preset { id: string; name: string; source: string | null; delimiter: string; mapping: Record<string, string> }
interface FieldInfo { fields: { key: string; label: string }[]; maxBytes: number; maxRows: number }
type Step = 'file' | 'map' | 'check' | 'done';

const DELIMITER_NAME: Record<string, string> = { ',': 'commas', ';': 'semicolons', '\t': 'tabs', '|': 'vertical bars' };

/** The mapping screen in the order a person thinks about a finding. `need` lists the fields of which one must be mapped. */
const GROUPS: { title: string; hint: string; fields: string[]; need?: string[] }[] = [
  { title: 'Which host', hint: 'Map the host name, the IP address, or both. A host seen by address in one file and by name in the next is treated as one host.', fields: ['host_name', 'host_ip'], need: ['host_name', 'host_ip'] },
  { title: 'Which finding', hint: 'Map what identifies the finding: its ID in the scanner, else the CVE, else the title. The port (and protocol) keeps the same finding on two ports apart.', fields: ['plugin_id', 'cves', 'title', 'port', 'protocol', 'service'], need: ['plugin_id', 'cves', 'title'] },
  { title: 'How serious', hint: 'Severity may be a word or a number from 0 (informational) to 4 (critical). When it is empty the CVSS score is used.', fields: ['severity', 'cvss', 'known_exploited'], need: ['severity', 'cvss'] },
  { title: 'Dates and text', hint: 'Optional. Without dates, a new finding is first seen today.', fields: ['first_seen', 'last_seen', 'description', 'solution'] },
];

export function ImportWizard() {
  const toast = useToast();
  const info = useFetch<FieldInfo>('/api/vulnerabilities/import/fields');
  const presets = useFetch<Preset[]>('/api/vulnerabilities/import/presets');

  const [step, setStep] = useState<Step>('file');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState<{ id: string; label: string } | null>(null);
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
  const lineCount = useMemo(() => (csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0), [csv]);
  const fields = info.data?.fields ?? [];
  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const preset = presets.data?.find((p) => p.id === presetId);
  const mapped = (key: string) => !!mapping[key];
  const groupReady = (g: (typeof GROUPS)[number]) => !g.need || g.need.some(mapped);
  const mappingComplete = GROUPS.every(groupReady);

  const title = (
    <>
      <PageHeader title="Import findings" subtitle="Nothing is written until you have seen the dry run and chosen to import."
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Imports', to: '/vulnerabilities/imports' }, { label: 'Import findings' }]} />
      <SectionTabs active="imports" />
    </>
  );
  if (info.error && !info.data) return <div className="stack">{title}<ErrorState title="The import could not be started" error={info.error} onRetry={info.reload} /></div>;
  if (!info.data) return <div className="stack">{title}<Loading lines={6} label="Loading the import" /></div>;
  const maxMb = Math.round(info.data.maxBytes / 1024 / 1024);

  function onFile(picked: File | null) {
    setError(null);
    setFile(null);
    setCsv('');
    setFileName('');
    if (!picked) return;
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
        closeMissing: over.closeMissing ?? closeMissing, presetName: preset?.name, ownerId: owner?.id ?? null,
        mapping: Object.fromEntries(Object.entries(over.mapping ?? mapping).filter(([, v]) => v)),
      });
      setResult(res);
      setStep(dryRun ? 'check' : 'done');
      if (!dryRun) toast.success(`Import finished: ${res.created} new, ${res.updated + res.reopened} updated.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mapping' && err.fields) { setFieldErrors(err.fields); setStep('map'); }
      else if (err instanceof ApiError && (err.fields?.source || err.fields?.ownerId)) { setFieldErrors(err.fields); setStep('file'); }
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
  const firstValue = (key: string) => (mapping[key] ? records[1]?.[columnAt(mapping[key])]?.trim() : undefined);
  const unused = headers.filter((h) => !Object.values(mapping).includes(h));
  const hasFile = csv.trim() !== '';
  const ready = hasFile && source.trim() !== '';

  return (
    <div className="stack">
      {title}
      <Stepper label="Import steps" current={step} steps={[
        { key: 'file', label: 'Choose the file' }, { key: 'map', label: 'Map columns' }, { key: 'check', label: 'Dry run' }, { key: 'done', label: 'Result' },
      ]} />
      {error != null && <ErrorState title="The import could not continue" error={error} />}

      {step === 'file' && (
        <Card title="Step 1: choose the file"
          actions={(
            <SegmentedControl size="xs" aria-label="How to give the findings" value={mode}
              onChange={(v) => { setMode(v as typeof mode); setError(null); }}
              data={[{ value: 'file', label: 'Upload a file' }, { value: 'paste', label: 'Paste text' }]} />
          )}>
          <div className="stack">
            {mode === 'file' ? (
              <FileInput label="CSV file" placeholder="Choose a file" accept=".csv,.tsv,.txt,text/csv" clearable value={file} onChange={onFile}
                leftSection={<Icon name="upload" size={16} />}
                description={`A scanner or assessment export, up to ${maxMb} MB and ${info.data.maxRows.toLocaleString('en-US')} rows. The first row must hold the column names.`}
                inputWrapperOrder={['label', 'input', 'description', 'error']} />
            ) : (
              <TextArea label="CSV text" value={csv} onChange={(v) => { setCsv(v); setFileName(''); setFile(null); }} rows={6} maxRows={12}
                hint="Paste the rows with the column names on the first line."
                placeholder={'Host,IP,Port,Finding ID,Title,Severity,CVSS,First seen\nfiles01,10.0.0.5,445,1001,Outdated file service,High,8.1,2030-01-15'} />
            )}
            {hasFile && (
              <div className={headers.length > 1 && lineCount > 0 ? 'notice notice-success' : 'notice notice-warn'} role="status">
                <Icon name={headers.length > 1 && lineCount > 0 ? 'check-circle' : 'alert-circle'} size={16} />
                <span>
                  {headers.length > 1 && lineCount > 0
                    ? <><strong>{fileName || 'Pasted text'}</strong>: {headers.length} columns separated by {DELIMITER_NAME[delimiter] ?? delimiter}, and about {lineCount.toLocaleString('en-US')} {lineCount === 1 ? 'row' : 'rows'} of findings.</>
                    : <>This does not look like a file of findings yet: it needs a first row of column names and at least one row below it.</>}
                </span>
              </div>
            )}
            <div className="form-grid">
              <TextField label="Source" required value={source} onChange={setSource} error={fieldErrors.source} maxLength={120}
                hint="Where these findings come from, for example the name of the scan. Use the same name each time: a later import of the same source is compared with it." />
              <Select label="Saved mapping" value={presetId} placeholder="None: match columns by name"
                options={(presets.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                onChange={(id) => { setPresetId(id); const p = presets.data?.find((x) => x.id === id); if (p?.source && !source.trim()) setSource(p.source); }}
                hint={presets.data?.length ? 'A mapping saved from an earlier import of the same kind of file.' : 'None saved yet. You can save one on the next step.'} />
              <UserPicker label="Owner for new findings" value={owner?.id ?? null} display={owner?.label} error={fieldErrors.ownerId}
                onChange={(id, option) => setOwner(id ? { id, label: option?.label ?? '' } : null)}
                hint="Optional. Findings this import adds are assigned to this person, who is told once when it finishes. Findings already recorded keep their owner." />
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
          <Card title="Step 2: match your columns">
            <div className="stack">
              <p className="muted vuln-note">
                {headers.length} columns found in {fileName ? <strong>{fileName}</strong> : 'the pasted text'}. They were matched {preset ? `from "${preset.name}"` : 'by name'} where possible:
                check each one, and leave what you do not need as “Not imported”.
              </p>
              {GROUPS.map((g) => (
                <section key={g.title} className="vuln-map-group" aria-label={g.title}>
                  <header className="vuln-map-head">
                    <h3 className="vuln-map-title">{g.title}</h3>
                    {g.need && (groupReady(g) ? <Badge color="green">Ready</Badge> : <Badge color="red">Needs a column</Badge>)}
                    {!g.need && <Badge color="gray">Optional</Badge>}
                  </header>
                  <p className="muted vuln-note">{g.hint}</p>
                  <div className="vuln-map-grid">
                    {g.fields.filter((key) => fields.some((f) => f.key === key)).map((key) => (
                      <Select key={key} label={labelOf(key)} value={mapping[key] ?? ''} placeholder="Not imported"
                        onChange={(v) => setMapping((m) => ({ ...m, [key]: v }))} error={fieldErrors[key]}
                        hint={firstValue(key) ? `First row: ${firstValue(key)!.slice(0, 60)}` : undefined}
                        options={headers.map((h) => ({ value: h, label: h }))} />
                    ))}
                  </div>
                </section>
              ))}
              {unused.length > 0 && (
                <p className="muted vuln-note">Columns that will not be imported: {unused.join(', ')}.</p>
              )}
            </div>
          </Card>

          <Card title="How the first rows will be read" flush>
            {previewFields.length === 0 ? <p className="muted vuln-pad">Map a column to see how the first rows will be read.</p> : (
              <div className="table-wrap vuln-tw vuln-wrap">
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
                <Select label="Dates written like 03/04/2030 mean" value={dayFirst} required
                  options={[{ value: 'day', label: 'Day first (3 April)' }, { value: 'month', label: 'Month first (4 March)' }]}
                  onChange={(v) => setDayFirst(v || 'day')} hint="Dates written year first (2030-04-03) are always understood." />
                <div className="vuln-save">
                  <TextField label="Save this mapping as" value={saveName} onChange={setSaveName} maxLength={80} placeholder="For example: Monthly network scan export"
                    hint="Optional. Saving under an existing name replaces it." />
                  <Button loading={saving} disabled={!saveName.trim() || !Object.values(mapping).some(Boolean)} onClick={() => void saveMapping()}>Save mapping</Button>
                </div>
              </div>
              <Checkbox label="Close missing findings" checked={closeMissing} onChange={setCloseMissing}
                hint="Marks as fixed every open finding from an earlier import of this source that this file no longer reports. Only use it when the file is a complete scan. The dry run shows which findings would be closed." />
              {!mappingComplete && (
                <p className="field-error" role="alert">
                  Still needed: {GROUPS.filter((g) => !groupReady(g)).map((g) => g.need!.map(labelOf).join(' or ')).join('; ')}.
                </p>
              )}
              <div className="form-actions">
                <Button onClick={() => setStep('file')}>Back</Button>
                <Button variant="primary" loading={busy} disabled={!mappingComplete} onClick={() => void run(true)}>Next: dry run</Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {(step === 'check' || step === 'done') && result && (
        <>
          <Card>
            <KeyValue layout="columns" compact items={[
              { label: 'Source', value: result.source },
              { label: 'File', value: fileName || 'Pasted text' },
              { label: 'Rows read', value: result.total.toLocaleString('en-US') },
              { label: 'Owner for new findings', value: owner?.label || 'Nobody' },
              { label: 'Close missing findings', value: result.closeMissing ? 'Yes' : 'No' },
            ]} />
          </Card>
          <ImportResultView
            result={result} done={step === 'done'} busy={busy} closeMissing={closeMissing}
            onCloseMissing={(v) => { setCloseMissing(v); void run(true, { closeMissing: v }); }}
            onBack={() => setStep('map')} onImport={() => void run(false)} onRestart={restart}
          />
        </>
      )}
    </div>
  );
}
