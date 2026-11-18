import type { ModuleDef } from '../../core';
import './admin.css';
import { AccountSecurityPage } from './AccountSecurity';
import { AuditLogPage } from './AuditLog';
import { ListsPage } from './Lists';
import { RecoverySignInPage, RedeemPage } from './Redeem';
import { RoleDetailPage } from './RoleDetail';
import { RolesPage } from './Roles';
import { SettingsPage } from './Settings';
import { UserDetailPage } from './UserDetail';
import { UsersPage } from './Users';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'admin',
  nav: [
    { group: 'Administration', label: 'Users', path: '/admin/users', icon: 'users', permission: ADMIN, order: 10 },
    { group: 'Administration', label: 'Roles', path: '/admin/roles', icon: 'shield', permission: ADMIN, order: 20 },
    { group: 'Administration', label: 'Lists', path: '/admin/lists', icon: 'clipboard', permission: ADMIN, order: 30 },
    { group: 'Administration', label: 'Settings', path: '/admin/settings', icon: 'settings', permission: ADMIN, order: 40 },
    { group: 'Administration', label: 'Audit log', path: '/admin/audit', icon: 'history', permission: 'audit.view', order: 50 },
  ],
  routes: [
    { path: '/admin/users', element: <UsersPage />, permission: ADMIN },
    { path: '/admin/users/:id', element: <UserDetailPage />, permission: ADMIN },
    { path: '/admin/roles', element: <RolesPage />, permission: ADMIN },
    { path: '/admin/roles/:id', element: <RoleDetailPage />, permission: ADMIN },
    { path: '/admin/lists', element: <ListsPage />, permission: ADMIN },
    { path: '/admin/settings', element: <SettingsPage />, permission: ADMIN },
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
