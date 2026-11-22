// Privacy: coverage (systems holding personal data and whether each has an approved assessment in
// date), the assessments list, and one assessment with its questions, data categories and approval.
import { Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, EditableSummary, EmptyState, errorMessage, ErrorState, formatDate, Loading, LookupChip, PageHeader,
  RecordPage, ResourceList, Select, StatusChip, TableWrap, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { LazyActions } from './Requests';
import { RecordsTabs } from './shared';
import './records.css';

interface CoverageRow {
  id: string; name: string; ref: string | null; current: boolean; categories: { id: string; name: string }[];
  assessment: { id: string; ref: string; title: string; status: string; next_review_on: string | null } | null;
}
interface Coverage { rows: CoverageRow[]; total: number; without_current: number; hidden: number }

export function CoveragePage() {
  const { data, error, reload } = useFetch<Coverage>('/api/privacy/coverage');
  return (
    <div className="stack">
      <PageHeader title="Privacy" subtitle="Systems holding personal data, and whether each has an approved privacy impact assessment in date." />
      <RecordsTabs active="coverage" />
      <Card title="Systems holding personal data" flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="rr-pad"><Loading lines={4} /></div>
          : data.total === 0 ? (
            <EmptyState icon="lock" title="No system holds personal data yet"
              message="Mark data categories that hold personal data (Inventory > Data categories) and link them to the systems that hold them." />
          ) : (
            <>
              <p className="rr-pad muted">
                {data.total} system{data.total === 1 ? '' : 's'} hold personal data; {data.without_current} without a current assessment
                {data.hidden ? ` (${data.hidden} you cannot see)` : ''}.
              </p>
              <TableWrap label="Systems holding personal data">
                <table className="table">
                  <caption className="sr-only">Systems holding personal data</caption>
                  <thead><tr><th scope="col">System</th><th scope="col">Personal data</th><th scope="col">Assessment</th><th scope="col">Next review</th></tr></thead>
                  <tbody>
                    {data.rows.map((s) => (
                      <tr key={s.id}>
                        <td className="rr-wrap"><Link to={`/systems/${s.id}`}>{s.ref && <span className="ref">{s.ref}</span>} {s.name}</Link></td>
                        <td className="rr-wrap">{s.categories.map((c) => c.name).join(', ') || <span className="muted">Not shown</span>}</td>
                        <td className="rr-wrap">
                          {s.current ? <StatusChip size="sm" color="green" label="Current" /> : <StatusChip size="sm" color="amber" label="No current assessment" />}
                          {s.assessment && <div><Link to={`/privacy/assessments/${s.assessment.id}`}><span className="ref">{s.assessment.ref}</span> {s.assessment.title}</Link> <LookupChip list="privacy_assessment_status" value={s.assessment.status} /></div>}
                        </td>
                        <td>{s.assessment?.next_review_on ? formatDate(s.assessment.next_review_on) : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          )}
      </Card>
    </div>
  );
}

export function AssessmentList() {
  return (
    <div className="stack">
      <PageHeader title="Privacy impact assessments" subtitle="One assessment for each system that holds personal data, approved and reviewed on a cycle." />
      <RecordsTabs active="assessments" />
      <ResourceList
        type="privacy_assessment"
        urlState
        columns={['ref', 'title', 'system_id', 'status', 'residual_risk', 'owner_id', 'next_review_on']}
        filters={['status', 'residual_risk', 'system_id', 'owner_id', 'next_review_on']}
        createFields={['title', 'system_id', 'owner_id', 'review_months']}
      />
    </div>
  );
}

interface Question { value: string; label: string; active: boolean; meta?: { kind?: string } }

function QuestionsTab({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Question[]>('/api/lookups/privacy_question');
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...((row.answers ?? {}) as Record<string, string>) }));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(answers) !== JSON.stringify(row.answers ?? {});
  const canEdit = can('privacy.edit') && row.status !== 'in_review';
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/api/privacy-assessments/${row.id}`, { answers }); toast.success('Answers saved.'); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const questions = data.filter((q) => q.active !== false || answers[q.value] !== undefined);
  return (
    <Card title="Screening questions" actions={canEdit && <Button size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={save}>Save answers</Button>}>
      {questions.length === 0 ? <EmptyState icon="clipboard" title="No questions set" message="Administrators set the questions under Administration > Lists (Privacy questions)." /> : (
        <div className="rr-answers">
          {questions.map((q) => (q.meta?.kind === 'yes_no' ? (
            <Select key={q.value} label={q.label} disabled={!canEdit} value={answers[q.value] ?? ''} placeholder="Not answered"
              options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'not_known', label: 'Not known' }]}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.value]: v }))} />
          ) : (
            <TextField key={q.value} label={q.label} disabled={!canEdit} value={answers[q.value] ?? ''} onChange={(v) => setAnswers((a) => ({ ...a, [q.value]: v }))} />
          )))}
        </div>
      )}
    </Card>
  );
}

interface Category { id: string; name: string; sensitivity_level: string | null }

function CategoriesTab({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Category[]>(row.system_id && can('data.view') && can('systems.view') ? `/api/systems/${row.system_id}/data-categories` : null);
  const initial = (Array.isArray(row.data_category_ids) ? row.data_category_ids : []) as string[];
  const [chosen, setChosen] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  if (!row.system_id) return <EmptyState icon="server" title="No system chosen" message="Choose the system this assessment is about, then pick the data categories it covers." />;
  if (!can('data.view')) return <EmptyState icon="lock" title="Data categories are not shown" message="You do not have permission to see data categories." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const canEdit = can('privacy.edit') && row.status !== 'in_review';
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/api/privacy-assessments/${row.id}`, { data_category_ids: chosen }); toast.success('Data categories saved.'); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Data categories the system holds" actions={canEdit && <Button size="sm" variant="primary" loading={busy} disabled={JSON.stringify([...chosen].sort()) === JSON.stringify([...initial].sort())} onClick={save}>Save</Button>}>
      {data.length === 0 ? <EmptyState icon="database" title="The system has no data categories" message="Link data categories to the system on its page (Data tab)." /> : (
        <div className="stack">
          {data.map((c) => (
            <Checkbox key={c.id} label={c.name} disabled={!canEdit} checked={chosen.includes(c.id)}
              onChange={(on) => setChosen((list) => (on ? [...list, c.id] : list.filter((x) => x !== c.id)))} />
          ))}
          <p className="muted">An approved assessment moves to "Needs update" when the system's data categories change.</p>
        </div>
      )}
    </Card>
  );
}

