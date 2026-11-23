// Inspections and their schedules. A new inspection or schedule needs a checklist and, usually, the
// site, vehicle, asset or system inspected, so both have their own New dialog with a target picker.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, Badge, Button, Card, DateField, EmptyState, errorMessage, ErrorState, Loading, LookupSelect, Modal, PageHeader, RecordPage, RecordPicker,
  ResourceList, useAuth, useFetch, UserPicker, useToast,
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

export function InspectionList() {
  const { can, areaOn } = useAuth();
  const dialog = useNewDialog();
  return (
    <div className="stack">
      <PageHeader title="Inspections" subtitle={`Inspections of stations, depots${areaOn('fleet') ? ', vehicles' : ''} and equipment, created from their schedules or by hand, and run on a phone or tablet.`} />
      <InspectionTabs active="inspections" />
      <ResourceList
        type="inspection"
        urlState
        columns={['ref', 'title', 'target_label', 'due_on', 'status', 'result', 'score_pct', 'inspector_id', { field: 'performed_on', hidden: true }, { field: 'template_id', hidden: true }]}
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

export function InspectionDetail() {
  return (
    <RecordPage
      type="inspection"
      actions={({ row }) => (row.status === 'complete' ? null
        : <Link className="btn btn-primary" to={`/inspections/${row.id}/run`}>{row.status === 'in_progress' ? 'Continue the checklist' : 'Start the checklist'}</Link>)}
      summaryFields={['title', 'template_id', 'schedule_id', 'target_label', 'inspector_id', 'due_on', 'performed_on', 'status', 'result', 'score_pct', 'signed_by_name', 'signed_at', 'notes']}
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
