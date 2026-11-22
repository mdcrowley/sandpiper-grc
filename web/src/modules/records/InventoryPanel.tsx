// Privacy on inventory pages (contract C2): a "Privacy" tab on a system with its privacy impact
// assessments, and a "Personal data" section on a data category with its personal-data flag and kinds.
// Left out while the records area is switched off.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EditableSummary, ResourceList, useAuth } from '../../core';
import type { Row } from '../../core';
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';
import './records.css';

function SystemPrivacy({ recordId }: InventoryPanelProps) {
  const { can } = useAuth();
  if (!can('privacy.view')) return null;
  return (
    <Card title="Privacy impact assessments" flush>
      <ResourceList type="privacy_assessment" baseFilter={{ system_id: recordId }} createInitial={{ system_id: recordId }}
        columns={['ref', 'title', 'status', 'residual_risk', 'next_review_on']} filters={['status']}
        createFields={['title', 'owner_id', 'review_months']} bulkFields={[]} urlState={false} extras={false} />
      <p className="muted rr-pad">See <Link to="/privacy">Privacy</Link> for every system holding personal data.</p>
    </Card>
  );
}

function CategoryPrivacy({ row }: InventoryPanelProps) {
  const { can } = useAuth();
  // The host page's row is not reloaded by this card, so the saved row is kept here.
  const [saved, setSaved] = useState<Row | null>(null);
  if (!can('data.view')) return null;
  return (
    <EditableSummary type="data_category" row={saved ?? (row as Row)} title="Personal data" fields={['personal_data', 'personal_data_kinds']}
      onSaved={setSaved} />
  );
}

export const panels: InventoryPanelDef[] = [
  { key: 'privacy', label: 'Privacy', area: 'records', appliesTo: ['system'], Panel: SystemPrivacy },
  { key: 'personal-data', label: 'Personal data', area: 'records', appliesTo: ['data_category'], Panel: CategoryPrivacy },
];
