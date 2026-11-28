// Inspections and their schedules. A new inspection or schedule needs a checklist and, usually, the
// site, vehicle, asset or system inspected, so both have their own New dialog with a target picker.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, Badge, Button, Card, DateField, EmptyState, errorMessage, ErrorState, Loading, LookupSelect, Modal, Notice, PageHeader, RecordPage, RecordPicker,
  ResourceList, TextArea, TextField, todayInZone, useAuth, useFetch, UserPicker, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { ANSWER_LABEL, bySection, type ChecklistData, ItemFlags } from './Checklist';
import { InspectionTabs, TargetPicker } from './shared';

function NewDialog({ kind, open, onClose }: { kind: 'inspection' | 'schedule'; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [template, setTemplate] = useState<string | null>(null);
  const [target, setTarget] = useState<{ type: string; id: string | null }>({ type: '', id: null });
  const [person, setPerson] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(template || target.type || person || due);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = kind === 'inspection'
        ? { template_id: template, target_type: target.type || null, target_id: target.id, inspector_id: person, due_on: due || null }
        : { template_id: template, target_type: target.type || null, target_id: target.id, assignee_id: person, next_due_on: due || null, frequency };
      const row = await api.post<{ id: string }>(kind === 'inspection' ? '/api/inspections' : '/api/inspection-schedules', body);
      toast.success(kind === 'inspection' ? 'Inspection created.' : 'Schedule created. Inspections are created from it as they come due.');
      onClose();
      navigate(kind === 'inspection' ? `/inspections/${row.id}` : `/inspections/schedules/${row.id}`);
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={kind === 'inspection' ? 'New inspection' : 'New inspection schedule'} onClose={onClose} dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!template} onClick={submit}>{kind === 'inspection' ? 'Create inspection' : 'Create schedule'}</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="form-grid">
          <div className="form-cell-wide">
            <RecordPicker label="Checklist" type="checklist_template" value={template} onChange={(id) => setTemplate(id)} placeholder="Search the inspection checklists" />
            {errors.template_id && <p className="field-error">{errors.template_id}</p>}
          </div>
          <TargetPicker type={target.type} id={target.id} onChange={(type, id) => setTarget({ type, id })} />
          {(errors.target_type || errors.target_id) && <p className="field-error form-cell-wide">{errors.target_type ?? errors.target_id}</p>}
          <UserPicker label={kind === 'inspection' ? 'Inspector' : 'Inspector (assigned to each inspection)'} value={person} onChange={(id) => setPerson(id)} />
          <DateField label={kind === 'inspection' ? 'Due' : 'First inspection due'} value={due} onChange={setDue} required={kind === 'schedule'} error={errors.due_on ?? errors.next_due_on} />
          {kind === 'schedule' && <LookupSelect label="Frequency" list="inspection_frequency" value={frequency} onChange={setFrequency} required />}
        </div>
      </form>
    </Modal>
  );
}

function useNewDialog() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const close = () => {
    setOpen(false);
    if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); }
  };
  return { open, show: () => setOpen(true), close };
}

interface Attention {
  inspections: { overdue: number; due_soon: number; missed_open: number; missed_90_days: number; schedules_behind: number };
  defects: { open: number; out_of_service: number; to_verify: number; deferral_overdue: number };
}

/** Wave 26: the list opens on what is due, soonest first; the other views are a click away. */
function inspectionViews(today: string) {
  return [
    { key: 'due', label: 'Due and overdue', filter: { status: 'scheduled,in_progress' } as Record<string, string>, sort: { field: 'due_on', dir: 'asc' as const } },
    { key: 'late', label: 'Overdue', filter: { status: 'scheduled,in_progress', 'due_on.lt': today }, sort: { field: 'due_on', dir: 'asc' as const } },
    { key: 'missed', label: 'Missed', filter: { status: 'missed' }, sort: { field: 'due_on', dir: 'desc' as const } },
    { key: 'all', label: 'All inspections', filter: {} as Record<string, string>, sort: undefined },
  ];
}

