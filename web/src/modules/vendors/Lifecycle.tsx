// The vendor's lifecycle tab (E35): when it is next reassessed, its exclusion-list checks, its issues
// and its offboardings.
import { lazy, Suspense, useState, type ComponentType, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, Modal,
  ResourceList, Select, StatusChip, TextArea, TextField, todayInZone, useAuth, useFetch, useLookup, useResource, useToast,
  useUnsavedChanges,
} from '../../core';
import type { ColorName, Row } from '../../core';
import { daysPhrase, daysUntil } from './shared';

export interface ExclusionCheck {
  id: string;
  checked_on: string;
  list_key: string;
  list_label: string;
  result: 'clear' | 'possible_match' | 'match';
  result_label: string;
  reference: string | null;
  note: string | null;
  checked_by_name: string | null;
  attachment_id: string | null;
  attachment_name: string | null;
}

interface ExclusionList {
  rows: ExclusionCheck[];
  months: number;
  due_on: string;
  overdue: boolean;
  latest_result: string | null;
  before_contract: boolean;
  can_record: boolean;
}

export const RESULT_COLOR: Record<string, ColorName> = { clear: 'green', possible_match: 'amber', match: 'red' };

/** A due date as a chip: red when passed, amber within 30 days. */
export function DueChip({ date, never = 'Never due' }: { date: string | null | undefined; never?: string }) {
  if (!date) return <StatusChip color="gray" label={never} />;
  const left = daysUntil(date);
  const color: ColorName = left < 0 ? 'red' : left <= 30 ? 'amber' : 'green';
  return <StatusChip color={color} label={`${formatDate(date)} · ${daysPhrase(left)}`} />;
}

export interface LifecycleSettings {
  cadence: { value: string; label: string; months: number | null }[];
  reminder_days: number;
  exclusion_months: number;
  exclusion_before_contract: boolean;
  can_edit: boolean;
}

interface FileRow { id: string; file_name: string }

function CheckForm({ vendorId, onDone, onCancel }: { vendorId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const lists = useLookup('exclusion_list');
  const results = useLookup('exclusion_result');
  const files = useFetch<{ rows: FileRow[] }>(useResource('vendor') ? `/api/attachments?record_type=vendor&record_id=${vendorId}` : null);
  const blank = { checked_on: todayInZone(), list_key: lists.length === 1 ? lists[0].value : '', result: '', reference: '', note: '', attachment_id: '' };
  const [start] = useState(blank);
  const [v, setV] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);
  const unsaved = useUnsavedChanges(dirty);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!v.list_key) found.list_key = 'Choose the list that was checked.';
    if (!v.result) found.result = 'Choose the result.';
    if (v.result && v.result !== 'clear' && !v.note.trim()) found.note = 'Say what was found and what happens next.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await api.post(`/api/vendors/${vendorId}/exclusion-checks`, { ...v, attachment_id: v.attachment_id || null });
      unsaved.release();
      toast.success('Exclusion-list check recorded.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Record an exclusion-list check" onClose={onCancel} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {message && <div className="form-error" role="alert">{message}</div>}
        <p className="muted">Record a check you made against an exclusion list your organization uses. The lists are yours to name under Administration &gt; Lookups (Exclusion lists).</p>
        <div className="form-grid">
          <DateField label="Checked on" required value={v.checked_on} max={todayInZone()} error={errors.checked_on} onChange={(checked_on) => setV({ ...v, checked_on })} />
          <Select label="List checked" required value={v.list_key} error={errors.list_key} options={lists.map((l) => ({ value: l.value, label: l.label }))} onChange={(list_key) => setV({ ...v, list_key })} />
          <Select label="Result" required value={v.result} error={errors.result} options={results.map((r) => ({ value: r.value, label: r.label, color: r.color }))} onChange={(result) => setV({ ...v, result })} />
          <TextField label="Search reference" hint="The reference or result number the list showed." value={v.reference} error={errors.reference} onChange={(reference) => setV({ ...v, reference })} />
        </div>
        <TextArea label="Note" required={v.result !== '' && v.result !== 'clear'} value={v.note} error={errors.note} onChange={(note) => setV({ ...v, note })} rows={3} />
        {(files.data?.rows.length ?? 0) > 0 && (
          <Select
            label="Result file" hint="A file on this vendor's Files tab that holds the result (a saved search, a screenshot)."
            value={v.attachment_id} error={errors.attachment_id}
            options={[{ value: '', label: 'None' }, ...files.data!.rows.map((f) => ({ value: f.id, label: f.file_name }))]}
            onChange={(attachment_id) => setV({ ...v, attachment_id })}
          />
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onCancel)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Record the check</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ExclusionChecks({ vendorId, onChanged }: { vendorId: string; onChanged?: () => void }) {
  const { data, error, reload } = useFetch<ExclusionList>(`/api/vendors/${vendorId}/exclusion-checks`);
  const [adding, setAdding] = useState(false);
  if (error) return <Card title="Exclusion-list checks"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Exclusion-list checks"><Loading lines={3} label="Loading exclusion-list checks" /></Card>;
  const add = data.can_record ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Record a check</Button> : undefined;
  return (
    <Card title="Exclusion-list checks" actions={data.rows.length ? add : undefined} flush={data.rows.length > 0}>
      <div className="vnd-lc-due">
        <span>Next check due</span> <DueChip date={data.due_on} />
        <span className="muted">Every {data.months} months{data.before_contract ? '; a check is also needed before a contract becomes active' : ''}.</span>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState icon="shield" title="No checks recorded" message="Record each check of this vendor against an exclusion list, with its date and result." action={add} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Exclusion-list checks, newest first</caption>
            <thead>
              <tr><th scope="col">Checked on</th><th scope="col">List</th><th scope="col">Result</th><th scope="col">Reference</th><th scope="col">Note</th><th scope="col">By</th></tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.checked_on)}</td>
                  <td>{c.list_label}</td>
                  <td><StatusChip color={RESULT_COLOR[c.result] ?? 'gray'} label={c.result_label} /></td>
                  <td>{c.reference || <span className="muted">—</span>}{c.attachment_name && <div className="muted">File: {c.attachment_name}</div>}</td>
                  <td className="vnd-wrap">{c.note || <span className="muted">—</span>}</td>
                  <td>{c.checked_by_name || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <CheckForm vendorId={vendorId} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); onChanged?.(); }} />}
    </Card>
  );
}

