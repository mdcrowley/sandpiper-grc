// Records retention schedule and destruction log (E41-15, feature area `recordsretention`): the
// organization's own record series, paper and electronic, with their periods and triggers, and the
// log of batches of records destroyed after approval. Shares the records permissions.
import type { ModuleDef } from '../../core';
import { DestructionDetail, DestructionList, SeriesDetail, SeriesList } from './Retention';

const view = 'records.view';

const mod: ModuleDef = {
  key: 'recordsretention',
  nav: [
    { group: 'Governance', label: 'Retention schedule', path: '/retention-schedule', icon: 'clock', permission: view, order: 62 },
    { group: 'Governance', label: 'Destruction log', path: '/destruction-log', icon: 'trash', permission: view, order: 63 },
  ],
  routes: [
    { path: '/retention-schedule', element: <SeriesList />, permission: view },
    { path: '/retention-schedule/:id', element: <SeriesDetail />, permission: view },
    { path: '/destruction-log', element: <DestructionList />, permission: view },
    { path: '/destruction-log/:id', element: <DestructionDetail />, permission: view },
  ],
  create: [
    { label: 'Record series', path: '/retention-schedule?new=1', permission: 'records.create', icon: 'clock' },
    { label: 'Records destruction', path: '/destruction-log?new=1', permission: 'records.create', icon: 'trash' },
  ],
};
export default mod;
