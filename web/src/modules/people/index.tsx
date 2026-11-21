// The staff roster and positions (E29-01, E29-02): everyone on staff, with or without an account,
// for training, certifications and policy acknowledgments. Always on (not a feature area).
import type { ModuleDef } from '../../core';
import { PeopleList, PersonDetail, PositionDetail, PositionList } from './PeoplePages';
import './people.css';

const mod: ModuleDef = {
  key: 'people',
  nav: [
    { group: 'Administration', label: 'People', path: '/people', icon: 'users', permission: 'people.view', order: 12 },
    { group: 'Administration', label: 'Positions', path: '/people/positions', icon: 'clipboard', permission: 'people.view', order: 13 },
  ],
  routes: [
    { path: '/people', element: <PeopleList />, permission: 'people.view' },
    { path: '/people/positions', element: <PositionList />, permission: 'people.view' },
    { path: '/people/positions/:id', element: <PositionDetail />, permission: 'people.view' },
    { path: '/people/:id', element: <PersonDetail />, permission: 'people.view' },
  ],
  create: [
    { label: 'Person', path: '/people?new=1', permission: 'people.create', icon: 'user' },
  ],
};

export default mod;