function Reassessment({ row }: { row: Row }) {
  const settings = useFetch<LifecycleSettings>('/api/vendors/lifecycle-settings');
  const months = settings.data?.cadence.find((c) => c.value === row.criticality)?.months ?? null;
  return (
    <Card title="Reassessment">
      <dl className="vnd-about">
        <div>
          <dt>Criticality</dt>
          <dd>{row.criticality ? <LookupChip list="vendor_criticality" value={row.criticality} /> : <span className="muted">Not set</span>}</dd>
        </div>
        <div>
          <dt>Reassessed every</dt>
          <dd>{months ? `${months} months` : <span className="muted">No cadence for this criticality</span>}</dd>
        </div>
        <div>
          <dt>Last assessed</dt>
          <dd>{row.last_assessed_on ? formatDate(row.last_assessed_on) : <span className="muted">Never</span>}</dd>
        </div>
        <div>
          <dt>Next assessment due</dt>
          <dd><DueChip date={row.next_assessment_due} /></dd>
        </div>
      </dl>
      <p className="muted">
        The next date is the last completed assessment plus the months set for the vendor&apos;s criticality.{' '}
        <Link to={`/vendors/${row.id}?tab=assessment`}>Open the assessment</Link> · <Link to="/vendors/reassessments">All reassessments due</Link>
      </p>
    </Card>
  );
}

// Corrective action plans live in the risks module (contract C1): their panel loads only when it is in the build.
interface CapPanelProps { sourceType: string; sourceId: string; source?: string }
const capLoaders = import.meta.glob<{ CapPanel: ComponentType<CapPanelProps> }>('../risks/CapPanel.tsx');
const loadCaps = Object.values(capLoaders)[0];
const LazyCaps = loadCaps ? lazy(() => loadCaps().then((m) => ({ default: m.CapPanel }))) : null;
export const capsInBuild = Boolean(LazyCaps);

export function CapsTab({ sourceType, sourceId, source }: CapPanelProps) {
  if (!LazyCaps) return null;
  return <Suspense fallback={<Loading lines={3} />}><LazyCaps sourceType={sourceType} sourceId={sourceId} source={source} /></Suspense>;
}

export function LifecycleTab({ row, onChanged }: { row: Row; onChanged?: () => void }) {
  const { can } = useAuth();
  return (
    <div className="stack">
      <div className="vnd-lc-grid">
        <Reassessment row={row} />
        <ExclusionChecks vendorId={row.id} onChanged={onChanged} />
      </div>
      <Card title="Issues" padding="sm">
        <ResourceList
          type="vendor_issue"
          baseFilter={{ vendor_id: row.id }}
          columns={['ref', 'title', 'category', 'severity', 'status', 'owner_id', 'raised_on']}
          filters={['status', 'severity']}
          bulkFields={[]}
          createFields={['title', 'contract_id', 'category', 'severity', 'owner_id', 'description']}
          createInitial={{ vendor_id: row.id }}
          extras={false}
        />
      </Card>
      <Card title="Offboardings" padding="sm">
        <ResourceList
          type="vendor_offboarding"
          baseFilter={{ vendor_id: row.id }}
          columns={['ref', 'contract_id', 'trigger', 'status', 'owner_id', 'due_on']}
          bulkFields={[]}
          createFields={can('vendors.create') ? ['contract_id', 'trigger', 'owner_id', 'due_on', 'notes'] : undefined}
          createInitial={{ vendor_id: row.id, trigger: 'vendor_exit' }}
          extras={false}
        />
      </Card>
    </div>
  );
}
