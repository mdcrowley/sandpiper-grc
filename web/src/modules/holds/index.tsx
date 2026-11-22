// Legal holds (Administration > Legal holds). Always on: not a feature area, so a hold never lapses
// because a part of the application was switched off.
import type { ModuleDef } from '../../core';
import { HoldDetail, HoldList } from './LegalHolds';

const view = 'legal.view';

const mod: ModuleDef = {
  key: 'holds',
  nav: [
    { group: 'Administration', label: 'Legal holds', path: '/admin/legal-holds', icon: 'lock', permission: view, order: 45 },
  ],
  routes: [
    { path: '/admin/legal-holds', element: <HoldList />, permission: view },
    { path: '/admin/legal-holds/:id', element: <HoldDetail />, permission: view },
  ],
  create: [
    { label: 'Legal hold', path: '/admin/legal-holds?new=1', permission: 'legal.create', icon: 'lock' },
  ],
};
export default mod;
