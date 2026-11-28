// Audit engagements: the list, and one audit with its scope, checklist, evidence requests,
// findings, report and report approval.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EditableSummary, errorMessage, ErrorState, IconButton, Loading, PageHeader, RecordPage, ResourceList,
  Stepper, TextArea, useAuth, useFetch, UserPicker, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { AuditWorkpapers } from './Workpapers';
import { AuditTime } from './Time';
import { AuditTabs } from './shared';

// Outside reviewers (E41-09) live in their own module; its tab shows only when the module is in the build.
interface ReviewersPanelProps { basePath: string; recordId: string; noun: string; restricted?: boolean }
const reviewerLoaders = import.meta.glob<{ ReviewersPanel: ComponentType<ReviewersPanelProps> }>('../outsidereviews/ReviewersPanel.tsx');
const loadReviewers = Object.values(reviewerLoaders)[0];
const OutsideReviewers = loadReviewers ? lazy(() => loadReviewers().then((m) => ({ default: m.ReviewersPanel }))) : null;

const STEPS = [
  { key: 'planned', label: 'Planned' }, { key: 'fieldwork', label: 'Fieldwork' },
  { key: 'reporting', label: 'Reporting' }, { key: 'closed', label: 'Closed' },
];
const SCOPE_FIELDS = ['title', 'audit_type', 'area_id', 'plan_year', 'scope', 'criteria', 'template_id', 'auditee_id', 'lead_auditor_id',
  'planned_start', 'planned_end', 'fieldwork_start', 'fieldwork_end', 'status', 'restricted'];

export function AuditList() {
  const { areaOn } = useAuth();
  return (
    <div className="stack">
      <PageHeader title="Audits" subtitle={`Internal audits, ${areaOn('safety') ? 'safety reviews, ' : ''}compliance pre-reviews and control audits: planned, in fieldwork, reporting and closed.`} />
      <AuditTabs active="engagements" />
      <ResourceList
        type="audit_engagement"
        urlState
        columns={['ref', 'title', 'audit_type', 'area_id', 'plan_year', 'status', 'planned_start', 'lead_auditor_id', { field: 'opinion', hidden: true }, { field: 'closed_on', hidden: true }]}
        filters={['status', 'audit_type', 'area_id', 'lead_auditor_id', 'auditee_id', 'planned_start', 'restricted']}
        createFields={['title', 'audit_type', 'area_id', 'plan_year', 'scope', 'criteria', 'template_id', 'lead_auditor_id', 'auditee_id', 'planned_start', 'planned_end', 'restricted']}
      />
    </div>
  );
}

/** The audit team: people picked one by one (stored as a list on the audit). */
function Team({ row, save, canEdit }: RecordContext) {
  const toast = useToast();
  const ids: string[] = Array.isArray(row.team_ids) ? row.team_ids : [];
  const { data, error, reload } = useFetch<{ id: string; label: string }[]>(ids.length ? `/api/users/options?ids=${ids.join(',')}` : null);
  const [adding, setAdding] = useState<string | null>(null);
  const update = async (next: string[]) => {
    try { await save({ team_ids: next }); reload(); } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Card title="Audit team">
      {error ? <ErrorState error={error} onRetry={reload} />
        : ids.length === 0 ? <p className="muted">No team members named yet.</p>
        : !data ? <Loading lines={2} />
        : (
          <ul className="au-team">
            {data.map((u) => (
              <li key={u.id}>
                <span>{u.label}</span>
                {canEdit && <IconButton icon="x" size="sm" variant="ghost" label={`Remove ${u.label} from the team`} onClick={() => update(ids.filter((i) => i !== u.id))} />}
              </li>
            ))}
          </ul>
        )}
      {canEdit && (
        <div className="au-team-add">
          <UserPicker label="Add a team member" value={adding} onChange={(id) => setAdding(id)} />
          <Button size="sm" disabled={!adding} onClick={async () => { if (adding) { await update([...ids, adding]); setAdding(null); } }}>Add</Button>
        </div>
      )}
    </Card>
  );
}

