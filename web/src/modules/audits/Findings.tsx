// Findings from audits and inspections: the list across every source, and one finding with its
// response, the corrective action plan and hazard it raised, and the auditor's verification that it
// was put right, which closing needs (E45-16).
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, Button, Card, DateField, EditableSummary, errorMessage, formatDate, Loading, Modal, MultiSelect, PageHeader, RecordPage, ResourceList,
  TextArea, todayInZone, useAuth, useFetch, useResource, useToast, useUnsavedChanges,
} from '../../core';
import type { RecordContext } from '../../core';
import { AuditTabs, FindingCaps, sourceLabel, sourceRoute } from './shared';

// The evidence library's panel, when that module is in the build.
interface EvidencePanelProps { recordType: string; recordId: string; title?: string; onChange?: () => void }
const evidenceLoaders = import.meta.glob<{ EvidencePanel: ComponentType<EvidencePanelProps> }>('../evidence/EvidencePanel.tsx');
const loadEvidence = Object.values(evidenceLoaders)[0];
const EvidencePanel = loadEvidence ? lazy(() => loadEvidence().then((m) => ({ default: m.EvidencePanel }))) : null;

export function FindingList() {
  return (
    <div className="stack">
      <PageHeader title="Audit findings" subtitle="Findings from audits and inspections, with their rating, the management response, the plan that puts them right and the auditor's verification." />
      <AuditTabs active="findings" />
      <ResourceList
        type="audit_finding"
        urlState
        columns={['ref', 'title', 'rating', 'status', 'response_owner_id', 'response_due', 'cap_id', { field: 'source_type', label: 'Raised on', render: (r) => sourceLabel(r.source_type) },
          { field: 'verification_due', priority: 3 }, { field: 'verified_on', priority: 3 }, { field: 'verifier_id', hidden: true }, { field: 'responded_on', hidden: true }]}
        filters={['rating', 'status', 'response_owner_id', 'response_due', 'source_type', 'verifier_id', 'verification_due', 'verified_on']}
      />
    </div>
  );
}

