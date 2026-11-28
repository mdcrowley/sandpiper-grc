import { Navigate, useParams } from 'react-router-dom';
import { ErrorState, Loading, useFetch } from '../../core';
import type { ModuleDef, Row } from '../../core';
import { DeclareIncident } from './DeclareIncident';
import { IncidentList } from './IncidentList';
import { KitPage } from './KitPage';
import { NotificationsPage } from './NotificationsPage';
import { ReportPage } from './ReportPage';
import { RulesPage } from './RulesPage';
import { Workspace } from './Workspace';
import './secincidents.css';

/** A notification task has no page of its own: search results and links land on its incident. */
function NotificationTaskRedirect() {
  const { id } = useParams();
  const { data, error, reload } = useFetch<Row>(id ? `/api/notification-tasks/${id}` : null);
  if (error) return <ErrorState title="This notification could not be opened" error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return <Navigate to={`/security-incidents/${data.incident_id}`} replace />;
}

const view = 'security.view';

const mod: ModuleDef = {
  key: 'secincidents',
  nav: [
    { group: 'Security', label: 'Security incidents', path: '/security-incidents', icon: 'alert', permission: view, order: 20, tabs: 'Incidents' },
    { group: 'Security', label: 'Notification deadlines', path: '/security-incidents/notifications', icon: 'clock', permission: view, order: 21, menu: false, parent: '/security-incidents', tab: 'Notification deadlines' },
    { group: 'Security', label: 'Rules and checklists', path: '/security-incidents/rules', icon: 'settings', permission: view, order: 22, menu: false, parent: '/security-incidents', tab: 'Rules and checklists' },
    { group: 'Security', label: 'Offline incident kit', path: '/security-incidents/kit', icon: 'clipboard', permission: view, order: 23, menu: false, parent: '/security-incidents' },
    // E44-10: the rules as an Administration card, for the people who may change them (security.administer), so
    // the Administration page is not offered to everyone who may only read security incidents.
    { group: 'Security', label: 'Security incident rules', path: '/security-incidents/settings', icon: 'settings', permission: 'security.administer', order: 24, menu: false, parent: '/security-incidents', hub: 'Area settings', hint: 'Notification rules, kinds of data, scenario checklists and the incident team.' },
  ],
  routes: [
    { path: '/security-incidents', element: <IncidentList />, permission: view },
    { path: '/security-incidents/declare', element: <DeclareIncident />, permission: 'security.create' },
    { path: '/security-incidents/rules', element: <RulesPage />, permission: view },
    { path: '/security-incidents/settings', element: <RulesPage />, permission: 'security.administer' },
    { path: '/security-incidents/kit', element: <KitPage />, permission: view },
    { path: '/security-incidents/notifications', element: <NotificationsPage />, permission: view },
    { path: '/security-incidents/notifications/:id', element: <NotificationTaskRedirect />, permission: view },
    { path: '/security-incidents/:id/report', element: <ReportPage />, permission: view },
    { path: '/security-incidents/:id', element: <Workspace />, permission: view },
  ],
  create: [{ label: 'Security incident', path: '/security-incidents/declare', permission: 'security.create', icon: 'alert' }],
};

export default mod;
