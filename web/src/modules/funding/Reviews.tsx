// Funder compliance reviews: the list, and one review with its areas, document requests and deficiencies.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, LookupSelect, Modal,
  PageHeader, RecordPage, ResourceForm, ResourceList, Select, Stepper, TableWrap, TextArea, useAuth, useFetch, UserPicker, useToast, useUnsavedChanges,
} from '../../core';
import type { Row } from '../../core';
import { FundingTabs, ofText } from './shared';

export function ReviewList() {
  return (
    <div className="stack">
      <PageHeader title="Compliance reviews" subtitle="Reviews a funder makes of how its awards are managed: the areas reviewed, what the funder asked for, and what it found." />
      <FundingTabs active="reviews" />
      <ResourceList
        type="compliance_review"
        urlState
        columns={['ref', 'title', 'funder_name', 'period', 'site_visit_on', 'status', 'lead_id', { field: 'closed_on', hidden: true }]}
        filters={['status', 'lead_id', 'site_visit_on']}
        createFields={['title', 'funder_name', 'period', 'site_visit_on', 'lead_id', 'notes']}
      />
    </div>
  );
}

const STEPS = [
  { key: 'preparing', label: 'Preparing' },
  { key: 'self_assessment', label: 'Self-assessment' },
  { key: 'on_site', label: 'Site visit' },
  { key: 'draft_report', label: 'Draft report' },
  { key: 'final_report', label: 'Final report' },
  { key: 'closed', label: 'Closed' },
];

interface Area {
  id: string; area_code: string; title: string; description: string | null; questions: string[]; self_assessment: string;
  answers: string[]; owner_id: string | null; owner_name: string | null; notes: string | null; deficiencies: number;
}
interface AreaSet { id: string; name: string; version: string; areas: number }

function LoadAreas({ reviewId, onLoaded }: { reviewId: string; onLoaded: () => void }) {
  const toast = useToast();
  const { data: sets } = useFetch<AreaSet[]>('/api/funding/review-area-sets');
  const [setId, setSetId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (sets?.length && !setId) setSetId(sets[0].id); }, [sets, setId]);
  const load = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: number }>(`/api/compliance-reviews/${reviewId}/areas/load`, { set_id: setId });
      toast.success(`${r.added} area${r.added === 1 ? '' : 's'} added.`);
      onLoaded();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  if (!sets) return <Loading lines={2} />;
  if (!sets.length) return <p className="muted">No review areas are loaded yet. <Link to="/funding/review-areas">Load a file of review areas</Link> first.</p>;
  return (
    <div className="fd-inline">
      <Select label="Review areas" value={setId} required options={sets.map((s) => ({ value: s.id, label: `${s.name}${s.version ? ` ${s.version}` : ''} (${s.areas} areas)` }))} onChange={setSetId} />
      <Button variant="primary" loading={busy} disabled={!setId} onClick={load}>Load areas</Button>
    </div>
  );
}

