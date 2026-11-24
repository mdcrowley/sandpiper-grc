import { lazy, Suspense, useEffect, useState, type ComponentType, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading, LookupChip, LookupSelect,
  Modal, PageHeader, RecordPage, ResourceList, Stat, StatusChip, TableWrap, TextArea, TextField, todayInZone, useFetch, useMeta, useToast,
} from '../../core';
import type { ListResult, RecordContext, Row, StatsResult } from '../../core';
import { DueChip } from './scales';
import { addDays } from '../../../../shared/dates.ts';

// The attachments module supplies the evidence panel. It is found at build time and loaded on
// first use, so this module still builds and runs when that folder is absent.
const loaders = import.meta.glob<{ AttachmentsPanel: ComponentType<{ recordType: string; recordId: string; evidence?: boolean }> }>(
  '../attachments/AttachmentsPanel.tsx',
);
const load = Object.values(loaders)[0];
const AttachmentsPanel = load ? lazy(() => load().then((m) => ({ default: m.AttachmentsPanel }))) : null;

// The controls covering an obligation (E26-11), from the control library when it is part of the build.
// The panel renders nothing while the controls area is off or without controls.view.
const controlsLoaders = import.meta.glob<{ ControlsPanel: ComponentType<{ recordType: string; recordId: string }> }>('../controls/ControlsPanel.tsx');
const loadControls = Object.values(controlsLoaders)[0];
const ControlsPanel = loadControls ? lazy(() => loadControls().then((m) => ({ default: m.ControlsPanel }))) : null;

/** One entry of an obligation's "Applies to": a name, or a record of another type. */
interface AppliesTo { label: string; type?: string; id?: string }

/** The names and records an obligation applies to, as chips; records link to their page when the type is shown. */
export function AppliesToChips({ value }: { value: unknown }) {
  const { resources } = useMeta();
  const list = Array.isArray(value) ? (value as AppliesTo[]) : [];
  if (!list.length) return <span className="muted">Not set</span>;
  return (
    <span className="rk-applies">
      {list.map((e, i) => {
        const def = e.type ? resources[e.type] : undefined;
        // A record whose type is switched off or not shown to this person is listed by name only.
        return def && e.id
          ? <Link key={`${e.type}:${e.id}`} className="chip chip-blue" to={`${def.route}/${e.id}`}>{e.label}</Link>
          : <span key={`${e.label}:${i}`} className="chip chip-gray">{e.label}</span>;
      })}
    </span>
  );
}

