// Approval workflows (E14-06): the Approvals page for everyone, the administrators' workflow
// screens, and (in its own file, found by RecordPage) the approval panel on record pages.
import type { ModuleDef } from '../../core';
import { ApprovalsPage } from './ApprovalsPage';
import { WorkflowEditor } from './WorkflowEditor';
import { WorkflowsAdmin } from './WorkflowsAdmin';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'workflows',
  nav: [
    { group: 'Home', label: 'Approvals', path: '/approvals', icon: 'check-square', order: 32, menu: false, parent: '/my-work', tab: 'Approvals' },
    { group: 'Administration', label: 'Approval workflows', path: '/admin/workflows', icon: 'check-square', permission: ADMIN, order: 46, menu: false, hub: 'Records setup', hint: 'Who approves what, in which steps, and how fast.' },
  ],
  routes: [
    { path: '/approvals', element: <ApprovalsPage /> },
    { path: '/admin/workflows', element: <WorkflowsAdmin />, permission: ADMIN },
    { path: '/admin/workflows/new', element: <WorkflowEditor />, permission: ADMIN },
    { path: '/admin/workflows/:id', element: <WorkflowEditor />, permission: ADMIN },
  ],
};
export default mod;
