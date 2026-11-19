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
    { group: 'Cybersecurity', label: 'Security incidents', path: '/security-incidents', icon: 'alert', permission: view, order: 30 },
    { group: 'Cybersecurity', label: 'Notification deadlines', path: '/security-incidents/notifications', icon: 'clock', permission: view, order: 31 },
    { group: 'Cybersecurity', label: 'Rules and checklists', path: '/security-incidents/rules', icon: 'settings', permission: view, order: 32 },
    { group: 'Cybersecurity', label: 'Offline incident kit', path: '/security-incidents/kit', icon: 'clipboard', permission: view, order: 33 },
  ],
  routes: [
    { path: '/security-incidents', element: <IncidentList />, permission: view },
    { path: '/security-incidents/declare', element: <DeclareIncident />, permission: 'security.create' },
    { path: '/security-incidents/rules', element: <RulesPage />, permission: view },
    { path: '/security-incidents/kit', element: <KitPage />, permission: view },
    { path: '/security-incidents/notifications', element: <NotificationsPage />, permission: view },
    { path: '/security-incidents/notifications/:id', element: <NotificationTaskRedirect />, permission: view },
    { path: '/security-incidents/:id/report', element: <ReportPage />, permission: view },
    { path: '/security-incidents/:id', element: <Workspace />, permission: view },
  ],
  create: [{ label: 'Security incident', path: '/security-incidents/declare', permission: 'security.create', icon: 'alert' }],
};

export default mod;