export function InspectionList() {
  const { can, areaOn } = useAuth();
  const dialog = useNewDialog();
  const [params] = useSearchParams();
  const views = inspectionViews(todayInZone());
  const view = views.find((v) => v.key === params.get('view')) ?? views[0];
  const { data: attention } = useFetch<Attention>('/api/inspections/attention');
  const a = attention?.inspections;
  return (
    <div className="stack">
      <PageHeader title="Inspections" subtitle={`Inspections of stations, depots${areaOn('fleet') ? ', vehicles' : ''} and equipment, created from their schedules or by hand, and run on a phone or tablet.`} />
      <InspectionTabs active="inspections" />
      {a && (a.overdue > 0 || a.missed_open > 0) && (
        <Notice tone="warning" title="Inspections need following up">
          {a.overdue} overdue and {a.missed_open} missed without a reason, a new date or a follow-up action; {a.schedules_behind} {a.schedules_behind === 1 ? 'schedule is' : 'schedules are'} behind.
          {' '}<Link to="/inspections?view=late">Overdue</Link> · <Link to="/inspections?view=missed">Missed</Link>
        </Notice>
      )}
      <nav className="au-views" aria-label="Which inspections to show">
        {views.map((v) => (
          <Link key={v.key} className={`btn btn-sm ${v.key === view.key ? 'btn-primary' : 'btn-secondary'}`} aria-current={v.key === view.key ? 'page' : undefined}
            to={v.key === 'due' ? '/inspections' : `/inspections?view=${v.key}`}>{v.label}</Link>
        ))}
      </nav>
      <ResourceList
        key={view.key}
        type="inspection"
        urlState
        baseFilter={view.filter}
        defaultSort={view.sort}
        columns={['ref', 'title', 'target_label', 'due_on', 'status', 'result', 'score_pct', 'inspector_id', { field: 'performed_on', hidden: true }, { field: 'template_id', hidden: true },
          { field: 'missed_reason', hidden: true }]}
        filters={['status', 'result', 'inspector_id', 'template_id', 'schedule_id', 'due_on', 'target_type']}
        actions={can('audits.create') ? <Button variant="primary" icon="plus" onClick={dialog.show}>New inspection</Button> : undefined}
      />
      <NewDialog kind="inspection" open={dialog.open} onClose={dialog.close} />
    </div>
  );
}

