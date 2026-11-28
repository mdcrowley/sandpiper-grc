// The audit's workpapers (E45-15): its checklist items are the program steps. Each step records the test
// procedure, the sample, the result and what was found, with files on the audit and evidence records of
// the shared library; then the preparer signs it and someone else reviews it. A reviewer's note sends
// the step back to its preparer, who clears it with a response. A reviewed step is locked.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import {
  api, Badge, Button, Card, EmptyState, errorMessage, ErrorState, formatDateTime, Loading, LookupChip, LookupSelect, MultiSelect, ProgressBar,
  TextArea, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import { ANSWER_LABEL, bySection, ItemFlags, type ChecklistItem } from './Checklist';

interface ReviewNote {
  id: string; item_id: string; note: string; raised_by_name: string | null; raised_at: string;
  addressed_to: string | null; addressed_to_name: string | null; response: string | null; cleared_by_name: string | null; cleared_at: string | null;
}
interface StepEvidence { link_id: string; id: string; ref: string | null; label: string; route: string | null }
interface Step {
  item_id: string; answer: 'yes' | 'no' | 'na' | null; result: string | null; procedure: string | null; sample: string | null; note: string | null;
  attachment_ids: string[]; answered_by_name: string | null; answered_at: string | null;
  prepared_by: string | null; prepared_by_name: string | null; prepared_at: string | null;
  reviewed_by: string | null; reviewed_by_name: string | null; reviewed_at: string | null;
  locked: boolean; notes: ReviewNote[]; evidence: StepEvidence[]; evidence_hidden: number;
}
interface WorkpaperData {
  template: { id: string; name: string; kind: string; version: number; active: boolean } | null;
  items: ChecklistItem[];
  responses: Record<string, Step>;
  answered: number; prepared?: number; reviewed?: number; open_notes?: number; total: number;
  can_answer: boolean; can_review?: boolean; evidence_available?: boolean; me?: string | null;
}
interface AuditFile { id: string; file_name: string; link_title?: string | null }

// The evidence library's panel, when that module is in the build.
interface EvidencePanelProps { recordType: string; recordId: string; part?: string; title?: string; bare?: boolean; onChange?: () => void }
const evidenceLoaders = import.meta.glob<{ EvidencePanel: ComponentType<EvidencePanelProps> }>('../evidence/EvidencePanel.tsx');
const loadEvidence = Object.values(evidenceLoaders)[0];
const EvidencePanel = loadEvidence ? lazy(() => loadEvidence().then((m) => ({ default: m.EvidencePanel }))) : null;

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '') === (b ?? '');

/** The step's state in a few words, as chips. */
function StepState({ step }: { step: Step | undefined }) {
  if (!step) return <Badge color="gray">Not started</Badge>;
  const open = step.notes.filter((n) => !n.cleared_at).length;
  return (
    <span className="au-flags">
      {step.result ? <LookupChip list="workpaper_result" value={step.result} /> : step.answer ? <Badge color={step.answer === 'yes' ? 'green' : step.answer === 'no' ? 'red' : 'gray'}>{ANSWER_LABEL[step.answer]}</Badge> : <Badge color="gray">No result</Badge>}
      {step.reviewed_at ? <Badge color="green">Reviewed</Badge> : step.prepared_at ? <Badge color="blue">Prepared</Badge> : null}
      {open > 0 && <Badge color="orange">{open === 1 ? '1 open review note' : `${open} open review notes`}</Badge>}
    </span>
  );
}