function StatusActions({ row, save, canEdit, reload }: RecordContext) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!canEdit) return null;
  const move = async (status: string, done: string) => {
    setBusy(true);
    try { await save({ status }); toast.success(done); reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  if (row.status === 'planned') return <Button variant="primary" loading={busy} onClick={() => move('fieldwork', 'Fieldwork started.')}>Start fieldwork</Button>;
  if (row.status === 'fieldwork') return <Button variant="primary" loading={busy} onClick={() => move('reporting', 'The audit is now in reporting.')}>Move to reporting</Button>;
  if (row.status === 'reporting') return <Link className="btn btn-primary" to={`?tab=approval`}>Close the audit</Link>;
  return null;
}

interface ApprovalState {
  available: boolean; required: boolean; approved: boolean; running: boolean; problems: string[];
  request: { id: string; workflow: string; status: string; started_at: string; finished_at: string | null; note: string | null } | null;
}

/** What still stops the audit closing, and the request for report approval (the workflow panel above shows its steps). */
function Approval({ row, reload, save, canEdit }: RecordContext) {
  const toast = useToast();
  const { data, error, reload: again } = useFetch<ApprovalState>(`/api/audits/${row.id}/report-approval?v=${row.updated_at}`);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={again} />;
  if (!data) return <Loading lines={4} />;
  const closed = row.status === 'closed' || row.status === 'canceled';
  const ask = async () => {
    setBusy(true);
    try { await api.post(`/api/audits/${row.id}/report-approval`, { note }); toast.success('Report approval asked for.'); setNote(''); reload(); again(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const close = async () => {
    setBusy(true);
    try { await save({ status: 'closed' }); toast.success('Audit closed.'); reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <Card title="Closing the audit">
        {closed ? (
          <p>{row.status === 'closed' ? `Closed${row.report_approved_on ? ' after the report was approved' : ''}.` : 'This audit was canceled.'}</p>
        ) : (
          <div className="stack">
            <p className="muted">An audit closes with a report summary, a management response or corrective action plan on every finding, every worked program step prepared and reviewed, and its control tests reviewed{data.required ? ', once its report is approved' : ''}.</p>
            {data.problems.length > 0 ? (
              <ul className="au-problems">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            ) : <p className="notice notice-success">Nothing is missing.</p>}
            {row.status !== 'reporting' && <p className="muted">Move the audit to Reporting first.</p>}
            {canEdit && row.status === 'reporting' && data.required && !data.running && !data.approved && (
              <div className="stack">
                <TextArea label="Note for the approvers (optional)" value={note} onChange={setNote} rows={2} />
                <div><Button variant="primary" loading={busy} disabled={data.problems.length > 0} onClick={ask}>Ask for report approval</Button></div>
              </div>
            )}
            {data.running && <p className="notice">The report is waiting for approval. The audit closes when it is approved.</p>}
            {canEdit && row.status === 'reporting' && (!data.required || data.approved) && (
              <div><Button variant="primary" loading={busy} disabled={data.problems.length > 0} onClick={close}>Close the audit</Button></div>
            )}
          </div>
        )}
      </Card>
      {data.request && (
        <Card title="Latest approval request">
          <p>{data.request.workflow}: <strong>{data.request.status === 'running' ? 'waiting' : data.request.status}</strong>{data.request.note ? ` · ${data.request.note}` : ''}</p>
        </Card>
      )}
    </div>
  );
}

interface WorkpaperStatus {
  steps: { total: number; worked: number; prepared: number; reviewed: number }; open_notes: number;
  control_tests: { total: number; unreviewed: number } | null;
  findings: { total: number; awaiting_verification: number; verification_overdue: number; closed: number };
}

/** Where the workpapers, control tests and finding verifications stand (beside the scope). */
function WorkStatus({ row }: RecordContext) {
  const { data, error, reload } = useFetch<WorkpaperStatus>(`/api/audits/${row.id}/workpaper-status?v=${row.updated_at}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const s = data.steps;
  return (
    <Card title="Workpapers and follow-up">
      <ul className="au-status-list">
        <li>{s.worked} of {s.total} program steps worked, {s.prepared} prepared, {s.reviewed} reviewed</li>
        {data.open_notes > 0 && <li>{data.open_notes === 1 ? '1 review note open' : `${data.open_notes} review notes open`}</li>}
        {data.control_tests && data.control_tests.total > 0 && <li>{data.control_tests.total} control tests, {data.control_tests.unreviewed} not reviewed</li>}
        <li>{data.findings.total} findings, {data.findings.awaiting_verification} awaiting verification, {data.findings.closed} closed</li>
      </ul>
      {data.findings.verification_overdue > 0 && (
        <p className="notice notice-warn">{data.findings.verification_overdue === 1 ? '1 finding is' : `${data.findings.verification_overdue} findings are`} past the date for the auditor's verification.</p>
      )}
    </Card>
  );
}

/** Control tests recorded as part of this audit (controls module), when it is installed and on. */
function ControlTests({ row }: RecordContext) {
  return (
    <div className="stack">
      <p className="muted">Tests of the area's controls carried out for this audit. Each is reviewed by someone other than its tester who also works on audits; the audit closes once they are all reviewed.</p>
      <ResourceList type="control_test" baseFilter={{ audit_id: row.id }} urlState={false}
        columns={['ref', 'title', 'control_id', 'test_type', 'tester_id', 'result', 'status', 'reviewer_name']}
        filters={['status', 'result', 'tester_id']}
        createFields={['control_id', 'test_type', 'period_start', 'period_end', 'planned_on', 'tester_id', 'method']}
        createInitial={{ audit_id: row.id }} />
    </div>
  );
}

function Report(rec: RecordContext) {
  const { can } = useAuth();
  const { row } = rec;
  return (
    <div className="stack">
      <EditableSummary type="audit_engagement" row={row} onSaved={rec.reload} title="Report"
        editable={rec.canEdit && row.status !== 'closed'} fields={['report_summary', 'opinion', 'report_approved_on', 'report_approved_by_name', 'closed_on']} />
      {can('audits.export') && (
        <Card title="Audit report">
          <p className="muted">The report as a PDF, with your organization's name and logo: scope, summary, opinion and every finding with its response.</p>
          <a className="btn btn-secondary" href={`/api/audits/${row.id}/report.pdf`} download>Download the report (PDF)</a>
        </Card>
      )}
    </div>
  );
}

export function AuditDetail() {
  const controlTests = useResource('control_test');
  return (
    <RecordPage
      type="audit_engagement"
      banner={({ row }) => row.status === 'canceled' ? <p className="notice notice-warn">This audit was canceled.</p>
        : <Stepper label="Audit stages" current={row.status ?? 'planned'} steps={STEPS} />}
      actions={(rec) => <StatusActions {...rec} />}
      summary={(rec) => (
        <div className="au-scope">
          <EditableSummary type="audit_engagement" row={rec.row} onSaved={rec.reload} title="Scope" fields={SCOPE_FIELDS} />
          <div className="stack">
            <Team {...rec} />
            <WorkStatus {...rec} />
          </div>
        </div>
      )}
      tabs={[
        { key: 'checklist', label: 'Workpapers', content: ({ row }) => <AuditWorkpapers auditId={row.id} closed={row.status === 'closed' || row.status === 'canceled'} /> },
        { key: 'time', label: 'Time', content: ({ row }) => <AuditTime auditId={row.id} closed={row.status === 'closed' || row.status === 'canceled'} /> },
        {
          key: 'requests', label: 'Evidence requests',
          content: ({ row }) => (
            <ResourceList type="audit_request" baseFilter={{ audit_id: row.id }} urlState={false}
              columns={['ref', 'request', 'owner_id', 'due_on', 'status', 'provided_at']}
              filters={['status', 'owner_id', 'due_on']}
              createFields={['request', 'owner_id', 'due_on']} createInitial={{ audit_id: row.id }} onCreated={() => undefined} />
          ),
        },
        {
          key: 'findings', label: 'Findings',
          content: ({ row }) => (
            <ResourceList type="audit_finding" baseFilter={{ source_id: row.id }} urlState={false}
              columns={['ref', 'title', 'rating', 'status', 'response_owner_id', 'response_due', 'cap_id', 'verification_due', 'verified_on']}
              filters={['rating', 'status', 'response_owner_id']}
              createFields={['title', 'rating', 'criteria', 'condition', 'cause', 'effect', 'recommendation', 'response_owner_id', 'response_due']}
              createInitial={{ source_type: 'audit_engagement', source_id: row.id }} />
          ),
        },
        ...(controlTests ? [{ key: 'controls', label: 'Control tests', content: (rec: RecordContext) => <ControlTests {...rec} /> }] : []),
        { key: 'report', label: 'Report', content: (rec) => <Report {...rec} /> },
        { key: 'approval', label: 'Approval', content: (rec) => <Approval {...rec} /> },
        ...(OutsideReviewers ? [{
          key: 'reviewers', label: 'Outside reviewers',
          content: ({ row }: RecordContext) => (
            <Suspense fallback={<Loading lines={3} />}><OutsideReviewers basePath="/api/audits" recordId={row.id} noun="audit" restricted={row.restricted === true} /></Suspense>
          ),
        }] : []),
      ]}
    />
  );
}

