// AI assistant access (MCP), E21. Administrators: /admin/ai-assistants. Everyone: /account/ai-assistant
// ("Connect an AI assistant"). The card is also exported from ConnectCard.tsx for the Account security page.
import type { ModuleDef } from '../../core';
import './mcp.css';
import { AdminAssistantsPage } from './AdminPage';
import { ConnectAssistantPage } from './ConnectPage';

const ADMIN = 'admin.administer';

const mod: ModuleDef = {
  key: 'mcp',
  nav: [
    { group: 'Administration', label: 'AI assistant access', path: '/admin/ai-assistants', icon: 'link', permission: ADMIN, order: 47 },
  ],
  routes: [
    { path: '/admin/ai-assistants', element: <AdminAssistantsPage />, permission: ADMIN },
    // "My account": open to every signed-in user.
    { path: '/account/ai-assistant', element: <ConnectAssistantPage /> },
  ],
};
export default mod;