/** The answers given, read-only, for the inspection page (the run screen is where they are given). */
function Answers({ row }: RecordContext) {
  const { data, error, reload } = useFetch<ChecklistData>(`/api/inspections/${row.id}/responses?v=${row.updated_at}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  if (!data.items.length) return <EmptyState icon="check-square" title="The checklist has no items" message="Add items to the checklist template first." />;
  return (
    <div className="stack">
      {bySection(data.items).map((g) => (
        <Card key={`${g.section}-${g.items[0].id}`} title={g.section ?? 'Checklist'} flush>
          <ol className="au-list">
            {g.items.map((i) => {
              const r = data.responses[i.id];
              return (
                <li key={i.id} className="au-list-item">
                  <div className="au-list-main">
                    <p className="au-prompt">{i.prompt} <ItemFlags item={i} /></p>
                    {r?.note && <p className="au-guidance">{r.note}</p>}
                    {r?.attachment_ids?.length ? <p className="muted au-meta">{r.attachment_ids.length} photo{r.attachment_ids.length === 1 ? '' : 's'} (Attachments tab)</p> : null}
                  </div>
                  {r?.answer ? <Badge color={r.answer === 'yes' ? 'green' : r.answer === 'no' ? 'red' : 'gray'}>{ANSWER_LABEL[r.answer]}</Badge> : <span className="muted">Not answered</span>}
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
    </div>
  );
}

type FollowUp = 'reason' | 'reschedule' | 'action';
const FOLLOW_UP_TITLE: Record<FollowUp, string> = { reason: 'Record why it was missed', reschedule: 'Reschedule', action: 'Raise a follow-up action' };

/** Missed or overdue inspections (wave 26): record why, reschedule as a new inspection, or raise an action. */
function FollowUpDialog({ kind, rec, onClose }: { kind: FollowUp; rec: RecordContext; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [due, setDue] = useState('');
  const [person, setPerson] = useState<string | null>(rec.row.inspector_id ?? null);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const needReason = !rec.row.missed_reason;
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (kind === 'reason') {
        await api.post(`/api/inspections/${rec.row.id}/missed-reason`, { reason });
        toast.success('The reason is recorded.');
        onClose();
      } else if (kind === 'reschedule') {
        const next = await api.post<{ id: string; ref: string }>(`/api/inspections/${rec.row.id}/reschedule`, { due_on: due || null, reason: reason || undefined, inspector_id: person });
        toast.success(`Rescheduled as ${next.ref}.`);
        onClose();
        navigate(`/inspections/${next.id}`);
      } else {
        const action = await api.post<{ id: string; ref: string }>(`/api/inspections/${rec.row.id}/follow-up`, { title: title || undefined, owner_id: person, due_on: due || undefined });
        toast.success(`Action ${action.ref} raised.`);
        onClose();
      }
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={FOLLOW_UP_TITLE[kind]} onClose={onClose} dirty={Boolean(reason || due || title)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{FOLLOW_UP_TITLE[kind]}</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {(kind === 'reason' || (kind === 'reschedule' && needReason)) && (
          <TextArea label="Why it was missed" value={reason} onChange={setReason} required error={errors.reason} />
        )}
        {kind === 'reschedule' && <>
          <p className="muted">A new inspection is created for the new date. This one stays as missed, so the on-time figures keep it.</p>
          <DateField label="New due date" value={due} onChange={setDue} required error={errors.due_on} />
          <UserPicker label="Inspector" value={person} onChange={(id) => setPerson(id)} />
        </>}
        {kind === 'action' && <>
          <TextField label="Action" value={title} onChange={setTitle} placeholder={`Follow up the missed inspection ${rec.row.ref ?? ''}`} />
          <UserPicker label="Owner" value={person} onChange={(id) => setPerson(id)} />
          <DateField label="Due" value={due} onChange={setDue} hint="In two weeks when left empty." />
        </>}
      </form>
    </Modal>
  );
}

function InspectionActions(rec: RecordContext) {
  const { can } = useAuth();
  const actions = useResource('action');
  const [open, setOpen] = useState<FollowUp | null>(null);
  const { row } = rec;
  const late = row.status === 'missed' || (['scheduled', 'in_progress'].includes(String(row.status)) && row.due_on && String(row.due_on) < todayInZone());
  const run = row.status === 'complete' || row.status === 'canceled' || row.rescheduled_to_id ? null
    : <Link className={`btn ${row.status === 'missed' ? 'btn-secondary' : 'btn-primary'}`} to={`/inspections/${row.id}/run`}>
      {row.status === 'missed' ? 'Carry it out late' : row.status === 'in_progress' ? 'Continue the checklist' : 'Start the checklist'}</Link>;
  return (
    <>
      {late && !row.rescheduled_to_id && can('audits.create') && <Button variant="primary" onClick={() => setOpen('reschedule')}>Reschedule</Button>}
      {run}
      {late && !row.missed_reason && can('audits.edit') && <Button onClick={() => setOpen('reason')}>Record why it was missed</Button>}
      {late && actions && can('actions.create') && <Button onClick={() => setOpen('action')}>Raise a follow-up action</Button>}
      {open && <FollowUpDialog kind={open} rec={rec} onClose={() => { setOpen(null); rec.reload(); }} />}
    </>
  );
}

export function InspectionDetail() {
  const actions = useResource('action');
  return (
    <RecordPage
      type="inspection"
      actions={(rec) => <InspectionActions {...rec} />}
      banner={({ row }) => (
        <>
          {row.status === 'missed' && !row.missed_reason && !row.rescheduled_to_id && (
            <Notice tone="warning" title="Missed">This inspection was not carried out by its due date. Record why, reschedule it, or raise a follow-up action.</Notice>
          )}
          {row.rescheduled_to_id && (
            <Notice title="Rescheduled">Replaced by <Link to={`/inspections/${row.rescheduled_to_id}`}>{row._display?.rescheduled_to_id ?? 'a new inspection'}</Link>.</Notice>
          )}
        </>
      )}
      summaryFields={['title', 'template_id', 'schedule_id', 'target_label', 'inspector_id', 'due_on', 'performed_on', 'status', 'result', 'score_pct', 'signed_by_name', 'signed_at', 'notes',
        'missed_reason', 'missed_reason_by', 'missed_reason_on', 'rescheduled_from_id', 'rescheduled_to_id']}
      tabs={[
        { key: 'answers', label: 'Checklist', content: (rec) => <Answers {...rec} /> },
        {
          key: 'findings', label: 'Findings',
          content: ({ row }) => (
            <ResourceList type="audit_finding" baseFilter={{ source_id: row.id }} urlState={false}
              columns={['ref', 'title', 'rating', 'status', 'response_owner_id', 'response_due', 'cap_id']}
              createFields={['title', 'rating', 'criteria', 'condition', 'recommendation', 'response_owner_id', 'response_due']}
              createInitial={{ source_type: 'inspection', source_id: row.id }} />
          ),
        },
        // Wave 26: defects raised from the items not met, and follow-up actions of a missed inspection.
        {
          key: 'defects', label: 'Defects',
          content: ({ row }) => (
            <ResourceList type="defect" baseFilter={{ inspection_id: row.id }} urlState={false}
              columns={['ref', 'title', 'severity', 'out_of_service', 'status', 'owner_id', 'deferred_until']} />
          ),
        },
        ...(actions ? [{
          key: 'follow-up', label: 'Follow-up actions',
          content: ({ row }: RecordContext) => (
            <ResourceList type="action" baseFilter={{ source_id: row.id }} urlState={false} columns={['ref', 'title', 'status', 'owner_id', 'due_on']} />
          ),
        }] : []),
      ]}
    />
  );
}

export function ScheduleList() {
  const { can } = useAuth();
  const dialog = useNewDialog();
  return (
    <div className="stack">
      <PageHeader title="Inspection schedules" subtitle="Recurring inspections: each schedule creates the next inspection as it comes due, assigns it and sends reminders." />
      <InspectionTabs active="schedules" />
      <ResourceList
        type="inspection_schedule"
        urlState
        columns={['name', 'target_label', 'frequency', 'next_due_on', 'assignee_id', 'active', { field: 'template_id', hidden: true }]}
        filters={['frequency', 'assignee_id', 'active', 'template_id', 'next_due_on']}
        actions={can('audits.create') ? <Button variant="primary" icon="plus" onClick={dialog.show}>New schedule</Button> : undefined}
      />
      <NewDialog kind="schedule" open={dialog.open} onClose={dialog.close} />
    </div>
  );
}

export function ScheduleDetail() {
  return (
    <RecordPage
      type="inspection_schedule"
      summaryFields={['name', 'template_id', 'target_label', 'frequency', 'next_due_on', 'assignee_id', 'active']}
      tabs={[{
        key: 'inspections', label: 'Inspections',
        content: ({ row }) => (
          <ResourceList type="inspection" baseFilter={{ schedule_id: row.id }} urlState={false}
            columns={['ref', 'due_on', 'status', 'result', 'score_pct', 'inspector_id', 'performed_on']} filters={['status', 'result', 'due_on']} />
        ),
      }]}
    />
  );
}
