import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Group, Paper, SimpleGrid, Text } from '@mantine/core';
import {
  Card, EditableSummary, ErrorState, formatDate, Icon, Loading, LookupChip, Menu, RecordPage, useAuth, useResource,
} from '../../core';
import type { RecordContext } from '../../core';
import { ActionsPanel } from '../risks/ActionsPanel';
import { BudgetBar, Person, RagChip, RagWithTrend, TierChip } from './bits';
import { GateRecordDrawer } from './GateRecordDrawer';
import { GatesProvider, useGates } from './gatesContext';
import { describeGate, GateStepper } from './GateStepper';
import { GateTab } from './GateTab';
import { ItemsTab } from './ItemsTab';
import { MilestonesTab } from './MilestonesTab';
import { RollbackDialog } from './RollbackDialog';
import { ScoringTab } from './ScoringTab';
import { StatusReportsTab } from './StatusReportsTab';
import { SystemsCard } from './SystemsCard';
import { daysBetween, todayIso, type Gate } from './types';

/** The centerpiece: stages and gates, with one line saying where the project stands. */
function StepperBanner() {
  const { data, error, reload } = useGates();
  const [search, setSearch] = useSearchParams();
  const [record, setRecord] = useState<Gate | null>(null);
  if (error) return <ErrorState title="The stages and gates could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Card><Loading lines={2} label="Loading stages and gates" /></Card>;
  const current = data.gates.find((g) => g.id === data.current_gate_id);
  const work = (gate: Gate) => {
    const next = new URLSearchParams(search);
    next.set('tab', 'gate');
    if (gate.id === data.current_gate_id) next.delete('gate'); else next.set('gate', gate.id);
    setSearch(next, { replace: true });
    setRecord(null);
  };
  return (
    <Card>
      <GateStepper data={data} onGateClick={setRecord} />
      <Text size="sm" c="dimmed" mt="sm" className="prj-stepper-note">
        {current
          ? <><Icon name={current.blockers.length ? 'lock' : 'check-circle'} size={14} /> Current gate: <strong>{current.name}</strong>. {describeGate(current)}. Select a gate to see its record.</>
          : <><Icon name="check-circle" size={14} /> Every gate has been passed. Select a gate to see its record.</>}
      </Text>
      <GateRecordDrawer gate={record ? data.gates.find((g) => g.id === record.id) ?? record : null} onClose={() => setRecord(null)} onWork={work} />
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prj-fact">
      <Text size="xs" c="dimmed" fw={500}>{label}</Text>
      <div>{children}</div>
    </div>
  );
}

function Summary({ row }: RecordContext) {
  const today = todayIso();
  const target = row.target_on ? String(row.target_on).slice(0, 10) : null;
  const left = target ? daysBetween(today, target) : null;
  const open = row.status === 'active' && row.stage !== 'close';
  return (
    <div className="stack">
      {row.tier_override && (
        <Alert color="blue" variant="light" icon={<Icon name="info" />} title="The tier was set by hand">
          Set to <strong>{row._display?.tier_override ?? row.tier_override}</strong>; the rules give {row._display?.tier_computed ?? row.tier_computed}.
          Reason: {row.tier_override_reason}
        </Alert>
      )}
      <Paper withBorder radius="md" p="md">
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="lg">
          <Fact label="Latest ratings">
            <Group gap={6}>
              <RagChip value={row.rag_schedule} label="Schedule" />
              <RagChip value={row.rag_budget} label="Budget" />
              <RagChip value={row.rag_risk} label="Risk" />
            </Group>
            <Text size="xs" c="dimmed" mt={4}>{row.last_report_on ? `Reported ${formatDate(row.last_report_on)}` : 'No status report yet'}</Text>
          </Fact>
          <Fact label="Spend against budget"><BudgetBar budget={row.budget} spend={row.spend_to_date} detail /></Fact>
          <Fact label="Target date">
            <Text fw={600}>{target ? formatDate(target) : 'Not set'}</Text>
            {left !== null && open && (
              <Text size="xs" c={left < 0 ? 'var(--danger-text)' : 'dimmed'}>
                {left < 0 ? `${-left} ${left === -1 ? 'day' : 'days'} past the target` : left === 0 ? 'Today' : `${left} ${left === 1 ? 'day' : 'days'} to go`}
              </Text>
            )}
          </Fact>
          <Fact label="People">
            <Person name={row._display?.project_manager_id} placeholder="No project manager" />
            <Text size="xs" c="dimmed" mt={4}>{row.sponsor ? `Sponsor: ${row.sponsor}` : 'No sponsor named'}</Text>
            <Text size="xs" c="dimmed">{row.priority_score !== null && row.priority_score !== undefined ? `Priority score ${row.priority_score} of 100` : 'Not scored yet'}</Text>
          </Fact>
        </SimpleGrid>
      </Paper>
    </div>
  );
}

