import { Link } from 'react-router-dom';
import { ResourceList, useAuth } from '../../core';
import { PilotNotice } from './Workspace';

/** Restricted list of security incidents. New incidents go through the Declare flow. */
export function IncidentList() {
  const { can } = useAuth();
  return (
    <div className="stack">
      <PilotNotice />
      <ResourceList
        type="security_incident"
        title="Security incidents"
        columns={['ref', 'title', 'severity', 'status', 'scenario', 'lead_id', 'discovered_at', 'declared_at']}
        filters={['status', 'severity', 'scenario', 'lead_id', 'health_data_involved', 'card_data_involved', 'personal_info_involved', 'discovered_at']}
        actions={(
          <>
            <Link className="btn btn-secondary" to="/security-incidents/kit">Offline incident kit</Link>
            {can('security.create') && <Link className="btn btn-primary" to="/security-incidents/declare">Declare incident</Link>}
          </>
        )}
      />
    </div>
  );
}