function AreaEditor({ reviewId, area, editable, onSaved, onDeficiency }: {
  reviewId: string; area: Area; editable: boolean; onSaved: () => void; onDeficiency: (area: Area) => void;
}) {
  const toast = useToast();
  const [assessment, setAssessment] = useState(area.self_assessment);
  const [answers, setAnswers] = useState<string[]>(area.questions.map((_, i) => area.answers[i] ?? ''));
  const [owner, setOwner] = useState<string | null>(area.owner_id);
  const [notes, setNotes] = useState(area.notes ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = assessment !== area.self_assessment || owner !== area.owner_id || notes !== (area.notes ?? '')
    || answers.some((a, i) => a !== (area.answers[i] ?? ''));
  const unsaved = useUnsavedChanges(dirty);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/compliance-reviews/${reviewId}/areas/${encodeURIComponent(area.area_code)}`, { self_assessment: assessment, answers, owner_id: owner, notes });
      unsaved.release();
      toast.success(`${area.title} saved.`);
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="fd-area-body stack">
      {area.description && <p className="muted">{area.description}</p>}
      {area.questions.length > 0 && (
        <ol className="fd-questions">
          {area.questions.map((q, i) => (
            <li key={i}>
              <TextArea label={q} value={answers[i] ?? ''} rows={2} disabled={!editable}
                onChange={(v) => setAnswers((list) => list.map((x, j) => (j === i ? v : x)))} />
            </li>
          ))}
        </ol>
      )}
      <div className="form-grid">
        <LookupSelect label="Self-assessment" list="review_self_assessment" value={assessment} required disabled={!editable} onChange={setAssessment} />
        <UserPicker label="Owner" value={owner} display={area.owner_name ?? undefined} disabled={!editable} onChange={(id) => setOwner(id)} />
      </div>
      <TextArea label="Notes and evidence" value={notes} rows={2} disabled={!editable} onChange={setNotes}
        hint="Where the evidence is kept; attach files on the review's Attachments tab." />
      {editable && (
        <div className="form-actions">
          <Button onClick={() => onDeficiency(area)}>Record a deficiency</Button>
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save area</Button>
        </div>
      )}
    </div>
  );
}

function Areas({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { data, error, reload } = useFetch<{ set: { id: string; name: string; version: string } | null; areas: Area[] }>(`/api/compliance-reviews/${row.id}/areas`);
  const [deficiencyFor, setDeficiencyFor] = useState<Area | null>(null);
  const toast = useToast();
  const editable = canEdit && row.status !== 'closed';
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  const assessed = data.areas.filter((a) => a.self_assessment !== 'not_assessed').length;
  return (
    <Card title={data.set ? `Review areas: ${data.set.name}${data.set.version ? ` ${data.set.version}` : ''}` : 'Review areas'}>
      {data.areas.length === 0 ? (
        <div className="stack">
          <EmptyState icon="clipboard" title="No review areas yet" message="Load the funder's review areas, then record a self-assessment for each." />
          {editable && <LoadAreas reviewId={row.id} onLoaded={reload} />}
        </div>
      ) : (
        <div className="stack">
          <p className="muted">{ofText(assessed, data.areas.length)} areas assessed. Open an area to answer its questions.</p>
          <div className="fd-areas">
            {data.areas.map((a) => (
              <details key={a.id} className="fd-area">
                <summary>
                  <span className="ref">{a.area_code}</span>
                  <span className="fd-area-title">{a.title}</span>
                  <LookupChip list="review_self_assessment" value={a.self_assessment} />
                  <span className="muted fd-small">{a.owner_name ?? 'No owner'}{a.deficiencies ? ` · ${a.deficiencies} deficienc${a.deficiencies === 1 ? 'y' : 'ies'}` : ''}</span>
                </summary>
                <AreaEditor reviewId={row.id} area={a} editable={editable} onSaved={reload} onDeficiency={setDeficiencyFor} />
              </details>
            ))}
          </div>
        </div>
      )}
      <Modal open={!!deficiencyFor} title={`Record a deficiency in ${deficiencyFor?.title ?? 'this area'}`} onClose={() => setDeficiencyFor(null)}>
        {deficiencyFor && (
          <ResourceForm type="review_deficiency" fields={['title', 'description', 'required_action', 'owner_id', 'due_on']}
            initial={{ review_id: row.id, area_code: deficiencyFor.area_code }}
            onCancel={() => setDeficiencyFor(null)}
            onSaved={() => { setDeficiencyFor(null); toast.success('Deficiency recorded.'); reload(); }} />
        )}
      </Modal>
    </Card>
  );
}

interface RequestRow { id: string; area_code: string | null; request: string; owner_id: string | null; owner_name: string | null; due_on: string | null; status: string; response_note: string | null }

function RequestDialog({ reviewId, request, areas, full, onClose, onSaved }: {
  reviewId: string; request: RequestRow | 'new'; areas: { value: string; label: string }[]; full: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const start = request === 'new' ? null : request;
  const [text, setText] = useState(start?.request ?? '');
  const [area, setArea] = useState(start?.area_code ?? '');
  const [owner, setOwner] = useState<string | null>(start?.owner_id ?? null);
  const [due, setDue] = useState(start?.due_on ?? '');
  const [status, setStatus] = useState(start?.status ?? 'open');
  const [response, setResponse] = useState(start?.response_note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = text !== (start?.request ?? '') || area !== (start?.area_code ?? '') || owner !== (start?.owner_id ?? null) || due !== (start?.due_on ?? '')
    || status !== (start?.status ?? 'open') || response !== (start?.response_note ?? '');
  const unsaved = useUnsavedChanges(dirty);
  const save = async () => {
    setBusy(true); setErrors({});
    const body = full
      ? { request: text, area_code: area || null, owner_id: owner, due_on: due || null, status, response_note: response }
      : { status, response_note: response };
    try {
      if (start) await api.patch(`/api/compliance-reviews/${reviewId}/requests/${start.id}`, body);
      else await api.post(`/api/compliance-reviews/${reviewId}/requests`, body);
      unsaved.release();
      toast.success(start ? 'Request saved.' : 'Request added.');
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={start ? 'Document request' : 'Add a document request'} onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!text.trim()} onClick={save}>{start ? 'Save' : 'Add'}</Button></>}>
      <div className="stack">
        <TextArea label="What the funder asked for" required value={text} onChange={setText} rows={2} disabled={!full} error={errors.request} />
        <div className="form-grid">
          <Select label="Review area" value={area} options={[{ value: '', label: 'No particular area' }, ...areas]} disabled={!full} onChange={setArea} error={errors.area_code} />
          <UserPicker label="Assigned to" value={owner} display={start?.owner_name ?? undefined} disabled={!full} onChange={(id) => setOwner(id)} error={errors.owner_id} />
          <DateField label="Due" value={due} disabled={!full} onChange={setDue} error={errors.due_on} />
          <LookupSelect label="Status" list="review_request_status" required value={status} onChange={setStatus} error={errors.status} />
        </div>
        <TextArea label="Response" value={response} onChange={setResponse} rows={3} hint="What was sent, and where it is kept." />
      </div>
    </Modal>
  );
}

function Requests({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<RequestRow[]>(`/api/compliance-reviews/${row.id}/requests`);
  const { data: areaData } = useFetch<{ areas: Area[] }>(`/api/compliance-reviews/${row.id}/areas`);
  const [editing, setEditing] = useState<RequestRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<RequestRow | null>(null);
  const [busy, setBusy] = useState(false);
  const open = row.status !== 'closed';
  const areas = (areaData?.areas ?? []).map((a) => ({ value: a.area_code, label: `${a.area_code} ${a.title}` }));
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/compliance-reviews/${row.id}/requests/${removing.id}`);
      toast.success('Request removed.'); setRemoving(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Document requests" flush actions={canEdit && open && <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add a request</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="fd-pad"><Loading lines={4} /></div>
        : data.length === 0 ? <EmptyState icon="folder" title="No document requests" message="Record what the funder asks to see, who gathers it and by when." />
        : (
          <TableWrap label="Document requests of this review">
            <table className="table">
              <caption className="sr-only">Document requests of this review</caption>
              <thead><tr><th scope="col">Request</th><th scope="col">Area</th><th scope="col">Assigned to</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((r) => {
                  const mayAnswer = open && (canEdit || r.owner_id === user?.id);
                  return (
                    <tr key={r.id}>
                      <td><span className="fd-statement">{r.request}</span>{r.response_note && <span className="muted fd-small fd-block">{r.response_note}</span>}</td>
                      <td>{r.area_code ?? '—'}</td>
                      <td>{r.owner_name ?? <span className="muted">No one</span>}</td>
                      <td>{formatDate(r.due_on)}</td>
                      <td><LookupChip list="review_request_status" value={r.status} /></td>
                      <td className="fd-actions">
                        {mayAnswer && <Button size="sm" variant="ghost" aria-label={`${canEdit ? 'Edit' : 'Answer'}: ${r.request}`} onClick={() => setEditing(r)}>{canEdit ? 'Edit' : 'Answer'}</Button>}
                        {canEdit && open && <Button size="sm" variant="ghost" aria-label={`Remove: ${r.request}`} onClick={() => setRemoving(r)}>Remove</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      {editing && <RequestDialog reviewId={row.id} request={editing} areas={areas} full={canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this request?" message="The request and its response are removed from the review."
        confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

function Deficiencies({ row }: { row: Row }) {
  return (
    <ResourceList
      type="review_deficiency"
      baseFilter={{ review_id: row.id }}
      columns={['ref', 'title', 'area_code', 'status', 'owner_id', 'due_on', 'cap_id']}
      filters={['status', 'owner_id', 'due_on']}
      createFields={row.status === 'closed' ? undefined : ['title', 'area_code', 'description', 'required_action', 'owner_id', 'due_on']}
      createInitial={{ review_id: row.id }}
      onCreated={() => undefined}
    />
  );
}

export function ReviewDetail() {
  return (
    <RecordPage
      type="compliance_review"
      breadcrumbs={[{ label: 'Funding', to: '/funding' }, { label: 'Compliance reviews', to: '/funding/reviews' }]}
      subtitle={(row) => `${row.funder_name ?? 'Funder not named'}${row.period ? ` · ${row.period}` : ''}${row.site_visit_on ? ` · site visit ${formatDate(row.site_visit_on)}` : ''}`}
      banner={({ row }) => <Stepper label="Progress" current={row.status} steps={STEPS} />}
      summaryFields={['title', 'funder_name', 'period', 'site_visit_on', 'lead_id', 'status', 'closed_on', 'notes']}
      tabs={[
        { key: 'areas', label: 'Areas', content: ({ row, canEdit }) => <Areas row={row} canEdit={canEdit} /> },
        { key: 'requests', label: 'Requests', content: ({ row, canEdit }) => <Requests row={row} canEdit={canEdit} /> },
        { key: 'deficiencies', label: 'Deficiencies', content: ({ row }) => <Deficiencies row={row} /> },
      ]}
    />
  );
}
