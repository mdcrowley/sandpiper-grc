// The accounts a system holds (E41-02): an "Accounts" tab on a system's page, with the import of the
// system's own account file. Left out while the access review area is switched off.
import { useAuth } from '../../core';
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';
import { AccountsList } from './Accounts';

function AccountsPanel({ recordId }: InventoryPanelProps) {
  const { can } = useAuth();
  if (!can('systems.view')) return null;
  return <AccountsList systemId={recordId} />;
}

export const panels: InventoryPanelDef[] = [
  { key: 'accounts', label: 'Accounts', area: 'accessreviews', appliesTo: ['system'], Panel: AccountsPanel },
];
