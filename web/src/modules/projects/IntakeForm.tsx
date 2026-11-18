import { useNavigate } from 'react-router-dom';
import { Card, formatCurrency, PageHeader, ResourceForm, useFetch, useToast } from '../../core';
import type { ProjectSettings } from './types';

/** The one-page project request. A new request enters the portfolio at the Idea stage. */
export function IntakeForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: settings } = useFetch<ProjectSettings>('/api/projects/settings');

  return (
    <div className="stack prj-narrow">
      <PageHeader
        title="New project request"
        subtitle="One page is enough to start. The request joins the portfolio as an idea and goes to the intake gate."
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: 'New request' }]}
      />
      <Card>
        <ResourceForm
          type="project"
          fields={[
            'name', 'description', 'expected_benefits', 'sponsor', 'department', 'budget', 'funding_source', 'target_on',
            'touches_payment', 'touches_personal_data', 'touches_operational_systems',
          ]}
          submitLabel="Submit request"
          onCancel={() => navigate('/projects')}
          onSaved={(row) => {
            toast.success(`Request ${row.ref} submitted.`);
            navigate(`/projects/${row.id}`);
          }}
        />
      </Card>
      <Card title="How the tier is set">
        {settings ? (
          <ul className="prj-plainlist">
            <li><strong>Tier 3:</strong> budget under {formatCurrency(settings.tiers.tier3Below)}.</li>
            <li><strong>Tier 2:</strong> budget from {formatCurrency(settings.tiers.tier3Below)} to {formatCurrency(settings.tiers.tier1Above)}.</li>
            <li><strong>Tier 1:</strong> budget over {formatCurrency(settings.tiers.tier1Above)}, or anything that touches payment, personal data or operational systems.</li>
          </ul>
        ) : (
          <p className="muted">The tier is worked out from the budget and the three impact questions.</p>
        )}
        <p className="muted">The tier decides who approves each gate. It is recalculated whenever the project is saved.</p>
      </Card>
    </div>
  );
}
