// Strategy and performance (wave 26, feature area `strategy`): the strategic plan register (plans, goals,
// objectives, measures, initiatives, quarterly updates, the scorecard and a board PDF), operating
// statistics and the log of statistical reports submitted to outside bodies. One menu entry with tabs.
import type { ModuleDef } from '../../core';
import { GoalDetail, InitiativeDetail, MeasureDetail, MeasureValueDetail, ObjectiveDetail, PlanDetail, PlanHome, UpdateDetail } from './Plans';
import { MeasureList } from './Measures';
import { ScorecardPage } from './Scorecard';
import { SeriesDetail, StatValueDetail, StatisticsPage } from './Statistics';
import { SubmissionDetail, SubmissionsPage } from './Submissions';
import { StrategySettings } from './Settings';

const view = 'strategy.view';

const mod: ModuleDef = {
  key: 'strategy',
  nav: [
    { group: 'Governance and records', label: 'Strategy', path: '/strategy', icon: 'target', permission: view, order: 60, tabs: 'Plan' },
    { group: 'Governance and records', label: 'Plan scorecard', path: '/strategy/scorecard', icon: 'chart', permission: view, order: 61, menu: false, parent: '/strategy', tab: 'Scorecard' },
    { group: 'Governance and records', label: 'Strategic measures', path: '/strategy/measures', icon: 'target', permission: view, order: 62, menu: false, parent: '/strategy', tab: 'Measures' },
    { group: 'Governance and records', label: 'Operating statistics', path: '/strategy/statistics', icon: 'chart', permission: view, order: 63, menu: false, parent: '/strategy', tab: 'Statistics' },
    { group: 'Governance and records', label: 'Statistical submissions', path: '/strategy/submissions', icon: 'upload', permission: view, order: 64, menu: false, parent: '/strategy', tab: 'Submissions' },
    { group: 'Governance and records', label: 'Strategy settings', path: '/strategy/settings', icon: 'settings', permission: 'strategy.administer', order: 65, menu: false, parent: '/strategy', tab: 'Settings' },
  ],
  routes: [
    { path: '/strategy', element: <PlanHome />, permission: view },
    { path: '/strategy/plans/:id', element: <PlanDetail />, permission: view },
    { path: '/strategy/goals/:id', element: <GoalDetail />, permission: view },
    { path: '/strategy/objectives/:id', element: <ObjectiveDetail />, permission: view },
    { path: '/strategy/initiatives/:id', element: <InitiativeDetail />, permission: view },
    { path: '/strategy/updates/:id', element: <UpdateDetail />, permission: view },
    { path: '/strategy/scorecard', element: <ScorecardPage />, permission: view },
    { path: '/strategy/measures', element: <MeasureList />, permission: view },
    { path: '/strategy/measures/:id', element: <MeasureDetail />, permission: view },
    { path: '/strategy/measure-values/:id', element: <MeasureValueDetail />, permission: view },
    { path: '/strategy/statistics', element: <StatisticsPage />, permission: view },
    { path: '/strategy/statistics/:id', element: <SeriesDetail />, permission: view },
    { path: '/strategy/stat-values/:id', element: <StatValueDetail />, permission: view },
    { path: '/strategy/submissions', element: <SubmissionsPage />, permission: view },
    { path: '/strategy/submissions/:id', element: <SubmissionDetail />, permission: view },
    { path: '/strategy/settings', element: <StrategySettings />, permission: 'strategy.administer' },
  ],
  create: [
    { label: 'Strategic plan', path: '/strategy?new=1', permission: 'strategy.create', icon: 'target' },
    { label: 'Statistical submission', path: '/strategy/submissions?new=1', permission: 'strategy.create', icon: 'upload' },
  ],
};
export default mod;