/** The obligations register: what must be done, whether it is met, and what is due next. */
export function ObligationList() {
  const today = todayInZone();
  const soon = addDays(today, 30);
  const stats = useFetch<StatsResult>('/api/obligations/stats?group=status');
  const overdue = useFetch<ListResult>(`/api/obligations?f.next_due_on.lt=${today}&pageSize=1`);
  const due = useFetch<ListResult>(`/api/obligations?f.next_due_on.gte=${today}&f.next_due_on.lte=${soon}&pageSize=1`);
  const count = (value: string) => stats.data?.groups.find((g) => g.value === value);

  return (
    <div className="stack">
      <PageHeader
        title="Obligations"
        subtitle="What the organization is required to do, how often, who owns each requirement, how it is met and when it is next due."
        actions={<Link className="btn btn-secondary" to="/regulatory-changes">Regulatory changes</Link>}
      />
      <div className="grid-stats">
        <Stat label="Obligations" value={stats.data?.total ?? '–'} color="blue" icon="scale" />
        <Stat label={count('not_met')?.label ?? 'Not met'} value={count('not_met')?.count ?? 0} color={(count('not_met')?.count ?? 0) > 0 ? 'red' : 'green'} to="/obligations?f.status=not_met" />
        <Stat label={count('partly_met')?.label ?? 'Partly met'} value={count('partly_met')?.count ?? 0} color="amber" to="/obligations?f.status=partly_met" />
        <Stat label="Overdue" value={overdue.data?.total ?? '–'} color={(overdue.data?.total ?? 0) > 0 ? 'red' : 'green'} to={`/obligations?f.next_due_on.lt=${today}&sort=next_due_on&dir=asc`} hint="Next due date has passed" />
        <Stat label="Due in 30 days" value={due.data?.total ?? '–'} color="amber" to={`/obligations?f.next_due_on.gt=${addDays(today, -1)}&f.next_due_on.lt=${addDays(soon, 1)}&sort=next_due_on&dir=asc`} hint="Not yet overdue" />
      </div>
      <ResourceList
        type="obligation"
        urlState
        columns={[
          'ref', 'title', 'type', 'frequency', 'status', 'owner_id',
          {
            field: 'next_due_on', label: 'Next due', sortable: true,
            render: (row) => (row.next_due_on
              ? <span className="rk-two-line"><span>{formatDate(row.next_due_on)}</span><DueChip date={row.next_due_on} warnDays={30} /></span>
              : <span className="muted">No date</span>),
          },
          { field: 'applies_to', label: 'Applies to', hidden: true, render: (row) => <AppliesToChips value={row.applies_to} /> },
          { field: 'source', hidden: true }, { field: 'last_attested_on', hidden: true },
          { field: 'how_met', hidden: true }, { field: 'evidence', hidden: true },
        ]}
        filters={['status', 'type', 'frequency', 'owner_id', 'next_due_on']}
        bulkFields={['status', 'type', 'frequency', 'owner_id', 'next_due_on']}
        defaultSort={{ field: 'next_due_on', dir: 'asc' }}
        createFields={['title', 'source', 'type', 'frequency', 'requirement', 'owner_id', 'how_met', 'evidence', 'next_due_on', 'status']}
      />
    </div>
  );
}

