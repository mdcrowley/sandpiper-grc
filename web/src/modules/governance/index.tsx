// Committees and meetings: committees and their members, meetings with agenda, pack, attendance,
// minutes and decisions, and the decisions register.
import type { ModuleDef } from '../../core';
import { CommitteeDetail, CommitteeList } from './Committees';
import { DecisionDetail, DecisionList } from './Decisions';
import { MeetingDetail, MeetingList } from './Meetings';
import './governance.css';

const view = 'governance.view';

const mod: ModuleDef = {
  key: 'governance',
  nav: [
    { group: 'Governance and records', label: 'Committees', path: '/governance/committees', icon: 'users', permission: view, order: 10 },
    { group: 'Governance and records', label: 'Meetings', path: '/governance/meetings', icon: 'calendar', permission: view, order: 11, menu: false, parent: '/governance/committees' },
    { group: 'Governance and records', label: 'Decisions', path: '/governance/decisions', icon: 'check-square', permission: view, order: 12, menu: false, parent: '/governance/committees' },
  ],
  routes: [
    { path: '/governance/committees', element: <CommitteeList />, permission: view },
    { path: '/governance/committees/:id', element: <CommitteeDetail />, permission: view },
    { path: '/governance/meetings', element: <MeetingList />, permission: view },
    { path: '/governance/meetings/:id', element: <MeetingDetail />, permission: view },
    { path: '/governance/decisions', element: <DecisionList />, permission: view },
    { path: '/governance/decisions/:id', element: <DecisionDetail />, permission: view },
  ],
  create: [
    { label: 'Committee', path: '/governance/committees?new=1', permission: 'governance.create', icon: 'users' },
    { label: 'Meeting', path: '/governance/meetings?new=1', permission: 'governance.create', icon: 'calendar' },
  ],
};
export default mod;
