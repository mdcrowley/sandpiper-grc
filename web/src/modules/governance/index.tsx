// Committees and meetings: committees and their members, meetings with agenda, papers, board book,
// attendance, minutes, motions and decisions, the decisions register, and the member reading view.
import type { ModuleDef } from '../../core';
import { CommitteeDetail, CommitteeList } from './Committees';
import { DecisionDetail, DecisionList } from './Decisions';
import { MeetingDetail, MeetingList } from './Meetings';
import { MyMeetingDetail, MyMeetingList } from './MyMeetings';
import './governance.css';

const view = 'governance.view';

const mod: ModuleDef = {
  key: 'governance',
  nav: [
    { group: 'Governance and records', label: 'Committees', path: '/governance/committees', icon: 'users', permission: view, order: 10 },
    { group: 'Governance and records', label: 'Meetings', path: '/governance/meetings', icon: 'calendar', permission: view, order: 11, menu: false, parent: '/governance/committees' },
    { group: 'Governance and records', label: 'Decisions', path: '/governance/decisions', icon: 'check-square', permission: view, order: 12, menu: false, parent: '/governance/committees' },
    // The member reading view needs no permission: the server answers only for the committees a person sits on.
    { group: 'Home', label: 'My committee meetings', path: '/governance/my-meetings', icon: 'calendar', order: 37, menu: false, parent: '/my-work', tab: 'Committee meetings' },
  ],
  routes: [
    { path: '/governance/committees', element: <CommitteeList />, permission: view },
    { path: '/governance/committees/:id', element: <CommitteeDetail />, permission: view },
    { path: '/governance/meetings', element: <MeetingList />, permission: view },
    { path: '/governance/meetings/:id', element: <MeetingDetail />, permission: view },
    { path: '/governance/decisions', element: <DecisionList />, permission: view },
    { path: '/governance/decisions/:id', element: <DecisionDetail />, permission: view },
    { path: '/governance/my-meetings', element: <MyMeetingList /> },
    { path: '/governance/my-meetings/:id', element: <MyMeetingDetail /> },
  ],
  create: [
    { label: 'Committee', path: '/governance/committees?new=1', permission: 'governance.create', icon: 'users' },
    { label: 'Meeting', path: '/governance/meetings?new=1', permission: 'governance.create', icon: 'calendar' },
  ],
};
export default mod;