/** Edits the free-text names an obligation applies to; records named by other modules are kept. */
function AppliesToCard({ rec }: { rec: RecordContext }) {
  const toast = useToast();
  const list: AppliesTo[] = Array.isArray(rec.row.applies_to) ? rec.row.applies_to : [];
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (next: AppliesTo[]) => {
    setSaving(true);
    setError('');
    try {
      await rec.save({ applies_to: next });
      setName('');
      rec.reload();
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.applies_to ? err.fields.applies_to : errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void save([...list, { label: name.trim() }]);
  };

  return (
    <Card title="Applies to">
      {list.length === 0 && <p className="muted" style={{ margin: 0 }}>Not set. Name the services, sites, modes or departments this obligation covers.</p>}
      {list.length > 0 && (
        <ul className="rk-applies-list" aria-label="Applies to">
          {list.map((e, i) => (
            <li key={e.type ? `${e.type}:${e.id}` : `${e.label}:${i}`}>
              <AppliesToChips value={[e]} />
              {rec.canEdit && !e.type && (
                <IconButton icon="x" label={`Remove ${e.label}`} size="sm" disabled={saving} onClick={() => void save(list.filter((_, j) => j !== i))} />
              )}
            </li>
          ))}
        </ul>
      )}
      {rec.canEdit && (
        <form className="rk-applies-add" onSubmit={add} noValidate>
          <TextField label="Add a name" value={name} onChange={setName} error={error || undefined} hint="For example: Bus operations, North depot, Paratransit." />
          <Button type="submit" size="sm" icon="plus" loading={saving} disabled={!name.trim()}>Add</Button>
        </form>
      )}
    </Card>
  );
}

interface Period {
  id: string; period_start: string; period_end: string; due_on: string | null; status: string | null;
  attested_by_name: string | null; attested_on: string | null; note: string | null; evidence: string | null;
}
interface Periods { periods: Period[]; next: { period_start: string; period_end: string; due_on: string } | null; months: number }

/** Attests one period: adds it first when it is not recorded yet. */
function AttestDialog({ obligationId, period, suggested, onClose, onDone }: {
  obligationId: string;
  /** The period to attest, or null to add one first (with the suggested dates). */
  period: Period | null;
  suggested: Periods['next'];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [status, setStatus] = useState('met');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStart(period?.period_start ?? suggested?.period_start ?? '');
    setEnd(period?.period_end ?? suggested?.period_end ?? '');
    setDueOn(period?.due_on ?? suggested?.due_on ?? '');
    setStatus(period?.status ?? 'met');
    setNote(period?.note ?? '');
    setEvidence(period?.evidence ?? '');
    setErrors({});
    setMessage('');
  }, [period, suggested]);
  const dirty = start !== (period?.period_start ?? suggested?.period_start ?? '') || end !== (period?.period_end ?? suggested?.period_end ?? '')
    || dueOn !== (period?.due_on ?? suggested?.due_on ?? '') || status !== (period?.status ?? 'met')
    || note !== (period?.note ?? '') || evidence !== (period?.evidence ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setErrors({});
    try {
      const target = period ?? await api.post<Period>(`/api/obligations/${obligationId}/periods`, { period_start: start, period_end: end, due_on: dueOn || null });
      const res = await api.post<{ obligation: Row }>(`/api/obligations/${obligationId}/periods/${target.id}/attest`, { status, note, evidence });
      toast.success(res.obligation.next_due_on ? `Period attested. Next due ${formatDate(res.obligation.next_due_on)}.` : 'Period attested.');
      onDone();
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : {});
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={period ? 'Attest period' : 'Add and attest a period'} size="md" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {message && <p role="alert" className="form-error">{message}</p>}
        {period ? (
          <p className="muted" style={{ margin: 0 }}>Period {formatDate(period.period_start)} to {formatDate(period.period_end)}{period.due_on ? `, due ${formatDate(period.due_on)}` : ''}.</p>
        ) : (
          <div className="form-grid">
            <DateField label="Period starts" required value={start} onChange={setStart} error={errors.period_start} />
            <DateField label="Period ends" required value={end} onChange={setEnd} error={errors.period_end} />
            <DateField label="Due" value={dueOn} onChange={setDueOn} error={errors.due_on} hint="Defaults to the end of the period." />
          </div>
        )}
        <LookupSelect list="obligation_status" only={['met', 'partly_met', 'not_met']} label="Was it met?" required value={status} onChange={(v) => setStatus(v || 'met')} error={errors.status} />
        <TextArea label="Note" rows={3} value={note} onChange={setNote} error={errors.note} hint={status === 'met' ? 'Optional.' : 'Required: what was not met, and what is being done about it.'} />
        <TextArea label="Evidence" rows={2} value={evidence} onChange={setEvidence} error={errors.evidence} hint="Where the proof is: a receipt, a report, a file attached to this obligation." />
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>Attest</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

/** The periods of a recurring obligation and their attestations. */
function PeriodsPanel({ rec }: { rec: RecordContext }) {
  const { row } = rec;
  const { data, error, reload } = useFetch<Periods>(`/api/obligations/${row.id}/periods`);
  const [attesting, setAttesting] = useState<Period | 'new' | null>(null);
  const today = todayInZone();
  const done = () => { reload(); rec.reload(); };

  return (
    <Card
      title="Periods"
      actions={rec.canEdit && <Button size="sm" icon="check" onClick={() => setAttesting('new')}>Attest a period</Button>}
      flush
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="rk-panel-pad"><Loading lines={3} label="Loading periods" /></div>
        : (
          <>
            {data.next && (
              <p className="rk-panel-pad muted" style={{ margin: 0 }}>
                Next period to attest: {formatDate(data.next.period_start)} to {formatDate(data.next.period_end)}, due {formatDate(data.next.due_on)}.
              </p>
            )}
            {!row.frequency && <p className="rk-panel-pad muted" style={{ margin: 0 }}>Set a frequency to have the next due date move on by itself when a period is attested.</p>}
            {data.periods.length === 0 ? (
              <EmptyState icon="calendar" title="No periods attested yet" message="Attest a period to record whether the obligation was met for it, with the evidence." />
            ) : (
              <TableWrap label="Periods of this obligation">
                <table className="table">
                  <caption className="sr-only">Periods of this obligation</caption>
                  <thead>
                    <tr><th scope="col">Period</th><th scope="col">Due</th><th scope="col">Result</th><th scope="col">Attested</th><th scope="col">Note and evidence</th>{rec.canEdit && <th scope="col" aria-label="Attest" />}</tr>
                  </thead>
                  <tbody>
                    {data.periods.map((p) => (
                      <tr key={p.id} className={!p.status && p.due_on && p.due_on < today ? 'is-overdue-row' : undefined}>
                        <td>{formatDate(p.period_start)} to {formatDate(p.period_end)}</td>
                        <td>{p.due_on ? formatDate(p.due_on) : <span className="muted">No date</span>}</td>
                        <td>{p.status ? <LookupChip list="obligation_status" value={p.status} /> : <StatusChip color={p.due_on && p.due_on < today ? 'red' : 'gray'} label="To attest" />}</td>
                        <td>{p.attested_on ? <span className="rk-two-line"><span>{formatDate(p.attested_on)}</span><span className="muted">{p.attested_by_name ?? 'System'}</span></span> : <span className="muted">Not yet</span>}</td>
                        <td>
                          {p.note && <span className="prose">{p.note}</span>}
                          {p.evidence && <span className="muted prose">{p.note ? ' · ' : ''}{p.evidence}</span>}
                          {!p.note && !p.evidence && <span className="muted">None</span>}
                        </td>
                        {rec.canEdit && <td><Button size="sm" onClick={() => setAttesting(p)}>{p.status ? 'Correct' : 'Attest'}</Button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </>
        )}
      {attesting && (
        <AttestDialog
          obligationId={row.id}
          period={attesting === 'new' ? null : attesting}
          suggested={data?.next ?? null}
          onClose={() => setAttesting(null)}
          onDone={done}
        />
      )}
    </Card>
  );
}

export function ObligationDetail() {
  return (
    <RecordPage
      type="obligation"
      subtitle={(row) => row.source}
      banner={({ row }) => (
        <div className="rk-obl-banner">
          <div>
            <span className="rk-step-label">Status</span>
            <LookupChip list="obligation_status" value={row.status} />
          </div>
          <div>
            <span className="rk-step-label">Next due</span>
            <span className="row">
              <strong>{row.next_due_on ? formatDate(row.next_due_on) : 'No date set'}</strong>
              {row.next_due_on && <DueChip date={row.next_due_on} warnDays={30} />}
            </span>
          </div>
          <div>
            <span className="rk-step-label">Frequency</span>
            {row.frequency ? <LookupChip list="obligation_frequency" value={row.frequency} /> : <span className="muted">Not set</span>}
          </div>
          <div>
            <span className="rk-step-label">Last attested</span>
            <span>{row.last_attested_on ? formatDate(row.last_attested_on) : <span className="muted">Never</span>}</span>
          </div>
          <div>
            <span className="rk-step-label">Owner</span>
            <span>{row._display?.owner_id ?? <span className="muted">No owner</span>}</span>
          </div>
        </div>
      )}
      summaryFields={['title', 'source', 'type', 'frequency', 'requirement', 'status', 'owner_id', 'how_met', 'evidence', 'next_due_on']}
      tabs={[
        { key: 'periods', label: 'Periods', content: (rec) => (
          <div className="stack">
            <PeriodsPanel rec={rec} />
            <AppliesToCard rec={rec} />
            {ControlsPanel && <Suspense fallback={null}><ControlsPanel recordType="obligation" recordId={rec.row.id} /></Suspense>}
          </div>
        ) },
        ...(AttachmentsPanel ? [{
          key: 'attachments', label: 'Evidence',
          content: ({ row }: RecordContext) => (
            <Card title="Evidence files">
              <p className="muted" style={{ margin: 0 }}>Attach the proof that this obligation is met: a signed form, a report, a certificate. Say where else evidence is kept in the Evidence field.</p>
              <Suspense fallback={<Loading lines={3} label="Loading evidence" />}>
                <AttachmentsPanel recordType="obligation" recordId={row.id} evidence />
              </Suspense>
            </Card>
          ),
        }] : []),
      ]}
    />
  );
}
