// The steps of the import wizard (ImportWizard.tsx): matching columns to fields, mapping values
// that matched nothing, and the per-row results of a check or an import.
import { useMemo, useState } from 'react';
import { Select, type Option } from './fields';
import { formatDateTime, formatNumber } from './format';
import { useLookup, type ColorName } from './meta';
import { RecordPicker, UserPicker } from './pickers';
import { StatusChip, TableWrap } from './ui';

export type ImportMode = 'create' | 'update' | 'upsert';

export interface ImportField {
  name: string; label: string; type: string; required: boolean;
  list?: string; to?: string; multiple?: boolean; custom?: boolean;
}
export interface ReadResult {
  type: string; label: string; plural: string; route: string;
  fields: ImportField[]; matchKeys: { name: string; label: string }[]; modes: ImportMode[];
  limits: { bytes: number; rows: number; columns: number };
  kind: 'csv' | 'xlsx'; sheets: string[]; sheet: string | null;
  /** Things to check before importing, such as a CSV file read as Windows-1252. */
  warnings?: string[];
  headers: string[]; sample: string[][]; rowCount: number; suggested: Record<string, string>;
}
export interface RowResult { line: number; action: 'create' | 'update' | 'skip' | 'error'; errors: Record<string, string>; reason?: string; id?: string; label?: string; key?: string }
export interface ImportSummary {
  dryRun: boolean; mode: ImportMode; matchKey: string | null;
  total: number; created: number; updated: number; skipped: number; errors: number; duplicates: number;
  rows: RowResult[]; unmatched: Record<string, string[]>;
  warnings?: string[];
}
export interface PastImport { id: string; at: string; by: string | null; file: string | null; mode: string | null; total: number | null; created: number; updated: number; skipped: number; errors: number }

export const MODE_LABELS: Record<ImportMode, string> = {
  create: 'Create new records',
  update: 'Update existing records only',
  upsert: 'Update existing records and create the rest',
};

/* ---------- Match columns ---------- */

