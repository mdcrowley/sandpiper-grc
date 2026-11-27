// Evidence library (E45-06): evidence filed once and linked to many records (controls, obligations, audit
// requests, funder review areas and document requests, corrective actions), with expiry reminders.
// Other pages show what a record uses through EvidencePanel.tsx (loaded with import.meta.glob).
// Vendor evidence (Vendors > Evidence) is the vendors module's own and stays there.
import type { ModuleDef } from '../../core';
import { EvidenceDetail, EvidenceLibrary, ExpiringEvidence } from './Library';

const view = 'evidence.view';

const mod: ModuleDef = {
  key: 'evidence',
  nav: [
    { group: 'Risk and compliance', label: 'Evidence library', path: '/evidence-library', icon: 'paperclip', permission: view, order: 25, tabs: 'Library' },
    { group: 'Risk and compliance', label: 'Evidence to renew', path: '/evidence-library/expiring', icon: 'clock', permission: view, order: 26, menu: false, parent: '/evidence-library', tab: 'Expiring' },
  ],
  routes: [
    { path: '/evidence-library', element: <EvidenceLibrary />, permission: view },
    { path: '/evidence-library/expiring', element: <ExpiringEvidence />, permission: view },
    { path: '/evidence-library/:id', element: <EvidenceDetail />, permission: view },
  ],
  create: [{ label: 'Evidence record', path: '/evidence-library?new=1', permission: 'evidence.create', icon: 'paperclip' }],
};
export default mod;
