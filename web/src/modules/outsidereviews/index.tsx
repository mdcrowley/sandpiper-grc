// Outside reviewers (E41-09): the administrators' list of invitations. The staff tab on audits and
// funder reviews (ReviewersPanel.tsx) and the reviewer's own layout (ReviewerApp.tsx) are loaded by
// the audits and funding pages and by App.tsx.
import type { ModuleDef } from '../../core';
import { AdminReviewers } from './AdminReviewers';

const mod: ModuleDef = {
  key: 'outsidereviews',
  nav: [
    { group: 'Administration', label: 'Outside reviewers', path: '/admin/outside-reviewers', icon: 'users', permission: 'admin.administer', order: 24, menu: false, hub: 'People and access', hint: 'Auditors and assessors from outside, with access that ends.' },
  ],
  routes: [
    { path: '/admin/outside-reviewers', element: <AdminReviewers />, permission: 'admin.administer' },
  ],
};
export default mod;
