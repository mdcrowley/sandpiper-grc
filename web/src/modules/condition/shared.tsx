// Shared pieces of the asset condition pages (E32): section tabs, the kinds of record a class
// rates, the "past useful life" chip and the condition section shown on asset, site and vehicle pages.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, formatDate, formatNumber, KeyValue, Loading, LookupChip, Modal, ResourceForm, StatusChip, TableWrap, Tabs,
  todayInZone, useAuth, useFetch, useResource,
} from '../../core';
import type { ListResult, Row } from '../../core';

const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', path: '/condition' },
  { key: 'classes', label: 'Asset classes', path: '/condition/classes' },
  { key: 'assessments', label: 'Assessments', path: '/condition/assessments' },
  { key: 'aging', label: 'Aging', path: '/condition/aging' },
] as const;

export function ConditionTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Asset condition sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/condition')} />
  );
}

export type TargetType = 'vehicle' | 'asset' | 'site';

export const TARGET_INFO: Record<TargetType, { path: string; api: string; module: string; plural: string; fields: string[]; matchField: string }> = {
  vehicle: { path: '/vehicles', api: '/api/vehicles', module: 'fleet', plural: 'vehicles', fields: ['asset_class_id', 'odometer_miles', 'replacement_project_id'], matchField: 'mode' },
  asset: { path: '/assets', api: '/api/assets', module: 'assets', plural: 'assets', fields: ['asset_class_id', 'in_service_date', 'replacement_project_id'], matchField: 'asset_type' },
  site: { path: '/sites', api: '/api/sites', module: 'sites', plural: 'sites', fields: ['asset_class_id', 'site_kind', 'built_year', 'in_use', 'replacement_project_id'], matchField: 'site_kind' },
};

export const isTargetType = (v: unknown): v is TargetType => v === 'vehicle' || v === 'asset' || v === 'site';

