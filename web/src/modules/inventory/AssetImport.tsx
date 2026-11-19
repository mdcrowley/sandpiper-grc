// Asset import: paste or upload CSV, map columns, preview with errors and duplicates, then import.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button as MantineButton, FileButton, Text } from '@mantine/core';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, Icon, Loading, PageHeader, Select, Stat,
  StatusChip, Stepper, TextArea, useResource, useToast,
} from '../../core';
import type { ColorName } from '../../core';

interface PreviewRow {
  line: number; data: Record<string, unknown>; errors: Record<string, string>;
  duplicate: { by: string; of: 'file' | 'existing'; line?: number; id?: string; value?: string } | null;
  action: 'create' | 'update' | 'skip' | 'error'; id?: string; tag?: string;
}
interface ImportResult {
  dryRun: boolean; total: number; valid: number; errors: number; duplicates: number;
  created: number; updated: number; skipped: number; wouldCreate?: number; wouldUpdate?: number; rows: PreviewRow[];
}

const SKIP_FIELDS = new Set(['disposal_approved_by', 'disposal_approved_on', 'disposal_approval_ref', 'disposal_method', 'disposed_on', 'vendor_id', 'contract_id']);
const ACTION: Record<PreviewRow['action'], { label: string; color: ColorName }> = {
  create: { label: 'New', color: 'green' },
  update: { label: 'Update', color: 'blue' },
  skip: { label: 'Duplicate, skipped', color: 'amber' },
  error: { label: 'Error', color: 'red' },
};

/** The first `count` rows of a CSV text as cells (quotes handled): the header and a sample row. */
function firstRows(text: string, count: number): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim())) rows.push(cells.map((c) => c.trim()));
    cells = [];
    cell = '';
  };
  for (let i = 0; i < src.length && rows.length < count; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; endRow(); }
    else cell += c;
  }
  if (rows.length < count && (cell || cells.length)) endRow();
  return rows;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string[]> = {
  tag: ['assettag', 'tagnumber'], serial: ['serial', 'serialno', 'sn'], asset_type: ['type', 'kind', 'category'],
  site_id: ['site', 'sitename'], system_id: ['system'], user_id: ['user', 'username'], owner_id: ['owner'],
  assigned_to_name: ['assignedto', 'assignee'], cost: ['price', 'purchasecost'], purchase_date: ['purchased', 'bought'],
  name: ['assetname', 'description', 'device'], os: ['os'], os_version: ['osversion'], ip_address: ['ip'], mac_address: ['mac'],
};

