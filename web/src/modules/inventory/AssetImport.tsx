// Asset import (E13-21): the generic import wizard (core/ImportWizard) on the asset list. The older
// address /assets/import, kept for bookmarks and the help pages, opens the list with the wizard.
import { Navigate } from 'react-router-dom';

export function AssetImportPage() {
  return <Navigate to="/assets?import=1" replace />;
}
