// The Overview panel of the strategy area: objectives off track and at risk, measures missing their
// target, and statistical reports overdue and due soon. The figures are the same for everyone.
// The home module lists it (home/registry.ts: `...STRATEGY_WIDGETS` in the dashboard widgets).
import { Link } from 'react-router-dom';
import { Card, ErrorState, Loading, useFetch, type ColorName } from '../../core';
import type { WidgetDef } from '../home/types';
import type { Summary } from './shared';

function Figure({ value, label, to, tone }: { value: number | string; label: string; to: string; tone?: ColorName }) {
  return (
    <Link to={to} className={`home-figure${tone ? ` home-figure-${tone}` : ''}`}>
      <span className="home-figure-value">{value}</span>
      <span className="home-figure-label">{label}</span>
    </Link>
  );
}

export function StrategyPanel() {
  const { data: s, error, reload } = useFetch<Summary>('/api/strategy/summary');
  return (
    <Card title="Strategy and performance" className="home-panel" actions={<Link className="home-more" to="/strategy/scorecard">Scorecard</Link>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !s ? <Loading lines={3} />
        : (
          <div className="home-figures">
            <Figure value={s.objectives.off_track} label="Objectives off track" to="/strategy/scorecard" tone={s.objectives.off_track ? 'red' : undefined} />
            <Figure value={s.objectives.at_risk} label="Objectives at risk" to="/strategy/scorecard" tone={s.objectives.at_risk ? 'amber' : undefined} />
            <Figure value={s.measures.missed} label="Measures missing target" to="/strategy/measures?f.latest_state=missed" tone={s.measures.missed ? 'red' : undefined} />
            <Figure value={s.submissions.overdue} label="Statistical reports overdue" to="/strategy/submissions" tone={s.submissions.overdue ? 'red' : undefined} />
            <Figure value={s.submissions.due_soon} label={`Reports due in ${s.due_soon_days} days`} to="/strategy/submissions" tone={s.submissions.due_soon ? 'amber' : undefined} />
          </div>
        )}
    </Card>
  );
}

export const STRATEGY_WIDGETS: WidgetDef[] = [
  {
    id: 'strategy-status', title: 'Strategy and performance', group: 'dashboard',
    description: 'Strategic objectives off track and at risk, measures missing their target, and statistical reports overdue or due soon.',
    visible: (ctx) => ctx.sees('strategic_objective'), render: () => <StrategyPanel />,
  },
];
