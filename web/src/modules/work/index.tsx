// The compliance calendar (E41-03): everything due across every area that is on, from the server's
// calendar source registry (GET /api/work/calendar, GET /api/work/mine). No permission of its own:
// everyone signed in gets it, and sees only what they may see. My work on the Overview lists the same
// due work (home/widgetsMyWork.tsx).
import type { ModuleDef } from '../../core';
import { CompliancePage } from './CompliancePage';
import './work.css';

const mod: ModuleDef = {
  key: 'work',
  nav: [
    { group: 'Home', label: 'Calendar', path: '/calendar', icon: 'calendar', order: 20 },
  ],
  routes: [{ path: '/calendar', element: <CompliancePage /> }],
};
export default mod;
