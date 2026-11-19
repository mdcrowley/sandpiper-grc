import { Link } from 'react-router-dom';
import { PageHeader, ResourceList, Stat, useAuth, useFetch } from '../../core';
import { PilotNotice } from './shared';
import type { AllClocks } from './types';

/** Restricted list of security incidents under a strip saying where things stand. New incidents go through the Declare flow. */
export function IncidentList() {
  const { can } = useAuth();
  const { data } = useFetch<AllClocks>('/api/security-incidents/clocks');
  const s = data?.summary;
  return (
    <div className="stack">
      <PageHeader title="Security incidents"
        subtitle="Restricted: only people with access to security incidents can see this page"
        actions={(
          <>
            <Link className="btn btn-secondary" to="/security-incidents/kit">Offline incident kit</Link>
            {can('security.create') && <Link className="btn btn-primary" to="/security-incidents/declare">Declare incident</Link>}
          </>
        )} />
      <PilotNotice />
      <section aria-label="Where things stand" className="grid-stats si-stats">
        <Stat label="Open incidents" value={s ? s.open_incidents : '–'} icon="alert" color={s?.open_incidents ? 'blue' : 'gray'} hint="Not yet closed" />
        <Stat label="Notifications overdue" value={s ? s.red : '–'} icon="alert-circle" color={s?.red ? 'red' : 'gray'} to="/security-incidents/notifications"
          hint={s?.red ? 'Past their deadline' : 'None past their deadline'} />
        <Stat label="Notifications due soon" value={s ? s.amber : '–'} icon="clock" color={s?.amber ? 'amber' : 'gray'} to="/security-incidents/notifications"
          hint={s ? `${s.green} more on track` : undefined} />
        <Stat label="Reviews to complete" value={s ? s.reviews_due : '–'} icon="check-square" color={s?.reviews_due ? 'purple' : 'gray'}
          hint="Closed incidents without a finished review" />
      </section>
      <ResourceList
        type="security_incident"
        urlState
        columns={[
          'ref', 'title', 'severity', 'status', 'scenario', 'lead_id', 'discovered_at',
          { field: 'declared_at', hidden: true }, { field: 'closed_at', hidden: true }, { field: 'review_status', hidden: true }, { field: 'review_due_on', hidden: true },
        ]}
        filters={['status', 'severity', 'scenario', 'lead_id', 'is_cyber_incident', 'personal_info_involved', 'discovered_at', 'review_status']}
        bulkFields={['lead_id', 'severity']}
      />
    </div>
  );
}
