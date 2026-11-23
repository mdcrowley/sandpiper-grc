// AI assistant access (MCP), E21. Administrators: /admin/ai-assistants. Everyone: /account/ai-assistant
// ("Connect an AI assistant"), /oauth/authorize (the consent screen for connectors that sign in). The card is also exported from ConnectCard.tsx for the Account security page.
import type { ModuleDef } from '../../core';
import './mcp.css';
import { AdminAssistantsPage } from './AdminPage';
import { ConnectAssistantPage } from './ConnectPage';
import { ConsentPage } from './ConsentPage';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'mcp',
  nav: [
    { group: 'Administration', label: 'AI assistant access', path: '/admin/ai-assistants', icon: 'link', permission: ADMIN, order: 50 },
  ],
  routes: [
    { path: '/admin/ai-assistants', element: <AdminAssistantsPage />, permission: ADMIN },
    // "My account": open to every signed-in user.
    { path: '/account/ai-assistant', element: <ConnectAssistantPage /> },
    // The OAuth consent screen for remote connectors (E21-16); signing in first if needed.
    { path: '/oauth/authorize', element: <ConsentPage /> },
  ],
};
export default mod;
