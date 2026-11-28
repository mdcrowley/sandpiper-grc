// Funder compliance reviews: the list, and one review with its areas (what each relies on and its evidence),
// document requests (answered with files), deficiencies, the awards under review, and carrying forward.
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, LookupSelect, Modal,
  MultiSelect, PageHeader, RecordPage, RecordPicker, useMeta, ResourceForm, ResourceList, Select, Stepper, TableWrap, TextArea, useAuth, useFetch, UserPicker,
  useToast, useUnsavedChanges,
} from '../../core';
import type { Row } from '../../core';
import { Evidence, evidenceInBuild, FundingTabs, ofText } from './shared';
import { ReviewReadiness } from './Readiness';

// Outside reviewers (E41-09): the funder's reviewer may be invited to one review; the tab shows only when that module is in the build.
interface ReviewersPanelProps { basePath: string; recordId: string; noun: string; restricted?: boolean }
const reviewerLoaders = import.meta.glob<{ ReviewersPanel: ComponentType<ReviewersPanelProps> }>('../outsidereviews/ReviewersPanel.tsx');
const loadReviewers = Object.values(reviewerLoaders)[0];
const OutsideReviewers = loadReviewers ? lazy(() => loadReviewers().then((m) => ({ default: m.ReviewersPanel }))) : null;

