// A dashboard shown inside another page (the Overview, E12-07): its widgets read-only, with no
// filters; figures are the same for everyone, lists show what the viewer may see. Loaded on demand by the home
// module, so the Overview stays light for people without dashboards.
import { EmptyState, ErrorState, Loading, useFetch } from '../../core';
import type { ApiError } from '../../core';
import { DashboardGrid } from './DashboardGrid';
import './reports.css';
import './reports-dash.css';
import type { Dashboard } from './types';
import { WidgetBody } from './Widget';

export default function EmbeddedDashboard({ id, tick = 0 }: { id: string; tick?: number }) {
  const dash = useFetch<Dashboard>(`/api/dashboards/${id}`);
  const status = (dash.error as ApiError | undefined)?.status;
  if (status === 404 || status === 403) {
    return <EmptyState icon="lock" title="This dashboard is no longer available" message="It was removed or is no longer shared with you. Choose another under Reports > Dashboards." />;
  }
  if (dash.error) return <ErrorState title="The dashboard could not be loaded" error={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <Loading lines={6} label="Loading the dashboard" />;
  const d = dash.data;
  if (!d.widgets.length) return <EmptyState icon="chart" title="This dashboard is empty" message="Nothing has been added to it yet." />;
  return (
    <div className="rp-dash rp-embedded">
      <DashboardGrid widgets={d.widgets} editing={false} onChange={() => undefined}
        renderBody={(w, height) => <WidgetBody widget={w} dashboardId={d.id} globals={{}} tick={tick} height={height} />} />
    </div>
  );
}
