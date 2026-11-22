// Asset classes (E32-01, E32-03): the list, and one class with its benchmark, yearly targets and
// members (the vehicles, assets or sites in it, soonest end of useful life first).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, NumberField, PageHeader, RecordPage,
  ResourceList, StatusChip, TableWrap, TextField, todayInZone, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { Row } from '../../core';
import { capitalized, ConditionTabs, LifeChip, pct, TARGET_INFO, useTargetWords } from './shared';

const CLASS_FIELDS = ['name', 'applies_to', 'category', 'useful_life_years', 'useful_life_miles', 'poor_rating_at', 'assessment_every_months', 'owner_id', 'active', 'matches', 'description'];

export function ClassList() {
  const words = useTargetWords();
  return (
    <div className="stack">
      <PageHeader title="Asset classes" subtitle={`Each class sets the useful life its ${words.pluralOr} are measured against.`} />
      <ConditionTabs active="classes" />
      <ResourceList
        type="asset_class"
        urlState
        columns={['ref', 'name', 'applies_to', 'category', 'useful_life_years', 'useful_life_miles', 'active', { field: 'owner_id', hidden: true }, { field: 'poor_rating_at', hidden: true }]}
        filters={['applies_to', 'category', 'active', 'owner_id']}
        createFields={CLASS_FIELDS}
      />
    </div>
  );
}

const STATUS: Record<string, { color: 'green' | 'amber' | 'gray'; label: string }> = {
  approved: { color: 'green', label: 'Approved' },
  pending_approval: { color: 'amber', label: 'Waiting for approval' },
  draft: { color: 'gray', label: 'Draft' },
};

interface Target { id: string; year: number; target_pct: number; status: string; approved_on: string | null; approved_by_name: string | null; decision_ref: string | null; note: string | null }