function Raise({ row, reload }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const cap = useResource('cap');
  const hazard = useResource('hazard');
  const [busy, setBusy] = useState<string | null>(null);
  if (!can('audits.edit')) return null;
  const raise = async (what: 'cap' | 'hazard') => {
    setBusy(what);
    try {
      const res = await api.post<{ cap?: { route: string | null }; hazard?: { route: string } }>(`/api/audit-findings/${row.id}/${what}`, {});
      toast.success(what === 'cap' ? 'Corrective action plan raised.' : 'Hazard added to the hazard log.');
      reload();
      const route = what === 'cap' ? res.cap?.route : res.hazard?.route;
      if (route) navigate(route);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  return (
    <>
      {cap && can('actions.create') && !row.cap_id && row.status !== 'closed' && (
        <Button variant="primary" loading={busy === 'cap'} onClick={() => raise('cap')}>Raise a corrective action plan</Button>
      )}
      {hazard && can('safety.create') && !row.hazard_id && (
        <Button loading={busy === 'hazard'} onClick={() => raise('hazard')}>Add to the hazard log</Button>
      )}
    </>
  );
}

interface FileRow { id: string; file_name: string; link_title?: string | null }
interface EvidenceRow { evidence: { id: string; title: string; ref: string | null }; part: string }

function VerifyDialog({ row, onClose, onDone }: { row: RecordContext['row']; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const evidence = useResource('evidence_record');
  const files = useFetch<{ rows: FileRow[] }>(`/api/attachments?record_type=audit_finding&record_id=${row.id}`);
  const linked = useFetch<{ rows: EvidenceRow[] }>(evidence ? `/api/evidence-links?record_type=audit_finding&record_id=${row.id}` : null);
  const today = todayInZone();
  const [form, setForm] = useState({ verified_on: '', note: '', attachment_ids: [] as string[], evidence_ids: [] as string[] });
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(form.note || form.attachment_ids.length || form.evidence_ids.length || form.verified_on);
  const unsaved = useUnsavedChanges(dirty);
  const fileOptions = (files.data?.rows ?? []).map((f) => ({ value: f.id, label: f.link_title || f.file_name }));
  const evidenceOptions = (linked.data?.rows ?? []).filter((l) => !l.part).map((l) => ({ value: l.evidence.id, label: [l.evidence.ref, l.evidence.title].filter(Boolean).join(' ') }));
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/audit-findings/${row.id}/verify`, { ...form, verified_on: form.verified_on || undefined });
      unsaved.release();
      toast.success('Verification recorded; the finding is closed.');
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Verify and close the finding" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!form.note.trim() || (!form.attachment_ids.length && !form.evidence_ids.length)} onClick={submit}>Record verification and close</Button></>}>
      <div className="stack">
        <p className="muted">Check that the fix works. You cannot verify a fix you own (the response, the corrective action plan or one of its actions). Attach what you looked at to the finding first (Attachments{evidence ? ' or Evidence' : ''} tab).</p>
        <DateField label="Verified on" value={form.verified_on} max={today} onChange={(v) => setForm({ ...form, verified_on: v })} hint="Leave empty for today." />
        <TextArea label="What you checked and found" required value={form.note} rows={3} onChange={(v) => setForm({ ...form, note: v })} />
        {files.data ? (fileOptions.length
          ? <MultiSelect label={`Files looked at (${form.attachment_ids.length} chosen)`} options={fileOptions} value={form.attachment_ids} onChange={(v) => setForm({ ...form, attachment_ids: v })} />
          : <p className="muted au-meta">No files are attached to the finding yet.</p>) : <Loading lines={1} />}
        {evidence && (evidenceOptions.length
          ? <MultiSelect label={`Evidence records (${form.evidence_ids.length} chosen)`} options={evidenceOptions} value={form.evidence_ids} onChange={(v) => setForm({ ...form, evidence_ids: v })} />
          : <p className="muted au-meta">No evidence records are linked to the finding.</p>)}
      </div>
    </Modal>
  );
}

/** The auditor's verification of the fix: who is to verify, by when, and the verification once recorded. */
function Verification(rec: RecordContext) {
  const { row, reload } = rec;
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const responded = Boolean(String(row.management_response ?? '').trim() || row.cap_id);
  const ready = async () => {
    setBusy(true);
    try { await api.post(`/api/audit-findings/${row.id}/ready-for-verification`, {}); toast.success('The finding now waits for the auditor\'s verification.'); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const overdue = !row.verified_on && row.verification_due && String(row.verification_due) < todayInZone();
  return (
    <div className="stack">
    <Card title="Verification">
      <div className="stack">
        {row.verified_on ? (
          <>
            <p>Verified on {formatDate(String(row.verified_on))} by {row.verified_by_name ?? 'an auditor'}.</p>
            {row.verification_note && <p className="au-wp-note">{String(row.verification_note)}</p>}
          </>
        ) : row.status === 'closed' ? (
          <p className="notice notice-warn">Closed without a recorded verification.</p>
        ) : (
          <p className="muted">
            An auditor who does not own the fix verifies it, with evidence and a date, before the finding closes.
            {row.verification_due ? ` Verification is due ${formatDate(String(row.verification_due))}.` : ''}
          </p>
        )}
        {overdue && <p className="notice notice-warn">The verification is overdue.</p>}
        {can('audits.edit') && !row.verified_on && row.status !== 'closed' && (
          <div className="au-wp-actions">
            {row.status !== 'awaiting_verification' && responded && <Button loading={busy} onClick={ready}>Ready for verification</Button>}
            {responded && <Button variant="primary" onClick={() => setOpen(true)}>Verify and close</Button>}
            {!responded && <span className="muted au-meta">Record the management response or raise a plan first.</span>}
          </div>
        )}
      </div>
      {open && <VerifyDialog row={row} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </Card>
    <EditableSummary type="audit_finding" row={row} onSaved={reload} title="Who verifies" fields={['verifier_id', 'verification_due']}
      editable={can('audits.edit') && !row.verified_on} />
    </div>
  );
}

export function FindingDetail() {
  const evidence = useResource('evidence_record');
  return (
    <RecordPage
      type="audit_finding"
      subtitle={(row) => <Link to={sourceRoute(row.source_type, row.source_id)}>Open the {sourceLabel(row.source_type).toLowerCase()} it was raised on</Link>}
      actions={(rec) => <Raise {...rec} />}
      summary={(rec) => (
        <div className="stack">
          <EditableSummary type="audit_finding" row={rec.row} onSaved={rec.reload} title="Finding"
            fields={['title', 'rating', 'criteria', 'condition', 'cause', 'effect', 'recommendation', 'status']} />
          <EditableSummary type="audit_finding" row={rec.row} onSaved={rec.reload} title="Management response"
            fields={['management_response', 'response_owner_id', 'response_due', 'responded_on', 'cap_id', 'hazard_id']} />
          <Verification {...rec} />
        </div>
      )}
      tabs={[{
        key: 'plan', label: 'Corrective action plan',
        content: ({ row }) => (
          <div className="stack">
            <FindingCaps findingId={row.id} source={row.source_type === 'inspection' ? 'inspection' : 'audit'} />
            <Card title="How findings are put right">
              <p className="muted">Record the management response above. For anything more than a quick fix, raise a corrective action plan: its actions, approval and verification of effectiveness are kept with the plan. When the plan reaches Verifying, the finding waits for the auditor's verification.</p>
            </Card>
          </div>
        ),
      }, ...(evidence && EvidencePanel ? [{
        key: 'evidence', label: 'Evidence',
        content: ({ row, reload }: RecordContext) => (
          <Suspense fallback={<Loading lines={3} />}><EvidencePanel recordType="audit_finding" recordId={String(row.id)} onChange={reload} /></Suspense>
        ),
      }] : [])]}
    />
  );
}