export function AssetImportPage() {
  const resource = useResource('asset');
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [step, setStep] = useState<'paste' | 'map' | 'preview' | 'done'>('paste');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [update, setUpdate] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mapErrors, setMapErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const sampleRows = useMemo(() => firstRows(csv, 2), [csv]);
  const headers = useMemo(() => (sampleRows[0] ?? []).filter(Boolean), [sampleRows]);
  const sampleOf = (header: string | undefined) => (header ? sampleRows[1]?.[(sampleRows[0] ?? []).indexOf(header)] ?? '' : '');
  const [fileName, setFileName] = useState('');
  const [over, setOver] = useState(false);
  const fields = useMemo(
    () => Object.entries(resource?.fields ?? {}).filter(([k, f]) => !f.readOnly && !SKIP_FIELDS.has(k)).map(([k, f]) => ({ key: k, label: f.label, type: f.type })),
    [resource],
  );

  function toMapping() {
    if (headers.length < 1 || csv.trim().split(/\r?\n/).length < 2) {
      setError(new Error('The file needs a header row and at least one data row.'));
      return;
    }
    const guess: Record<string, string> = {};
    for (const f of fields) {
      const wanted = [norm(f.key), norm(f.label), ...(ALIASES[f.key] ?? [])];
      const hit = headers.find((h) => wanted.includes(norm(h)));
      if (hit) guess[f.key] = hit;
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
      const res = await api.post<ImportResult>('/api/assets/import', {
        csv, dryRun, onDuplicate: update ? 'update' : 'skip',
        mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
      });
      setResult(res);
      setStep(dryRun ? 'preview' : 'done');
      if (!dryRun) toast.success(`Import finished: ${res.created} created, ${res.updated} updated.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mapping' && err.fields) { setMapErrors(err.fields); setStep('map'); } else setError(err);
    } finally {
      setBusy(false);
    }
  }

  function readFile(file: File | null | undefined) {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { setError(new Error('Choose a .csv file. Save a spreadsheet as CSV first.')); return; }
    file.text().then((text) => { setCsv(text); setFileName(file.name); setError(null); }, () => setError(new Error('That file could not be read.')));
  }
  const restart = () => { setCsv(''); setFileName(''); setResult(null); setMapping({}); setError(null); setStep('paste'); };
  const dataRows = Math.max(0, csv.split(/\r?\n/).filter((l) => l.trim()).length - 1);
  const matched = fields.filter((f) => mapping[f.key]).length;

  const header = (
    <PageHeader title="Import assets" breadcrumbs={[{ label: 'Assets', to: '/assets' }, { label: 'Import' }]}
      subtitle="Nothing is written until you have seen the preview and chosen Import." />
  );
  if (!resource) return <div className="stack">{header}<Loading /></div>;

  const shown = (result?.rows ?? []).filter((r) => !onlyProblems || r.action === 'error' || r.duplicate);
  const previewColumns = fields.filter((f) => mapping[f.key]);
  return (
    <div className="stack">
      {header}
      <Stepper label="Import steps" current={step} steps={[
        { key: 'paste', label: 'File' }, { key: 'map', label: 'Map columns' }, { key: 'preview', label: 'Preview' }, { key: 'done', label: 'Imported' },
      ]} />
      {error != null && <ErrorState title="The import could not continue" error={error} />}

      {step === 'paste' && (
        <Card title="1. Choose or paste a CSV file">
          <div
            className={`inv-drop${over ? ' is-over' : ''}${fileName ? ' has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files?.[0]); }}
          >
            <span className="inv-drop-icon" aria-hidden="true"><Icon name={fileName ? 'check' : 'upload'} size={22} /></span>
            <div>
              <Text fw={600}>{fileName ? `${fileName}: ${dataRows} ${dataRows === 1 ? 'row' : 'rows'} and ${headers.length} columns found` : 'Drop a CSV file here, or choose one'}</Text>
              <Text size="sm" c="dimmed">The first row must hold the column names. Dates as YYYY-MM-DD or month/day/year. A spreadsheet workbook: save it as CSV first.</Text>
            </div>
            <FileButton onChange={readFile} accept=".csv,text/csv,.txt">
              {(props) => <MantineButton variant="default" {...props}>{fileName ? 'Choose another file' : 'Choose file'}</MantineButton>}
            </FileButton>
          </div>
          <TextArea label="Or paste the CSV text" value={csv} onChange={(v) => { setCsv(v); setFileName(''); }} rows={8} maxRows={12}
            placeholder={'Name,Tag,Serial,Type,Site\nFront desk PC,PC-0012,ABC123,Workstation,Head office'} />
          <div className="form-actions">
            <Link className="btn btn-secondary" to="/assets">Cancel</Link>
            <Button variant="primary" disabled={!csv.trim()} onClick={toMapping}>Next: map columns</Button>
          </div>
        </Card>
      )}

      {step === 'map' && (
        <Card title="2. Match your columns to asset fields">
          <p className="muted">
            {headers.length} columns found; {matched} of them matched to a field by name. Change any that are wrong. Under each
            choice is the value from the first row of your file. Type, status and funding accept the label or the value;
            site and system are matched by name.
          </p>
          <div className="inv-map-grid">
            {fields.map((f) => (
              <Select key={f.key} label={f.label} required={f.key === 'name'} value={mapping[f.key] ?? ''} placeholder="Not imported"
                onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))} error={mapErrors[f.key]}
                hint={mapping[f.key] ? (sampleOf(mapping[f.key]) ? `First row: ${sampleOf(mapping[f.key])}` : 'First row: empty') : undefined}
                options={headers.map((h) => ({ value: h, label: h }))} />
            ))}
          </div>
          {headers.filter((h) => !Object.values(mapping).includes(h)).length > 0 && (
            <p className="muted">Not imported from your file: {headers.filter((h) => !Object.values(mapping).includes(h)).join(', ')}.</p>
          )}
          <Checkbox label="Update assets that already exist (matched by tag or serial number) instead of skipping them" checked={update} onChange={setUpdate} />
          <div className="form-actions">
            <Button onClick={() => setStep('paste')}>Back</Button>
            <Button variant="primary" loading={busy} disabled={!mapping.name} onClick={() => void run(true)}>Next: preview</Button>
          </div>
          {!mapping.name && <p className="field-error">Choose the column that holds the asset name.</p>}
        </Card>
      )}

      {(step === 'preview' || step === 'done') && result && (
        <>
          <div className="grid-stats">
            <Stat label="Rows in file" value={result.total} />
            <Stat label={step === 'done' ? 'Created' : 'Will be created'} value={step === 'done' ? result.created : result.wouldCreate ?? 0} color="green" />
            <Stat label={step === 'done' ? 'Updated' : 'Will be updated'} value={step === 'done' ? result.updated : result.wouldUpdate ?? 0} color="blue" />
            <Stat label="Duplicates" value={result.duplicates} color={result.duplicates ? 'amber' : 'gray'} />
            <Stat label="Rows with errors" value={result.errors} color={result.errors ? 'red' : 'gray'} />
          </div>
          <Card
            title={step === 'done' ? 'Result' : '3. Preview (nothing has been written yet)'}
            actions={<Checkbox label="Only show problems" checked={onlyProblems} onChange={setOnlyProblems} />}
          >
            {step === 'preview' && (
              <p className="muted">
                Rows with errors are never imported; fix them in the file and try again, or import the rest now.
                Duplicates are rows whose tag or serial number matches an existing asset or an earlier row.
              </p>
            )}
            {shown.length === 0 ? <EmptyState icon="check" title="No problems found" message="Every row is ready to import." /> : (
              <div className="table-wrap inv-wrap-cells">
                <table className="table">
                  <caption className="sr-only">Import preview, one row per line of the file</caption>
                  <thead>
                    <tr>
                      <th scope="col">Line</th><th scope="col">Result</th>
                      {previewColumns.map((f) => <th key={f.key} scope="col">{f.label}</th>)}
                      <th scope="col">Problems</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.line} className={r.action === 'error' ? 'inv-row-error' : r.action === 'skip' ? 'inv-row-skip' : undefined}>
                        <td className="num">{r.line}</td>
                        <td>
                          <StatusChip color={ACTION[r.action].color} label={ACTION[r.action].label} />
                          {r.id && <> <Link to={`/assets/${r.id}`}>{r.tag ?? 'Open'}</Link></>}
                        </td>
                        {previewColumns.map((f) => (
                          <td key={f.key}>
                            {r.errors[f.key] ? <span className="inv-cell-error">{r.errors[f.key]}</span>
                              : r.data[f.key] === undefined ? '—'
                              : typeof r.data[f.key] === 'boolean' ? (r.data[f.key] ? 'Yes' : 'No')
                              : f.type === 'ref' || f.type === 'user' ? 'Matched' : String(r.data[f.key])}
                          </td>
                        ))}
                        <td>
                          {r.duplicate && (
                            <div>
                              Same {r.duplicate.by === 'tag' ? 'tag' : 'serial number'} ({r.duplicate.value}) as{' '}
                              {r.duplicate.of === 'file' ? `line ${r.duplicate.line}` : <Link to={`/assets/${r.duplicate.id}`}>an existing asset</Link>}
                            </div>
                          )}
                          {Object.entries(r.errors).filter(([k]) => !previewColumns.some((f) => f.key === k)).map(([k, m]) => (
                            <div key={k} className="inv-cell-error">{m}</div>
                          ))}
                          {!r.duplicate && Object.keys(r.errors).length === 0 && '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="form-actions">
              {step === 'preview' ? (
                <>
                  <Button onClick={() => setStep('map')}>Back</Button>
                  <Button variant="primary" loading={busy} disabled={(result.wouldCreate ?? 0) + (result.wouldUpdate ?? 0) === 0} onClick={() => void run(false)}>
                    Import {(result.wouldCreate ?? 0) + (result.wouldUpdate ?? 0)} assets
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={restart}>Import another file</Button>
                  <Link className="btn btn-primary" to="/assets">Go to assets</Link>
                </>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