function TargetsTab({ classId }: { classId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const url = `/api/asset-classes/${classId}/targets`;
  const { data, error, reload } = useFetch<Target[]>(url);
  const thisYear = Number(todayInZone().slice(0, 4));
  const [year, setYear] = useState<number | null>(thisYear);
  const [value, setValue] = useState<number | null>(null);
  const [decision, setDecision] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unsaved = useUnsavedChanges(value !== null || !!decision.trim());

  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={4} label="Loading the targets" /></Card>;

  const save = async () => {
    if (!year) { setErrors({ year: 'Enter a year.' }); return; }
    setBusy(true); setErrors({});
    try {
      await api.put(`${url}/${year}`, { target_pct: value, decision_ref: decision || undefined });
      unsaved.release();
      toast.success(`Target for ${year} saved.`);
      setValue(null); setDecision('');
      reload();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  const ask = async (t: Target) => {
    setBusy(true);
    try {
      const res = await api.post<{ status: string; workflow: string }>(`${url}/${t.year}/approval`, {});
      toast.success(res.status === 'running' ? `Approval asked for (${res.workflow}).` : `The approval finished: ${res.status}.`);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const approve = async (t: Target) => {
    setBusy(true);
    try {
      await api.post(`${url}/${t.year}/approve`, {});
      toast.success(`Target for ${t.year} approved.`);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      {can('assets.edit') && (
        <Card title="Set a yearly target">
          <div className="stack">
            <p className="muted cnd-hint">The most of this class that may be past its useful life in that year, as a percentage. Changing an approved target makes it a draft again.</p>
            <div className="cnd-bar">
              <NumberField label="Year" value={year} onChange={setYear} min={2000} max={2100} step={1} error={errors.year} />
              <NumberField label="Target (%)" value={value} onChange={setValue} min={0} max={100} error={errors.target_pct} required />
              <TextField label="Decision reference" value={decision} onChange={setDecision} hint="For example the meeting decision that set it" />
              <Button variant="primary" loading={busy} onClick={save}>Save target</Button>
            </div>
          </div>
        </Card>
      )}
      <Card title="Targets by year" flush>
        {data.length === 0 ? <EmptyState icon="target" title="No targets yet" message="Set the most of this class that may be past its useful life each year." /> : (
          <TableWrap label="Yearly targets">
            <table className="table">
              <caption className="sr-only">Yearly targets, newest year first</caption>
              <thead><tr><th scope="col">Year</th><th scope="col" className="num">Target</th><th scope="col">Status</th><th scope="col">Approved</th><th scope="col">Decision reference</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td>{t.year}</td>
                    <td className="num">{pct(t.target_pct)}</td>
                    <td><StatusChip size="sm" {...(STATUS[t.status] ?? STATUS.draft)} /></td>
                    <td>{t.approved_on ? `${formatDate(t.approved_on)}${t.approved_by_name ? `, ${t.approved_by_name}` : ''}` : '—'}</td>
                    <td>{t.decision_ref ?? '—'}</td>
                    <td><span className="cnd-life">
                      {t.status === 'draft' && can('assets.edit') && <Button size="sm" loading={busy} onClick={() => ask(t)}>Ask for approval</Button>}
                      {t.status !== 'approved' && can('assets.approve') && <Button size="sm" loading={busy} onClick={() => approve(t)}>Approve now</Button>}
                    </span></td>
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

interface Member {
  type: 'vehicle' | 'asset' | 'site'; id: string; label: string; route: string; useful_life_end: string | null; past: boolean;
  condition_rating: string | null; condition_assessed_on: string | null; next_assessment_due: string | null; excluded: boolean;
  age_years: number | null; replacement_project_id: string | null; replacement_project: string | null;
}

function MembersTab({ cls }: { cls: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<{ today: string; total: number; rows: Member[] }>(`/api/condition/aging?class=${cls.id}`);
  const [busy, setBusy] = useState(false);
  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={6} label="Loading the members" /></Card>;
  const info = TARGET_INFO[cls.applies_to as keyof typeof TARGET_INFO];
  const recompute = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ changed: number }>(`/api/asset-classes/${cls.id}/recompute`, {});
      toast.success(res.changed ? `${res.changed} end${res.changed === 1 ? '' : 's'} of useful life updated.` : 'Every end of useful life was already up to date.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title={`Members (${data.total})`} flush actions={can('assets.edit') ? <Button size="sm" icon="refresh" loading={busy} onClick={recompute}>Recompute useful life</Button> : undefined}>
      {data.rows.length === 0 ? (
        <EmptyState icon="box" title="Nothing in this class that you may see"
          message={info ? `Choose this class on the ${info.plural} it rates (their Condition section).` : 'Choose this class on the records it rates.'} />
      ) : (
        <TableWrap label="Records in this class">
          <table className="table">
            <caption className="sr-only">Records in this class, soonest end of useful life first</caption>
            <thead><tr><th scope="col">Record</th><th scope="col">End of useful life</th><th scope="col" className="num">Age</th><th scope="col">Condition</th><th scope="col">Next assessment</th><th scope="col">Replacement</th></tr></thead>
            <tbody>
              {data.rows.map((m) => (
                <tr key={`${m.type}:${m.id}`}>
                  <td><Link to={m.route}>{m.label}</Link>{m.excluded && <> <StatusChip color="gray" size="sm" label="Not counted" title="Retired, disposed or no longer in use" /></>}</td>
                  <td><span className="cnd-life">{m.useful_life_end ? formatDate(m.useful_life_end) : '—'} <LifeChip end={m.useful_life_end} today={data.today} /></span></td>
                  <td className="num">{m.age_years === null ? '—' : `${m.age_years} y`}</td>
                  <td>{m.condition_rating ? <LookupChip list="condition_rating" value={m.condition_rating} /> : <span className="muted">Not assessed</span>}</td>
                  <td>{m.next_assessment_due ? <span className={m.next_assessment_due < data.today ? 'cnd-over' : undefined}>{formatDate(m.next_assessment_due)}</span> : '—'}</td>
                  <td>{m.replacement_project_id ? <Link to={`/projects/${m.replacement_project_id}`}>{m.replacement_project}</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function ClassDetail() {
  return (
    <RecordPage
      type="asset_class"
      summaryFields={CLASS_FIELDS}
      tabs={[
        { key: 'targets', label: 'Targets by year', content: ({ row }) => <TargetsTab classId={row.id} /> },
        { key: 'members', label: 'Members', content: ({ row }) => <MembersTab cls={row} /> },
      ]}
    />
  );
}