export function MappingTable({ read, mapping, onChange }: {
  read: ReadResult; mapping: Record<string, string>; onChange: (header: string, field: string) => void;
}) {
  const options: Option[] = useMemo(() => {
    const keyOnly = read.matchKeys.filter((k) => !read.fields.some((f) => f.name === k.name));
    return [
      { value: '', label: 'Do not import' },
      ...read.fields.map((f) => ({ value: f.name, label: `${f.label}${f.required ? ' (required)' : ''}` })),
      ...keyOnly.map((k) => ({ value: k.name, label: `${k.label} (to find existing records)` })),
    ];
  }, [read]);
  const taken = new Map(Object.entries(mapping).filter(([, f]) => f).map(([h, f]) => [f, h]));
  return (
    <TableWrap label="Columns in the file and the fields they fill" className="iw-map">
      <table className="table">
        <caption className="sr-only">Columns in the file and the fields they fill</caption>
        <thead>
          <tr><th scope="col">Column in the file</th><th scope="col">Example values</th><th scope="col">Fills the field</th></tr>
        </thead>
        <tbody>
          {read.headers.map((h, i) => {
            const examples = read.sample.map((r) => r[i]).filter(Boolean).slice(0, 3).map((e) => (e.length > 40 ? `${e.slice(0, 39)}…` : e));
            const field = mapping[h] ?? '';
            const clash = field && taken.get(field) !== h;
            return (
              <tr key={h}>
                <th scope="row" className="iw-col-name">{h}</th>
                <td className="iw-examples">{examples.length ? examples.map((e, n) => <span key={n} className="iw-example">{e}</span>) : <span className="muted">Empty in the first rows</span>}</td>
                <td className="iw-field">
                  <Select label={`Field for the column "${h}"`} hideLabel value={field} options={options} searchable
                    error={clash ? 'Another column already fills this field.' : undefined}
                    onChange={(v) => onChange(h, v)} />
                  {read.suggested[h] && read.suggested[h] === field && <span className="iw-auto">Matched by name</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

/* ---------- Values that matched nothing ---------- */

function LookupValuePicker({ field, value, onChange, raw }: { field: ImportField; value: string; onChange: (v: string) => void; raw: string }) {
  const values = useLookup(field.list ?? '');
  return (
    <Select label={`${field.label} for "${raw}"`} hideLabel value={value} placeholder="Leave as a problem"
      options={[{ value: '', label: 'Leave as a problem' }, ...values.map((v) => ({ value: v.value, label: v.label, color: v.color }))]}
      onChange={onChange} />
  );
}

export function ValueMapping({ read, unmatched, valueMap, onChange }: {
  read: ReadResult;
  unmatched: Record<string, string[]>;
  valueMap: Record<string, Record<string, string>>;
  onChange: (field: string, raw: string, value: string) => void;
}) {
  const entries = Object.entries(unmatched).filter(([, list]) => list.length);
  if (!entries.length) return null;
  return (
    <section className="iw-values" aria-labelledby="iw-values-title">
      <h3 id="iw-values-title" className="iw-h3">Values that matched nothing</h3>
      <p className="muted iw-small">Choose what each value stands for, then check again. Lists match by value or label, people by user name, email or name, records by reference or title.</p>
      {entries.map(([name, list]) => {
        const field = read.fields.find((f) => f.name === name);
        if (!field) return null;
        return (
          <div key={name} className="iw-value-group">
            <div className="iw-value-field">{field.label}</div>
            <ul className="iw-value-list">
              {list.slice(0, 50).map((raw) => {
                const current = valueMap[name]?.[raw.toLowerCase()] ?? '';
                const set = (v: string | null) => onChange(name, raw, v ?? '');
                return (
                  <li key={raw} className="iw-value-row">
                    <span className="iw-raw" title={raw}>{raw}</span>
                    <span className="iw-arrow" aria-hidden="true">→</span>
                    <span className="iw-pick">
                      {field.type === 'lookup' ? <LookupValuePicker field={field} raw={raw} value={current} onChange={set} />
                        : field.type === 'user' ? <UserPicker label={`${field.label} for "${raw}"`} hideLabel value={current || null} onChange={set} placeholder="Find a person" />
                        : <RecordPicker label={`${field.label} for "${raw}"`} hideLabel type={field.to ?? ''} value={current || null} onChange={set} placeholder="Find a record" />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/* ---------- Results ---------- */

const ACTION: Record<RowResult['action'], { label: string; done: string; color: ColorName }> = {
  create: { label: 'Will create', done: 'Created', color: 'green' },
  update: { label: 'Will update', done: 'Updated', color: 'blue' },
  skip: { label: 'Will skip', done: 'Skipped', color: 'gray' },
  error: { label: 'Problem', done: 'Not imported', color: 'red' },
};

export function SummaryTiles({ s }: { s: ImportSummary }) {
  const tiles: [string, number, ColorName][] = [
    [s.dryRun ? 'To create' : 'Created', s.created, 'green'],
    [s.dryRun ? 'To update' : 'Updated', s.updated, 'blue'],
    [s.dryRun ? 'To skip' : 'Skipped', s.skipped, 'gray'],
    ['With problems', s.errors, 'red'],
  ];
  return (
    <div className="iw-tiles" role="status">
      {tiles.map(([label, n, color]) => (
        <div key={label} className={`iw-tile iw-tile-${color}`}>
          <span className="iw-tile-value">{formatNumber(n)}</span>
          <span className="iw-tile-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

const fieldLabel = (read: ReadResult, name: string) =>
  name === '_row' ? '' : read.fields.find((f) => f.name === name)?.label ?? read.matchKeys.find((k) => k.name === name)?.label ?? '';

export function RowResults({ read, s }: { read: ReadResult; s: ImportSummary }) {
  const [show, setShow] = useState<'problems' | 'all'>(s.errors || s.skipped ? 'problems' : 'all');
  const rows = s.rows.filter((r) => show === 'all' || r.action === 'error' || r.action === 'skip');
  const shown = rows.slice(0, 300);
  return (
    <section className="iw-rows" aria-labelledby="iw-rows-title">
      <div className="iw-rows-head">
        <h3 id="iw-rows-title" className="iw-h3">Rows</h3>
        <div className="iw-rows-filter">
          <Select label="Show" hideLabel required value={show} onChange={(v) => setShow(v as 'problems' | 'all')} size="xs"
            options={[{ value: 'problems', label: 'Rows with problems or skipped' }, { value: 'all', label: 'All rows' }]} />
        </div>
      </div>
      {!rows.length ? (
        <p className="muted iw-small">{show === 'problems' ? 'No problems: every row can be imported.' : 'No rows.'}</p>
      ) : (
        <TableWrap label="Import results by row">
          <table className="table iw-results">
            <thead><tr><th scope="col" className="num">Row</th><th scope="col">Result</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.line}>
                  <td className="num">{r.line}</td>
                  <td><StatusChip size="sm" color={ACTION[r.action].color} label={s.dryRun ? ACTION[r.action].label : ACTION[r.action].done} /></td>
                  <td>
                    {r.reason && <div>{r.reason}</div>}
                    {Object.entries(r.errors).map(([k, msg]) => (
                      <div key={k} className="iw-error">{fieldLabel(read, k) && !msg.startsWith(fieldLabel(read, k)) ? `${fieldLabel(read, k)}: ` : ''}{msg}</div>
                    ))}
                    {!r.reason && !Object.keys(r.errors).length && <span className="muted">{r.label || r.key || (r.action === 'update' ? 'Matches an existing record' : 'Ready')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {rows.length > shown.length && <p className="muted iw-small">The first {shown.length} of {formatNumber(rows.length)} rows are listed.</p>}
    </section>
  );
}

export function PastImports({ rows }: { rows: PastImport[] }) {
  if (!rows.length) return <p className="muted iw-small">No imports yet.</p>;
  return (
    <TableWrap label="Past imports">
      <table className="table iw-history">
        <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">File</th><th scope="col">Result</th></tr></thead>
        <tbody>
          {rows.slice(0, 10).map((r) => (
            <tr key={r.id}>
              <td>{formatDateTime(r.at)}</td>
              <td>{r.by ?? 'Unknown'}</td>
              <td className="iw-file-name">{r.file ?? '—'}</td>
              <td>{`${r.created} created, ${r.updated} updated, ${r.skipped} skipped${r.errors ? `, ${r.errors} not imported` : ''}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