function ApprovalTab({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    setBusy(true); setErrors({});
    try {
      const res = await api.post<{ status: string; workflow: string | null }>(`/api/privacy-assessments/${row.id}/submit`);
      toast.success(res.status === 'approved' ? 'Approved.' : `Submitted for approval${res.workflow ? ` (${res.workflow})` : ''}.`);
      onChanged();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const missing = Object.values(errors);
  return (
    <Card title="Approval">
      <div className="stack">
        <p>
          <LookupChip list="privacy_assessment_status" value={row.status} />{' '}
          {row.approved_on ? <>Approved on {formatDate(row.approved_on)} by {row.approved_by_name ?? 'an approver'}; next review by {formatDate(row.next_review_on)}.</> : 'Not approved yet.'}
        </p>
        {row.status === 'needs_update' && <p className="notice notice-warn-soft">The system's data categories changed after approval: review the assessment and submit it again.</p>}
        {missing.length > 0 && <ul className="notice notice-warn">{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
        {can('privacy.edit') && row.status !== 'in_review' && (
          <div><Button variant="primary" loading={busy} onClick={submit}>{row.status === 'approved' ? 'Submit for review' : 'Submit for approval'}</Button></div>
        )}
        <p className="muted">Approval goes through the "Privacy impact assessment" approval workflow; approving sets the next review date from "Review every (months)".</p>
      </div>
    </Card>
  );
}

export function AssessmentDetail() {
  const { can } = useAuth();
  const Actions = LazyActions;
  return (
    <RecordPage
      type="privacy_assessment"
      summary={({ row, reload }) => (
        <div className="stack">
          <div className="rr-summary">
            <EditableSummary type="privacy_assessment" row={row} onSaved={reload} title="Assessment" editable={can('privacy.edit') && row.status !== 'in_review'}
              fields={['title', 'system_id', 'owner_id', 'residual_risk', 'review_months', 'approved_on', 'approved_by_name', 'next_review_on']} />
            <EditableSummary type="privacy_assessment" row={row} onSaved={reload} title="Purpose and basis" editable={can('privacy.edit') && row.status !== 'in_review'}
              fields={['purpose', 'legal_basis', 'necessity', 'retention', 'sharing']} />
          </div>
          <EditableSummary type="privacy_assessment" row={row} onSaved={reload} title="Risks to people" editable={can('privacy.edit') && row.status !== 'in_review'}
            fields={['risks', 'mitigations']} />
        </div>
      )}
      tabs={[
        { key: 'questions', label: 'Questions', content: ({ row, reload }) => <QuestionsTab row={row} onSaved={reload} /> },
        { key: 'categories', label: 'Data categories', content: ({ row, reload }) => <CategoriesTab row={row} onSaved={reload} /> },
        { key: 'approval', label: 'Approval', content: ({ row, reload }) => <ApprovalTab row={row} onChanged={reload} /> },
        ...(Actions && can('actions.view') ? [{
          key: 'actions', label: 'Actions',
          content: ({ row }: { row: Row }) => <Suspense fallback={<Loading lines={3} />}><Actions sourceType="privacy_assessment" sourceId={row.id} source="privacy" /></Suspense>,
        }] : []),
      ]}
    />
  );
}
