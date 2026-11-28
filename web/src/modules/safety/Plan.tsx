// The safety plan from the safety pages (wave 26, E46): the plan is a controlled document whose type
// is a plan (Documents), with its element map and annual review. This page shows which plans are the
// safety plan, their version, the next review date and where the annual review stands, and lets a
// safety administrator choose the plans it shows.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, EmptyState, errorMessage, ErrorState, formatDate, Loading, LookupChip, Modal, PageHeader, StatusChip, useAuth, useFetch, useToast,
} from '../../core';
import { SafetyTabs } from './shared';

interface Plan {
  id: string; ref: string; title: string; status: string; current_version: number | null;
  review_date: string | null; review_overdue: boolean; last_reviewed_on: string | null; owner_name: string | null;
  last_review: { review_year: number; outcome: string; started_on: string | null; approved_on: string | null } | null;
  review_running: boolean;
  review_progress: { name: string; approvals: number; required: number; waiting_for: number } | null;
  elements: number; elements_unowned: number;
}
interface Plans { available: boolean; chosen: boolean; can_open: boolean; plans: Plan[]; candidates: { id: string; ref: string; title: string }[] }

const OUTCOME: Record<string, { label: string; color: 'green' | 'amber' | 'red' | 'gray' }> = {
  approved: { label: 'Approved', color: 'green' },
  in_review: { label: 'In review', color: 'amber' },
  rejected: { label: 'Rejected', color: 'red' },
  canceled: { label: 'Canceled', color: 'gray' },
};

function ChooseDialog({ data, onClose, onSaved }: { data: Plans; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>(data.chosen ? data.plans.map((p) => p.id) : []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/safety/plans', { plan_ids: ids });
      toast.success(ids.length ? 'The safety plan is chosen.' : 'The safety pages show every plan titled with "safety".');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Choose the safety plan" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <p className="muted">Documents whose type is a plan. Choose none to show every plan with "safety" in its title.</p>
        {data.candidates.length === 0
          ? <p>No document is a plan yet. Create the plan under Documents with the document type Plan.</p>
          : data.candidates.map((c) => (
            <Checkbox key={c.id} label={`${c.ref} ${c.title}`} checked={ids.includes(c.id)}
              onChange={(on) => setIds((list) => (on ? [...list, c.id] : list.filter((x) => x !== c.id)))} />
          ))}
      </div>
    </Modal>
  );
}

function PlanCard({ plan, canOpen }: { plan: Plan; canOpen: boolean }) {
  const outcome = plan.last_review ? OUTCOME[plan.last_review.outcome] ?? { label: plan.last_review.outcome, color: 'gray' as const } : null;
  return (
    <Card title={<>{canOpen ? <Link to={`/policies/${plan.id}`}><span className="ref">{plan.ref}</span> {plan.title}</Link> : <><span className="ref">{plan.ref}</span> {plan.title}</>}</>}
      actions={<LookupChip list="policy_status" value={plan.status} />}>
      <dl className="sf-plan-facts">
        <div><dt>Version in force</dt><dd>{plan.current_version ? `Version ${plan.current_version}` : 'Not published yet'}</dd></div>
        <div><dt>Owner</dt><dd>{plan.owner_name ?? <span className="muted">No owner</span>}</dd></div>
        <div><dt>Next annual review</dt><dd>{plan.review_date
          ? (plan.review_overdue ? <span className="sf-overdue">{formatDate(plan.review_date)} (overdue)</span> : formatDate(plan.review_date))
          : <StatusChip color="amber" label="No date set" />}</dd></div>
        <div><dt>Last review</dt><dd>{plan.last_review
          ? <>{plan.last_review.review_year} <StatusChip color={outcome!.color} label={outcome!.label} />{plan.last_review.approved_on ? <span className="muted"> {formatDate(plan.last_review.approved_on)}</span> : null}</>
          : <span className="muted">None recorded</span>}</dd></div>
        <div><dt>Annual review</dt><dd>{plan.review_running
          ? (plan.review_progress ? `In review: ${plan.review_progress.approvals} of ${plan.review_progress.required} approvals (${plan.review_progress.name})` : 'In review')
          : 'Not running'}</dd></div>
        <div><dt>Element map</dt><dd>{plan.elements ? `${plan.elements} elements${plan.elements_unowned ? `, ${plan.elements_unowned} with no owner` : ''}` : <span className="muted">Not mapped yet</span>}</dd></div>
      </dl>
      {canOpen && <p className="sf-hint"><Link to={`/policies/${plan.id}`}>Open the plan, its element map and the annual review</Link></p>}
    </Card>
  );
}

export function SafetyPlanPage() {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Plans>('/api/safety/plans');
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="stack">
      <PageHeader title="Safety plan" subtitle="The safety plan is a controlled document of the type Plan, with its element map and annual review. Its version, next review and approval state are shown here."
        actions={can('safety.administer') && data?.available ? <Button icon="edit" onClick={() => setChoosing(true)}>Choose the plan</Button> : undefined} />
      <SafetyTabs active="plan" />
      {error ? <ErrorState title="The safety plan could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={6} label="Loading the safety plan" />
        : !data.available ? <EmptyState icon="file-text" title="The safety plan is not available" message="The safety plan cannot be shown on this installation." />
        : data.plans.length === 0 ? (
          <EmptyState icon="file-text" title="No safety plan found"
            message={data.chosen ? 'The plans chosen are no longer available to you.' : 'Create the safety plan under Documents with the document type Plan and "safety" in its title, or choose the plan here.'}
            action={can('policies.create') ? <Link className="btn btn-primary" to="/policies?new=1">New document</Link> : undefined} />
        ) : (
          <div className="stack">
            {!data.chosen && <p className="muted">Showing every plan with "safety" in its title. {can('safety.administer') ? 'Choose the plan to show only it.' : ''}</p>}
            {data.plans.map((p) => <PlanCard key={p.id} plan={p} canOpen={data.can_open} />)}
          </div>
        )}
      {choosing && data && <ChooseDialog data={data} onClose={() => setChoosing(false)} onSaved={() => { setChoosing(false); reload(); }} />}
    </div>
  );
}
