// Safety events: the list, and one event with its investigation, corrective actions and hazards.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EditableSummary, EmptyState, errorMessage, ErrorState, Loading, Modal, PageHeader, RecordPage, RecordPicker,
  ResourceList, Stepper, useAuth, useFetch, useLookup, useResource, useToast,
} from '../../core';
import { canMoveTo, editableLifecycle } from '../../core/lifecycleMenus';
import type { RecordContext } from '../../core';
import { InvestigationTab, PeopleTab, ReportingTab } from './EventTabs';
import { RatingChip, SafetyActions, SafetyCaps, SafetyTabs, useHazardScale } from './shared';

const CREATE = ['title', 'occurred_at', 'event_type', 'severity', 'site_id', 'vehicle_id', 'service_id', 'location_detail', 'description', 'immediate_actions', 'injuries', 'fatalities', 'people_transported', 'damage_estimate', 'evacuation', 'reported_by_id', 'restricted'];

export function EventList() {
  return (
    <div className="stack">
      <PageHeader title="Safety events" subtitle="Collisions, injuries, near misses, assaults and unsafe conditions, and how each was investigated." />
      <SafetyTabs active="events" />
      <ResourceList
        type="safety_event"
        urlState
        columns={['ref', 'title', 'occurred_at', 'event_type', 'severity', 'status', 'vehicle_id', 'service_id', { field: 'reportable', hidden: true }, { field: 'site_id', hidden: true }, { field: 'investigator_id', hidden: true }, { field: 'restricted', hidden: true }]}
        filters={['event_type', 'severity', 'status', 'occurred_at', 'vehicle_id', 'service_id', 'site_id', 'investigator_id', 'reportable', 'restricted']}
        createFields={CREATE}
        // Most events are reported soon after they happen: start from now, to be corrected if not.
        createInitial={{ occurred_at: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString() }}
      />
    </div>
  );
}

const STEPS = [
  { key: 'reported', label: 'Reported' },
  { key: 'investigating', label: 'Under investigation' },
  { key: 'actions_open', label: 'Corrective actions' },
  { key: 'closed', label: 'Closed' },
];

function Actions({ row, save, canEdit }: RecordContext) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // A button whose move the lifecycle does not allow is left out (E14-31); Edit offers the allowed statuses.
  const lifecycle = editableLifecycle(useResource('safety_event')?.lifecycle, 'status');
  const values = useLookup('safety_event_status').map((v) => v.value);
  const may = (to: string) => canMoveTo(lifecycle, row.status, to, values);
  if (!canEdit) return null;
  const move = async (status: string, done: string) => {
    setBusy(true);
    try { await save({ status }); toast.success(done); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <>
      {row.status === 'reported' && may('investigating') && <Button loading={busy} onClick={() => move('investigating', 'Investigation started.')}>Start investigation</Button>}
      {row.status === 'investigating' && may('actions_open') && <Button loading={busy} onClick={() => move('actions_open', 'Waiting on corrective actions.')}>Corrective actions raised</Button>}
      {row.status !== 'closed' && may('closed') && <Button variant="primary" loading={busy} onClick={() => move('closed', 'Event closed.')}>Close event</Button>}
      {row.status === 'closed' && may('investigating') && <Button loading={busy} onClick={() => move('investigating', 'Event reopened.')}>Reopen</Button>}
    </>
  );
}

interface LinkedHazard { id: string; ref: string; title: string; status: string; rating: string | null; residual_rating: string | null }

function Hazards({ eventId }: { eventId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const { scale } = useHazardScale();
  const { data, error, reload } = useFetch<LinkedHazard[]>(`/api/safety-events/${eventId}/hazards`);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LinkedHazard | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!pick) return;
    setBusy(true);
    try { await api.post(`/api/safety-events/${eventId}/hazards`, { hazard_id: pick }); toast.success('Hazard linked.'); setAdding(false); setPick(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`/api/safety-events/${eventId}/hazards/${removing.id}`); toast.success('Link removed.'); setRemoving(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Hazards" flush actions={can('safety.edit') && <Button size="sm" icon="link" onClick={() => setAdding(true)}>Link a hazard</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="sf-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="shield" title="No hazards linked" message="Link the hazards this event shows, so the hazard log reflects what happens." />
        : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Hazards linked to this event</caption>
              <thead><tr><th scope="col">Hazard</th><th scope="col">Rating</th><th scope="col">After mitigation</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((h) => (
                  <tr key={h.id}>
                    <td><Link className="row-title" to={`/safety/hazards/${h.id}`}><span className="ref">{h.ref}</span> {h.title}</Link></td>
                    <td><RatingChip scale={scale} rating={h.rating} /></td>
                    <td><RatingChip scale={scale} rating={h.residual_rating} /></td>
                    <td className="sf-actions">{can('safety.edit') && <Button size="sm" variant="ghost" onClick={() => setRemoving(h)}>Remove</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <Modal open={adding} title="Link a hazard" size="sm" onClose={() => setAdding(false)} dirty={!!pick}
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!pick} onClick={add}>Link</Button></>}>
        <RecordPicker label="Hazard" type="hazard" required value={pick} onChange={(id) => setPick(id)} />
      </Modal>
      <ConfirmDialog open={!!removing} title="Remove this link?" message={`The event will no longer be linked to ${removing?.ref ?? 'the hazard'}.`}
        confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

export function EventDetail() {
  return (
    <RecordPage
      type="safety_event"
      banner={({ row }) => (
        <div className="stack">
          {row.restricted && <p className="notice notice-warn">Restricted: this event holds personal information and is visible only to people who may see restricted records.</p>}
          {row.reportable && <p className="notice notice-warn">Reportable: {(row.reportable_reasons ?? []).map((r: { party: string }) => r.party).join(', ')} must be notified. See the Reporting tab.</p>}
          <Stepper label="Progress" current={row.status} steps={STEPS} />
        </div>
      )}
      actions={(rec) => <Actions {...rec} />}
      summary={({ row, reload }) => (
        <div className="sf-summary sf-event-summary">
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="What happened"
            fields={['title', 'occurred_at', 'event_type', 'severity', 'description', 'immediate_actions', 'reported_by_id', 'restricted']} />
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="Harm and damage"
            fields={['injuries', 'fatalities', 'people_transported', 'damage_estimate', 'evacuation']} />
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="Where"
            fields={['site_id', 'vehicle_id', 'service_id', 'location_detail']} />
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="Investigation"
            fields={['investigator_id', 'investigation_due', 'root_cause_category', 'root_cause', 'findings', 'closed_on', 'notes']} />
        </div>
      )}
      tabs={[
        { key: 'people', label: 'People involved', content: ({ row, reload }) => <PeopleTab eventId={row.id} onChanged={reload} /> },
        { key: 'investigation', label: 'Investigation', content: ({ row, reload }) => <InvestigationTab row={row} reload={reload} /> },
        { key: 'reporting', label: 'Reporting', content: ({ row }) => <ReportingTab key={`${row.updated_at}`} eventId={row.id} /> },
        { key: 'actions', label: 'Corrective actions', content: ({ row }) => <div className="stack"><SafetyCaps sourceType="safety_event" sourceId={row.id} /><SafetyActions sourceType="safety_event" sourceId={row.id} /></div> },
        { key: 'hazards', label: 'Hazards', content: ({ row }) => <Hazards eventId={row.id} /> },
      ]}
    />
  );
}
