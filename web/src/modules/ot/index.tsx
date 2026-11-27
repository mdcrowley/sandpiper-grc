// OT and rail-systems security (E33): the overview, security zones and the conduits between them.
// The OT fields on systems and assets are shown by InventoryPanel.tsx (inventory extension, wave 11
// contract C2), and the starter structure file is offered on Frameworks and structure (StarterLink.tsx).
import type { ModuleDef } from '../../core';
import { ConduitDetail, ConduitList } from './Conduits';
import { OtOverview } from './Overview';
import { ZoneDetail, ZoneList } from './Zones';
import './ot.css';

const view = 'systems.view';

const mod: ModuleDef = {
  key: 'ot',
  nav: [
    { group: 'Security', label: 'OT security', path: '/ot', icon: 'server', permission: view, order: 40 },
    { group: 'Security', label: 'Security zones', path: '/ot/zones', icon: 'lock', permission: view, order: 41, menu: false, parent: '/ot' },
  ],
  routes: [
    { path: '/ot', element: <OtOverview />, permission: view },
    { path: '/ot/zones', element: <ZoneList />, permission: view },
    { path: '/ot/zones/:id', element: <ZoneDetail />, permission: view },
    { path: '/ot/conduits', element: <ConduitList />, permission: view },
    { path: '/ot/conduits/:id', element: <ConduitDetail />, permission: view },
  ],
  create: [
    { label: 'Security zone', path: '/ot/zones?new=1', permission: 'systems.create', icon: 'lock' },
    { label: 'Conduit', path: '/ot/conduits?new=1', permission: 'systems.create', icon: 'link' },
  ],
};
export default mod;
