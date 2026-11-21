import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge, Button, EmptyState, ErrorState, formatDateTime, Icon, Loading, LookupChip, PageHeader, ResourceList, Stat, Tabs, useAuth, useFetch,
} from '../../core';
import { AlertResponders } from './AlertResponders';
import { NotRequiredDialog, RecordNotificationDialog, useTaskBlocked } from './Clocks';
import { metText, PilotNotice, remainingText, sortClocks, STATE_COLOR, STATE_ICON, stateAt, useNow } from './shared';
import type { AllClocks, Clock } from './types';
import { deadlineText } from './types';

const SHOW = [
  { value: 'pending', label: 'To make' },
  { value: 'done', label: 'Recorded' },
  { value: 'not_required', label: 'Not required' },
  { value: 'all', label: 'All' },
];

function Deadlines() {
  const { can } = useAuth();
  const canEdit = can('security.edit');
  const [show, setShow] = useState('pending');
  const { data, error, reload } = useFetch<AllClocks>(`/api/security-incidents/clocks?status=${show}`, { keepPrevious: true });
  const [recording, setRecording] = useState<Clock | null>(null);
  const [skipping, setSkipping] = useState<Clock | null>(null);
  const now = useNow(20_000);
  const blockedFor = useTaskBlocked();
  const s = data?.summary;
  const clocks = data ? sortClocks(data.clocks, now) : [];
  const anyDone = clocks.some((c) => c.status === 'done');

  return (
    <div className="stack">
      <section aria-label="Summary" className="grid-stats si-stats">
        <Stat label="Overdue" value={s ? s.red : '–'} icon="alert-circle" color={s?.red ? 'red' : 'gray'} hint="Past the deadline, not yet recorded" />
        <Stat label="Due soon" value={s ? s.amber : '–'} icon="clock" color={s?.amber ? 'amber' : 'gray'} hint="In the last part of the time allowed" />
        <Stat label="On track" value={s ? s.green : '–'} icon="clock" color={s?.green ? 'green' : 'gray'} hint="Still to make, with time in hand" />
        <Stat label="Recorded" value={s ? s.done : '–'} icon="check-circle" color="gray" hint={s ? `${s.not_required} marked not required` : undefined} />
      </section>

      <div className="si-filter" role="radiogroup" aria-label="Show">
        {SHOW.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={show === o.value} className="si-filter-item" onClick={() => setShow(o.value)}>{o.label}</button>
        ))}
      </div>

      {error ? <ErrorState title="The notifications could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={5} label="Loading notifications" />
        : !clocks.length ? (
          <EmptyState icon="check-circle"
            title={show === 'pending' ? 'No notifications to make' : 'Nothing to show'}
            message={show === 'pending' ? 'Every notification on a declared incident has been recorded or stood down.' : 'No notification matches this choice.'} />
        ) : (
          <div className="table-wrap">
            <table className="table si-table si-deadlines">
              <thead>
                <tr>
                  <th scope="col">Deadline</th><th scope="col">Notify</th><th scope="col">Incident</th>
                  {anyDone && <th scope="col">Record</th>}{canEdit && <th scope="col" className="si-table-actions"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {clocks.map((c) => {
                  const state = stateAt(c, now);
                  const blocked = blockedFor(c);
                  return (
                    <tr key={c.task_id}>
                      <td>
                        <span className={`chip chip-${STATE_COLOR[state]} si-state`}>
                          <Icon name={STATE_ICON[state]} size={14} />
                          {c.status === 'pending' ? remainingText(c.due_at, now) : c.status === 'done' ? metText(c) : 'Not required'}
                        </span>
                        <div className="si-due">{formatDateTime(c.due_at)}</div>
                        <div className="si-cell-sub">{deadlineText(c.deadline_hours)}{Number(c.deadline_hours) === 0 ? '' : ' from discovery'}</div>
                      </td>
                      <td>
                        <strong>{c.party}</strong>
                        <div><Badge color={c.required ? 'blue' : 'gray'}>{c.required ? 'Required' : 'Recommended'}</Badge></div>
                      </td>
                      <td>
                        {c.incident && (
                          <>
                            <Link className="ref" to={`/security-incidents/${c.incident.id}`}>{c.incident.ref}</Link>
                            <div className="si-cell-sub">{c.incident.title}</div>
                            <LookupChip list="security_incident_status" value={c.incident.status} />
                          </>
                        )}
                      </td>
                      {anyDone && (
                      <td>
                        {c.status === 'done' ? (
                          <>
                            {c.notified_who}, by {c.notified_how}
                            <div className="si-cell-sub">
                              {formatDateTime(c.notified_at)}{c.reference_received ? ` · reference ${c.reference_received}` : ''}
                              {c.completed_by_name ? ` · recorded by ${c.completed_by_name}` : ''}
                            </div>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                      )}
                      {canEdit && (
                        <td className="si-table-actions">
                          <div className="si-row-actions si-row-actions-stack">
                            {c.status === 'pending' && <Button size="sm" variant="primary" onClick={() => setRecording(c)} disabled={Boolean(blocked('done'))} title={blocked('done') || undefined}>Record notification</Button>}
                            {c.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => setSkipping(c)} disabled={Boolean(blocked('not_required'))} title={blocked('not_required') || undefined}>Not required</Button>}
                            {c.status === 'done' && <Button size="sm" variant="ghost" onClick={() => setRecording(c)}>Correct record</Button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <RecordNotificationDialog clock={recording} onClose={() => setRecording(null)} onSaved={reload} />
      <NotRequiredDialog clock={skipping} onClose={() => setSkipping(null)} onSaved={reload} />
    </div>
  );
}

/** Every notification across incidents: the deadlines in order of urgency, and the full register with filters and export. */
export function NotificationsPage() {
  const navigate = useNavigate();
  return (
    <div className="stack">
      <PageHeader title="Notification deadlines"
        subtitle="Who must be told about each declared incident, and by when. Most urgent first"
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: 'Notification deadlines' }]}
        actions={<Link className="btn btn-secondary" to="/security-incidents/rules">Notification rules</Link>} />
      <PilotNotice />
      <Tabs label="Notification deadlines" tabs={[
        { key: 'deadlines', label: 'Deadlines', content: <Deadlines /> },
        {
          key: 'register', label: 'Register',
          content: (
            <ResourceList type="notification_task" urlState={false}
              columns={['ref', 'party', 'incident_id', 'status', 'required', 'due_at', 'notified_at', 'notified_who', { field: 'notified_how', hidden: true }, { field: 'reference_received', hidden: true }, { field: 'completed_by', hidden: true }]}
              filters={['status', 'required', 'incident_id', 'due_at', 'notified_at']}
              bulkFields={[]}
              onRowClick={(row) => navigate(`/security-incidents/${row.incident_id}`)} />
          ),
        },
        { key: 'alerts', label: 'Alerts by email and text', content: <AlertResponders /> },
      ]} />
    </div>
  );
}