function StepEditor({ auditId, item, step, files, data, closed, onSaved }: {
  auditId: string; item: ChecklistItem; step: Step | undefined; files: AuditFile[]; data: WorkpaperData; closed: boolean; onSaved: (d?: WorkpaperData) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const me = data.me ?? user?.id ?? null;
  const locked = Boolean(step?.locked);
  const canEdit = data.can_answer && !closed && !locked;
  const [form, setForm] = useState({
    procedure: step?.procedure ?? item.guidance ?? '', sample: step?.sample ?? '', result: step?.result ?? '', note: step?.note ?? '',
    attachment_ids: step?.attachment_ids ?? [],
  });
  const [noteText, setNoteText] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = canEdit && (!same(form.procedure, step?.procedure ?? item.guidance) || !same(form.sample, step?.sample) || !same(form.result, step?.result)
    || !same(form.note, step?.note) || form.attachment_ids.join() !== (step?.attachment_ids ?? []).join());
  const unsaved = useUnsavedChanges(dirty);
  const base = `/api/audits/${auditId}`;
  const run = async (key: string, fn: () => Promise<WorkpaperData | undefined>, done: string) => {
    setBusy(key);
    try { const d = await fn(); toast.success(done); onSaved(d); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const save = () => run('save', async () => {
    const d = await api.put<WorkpaperData>(`${base}/checklist`, {
      item_id: item.id, procedure: form.procedure, sample: form.sample, result: form.result || null, note: form.note, attachment_ids: form.attachment_ids,
    });
    unsaved.release();
    return d;
  }, step?.prepared_at ? 'Step saved. Sign it again as its preparer.' : 'Step saved.');
  const openNotes = (step?.notes ?? []).filter((n) => !n.cleared_at);
  const isPreparer = Boolean(step?.prepared_by && step.prepared_by === me);
  const mayPrepare = canEdit && !dirty && Boolean(step?.result || step?.answer) && !step?.prepared_at && openNotes.length === 0;
  const mayReview = Boolean(data.can_review) && !closed && !locked && Boolean(step?.prepared_at) && !isPreparer;
  const fileOptions = files.map((f) => ({ value: f.id, label: f.link_title || f.file_name }));

  return (
    <div className="au-wp-editor stack">
      {canEdit ? (
        <div className="au-wp-fields">
          <TextArea label="Test procedure" value={form.procedure} rows={2} onChange={(v) => setForm({ ...form, procedure: v })} hint="What you did to test this step." />
          <TextArea label="Sample" value={form.sample} rows={2} onChange={(v) => setForm({ ...form, sample: v })} hint="What you looked at, and how it was chosen." />
          <LookupSelect list="workpaper_result" label="Result" value={form.result} onChange={(v) => setForm({ ...form, result: v ?? '' })} placeholder="Choose the result" />
          <TextArea label="What was found" value={form.note} rows={2} onChange={(v) => setForm({ ...form, note: v })} />
          {fileOptions.length > 0
            ? <MultiSelect label={`Files (${form.attachment_ids.length} of the audit's files)`} options={fileOptions} value={form.attachment_ids} onChange={(v) => setForm({ ...form, attachment_ids: v })} />
            : <p className="muted au-meta">Files attached to the audit (its Attachments tab) can be chosen here as this step's evidence.</p>}
          <div className="au-wp-actions">
            <Button variant="primary" size="sm" disabled={!dirty} loading={busy === 'save'} onClick={save}>Save step</Button>
            {dirty && <span className="muted au-meta">Unsaved changes</span>}
          </div>
        </div>
      ) : (
        <dl className="au-wp-read">
          <dt>Test procedure</dt><dd>{step?.procedure || '—'}</dd>
          <dt>Sample</dt><dd>{step?.sample || '—'}</dd>
          <dt>Result</dt><dd>{step?.result ? <LookupChip list="workpaper_result" value={step.result} /> : '—'}</dd>
          <dt>What was found</dt><dd>{step?.note || '—'}</dd>
          <dt>Files</dt><dd>{(step?.attachment_ids ?? []).map((id) => fileOptions.find((f) => f.value === id)?.label ?? 'A file').join(', ') || '—'}</dd>
        </dl>
      )}

      {data.evidence_available && EvidencePanel && canEdit ? (
        <Suspense fallback={<Loading lines={2} />}>
          <h4 className="au-wp-h">Evidence from the library</h4>
          <EvidencePanel recordType="audit_engagement" recordId={auditId} part={`step:${item.id}`} title="Evidence from the library" bare onChange={() => onSaved()} />
        </Suspense>
      ) : step?.evidence?.length || step?.evidence_hidden ? (
        <p className="au-meta">Evidence from the library: {step.evidence.map((e) => [e.ref, e.label].filter(Boolean).join(' ')).join(', ')}
          {step.evidence_hidden ? ` (and ${step.evidence_hidden} you cannot see)` : ''}</p>
      ) : null}

      <div className="au-wp-signoff">
        <div>
          <h4 className="au-wp-h">Preparer</h4>
          {step?.prepared_at
            ? <p className="au-meta">Signed by {step.prepared_by_name ?? 'someone'}, {formatDateTime(step.prepared_at)}</p>
            : <p className="muted au-meta">Not signed yet.</p>}
          {mayPrepare && <Button size="sm" loading={busy === 'prepare'} onClick={() => run('prepare', () => api.post<WorkpaperData>(`${base}/steps/${item.id}/prepare`, {}), 'Signed as preparer.')}>Sign as preparer</Button>}
        </div>
        <div>
          <h4 className="au-wp-h">Reviewer</h4>
          {step?.reviewed_at
            ? <p className="au-meta">Reviewed by {step.reviewed_by_name ?? 'someone'}, {formatDateTime(step.reviewed_at)}. The step is locked.</p>
            : <p className="muted au-meta">{step?.prepared_at ? (isPreparer ? 'Someone other than you reviews this step.' : 'Waiting for review.') : 'Reviewed once the preparer has signed.'}</p>}
          {mayReview && openNotes.length === 0 && (
            <Button size="sm" variant="primary" loading={busy === 'review'} onClick={() => run('review', () => api.post<WorkpaperData>(`${base}/steps/${item.id}/review`, {}), 'Step reviewed and locked.')}>Sign as reviewer</Button>
          )}
        </div>
      </div>

      {(step?.notes.length ?? 0) > 0 && (
        <div>
          <h4 className="au-wp-h">Review notes</h4>
          <ul className="au-wp-notes">
            {step!.notes.map((n) => (
              <li key={n.id} className={n.cleared_at ? 'is-cleared' : ''}>
                <p className="au-wp-note">{n.note}</p>
                <p className="muted au-meta">{n.raised_by_name ?? 'A reviewer'}, {formatDateTime(n.raised_at)}{n.cleared_at ? '' : ` · for ${n.addressed_to_name ?? 'the preparer'}`}</p>
                {n.cleared_at ? (
                  <p className="au-meta">Cleared by {n.cleared_by_name ?? 'the preparer'}, {formatDateTime(n.cleared_at)}: {n.response}</p>
                ) : n.addressed_to === me && !closed ? (
                  <div className="au-note">
                    <TextArea label="Response" rows={1} value={responses[n.id] ?? ''} onChange={(v) => setResponses({ ...responses, [n.id]: v })} />
                    <Button size="sm" disabled={!(responses[n.id] ?? '').trim()} loading={busy === `clear-${n.id}`}
                      onClick={() => run(`clear-${n.id}`, () => api.post<WorkpaperData>(`${base}/steps/${item.id}/notes/${n.id}/clear`, { response: responses[n.id] }), 'Review note cleared.')}>Clear note</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {mayReview && (
        <div className="au-note">
          <TextArea label="Add a review note" rows={1} value={noteText} onChange={setNoteText} hint="Sends the step back to its preparer until they clear the note." />
          <Button size="sm" disabled={!noteText.trim()} loading={busy === 'note'}
            onClick={() => run('note', async () => { const d = await api.post<WorkpaperData>(`${base}/steps/${item.id}/notes`, { note: noteText }); setNoteText(''); return d; }, 'Review note raised.')}>Raise note</Button>
        </div>
      )}
    </div>
  );
}

/** The audit's workpapers (Checklist tab of an audit). */
export function AuditWorkpapers({ auditId, closed }: { auditId: string; closed: boolean }) {
  const url = `/api/audits/${auditId}/checklist`;
  const { data, error, reload } = useFetch<WorkpaperData>(url);
  const files = useFetch<AuditFile[] | { rows: AuditFile[] }>(`/api/attachments?record_type=audit_engagement&record_id=${auditId}`);
  const [open, setOpen] = useState<string | null>(null);
  const [fresh, setFresh] = useState<WorkpaperData | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  const d = fresh ?? data;
  if (!d.template) {
    return <EmptyState icon="check-square" title="No audit program chosen" message="Choose an audit checklist in the audit's details (Checklist field): its items are the steps of the audit program." />;
  }
  const fileList = Array.isArray(files.data) ? files.data : files.data?.rows ?? [];
  const after = (next?: WorkpaperData) => { if (next && next.items) setFresh(next); else { setFresh(null); reload(); } };
  let n = 0;
  return (
    <div className="stack">
      <Card title={d.template.name} actions={<span className="muted">Version {d.template.version}</span>}>
        <div className="au-wp-progress">
          <ProgressBar label="Steps with a result" value={d.answered} max={Math.max(1, d.total)} valueText={`${d.answered} of ${d.total}`} color="blue" />
          <ProgressBar label="Steps prepared" value={d.prepared ?? 0} max={Math.max(1, d.total)} valueText={`${d.prepared ?? 0} of ${d.total}`} color="teal" />
          <ProgressBar label="Steps reviewed" value={d.reviewed ?? 0} max={Math.max(1, d.total)} valueText={`${d.reviewed ?? 0} of ${d.total}`} color="green" />
        </div>
        {(d.open_notes ?? 0) > 0 && <p className="au-meta">{d.open_notes === 1 ? '1 review note is open.' : `${d.open_notes} review notes are open.`}</p>}
      </Card>
      {bySection(d.items).map((g) => (
        <Card key={`${g.section}-${g.items[0].id}`} title={g.section ?? 'Audit program'} flush>
          <ol className="au-list">
            {g.items.map((i) => {
              n += 1;
              const step = d.responses[i.id];
              const expanded = open === i.id;
              return (
                <li key={i.id} className="au-list-item au-wp-item">
                  <div className="au-list-main">
                    <p className="au-prompt"><span className="muted" title={i.wp_ref_full ?? undefined}>{i.wp_ref ? `WP ${i.wp_ref}` : `${n}.`}</span> {i.prompt} <ItemFlags item={i} /></p>
                    <StepState step={step} />
                    {expanded && <StepEditor key={`${i.id}-${step?.answered_at ?? ''}-${step?.prepared_at ?? ''}-${step?.reviewed_at ?? ''}`}
                      auditId={auditId} item={i} step={step} files={fileList} data={d} closed={closed} onSaved={after} />}
                  </div>
                  <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i.id)}>
                    {expanded ? 'Close step' : 'Open step'}
                  </Button>
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
    </div>
  );
}
