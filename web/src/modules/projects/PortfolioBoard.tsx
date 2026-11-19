import { Link } from 'react-router-dom';
import { Badge, Group, Paper, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { ColorDot, formatDate, Icon, LookupChip, lookupLabel, toColorName, useAuth } from '../../core';
import { BudgetBar, compactCurrency, Person, RagWithTrend, TierChip } from './bits';
import type { Portfolio, PortfolioRow } from './types';

function GateLine({ p, canApprove }: { p: PortfolioRow; canApprove: boolean }) {
  const gate = p.gate;
  if (!gate) return <Text size="xs" c="dimmed">No gate left: the last stage.</Text>;
  const next = lookupLabel('project_stage', gate.to_stage);
  const left = gate.total - gate.checked + gate.documents_missing;
  const state = gate.ready ? 'Ready for a decision' : gate.status === 'deferred' ? `Deferred · ${left} to do` : `${left} to do`;
  return (
    <div className="prj-kgate">
      <Group justify="space-between" gap={6} wrap="nowrap">
        <Text size="xs" c="dimmed" truncate>Next gate: <Text span c="var(--text)" inherit fw={500}>{gate.name}</Text></Text>
        <Text size="xs" c={gate.ready ? 'var(--c-green-fg)' : 'dimmed'} fw={gate.ready ? 600 : 400} style={{ whiteSpace: 'nowrap' }}>{state}</Text>
      </Group>
      <Progress
        value={gate.total ? (gate.checked / gate.total) * 100 : 100}
        color={gate.ready ? 'green' : 'blue'}
        size="xs"
        radius="xl"
        mt={4}
        aria-label={`${gate.name} checklist: ${gate.checked} of ${gate.total} done`}
      />
      {p.status === 'active' && (
        <Link className={`btn btn-sm ${gate.ready && canApprove ? 'btn-primary' : 'btn-secondary'} prj-kmove`} to={`/projects/${p.id}?tab=gate${gate.ready && canApprove ? '&decide=1' : ''}`}>
          {gate.ready && canApprove ? `Move to ${next}` : gate.ready ? 'See the gate' : 'Work the gate'}
          <Icon name="arrow-right" size={14} />
        </Link>
      )}
    </div>
  );
}

function ProjectCard({ p, canApprove }: { p: PortfolioRow; canApprove: boolean }) {
  return (
    <Paper component="li" withBorder radius="md" p="sm" className={`prj-kcard${p.status !== 'active' ? ' prj-kcard-held' : ''}`}>
      <Group justify="space-between" gap={6} wrap="nowrap">
        <span className="ref">{p.ref}</span>
        <Group gap={4} wrap="nowrap">
          {p.status !== 'active' && <LookupChip list="project_status" value={p.status} />}
          <TierChip tier={p.tier} />
        </Group>
      </Group>
      <Link to={`/projects/${p.id}`} className="prj-kcard-title">{p.name}</Link>
      <Group justify="space-between" gap={6} wrap="nowrap">
        <RagWithTrend value={p.rag_overall} trend={p.rag_trend} />
        {p.target_on && (
          <Tooltip label={`Target date ${formatDate(p.target_on)}`}>
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}><Icon name="calendar" size={13} /> {formatDate(p.target_on)}</Text>
          </Tooltip>
        )}
      </Group>
      <Person name={p.project_manager} placeholder="No project manager" />
      <BudgetBar budget={p.budget} spend={p.spend_to_date} detail />
      <GateLine p={p} canApprove={canApprove} />
    </Paper>
  );
}

/**
 * One column per stage. Nothing is dragged: a project changes column only when its gate is
 * approved, so each card carries a button that leads to that decision.
 */
export function PortfolioBoard({ data, rows }: { data: Portfolio; rows: PortfolioRow[]; onChanged?: () => void }) {
  const { can } = useAuth();
  const canApprove = can('projects.approve');
  const shown = rows.filter((p) => p.status !== 'cancelled');
  const cancelled = rows.length - shown.length;
  return (
    <Stack gap="xs">
      <div className="prj-board" role="list" aria-label="Projects by stage">
        {data.funnel.map((stage) => {
          const cards = shown.filter((p) => p.stage === stage.stage);
          const isWip = stage.stage === data.wip.stage;
          const over = isWip && data.wip.exceeded;
          const budget = cards.reduce((n, p) => n + (p.budget ?? 0), 0);
          return (
            <section key={stage.stage} role="listitem" className={`prj-column${over ? ' prj-column-over' : ''}`} aria-label={`${stage.label}: ${cards.length} projects`}>
              <header className="prj-column-head">
                <Group gap={6} wrap="nowrap">
                  <ColorDot color={toColorName(stage.color)} />
                  <Text fw={650} size="sm" component="h2">{stage.label}</Text>
                  <Badge variant="light" color={over ? 'red' : 'gray'} size="sm" radius="xl">
                    {cards.length}{isWip ? ` of ${data.wip.limit}` : ''}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">{budget ? compactCurrency(budget) : ''}</Text>
              </header>
              {over && <Text size="xs" c="var(--danger-text)" px={4}><Icon name="alert" size={13} /> Over the work-in-progress limit</Text>}
              {cards.length === 0 ? <p className="prj-column-empty">Nothing at this stage</p> : (
                <ul className="prj-cards">
                  {cards.map((p) => <ProjectCard key={p.id} p={p} canApprove={canApprove} />)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <Text size="sm" c="dimmed">
        A project moves to the next column when its gate is approved.
        {cancelled > 0 ? ` ${cancelled} cancelled ${cancelled === 1 ? 'project is' : 'projects are'} not shown.` : ' Cancelled projects are not shown.'}
      </Text>
    </Stack>
  );
}