/** "a, b and c" (or "a, b or c"). */
const listOf = (words: string[], last: 'and' | 'or') => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} ${last} ${words[words.length - 1]}`);

/**
 * The kinds of record a class can rate, in words, without vehicles while the fleet area is switched
 * off: { plural: "vehicles, assets and sites", pluralOr: "vehicles, assets or sites", singularOr:
 * "vehicle, asset or site" }. A switched-off area is named nowhere but Administration > Features.
 */
export function useTargetWords() {
  const { areaOn } = useAuth();
  const kinds = (['vehicle', 'asset', 'site'] as const).filter((t) => t !== 'vehicle' || areaOn('fleet'));
  const plural = kinds.map((t) => TARGET_INFO[t].plural);
  return { plural: listOf(plural, 'and'), pluralOr: listOf(plural, 'or'), singularOr: listOf([...kinds], 'or') };
}

/** The first letter in capitals. */
export const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Past useful life", "Ends within a year" or nothing. */
export function LifeChip({ end, today = todayInZone() }: { end: string | null | undefined; today?: string }) {
  if (!end) return null;
  if (end < today) return <StatusChip color="red" label="Past useful life" size="sm" />;
  const inAYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  if (end <= inAYear) return <StatusChip color="amber" label="Ends within a year" size="sm" />;
  return null;
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

interface Suggestion { id: string; ref: string; name: string; suggested: boolean }

/**
 * The condition of one vehicle, asset or site: its class, latest rating, useful life and
 * replacement, with its assessment history, "Record assessment" and "Edit condition details".
 * Shown only to people who may view assets (condition records are filed under assets).
 */
export function ConditionSection({ recordType, recordId }: { recordType: TargetType; recordId: string }) {
  const { can } = useAuth();
  const info = TARGET_INFO[recordType];
  const resource = useResource(recordType);
  const allowed = can('assets.view');
  const record = useFetch<Row>(allowed ? `${info.api}/${recordId}` : null);
  const history = useFetch<ListResult<Row>>(!allowed ? null :
    `/api/condition-assessments?f.target_type=${recordType}&f.target_id=${recordId}&sort=assessed_on&dir=desc&pageSize=10`);
  const row = record.data;
  const suggestions = useFetch<Suggestion[]>(row ? `/api/asset-classes/suggest?type=${recordType}&value=${encodeURIComponent(String(row[info.matchField] ?? ''))}` : null);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  if (!allowed) return null;

  if (record.error) return <Card title="Condition"><ErrorState error={record.error} onRetry={record.reload} /></Card>;
  if (!row) return <Card title="Condition"><Loading lines={3} label="Loading the condition" /></Card>;
  const editable = can(`${info.module}.edit`);
  const fields = info.fields.filter((f) => resource?.fields[f]);
  const suggested = suggestions.data?.find((s) => s.suggested);
  const hint = suggested && suggested.id !== row.asset_class_id ? `Suggested for this one: ${suggested.name}.` : undefined;
  const display = (row._display ?? {}) as Record<string, string>;
  const reload = () => { record.reload(); history.reload(); };

  return (
    <Card title="Condition" actions={<>
      {editable && fields.length > 0 && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit condition details</Button>}
      {can('assets.create') && <Button size="sm" variant="primary" icon="plus" onClick={() => setRecording(true)}>Record assessment</Button>}
    </>}>
      <div className="stack">
        <KeyValue layout="columns" compact items={[
          { label: 'Asset class', value: row.asset_class_id ? <Link to={`/condition/classes/${row.asset_class_id}`}>{display.asset_class_id ?? 'Open the class'}</Link> : null, hint },
          { label: 'Condition', value: row.condition_rating ? <LookupChip list="condition_rating" value={row.condition_rating} /> : <span className="muted">Not assessed yet</span> },
          { label: 'Assessed on', value: row.condition_assessed_on ? formatDate(row.condition_assessed_on) : null },
          { label: 'End of useful life', value: row.useful_life_end ? <span className="cnd-life">{formatDate(row.useful_life_end)} <LifeChip end={row.useful_life_end} /></span> : null,
            hint: row.asset_class_id && !row.useful_life_end ? 'Needs a date to count from (in service, purchase or year built).' : undefined },
          ...(recordType === 'site' && resource?.fields.site_kind ? [
            { label: 'Kind of site', value: row.site_kind ? <LookupChip list="site_kind" value={row.site_kind} /> : null },
            { label: 'Year built', value: row.built_year ? String(row.built_year) : null },
          ] : []),
          ...(recordType === 'asset' && resource?.fields.in_service_date ? [{ label: 'In service since', value: row.in_service_date ? formatDate(row.in_service_date) : null, hint: row.in_service_date ? undefined : 'The purchase date stands in.' }] : []),
          ...(recordType === 'vehicle' && resource?.fields.odometer_miles ? [{ label: 'Odometer', value: row.odometer_miles === null || row.odometer_miles === undefined ? null : `${formatNumber(row.odometer_miles)} miles`, hint: row.odometer_read_on ? `Read on ${formatDate(row.odometer_read_on)}` : undefined }] : []),
          { label: 'Replacement project', value: row.replacement_project_id ? <Link to={`/projects/${row.replacement_project_id}`}>{display.replacement_project_id ?? 'Open the project'}</Link> : null },
        ]} />
        <h3 className="cnd-subhead">Assessments</h3>
        {history.error ? <ErrorState error={history.error} onRetry={history.reload} />
          : !history.data ? <Loading lines={2} label="Loading the assessments" />
            : history.data.rows.length === 0 ? <EmptyState icon="clipboard" title="No assessments yet" message="Record the first one to rate its condition." />
              : (
                <TableWrap label="Condition assessments, newest first">
                  <table className="table">
                    <caption className="sr-only">Condition assessments, newest first</caption>
                    <thead><tr><th scope="col">Assessed on</th><th scope="col">Condition</th><th scope="col">Method</th><th scope="col">By</th><th scope="col">Reference</th></tr></thead>
                    <tbody>
                      {history.data.rows.map((a) => (
                        <tr key={a.id}>
                          <td>{formatDate(a.assessed_on)}</td>
                          <td><LookupChip list="condition_rating" value={a.rating} /></td>
                          <td>{a._display?.method ?? '—'}</td>
                          <td>{a._display?.assessor_id ?? a.assessor_name ?? '—'}</td>
                          <td><Link to={`/condition/assessments/${a.id}`} className="ref">{a.ref}</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
      </div>

      <Modal open={recording} title="Record a condition assessment" onClose={() => setRecording(false)} dirty={dirty}>
        {recording && (
          <ResourceForm type="condition_assessment" fields={['assessed_on', 'rating', 'method', 'assessor_id', 'assessor_name', 'notes']}
            initial={{ target_type: recordType, target_id: recordId, assessed_on: todayInZone() }}
            onDirtyChange={setDirty} submitLabel="Save assessment"
            onSaved={() => { setRecording(false); reload(); }} onCancel={() => setRecording(false)} />
        )}
      </Modal>
      <Modal open={editing} title="Condition details" onClose={() => setEditing(false)} dirty={dirty}>
        {editing && (
          <ResourceForm type={recordType} id={recordId} initial={row} fields={fields} hints={hint ? { asset_class_id: hint } : undefined}
            onDirtyChange={setDirty} onSaved={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />
        )}
      </Modal>
    </Card>
  );
}
