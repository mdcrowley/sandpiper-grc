// Business impact analyses: the impact of an outage over time bands, rated 1 to 5 in five areas, the
// tolerable downtime and recovery targets that follow, and the organization's own questions.
import { useMemo, useState } from 'react';
import {
  api, Button, Card, ConfirmDialog, EditableSummary, errorMessage, NumberField, PageHeader, RecordPage, ResourceList, Select, TableWrap, TextArea,
  TextField, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { ContinuityTabs, hoursText } from './shared';

const BANDS = [
  { key: '1h', label: '1 hour', hours: 1 }, { key: '4h', label: '4 hours', hours: 4 }, { key: '1d', label: '1 day', hours: 24 },
  { key: '3d', label: '3 days', hours: 72 }, { key: '1w', label: '1 week', hours: 168 },
];
const AREAS = [
  { key: 'operational', label: 'Operations' }, { key: 'safety', label: 'Harm to people' }, { key: 'financial', label: 'Financial' },
  { key: 'reputational', label: 'Reputation' }, { key: 'legal_regulatory', label: 'Legal or regulatory' },
];
const LEVELS = [
  { value: '', label: 'Not rated' }, { value: '1', label: '1 - minimal' }, { value: '2', label: '2 - minor' }, { value: '3', label: '3 - moderate' },
  { value: '4', label: '4 - major' }, { value: '5', label: '5 - severe' },
];

type Grid = Record<string, Record<string, number | null>>;

function gridOf(impacts: unknown): Grid {
  const rows = Array.isArray(impacts) ? impacts as Row[] : [];
  return Object.fromEntries(BANDS.map((b) => {
    const r: Row = rows.find((x) => x.band === b.key) ?? { id: '' };
    return [b.key, Object.fromEntries(AREAS.map((a) => [a.key, r[a.key] ?? null]))];
  }));
}

/** The first band at which any area reaches 4 (major): a suggested tolerable downtime. */
function suggested(grid: Grid): number | null {
  for (const b of BANDS) if (AREAS.some((a) => Number(grid[b.key][a.key] ?? 0) >= 4)) return b.hours;
  return null;
}

export function BiaList() {
  return (
    <div className="stack">
      <PageHeader title="Impact analyses" subtitle="How an outage of each business process hurts over time, and the downtime it can tolerate." />
      <ContinuityTabs active="processes" />
      <ResourceList type="bia" urlState
        columns={['ref', 'process_id', 'assessed_on', 'status', 'mtd_hours', 'assessor_id', 'signed_off_on']}
        filters={['process_id', 'status', 'assessed_on']} />
    </div>
  );
}

function ImpactGrid({ row, save, canEdit }: RecordContext) {
  const toast = useToast();
  const questions = (useFetch<{ value: string; label: string; active?: boolean; meta?: { kind?: string } | null }[]>('/api/lookups/bia_question').data ?? []).filter((q) => q.active !== false);
  const locked = row.status === 'signed_off';
  const editable = canEdit && !locked;
  const initial = useMemo(() => gridOf(row.impacts), [row.impacts]);
  const [grid, setGrid] = useState<Grid>(initial);
  const [answers, setAnswers] = useState<Record<string, unknown>>((row.answers as Record<string, unknown>) ?? {});
  const [hours, setHours] = useState({ mtd_hours: row.mtd_hours ?? null, rto_target_hours: row.rto_target_hours ?? null, rpo_target_hours: row.rpo_target_hours ?? null });
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(grid) !== JSON.stringify(initial) || JSON.stringify(answers) !== JSON.stringify(row.answers ?? {})
    || hours.mtd_hours !== (row.mtd_hours ?? null) || hours.rto_target_hours !== (row.rto_target_hours ?? null) || hours.rpo_target_hours !== (row.rpo_target_hours ?? null);
  const guard = useUnsavedChanges(editable && dirty);
  const hint = suggested(grid);

  const saveAll = async () => {
    setBusy(true);
    try {
      const impacts = BANDS.map((b) => ({ band: b.key, ...grid[b.key] })).filter((r) => AREAS.some((a) => r[a.key as keyof typeof r] !== null));
      await save({ impacts, answers, ...hours });
      guard.release();
      toast.success('Impact analysis saved.');
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <Card title="Impact over time" flush actions={editable && <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={saveAll}>Save</Button>}>
        <p className="bc-pad muted">Rate how badly an outage of this length hurts in each area, from 1 (minimal) to 5 (severe).</p>
        <TableWrap label="Impact by outage length and area">
          <table className="table bc-grid-table">
            <caption className="sr-only">Impact by outage length and area</caption>
            <thead><tr><th scope="col">Outage of</th>{AREAS.map((a) => <th key={a.key} scope="col">{a.label}</th>)}</tr></thead>
            <tbody>
              {BANDS.map((b) => (
                <tr key={b.key}>
                  <th scope="row">{b.label}</th>
                  {AREAS.map((a) => {
                    const v = grid[b.key][a.key];
                    return (
                      <td key={a.key} className={v ? `bc-level bc-level-${v}` : undefined}>
                        {editable ? (
                          <Select label={`${a.label} after ${b.label}`} hideLabel value={v ? String(v) : ''} options={LEVELS}
                            onChange={(x) => setGrid((g) => ({ ...g, [b.key]: { ...g[b.key], [a.key]: x ? Number(x) : null } }))} />
                        ) : (v ?? <span className="muted">-</span>)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="bc-pad">{hint ? `Suggested tolerable downtime: ${hoursText(hint)} (the first outage length rated 4 or more in any area).` : 'Rate the impacts to see a suggested tolerable downtime.'}</p>
      </Card>
      <Card title="Downtime and recovery targets">
        <div className="form-grid">
          {([['mtd_hours', 'Maximum tolerable downtime (hours)'], ['rto_target_hours', 'Recovery time target (hours)'], ['rpo_target_hours', 'Recovery point target (hours)']] as const).map(([k, label]) => (
            <NumberField key={k} label={label} min={0} value={hours[k] === null ? null : Number(hours[k])} disabled={!editable}
              onChange={(v) => setHours((h) => ({ ...h, [k]: v }))} />
          ))}
        </div>
        <p className="muted bc-small">Signing the analysis off copies these onto the process, where the gap report compares them with the recovery time of each system it depends on.</p>
      </Card>
      {questions.length > 0 && (
        <Card title="Questions">
          <div className="form-grid">
            {questions.map((q) => {
              const kind = q.meta?.kind ?? 'text';
              const value = answers[q.value];
              const set = (v: unknown) => setAnswers((x) => ({ ...x, [q.value]: v }));
              if (kind === 'yes_no') return <Select key={q.value} className="form-cell-wide" label={q.label} value={String(value ?? '')} disabled={!editable} onChange={set} options={[{ value: '', label: 'Not answered' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />;
              if (kind === 'number') return <NumberField key={q.value} className="form-cell-wide" label={q.label} min={0} value={value === undefined || value === null || value === '' ? null : Number(value)} disabled={!editable} onChange={set} />;
              return kind === 'text' && String(value ?? '').length > 80
                ? <TextArea key={q.value} className="form-cell-wide" label={q.label} value={String(value ?? '')} disabled={!editable} onChange={set} />
                : <TextField key={q.value} className="form-cell-wide" label={q.label} value={String(value ?? '')} disabled={!editable} onChange={set} />;
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function Actions({ row, save, canEdit, reload }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  if (row.status === 'signed_off') return null;
  const submit = async () => {
    setBusy(true);
    try { await save({ status: 'submitted' }); toast.success('Submitted for sign-off.'); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const signOff = async () => {
    setBusy(true);
    try { await api.post(`/api/bias/${row.id}/sign-off`); toast.success('Signed off. The process now carries these targets.'); setSigning(false); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <>
      {canEdit && row.status === 'draft' && <Button loading={busy} onClick={submit}>Submit for sign-off</Button>}
      {can('continuity.approve') && row.status === 'submitted' && <Button variant="primary" loading={busy} onClick={() => setSigning(true)}>Sign off</Button>}
      <ConfirmDialog open={signing} title="Sign off this impact analysis?" confirmLabel="Sign off" busy={busy} onConfirm={signOff} onCancel={() => setSigning(false)}
        message="Its tolerable downtime and recovery targets are copied onto the process, and the next analysis becomes due in a year. The analysis can no longer be changed." />
    </>
  );
}

export function BiaDetail() {
  return (
    <RecordPage
      type="bia"
      title={(row) => `Impact analysis: ${row._display?.process_id ?? 'business process'}`}
      actions={(rec) => <Actions {...rec} />}
      banner={({ row }) => (row.status === 'signed_off'
        ? <p className="notice notice-success">Signed off by {row.signed_off_by_name ?? 'an approver'}. Start a new analysis for the next review.</p> : null)}
      summary={({ row, reload }) => <EditableSummary type="bia" row={row} onSaved={reload} editable={row.status !== 'signed_off' && undefined} fields={['process_id', 'assessed_on', 'assessor_id', 'notes', 'signed_off_by_name', 'signed_off_on']} />}
      tabs={[{ key: 'impacts', label: 'Impacts', content: (rec) => <ImpactGrid key={String(rec.row.updated_at)} {...rec} /> }]}
    />
  );
}
