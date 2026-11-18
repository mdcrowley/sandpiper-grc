import { useParams, useSearchParams } from 'react-router-dom';
import { EditableSummary, ErrorState, Icon, Loading, LookupChip, RecordPage, useResource } from '../../core';
import type { RecordContext } from '../../core';
import { BudgetBar, RagChip, RagWithTrend, TierChip } from './bits';
import { GatesProvider, useGates } from './gatesContext';
import { GateStepper } from './GateStepper';
import { GateTab } from './GateTab';
import { ItemsTab } from './ItemsTab';
import { MilestonesTab } from './MilestonesTab';
import { ScoringTab } from './ScoringTab';
import { StatusReportsTab } from './StatusReportsTab';

function StepperBanner() {
  const { data, error, reload } = useGates();
  const [search, setSearch] = useSearchParams();
  if (error) return <ErrorState title="The gate stepper could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={2} label="Loading stages and gates" />;
  const openGateTab = () => {
    const next = new URLSearchParams(search);
    next.set('tab', 'gate');
    setSearch(next, { replace: true });
  };
  return <GateStepper data={data} onGateClick={openGateTab} />;
}

function Summary({ row, reload }: RecordContext) {
  const { reload: reloadGates } = useGates();
  const hasVendors = Boolean(useResource('vendor'));
  const hasContracts = Boolean(useResource('contract'));
  const saved = () => { reload(); reloadGates(); };
  return (
    <div className="stack">
      {row.tier_override && (
        <div className="prj-banner prj-banner-blue" role="note">
          <Icon name="info" />
          <p>
            The tier was set by hand to <strong>{row._display?.tier_override ?? row.tier_override}</strong>; the rules
            give {row._display?.tier_computed ?? row.tier_computed}. Reason: {row.tier_override_reason}
          </p>
        </div>
      )}
      <div className="row">
        <RagChip value={row.rag_schedule} label="Schedule" />
        <RagChip value={row.rag_budget} label="Budget" />
        <RagChip value={row.rag_risk} label="Risk" />
        <span className="muted">Spend against budget</span>
        <BudgetBar budget={row.budget} spend={row.spend_to_date} />
        {row.priority_score !== null && row.priority_score !== undefined && <span className="muted">Priority score {row.priority_score} of 100</span>}
      </div>
      <div className="grid-2">
        <EditableSummary
          type="project"
          row={row}
          title="Project"
          fields={['name', 'description', 'expected_benefits', 'sponsor', 'project_manager_id', 'system_owner', 'department', 'status', 'start_on', 'target_on']}
          onSaved={saved}
        />
        <div className="stack">
          <EditableSummary
            type="project"
            row={row}
            title="Money and suppliers"
            fields={['budget', 'spend_to_date', 'funding_source', ...(hasVendors ? ['vendor_id'] : []), ...(hasContracts ? ['contract_id'] : [])]}
            onSaved={saved}
          />
          <EditableSummary
            type="project"
            row={row}
            title="Tier and impact"
            fields={[
              'tier', 'tier_override', 'tier_override_reason',
              'touches_payment', 'touches_personal_data', 'touches_operational_systems', 'security_impact', 'data_impact',
            ]}
            onSaved={saved}
          />
        </div>
      </div>
    </div>
  );
}

/** Project record: tier and status chips, the gate stepper, summary and tabs. */
export function ProjectDetail() {
  const { id } = useParams();
  return (
    <GatesProvider projectId={id}>
      <RecordPage
        type="project"
        status={(row) => (
          <span className="row">
            <LookupChip list="project_stage" value={row.stage} />
            {row.status !== 'active' && <LookupChip list="project_status" value={row.status} />}
            <TierChip tier={row.tier} />
            <RagWithTrend value={row.rag_overall} trend={row.rag_trend} />
          </span>
        )}
        banner={() => <StepperBanner />}
        summary={(rec) => <Summary {...rec} />}
        tabs={[
          { key: 'gate', label: 'Gate', content: (rec) => <GateTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'reports', label: 'Status reports', content: (rec) => <StatusReportsTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'items', label: 'Risks & issues', content: (rec) => <ItemsTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'milestones', label: 'Milestones', content: (rec) => <MilestonesTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'scoring', label: 'Scoring', content: (rec) => <ScoringTab row={rec.row} save={rec.save} canEdit={rec.canEdit} /> },
        ]}
      />
    </GatesProvider>
  );
}
