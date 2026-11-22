// Integrations (wave 11, E36-01 and E36-02): Administration > User provisioning (SCIM tokens, the
// switch, group-to-role mapping, recent activity) and Administration > Log forwarding (audit-log
// forwarders, a test event, each one's delivery log). Not a feature area: each connection is off until
// an administrator sets it up. The webhook screen (E22-45, E36-04) stays in the admin module.
import type { ModuleDef } from '../../core';
import { LogForwardingPage } from './LogForwarding';
import { ProvisioningPage } from './Provisioning';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'integrations',
  nav: [
    { group: 'Administration', label: 'User provisioning', path: '/admin/provisioning', icon: 'users', permission: ADMIN, order: 26 },
    { group: 'Administration', label: 'Log forwarding', path: '/admin/log-forwarding', icon: 'upload', permission: ADMIN, order: 49 },
  ],
  routes: [
    { path: '/admin/provisioning', element: <ProvisioningPage />, permission: ADMIN },
    { path: '/admin/log-forwarding', element: <LogForwardingPage />, permission: ADMIN },
  ],
};
export default mod;
