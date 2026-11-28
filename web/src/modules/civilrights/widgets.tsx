// The Overview's civil rights panel: open and overdue complaints, overdue reports and program updates,
// and the current participation goal's attainment. Figures only (the same for everyone who may see the
// area; confidential complaints are counted, never shown). The home module lists it in its registry:
//   import { CIVIL_RIGHTS_WIDGETS } from '../civilrights/widgets';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Icon, Loading } from '../../core';
import type { WidgetDef } from '../home/types';
import { pct, useSummary } from './shared';

function Fig({ value, label, to, tone }: { value: number | string; label: string; to: string; tone?: 'amber' | 'red' }) {
  return (
    <Link to={to} className={`home-figure${tone ? ` home-figure-${tone}` : ''}`}>
      <span className="home-figure-value">{value}</span>
      <span className="home-figure-label">{label}</span>
    </Link>
  );
}

function CivilRightsPanel() {
  const { data, error, reload } = useSummary();
  return (
    <Card title="Civil rights" className="home-panel"
      actions={<Link className="home-more" to="/civil-rights" aria-label="Open civil rights programs">Programs<Icon name="arrow-right" size={14} /></Link>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.programs.total === 0 && data.complaints.open === 0 && !data.goal ? <EmptyState icon="scale" title="No civil rights programs yet" />
        : (
          <div className="home-figures">
            <Fig value={data.complaints.open} label="Open complaints" to="/civil-rights/complaints" />
            <Fig value={data.complaints.overdue} label="Complaints overdue" to="/civil-rights/complaints" tone={data.complaints.overdue ? 'red' : undefined} />
            <Fig value={data.programs.reports_overdue} label="Reports overdue" to="/civil-rights/reports" tone={data.programs.reports_overdue ? 'red' : undefined} />
            <Fig value={data.programs.update_overdue} label="Program updates overdue" to="/civil-rights" tone={data.programs.update_overdue ? 'amber' : undefined} />
            {data.goal && (
              <Fig value={pct(data.goal.attainment_pct)} label={`Participation, goal ${pct(data.goal.goal_pct)}`} to={`/civil-rights/goals/${data.goal.goal_id}`}
                tone={data.goal.met === false ? 'amber' : undefined} />
            )}
          </div>
        )}
    </Card>
  );
}

export const CIVIL_RIGHTS_WIDGETS: WidgetDef[] = [
  {
    id: 'civil-rights', title: 'Civil rights', group: 'dashboard',
    description: 'Open and overdue complaints, overdue reports and program updates, and participation against the goal.',
    visible: (ctx) => ctx.can('civilrights.view') && ctx.hasModule('civilrights'),
    render: () => <CivilRightsPanel />,
  },
];