/** The Overview tab: the editable cards. */
function Overview({ row, reload, save }: RecordContext) {
  const { reload: reloadGates } = useGates();
  const hasVendors = Boolean(useResource('vendor'));
  const hasContracts = Boolean(useResource('contract'));
  const saved = () => { reload(); reloadGates(); };
  return (
    <div className="stack">
      <div className="grid-2 prj-summary-grid">
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
          <SystemsCard row={row} save={save} />
        </div>
      </div>
    </div>
  );
}

function HeaderActions({ row, reload }: RecordContext) {
  const { can } = useAuth();
  const { data, reload: reloadGates } = useGates();
  const [rollingBack, setRollingBack] = useState(false);
  if (!data?.rollback || !can('projects.approve') || row.status === 'cancelled') return null;
  return (
    <>
      <Menu
        label="More actions" icon="more" iconOnly align="end"
        items={[{ label: 'Move back a stage…', icon: 'chevrons-left', onSelect: () => setRollingBack(true) }]}
      />
      <RollbackDialog open={rollingBack} projectId={row.id} data={data} onClose={() => setRollingBack(false)} onDone={() => { reload(); reloadGates(); }} />
    </>
  );
}

/** Project record: tier and rating chips, the gate stepper, the facts, and a tab for each part of the work. */
export function ProjectDetail() {
  const { id } = useParams();
  const hasActions = Boolean(useResource('action'));
  return (
    <GatesProvider projectId={id}>
      <RecordPage
        type="project"
        status={(row) => (
          <Group gap={6} component="span" display="inline-flex">
            <LookupChip list="project_stage" value={row.stage} />
            {row.status !== 'active' && <LookupChip list="project_status" value={row.status} />}
            <TierChip tier={row.tier} />
            <RagWithTrend value={row.rag_overall} trend={row.rag_trend} />
          </Group>
        )}
        actions={(rec) => <HeaderActions {...rec} />}
        banner={() => <StepperBanner />}
        summary={(rec) => <Summary {...rec} />}
        tabs={[
          { key: 'overview', label: 'Overview', content: (rec) => <Overview {...rec} /> },
          { key: 'gate', label: 'Gate', content: (rec) => <GateTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'reports', label: 'Status reports', content: (rec) => <StatusReportsTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'items', label: 'Register', content: (rec) => <ItemsTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'milestones', label: 'Milestones', content: (rec) => <MilestonesTab projectId={rec.row.id} onChanged={rec.reload} /> },
          { key: 'scoring', label: 'Scoring', content: (rec) => <ScoringTab row={rec.row} save={rec.save} canEdit={rec.canEdit} /> },
          ...(hasActions ? [{ key: 'actions', label: 'Actions', content: (rec: RecordContext) => <ActionsPanel sourceType="project" sourceId={rec.row.id} source="project" /> }] : []),
        ]}
      />
    </GatesProvider>
  );
}