export function ReviewList() {
  return (
    <div className="stack">
      <PageHeader title="Compliance reviews" subtitle="Reviews a funder makes of how its awards are managed: the areas reviewed, what the funder asked for, and what it found." />
      <FundingTabs active="reviews" />
      <ResourceList
        type="compliance_review"
        urlState
        columns={['ref', 'title', 'funder_id', 'period', 'site_visit_on', 'status', 'lead_id', { field: 'closed_on', hidden: true }]}
        filters={['status', 'funder_id', 'lead_id', 'site_visit_on']}
        createFields={['title', 'funder_id', 'period', 'site_visit_on', 'lead_id', 'notes']}
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
  links: AreaLink[]; links_hidden: number; evidence: number;
}
interface AreaLink {
  id: string; record_type: string; type_label: string; record_id: string; ref: string | null; title: string; route: string; status: string | null;
  operating_rating?: string | null; design_rating?: string | null; last_tested_on?: string | null; next_due_on?: string | null;
}
interface AreaSet { id: string; name: string; version: string; areas: number }
interface Suggested { id: string; ref: string | null; title: string; valid_until: string | null; state: string; via: { type_label: string; ref: string | null; title: string }[] }

const RELY_KINDS = [
  { value: 'control', label: 'Control' },
  { value: 'obligation', label: 'Obligation' },
  { value: 'policy', label: 'Document' },
];

/** What an area relies on (controls with their latest ratings, obligations, documents), and adding more. */
function AreaReliesOn({ reviewId, area, editable, onChange }: { reviewId: string; area: Area; editable: boolean; onChange: () => void }) {
  const toast = useToast();
  const { meta } = useMetaTypes();
  const kinds = RELY_KINDS.filter((k) => meta.has(k.value));
  const [kind, setKind] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = kind || kinds[0]?.value || '';
  const base = `/api/compliance-reviews/${reviewId}/areas/${encodeURIComponent(area.area_code)}/links`;
  const add = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api.post(base, { record_type: chosen, record_id: pick });
      setPick(null); onChange();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const remove = async (l: AreaLink) => {
    try { await api.del(`${base}/${l.id}`); onChange(); } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <section className="stack" aria-label={`What ${area.title} relies on`}>
      <h3 className="fd-h3">Relies on</h3>
      {area.links.length === 0 && !area.links_hidden ? (
        <p className="muted fd-small">No controls, obligations or documents recorded for this area yet.</p>
      ) : (
        <ul className="fd-relies">
          {area.links.map((l) => (
            <li key={l.id}>
              <span>
                <span className="muted fd-small">{l.type_label}</span>{' '}
                <Link to={l.route}>{l.ref && <span className="ref">{l.ref}</span>} {l.title}</Link>
                {l.record_type === 'control' && (
                  <span className="muted fd-small fd-block">
                    {l.operating_rating ? <>Operating: <LookupChip list="control_test_result" value={l.operating_rating} /></> : 'Not tested yet'}
                    {l.last_tested_on ? ` · tested ${formatDate(l.last_tested_on)}` : ''}
                  </span>
                )}
                {l.record_type === 'obligation' && l.next_due_on && <span className="muted fd-small fd-block">Next due {formatDate(l.next_due_on)}</span>}
              </span>
              {editable && <Button size="sm" variant="ghost" aria-label={`Remove: ${l.title}`} onClick={() => remove(l)}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {area.links_hidden > 0 && <p className="muted fd-small">And {area.links_hidden} record{area.links_hidden === 1 ? '' : 's'} you cannot open.</p>}
      {editable && kinds.length > 0 && (
        <div className="fd-inline fd-add">
          <Select label="Kind" value={chosen} options={kinds} onChange={(v) => { setKind(v); setPick(null); }} />
          <RecordPicker key={chosen} label={kinds.find((k) => k.value === chosen)?.label ?? 'Record'} type={chosen} value={pick} onChange={(id) => setPick(id)} />
          <Button loading={busy} disabled={!pick} aria-label={`Add to ${area.title}`} onClick={add}>Add</Button>
        </div>
      )}
    </section>
  );
}

/** The record types this installation has (and the reader may see), from the metadata. */
function useMetaTypes() {
  const { resources } = useMeta();
  return { meta: new Set(Object.keys(resources)) };
}

/** Evidence the area's related records already use, offered for reuse. */
function SuggestedEvidence({ reviewId, area, onUsed }: { reviewId: string; area: Area; onUsed: () => void }) {
  const toast = useToast();
  const { data, reload } = useFetch<{ rows: Suggested[] }>(area.links.length ? `/api/compliance-reviews/${reviewId}/areas/${encodeURIComponent(area.area_code)}/suggested-evidence` : null);
  if (!data?.rows.length) return null;
  const use = async (s: Suggested) => {
    try {
      await api.post('/api/evidence-links', { evidence_id: s.id, record_type: 'compliance_review', record_id: reviewId, part: `area:${area.area_code}`, relation: 'demonstrates' });
      toast.success(`${s.title} is used for ${area.area_code}.`);
      reload(); onUsed();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <div className="stack fd-suggested">
      <h4 className="fd-h3">Suggested from related records</h4>
      <ul className="fd-relies">
        {data.rows.map((s) => (
          <li key={s.id}>
            <span>
              <Link to={`/evidence-library/${s.id}`}>{s.ref && <span className="ref">{s.ref}</span>} {s.title}</Link>
              <span className="muted fd-small fd-block">Used by {s.via.map((v) => [v.ref, v.title].filter(Boolean).join(' ')).join(', ')}{s.valid_until ? ` · valid until ${formatDate(s.valid_until)}` : ''}</span>
            </span>
            <Button size="sm" aria-label={`Use for this area: ${s.title}`} onClick={() => use(s)}>Use</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  const showEvidence = useEvidenceShown();
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
      <TextArea label="Notes" value={notes} rows={2} disabled={!editable} onChange={setNotes}
        hint={showEvidence ? 'File the evidence itself below, in the evidence library.' : 'Where the evidence is kept.'} />
      {editable && (
        <div className="form-actions">
          {/* Named with their area: every area has the pair, and one may sit in a closed panel (E18-64). */}
          <Button aria-label={`Record a deficiency: ${area.title}`} onClick={() => onDeficiency(area)}>Record a deficiency</Button>
          <Button variant="primary" aria-label={`Save area: ${area.title}`} loading={busy} disabled={!dirty} onClick={save}>Save area</Button>
        </div>
      )}
      <AreaReliesOn reviewId={reviewId} area={area} editable={editable} onChange={onSaved} />
      {showEvidence && (
        <section className="stack" aria-label={`Evidence for ${area.title}`}>
          <h3 className="fd-h3">Evidence</h3>
          <Evidence recordType="compliance_review" recordId={reviewId} part={`area:${area.area_code}`} bare onChange={onSaved} />
          {editable && <SuggestedEvidence reviewId={reviewId} area={area} onUsed={onSaved} />}
        </section>
      )}
    </div>
  );
}

/** Whether to show the evidence library's panels: the module is in the build and its area is on. */
function useEvidenceShown() {
  const { areaOn } = useAuth();
  return evidenceInBuild && areaOn('evidence');
}

function Areas({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { data, error, reload } = useFetch<{ set: { id: string; name: string; version: string } | null; areas: Area[] }>(`/api/compliance-reviews/${row.id}/areas`);
  const [deficiencyFor, setDeficiencyFor] = useState<Area | null>(null);
  const toast = useToast();
  const showEvidence = useEvidenceShown();
  const editable = canEdit && row.status !== 'closed';
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  const assessed = data.areas.filter((a) => a.self_assessment !== 'not_assessed').length;
  const evidenced = data.areas.filter((a) => a.evidence > 0).length;
  return (
    <Card title={data.set ? `Review areas: ${data.set.name}${data.set.version ? ` ${data.set.version}` : ''}` : 'Review areas'}>
      {data.areas.length === 0 ? (
        <div className="stack">
          <EmptyState icon="clipboard" title="No review areas yet" message="Load the funder's review areas, or start from an earlier review of the same funder, then record a self-assessment for each." />
          {editable && <LoadAreas reviewId={row.id} onLoaded={reload} />}
          {editable && <CarryForward row={row} onDone={reload} />}
        </div>
      ) : (
        <div className="stack">
          <p className="muted">
            {ofText(assessed, data.areas.length)} areas assessed{showEvidence ? `, ${ofText(evidenced, data.areas.length)} with evidence` : ''}. Open an area to answer its questions.
          </p>
          <div className="fd-areas">
            {data.areas.map((a) => (
              <details key={a.id} className="fd-area">
                <summary>
                  <span className="ref">{a.area_code}</span>
                  <span className="fd-area-title">{a.title}</span>
                  <LookupChip list="review_self_assessment" value={a.self_assessment} />
                  <span className="muted fd-small">
                    {a.owner_name ?? 'No owner'}
                    {showEvidence ? ` · ${a.evidence ? `${a.evidence} evidence` : 'no evidence'}` : ''}
                    {a.deficiencies ? ` · ${a.deficiencies} deficienc${a.deficiencies === 1 ? 'y' : 'ies'}` : ''}
                  </span>
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

interface RequestRow { id: string; area_code: string | null; request: string; owner_id: string | null; owner_name: string | null; due_on: string | null; status: string; response_note: string | null; evidence: number }

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


/** A document request's evidence: files the assignee uploads, or evidence already in the library. */
function RequestEvidence({ reviewId, request, mayAnswer, onClose, onChanged }: {
  reviewId: string; request: RequestRow; mayAnswer: boolean; onClose: () => void; onChanged: () => void;
}) {
  return (
    <Modal open title="Evidence for this request" onClose={onClose} size="lg"
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="stack">
        <p className="fd-statement">{request.request}</p>
        <Evidence recordType="compliance_review" recordId={reviewId} part={`request:${request.id}`} bare mayUpload={mayAnswer} onChange={onChanged}
          uploadTo={(uploadId, form) => api.post(`/api/compliance-reviews/${reviewId}/requests/${request.id}/files`, { upload_id: uploadId, ...form })} />
      </div>
    </Modal>
  );
}

function Requests({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const showEvidence = useEvidenceShown();
  const { data, error, reload } = useFetch<RequestRow[]>(`/api/compliance-reviews/${row.id}/requests`);
  const { data: areaData } = useFetch<{ areas: Area[] }>(`/api/compliance-reviews/${row.id}/areas`);
  const [editing, setEditing] = useState<RequestRow | 'new' | null>(null);
  const [files, setFiles] = useState<RequestRow | null>(null);
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
              <thead>
                <tr>
                  <th scope="col">Request</th><th scope="col">Area</th><th scope="col">Assigned to</th><th scope="col">Due</th><th scope="col">Status</th>
                  {showEvidence && <th scope="col">Evidence</th>}
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
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
                      {showEvidence && <td>{r.evidence}</td>}
                      <td className="fd-actions">
                        {showEvidence && (
                          <Button size="sm" variant="ghost" aria-label={`${mayAnswer ? 'Files and evidence' : 'Evidence'}: ${r.request}`} onClick={() => setFiles(r)}>
                            {mayAnswer ? 'Files' : 'Evidence'}
                          </Button>
                        )}
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
      {files && (
        <RequestEvidence reviewId={row.id} request={files} mayAnswer={open && (canEdit || files.owner_id === user?.id)}
          onClose={() => { setFiles(null); reload(); }} onChanged={reload} />
      )}
      <ConfirmDialog open={!!removing} title="Remove this request?" message="The request and its response are removed from the review. Evidence filed for it stays in the evidence library."
        confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

interface Previous { review: { id: string; ref: string; title: string; status: string; closed_on: string | null } | null; deficiencies: { id: string; ref: string; title: string; area_code: string | null; status: string; closed_on: string | null; cap_id: string | null }[] }

/** The deficiencies of the review this one was carried forward from, and how they were closed. */
function PreviousDeficiencies({ row }: { row: Row }) {
  const { data } = useFetch<Previous>(row.previous_review_id ? `/api/compliance-reviews/${row.id}/previous` : null);
  if (!data?.review) return null;
  return (
    <Card title={`From the previous review: ${data.review.ref} ${data.review.title}`} flush>
      {data.deficiencies.length === 0 ? <p className="muted fd-pad">The previous review found no deficiencies.</p> : (
        <TableWrap label="Deficiencies of the previous review">
          <table className="table">
            <caption className="sr-only">Deficiencies of the previous review</caption>
            <thead><tr><th scope="col">Deficiency</th><th scope="col">Area</th><th scope="col">Status</th><th scope="col">Closed</th></tr></thead>
            <tbody>
              {data.deficiencies.map((d) => (
                <tr key={d.id}>
                  <td><Link className="row-title" to={`/funding/deficiencies/${d.id}`}><span className="ref">{d.ref}</span> {d.title}</Link></td>
                  <td>{d.area_code ?? '—'}</td>
                  <td><LookupChip list="review_deficiency_status" value={d.status} /></td>
                  <td>{formatDate(d.closed_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function Deficiencies({ row }: { row: Row }) {
  return (
    <div className="stack">
      <ResourceList
        type="review_deficiency"
        baseFilter={{ review_id: row.id }}
        columns={['ref', 'title', 'area_code', 'status', 'owner_id', 'due_on', 'cap_id']}
        filters={['status', 'owner_id', 'due_on']}
        createFields={row.status === 'closed' ? undefined : ['title', 'area_code', 'description', 'required_action', 'owner_id', 'due_on']}
        createInitial={{ review_id: row.id }}
        onCreated={() => undefined}
      />
      <PreviousDeficiencies row={row} />
    </div>
  );
}

interface AwardRow { id: string; ref: string; title: string; funder_name: string | null; status: string; period_start: string | null; period_end: string | null }

/** The awards this review covers, chosen from the awards (of the same funder first). */
function AwardsUnderReview({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<AwardRow[]>(`/api/compliance-reviews/${row.id}/awards`);
  const { data: all } = useFetch<{ rows: Row[] }>(canEdit ? '/api/funding-awards?pageSize=500&sort=ref' : null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = canEdit && row.status !== 'closed';
  const current = (data ?? []).map((a) => a.id);
  const value = chosen ?? current;
  const dirty = chosen !== null && (chosen.length !== current.length || chosen.some((id) => !current.includes(id)));
  const unsaved = useUnsavedChanges(dirty);
  const options = (all?.rows ?? [])
    .sort((a, b) => Number(b.funder_id === row.funder_id) - Number(a.funder_id === row.funder_id))
    .map((a) => ({ value: String(a.id), label: `${a.ref} ${a.title}${a.funder_name ? ` (${a.funder_name})` : ''}` }));
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/compliance-reviews/${row.id}/awards`, { award_ids: value });
      unsaved.release();
      setChosen(null); reload();
      toast.success('Awards under review saved.');
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Awards under review" flush>
      {editable && (
        <div className="fd-pad fd-inline">
          <MultiSelect label="Awards this review covers" options={options} value={value} onChange={setChosen} />
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save</Button>
        </div>
      )}
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="fd-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="chart" title="No awards named" message="Name the awards the funder is reviewing, so their reports and obligations can be checked with the review." />
        : (
          <TableWrap label="Awards this review covers">
            <table className="table">
              <caption className="sr-only">Awards this review covers</caption>
              <thead><tr><th scope="col">Award</th><th scope="col">Funder</th><th scope="col">Status</th><th scope="col">Period</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td><Link className="row-title" to={`/funding/awards/${a.id}`}><span className="ref">{a.ref}</span> {a.title}</Link></td>
                    <td>{a.funder_name ?? '—'}</td>
                    <td><LookupChip list="funding_award_status" value={a.status} /></td>
                    <td>{formatDate(a.period_start)} to {formatDate(a.period_end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
    </Card>
  );
}

interface CarryResult { areas_added: number; areas_filled: number; related: number; evidence: number; requests: number; awards: number }
const carriedText = (r: CarryResult) =>
  `${r.areas_added} areas added${r.areas_filled ? `, ${r.areas_filled} filled` : ''}, ${r.requests} requests, ${r.evidence} evidence links and ${r.related} related records carried forward.`;

/** Start this review from an earlier one (areas, answers as drafts, evidence, requests, awards). */
function CarryForward({ row, onDone }: { row: Row; onDone: () => void }) {
  const toast = useToast();
  const { data } = useFetch<{ rows: Row[] }>(`/api/compliance-reviews?pageSize=100&sort=site_visit_on&dir=desc`);
  const earlier = (data?.rows ?? []).filter((r) => r.id !== row.id)
    .sort((a, b) => Number(b.funder_id === row.funder_id) - Number(a.funder_id === row.funder_id));
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  if (!earlier.length) return null;
  const pick = from || String(earlier[0].id);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<CarryResult>(`/api/compliance-reviews/${row.id}/carry-forward`, { from_review_id: pick });
      toast.success(carriedText(r));
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="fd-inline">
      <Select label="Or start from an earlier review" value={pick} onChange={setFrom}
        options={earlier.map((r) => ({ value: String(r.id), label: `${r.ref} ${r.title}${r.funder_name ? ` (${r.funder_name})` : ''}` }))} />
      <Button loading={busy} onClick={run}>Carry forward</Button>
    </div>
  );
}

/** "Start the next review": a new review of the same funder, carried forward from this one. */
function NextReviewButton({ row }: { row: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!can('funding.create')) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<CarryResult & { id: string; ref: string }>(`/api/compliance-reviews/${row.id}/next`, {});
      toast.success(`${r.ref} started. ${carriedText(r)}`);
      navigate(`/funding/reviews/${r.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Button loading={busy} icon="refresh" onClick={run}>Start the next review</Button>;
}

export function ReviewDetail() {
  return (
    <RecordPage
      type="compliance_review"
      breadcrumbs={[{ label: 'Funding', to: '/funding' }, { label: 'Compliance reviews', to: '/funding/reviews' }]}
      subtitle={(row) => `${row.funder_name ?? 'Funder not named'}${row.period ? ` · ${row.period}` : ''}${row.site_visit_on ? ` · site visit ${formatDate(row.site_visit_on)}` : ''}`}
      banner={({ row }) => <Stepper label="Progress" current={row.status} steps={STEPS} />}
      actions={({ row }) => <NextReviewButton row={row} />}
      summaryFields={['title', 'funder_id', 'period', 'site_visit_on', 'lead_id', 'status', 'closed_on', 'previous_review_id', 'notes']}
      tabs={[
        { key: 'areas', label: 'Areas', content: ({ row, canEdit }) => <Areas row={row} canEdit={canEdit} /> },
        { key: 'readiness', label: 'Readiness', content: ({ row }) => <ReviewReadiness reviewId={row.id} /> },
        { key: 'requests', label: 'Requests', content: ({ row, canEdit }) => <Requests row={row} canEdit={canEdit} /> },
        { key: 'deficiencies', label: 'Deficiencies', content: ({ row }) => <Deficiencies row={row} /> },
        { key: 'awards', label: 'Awards', content: ({ row, canEdit }) => <AwardsUnderReview row={row} canEdit={canEdit} /> },
        ...(OutsideReviewers ? [{
          key: 'reviewers', label: 'Outside reviewers',
          content: ({ row }: { row: Row }) => (
            <Suspense fallback={<Loading lines={3} />}><OutsideReviewers basePath="/api/compliance-reviews" recordId={row.id} noun="review" /></Suspense>
          ),
        }] : []),
      ]}
    />
  );
}
