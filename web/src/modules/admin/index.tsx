import type { ModuleDef } from '../../core';
import './admin.css';
import { AccountSecurityPage } from './AccountSecurity';
import { AdminHubPage } from './AdminHub';
import { AdminTokensPage } from './ApiTokens';
import { AboutPage } from './About';
import { AuditLogPage } from './AuditLog';
import { CustomFieldsPage } from './CustomFields';
import { DataLoadsPage } from './DataLoad';
import { FeaturesPage } from './Features';
import { ListsPage } from './Lists';
import { OrganizationPage } from './Organization';
import { ProvidersPage } from './Providers';
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
    // The Administration page (/admin): one menu entry, shown to whoever may open one of its cards (E44-03).
    { group: 'Administration', label: 'Administration', path: '/admin', icon: 'settings', order: 10, hubHome: true },
    { group: 'Administration', label: 'Users', path: '/admin/users', icon: 'users', permission: ADMIN, order: 20, menu: false, hub: 'People and access', hint: 'Accounts, their roles, second factors and sign-in.' },
    { group: 'Administration', label: 'Roles', path: '/admin/roles', icon: 'shield', permission: ADMIN, order: 21, menu: false, hub: 'People and access', hint: 'What each role may see and do.' },
    { group: 'Administration', label: 'Sign-in providers', path: '/admin/sign-in-providers', icon: 'lock', permission: ADMIN, order: 22, menu: false, hub: 'People and access', hint: 'Single sign-on through an identity provider or a directory.' },
    { group: 'Administration', label: 'Organization', path: '/admin/organization', icon: 'building', permission: ADMIN, order: 30, menu: false, hub: 'Organization', hint: 'Name, logo, colors, time zone and contacts.' },
    { group: 'Administration', label: 'Features', path: '/admin/features', icon: 'check-square', permission: ADMIN, order: 31, menu: false, hub: 'Organization', hint: 'Switch optional parts of the application on and off.' },
    { group: 'Administration', label: 'Settings', path: '/admin/settings', icon: 'settings', permission: ADMIN, order: 32, menu: false, hub: 'Organization', hint: 'Identity, passwords, second factor, sessions and actions.' },
    { group: 'Administration', label: 'Lists', path: '/admin/lists', icon: 'clipboard', permission: ADMIN, order: 40, menu: false, hub: 'Records setup', hint: 'The values of drop-down lists: statuses, categories, priorities.' },
    { group: 'Administration', label: 'Custom fields', path: '/admin/custom-fields', icon: 'edit', permission: ADMIN, order: 41, menu: false, hub: 'Records setup', hint: 'Fields of your own on any kind of record.' },
    { group: 'Administration', label: 'API tokens', path: '/admin/tokens', icon: 'key', permission: ADMIN, order: 50, menu: false, hub: 'Connections', hint: 'Keys for scripts and other systems that call the API.' },
    { group: 'Administration', label: 'Webhooks', path: '/admin/webhooks', icon: 'link', permission: ADMIN, order: 51, menu: false, hub: 'Connections', hint: 'Tell other systems when records change.' },
    { group: 'Administration', label: 'Retention', path: '/admin/retention', icon: 'clock', permission: ADMIN, order: 60, menu: false, hub: 'Data and operations', hint: 'How long closed records, logs and files are kept.' },
    { group: 'Administration', label: 'Data loads', path: '/admin/data-loads', icon: 'upload', permission: ADMIN, order: 61, menu: false, hub: 'Data and operations', hint: 'Load historical records, with data load mode.' },
    { group: 'Administration', label: 'Audit log', path: '/admin/audit', icon: 'history', permission: 'audit.view', order: 62, menu: false, hub: 'Data and operations', hint: 'Every change and sign-in, searchable and exportable.' },
    { group: 'Administration', label: 'About', path: '/admin/about', icon: 'info', permission: ADMIN, order: 99, menu: false, hub: 'Data and operations', hint: 'Version, commit and the open-source licenses.' },
  ],
  routes: [
    // The Administration page: its cards follow each page's own permission, so it needs none itself.
    { path: '/admin', element: <AdminHubPage /> },
    { path: '/admin/users', element: <UsersPage />, permission: ADMIN },
    { path: '/admin/users/:id', element: <UserDetailPage />, permission: ADMIN },
    { path: '/admin/roles', element: <RolesPage />, permission: ADMIN },
    { path: '/admin/roles/:id', element: <RoleDetailPage />, permission: ADMIN },
    { path: '/admin/sign-in-providers', element: <ProvidersPage />, permission: ADMIN },
    { path: '/admin/lists', element: <ListsPage />, permission: ADMIN },
    { path: '/admin/organization', element: <OrganizationPage />, permission: ADMIN },
    { path: '/admin/settings', element: <SettingsPage />, permission: ADMIN },
    { path: '/admin/features', element: <FeaturesPage />, permission: ADMIN },
    { path: '/admin/custom-fields', element: <CustomFieldsPage />, permission: ADMIN },
    { path: '/admin/retention', element: <RetentionPage />, permission: ADMIN },
    { path: '/admin/data-loads', element: <DataLoadsPage />, permission: ADMIN },
    { path: '/admin/tokens', element: <AdminTokensPage />, permission: ADMIN },
    { path: '/admin/webhooks', element: <WebhooksPage />, permission: ADMIN },
    { path: '/admin/audit', element: <AuditLogPage />, permission: 'audit.view' },
    { path: '/admin/about', element: <AboutPage />, permission: ADMIN },
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
