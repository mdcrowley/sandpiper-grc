import type { ModuleDef } from '../../core';
import './admin.css';
import { AccountSecurityPage } from './AccountSecurity';
import { AdminTokensPage } from './ApiTokens';
import { AuditLogPage } from './AuditLog';
import { CustomFieldsPage } from './CustomFields';
import { ListsPage } from './Lists';
import { RecoverySignInPage, RedeemPage } from './Redeem';
import { RetentionPage } from './Retention';
import { RoleDetailPage } from './RoleDetail';
import { RolesPage } from './Roles';
import { SettingsPage } from './Settings';
import { UserDetailPage } from './UserDetail';
import { UsersPage } from './Users';
import { WebhooksPage } from './Webhooks';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'admin',
  nav: [
    { group: 'Administration', label: 'Users', path: '/admin/users', icon: 'users', permission: ADMIN, order: 10 },
    { group: 'Administration', label: 'Roles', path: '/admin/roles', icon: 'shield', permission: ADMIN, order: 20 },
    { group: 'Administration', label: 'Lists', path: '/admin/lists', icon: 'clipboard', permission: ADMIN, order: 30 },
    { group: 'Administration', label: 'Settings', path: '/admin/settings', icon: 'settings', permission: ADMIN, order: 40 },
    { group: 'Administration', label: 'Custom fields', path: '/admin/custom-fields', icon: 'edit', permission: ADMIN, order: 42 },
    { group: 'Administration', label: 'Retention', path: '/admin/retention', icon: 'clock', permission: ADMIN, order: 44 },
    { group: 'Administration', label: 'API tokens', path: '/admin/tokens', icon: 'key', permission: ADMIN, order: 46 },
    { group: 'Administration', label: 'Webhooks', path: '/admin/webhooks', icon: 'link', permission: ADMIN, order: 48 },
    { group: 'Administration', label: 'Audit log', path: '/admin/audit', icon: 'history', permission: 'audit.view', order: 50 },
  ],
  routes: [
    { path: '/admin/users', element: <UsersPage />, permission: ADMIN },
    { path: '/admin/users/:id', element: <UserDetailPage />, permission: ADMIN },
    { path: '/admin/roles', element: <RolesPage />, permission: ADMIN },
    { path: '/admin/roles/:id', element: <RoleDetailPage />, permission: ADMIN },
    { path: '/admin/lists', element: <ListsPage />, permission: ADMIN },
    { path: '/admin/settings', element: <SettingsPage />, permission: ADMIN },
    { path: '/admin/custom-fields', element: <CustomFieldsPage />, permission: ADMIN },
    { path: '/admin/retention', element: <RetentionPage />, permission: ADMIN },
    { path: '/admin/tokens', element: <AdminTokensPage />, permission: ADMIN },
    { path: '/admin/webhooks', element: <WebhooksPage />, permission: ADMIN },
    { path: '/admin/audit', element: <AuditLogPage />, permission: 'audit.view' },
    // "My account": open to every signed-in user.
    { path: '/account/security', element: <AccountSecurityPage /> },
  ],
  create: [{ label: 'User', path: '/admin/users?new=1', permission: ADMIN, icon: 'user' }],
  publicRoutes: [
    { path: '/redeem', element: <RedeemPage /> },
    { path: '/sign-in/recovery', element: <RecoverySignInPage /> },
  ],
};
export default mod;
