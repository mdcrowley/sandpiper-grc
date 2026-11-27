// User access reviews (E41-02): review campaigns, the register of accounts on each system and the
// reviewer's own list. The Accounts tab on a system's page is InventoryPanel.tsx (inventory extension).
// The record types share the systems permissions; the reviewer's pages need no permission (the server
// answers only the named reviewer and people who may view systems). Feature area `accessreviews`.
import type { ModuleDef } from '../../core';
import { AccountDetail, AccountListPage } from './Accounts';
import { DecidePage, MinePage } from './Decide';
import { ReviewDetail, ReviewList } from './Reviews';
import './accessreviews.css';

const view = 'systems.view';

const mod: ModuleDef = {
  key: 'accessreviews',
  nav: [
    { group: 'Security', label: 'Access reviews', path: '/access-reviews', icon: 'key', permission: view, order: 50 },
    { group: 'Security', label: 'Accounts on systems', path: '/access-reviews/accounts', icon: 'users', permission: view, order: 51, menu: false, parent: '/access-reviews' },
    { group: 'Home', label: 'My access reviews', path: '/access-reviews/mine', icon: 'check-square', permission: view, order: 35, menu: false, parent: '/my-work', tab: 'Access reviews' },
  ],
  routes: [
    { path: '/access-reviews', element: <ReviewList />, permission: view },
    { path: '/access-reviews/mine', element: <MinePage /> },
    { path: '/access-reviews/accounts', element: <AccountListPage />, permission: view },
    { path: '/access-reviews/accounts/:id', element: <AccountDetail />, permission: view },
    { path: '/access-reviews/:id', element: <ReviewDetail />, permission: view },
    { path: '/access-reviews/:id/systems/:systemId', element: <DecidePage /> },
  ],
  create: [
    { label: 'Access review', path: '/access-reviews?new=1', permission: 'systems.create', icon: 'key' },
    { label: 'Account on a system', path: '/access-reviews/accounts?new=1', permission: 'systems.create', icon: 'users' },
  ],
};
export default mod;
