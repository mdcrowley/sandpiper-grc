// Safety events: the list, and one event with its investigation, corrective actions and hazards.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EditableSummary, EmptyState, errorMessage, ErrorState, Loading, Modal, PageHeader, RecordPage, RecordPicker,
  ResourceList, Stepper, TableWrap, TextArea, useAuth, useFetch, useLookup, useResource, useToast,
} from '../../core';
import type { ViewerState } from './ConfidentialViewers';
import { canMoveTo, editableLifecycle } from '../../core/lifecycleMenus';
import type { RecordContext } from '../../core';
import { InvestigationTab, PeopleTab, ReportingTab } from './EventTabs';
import { RatingChip, SafetyActions, SafetyCaps, SafetyTabs, useHazardScale } from './shared';

const CREATE = ['title', 'occurred_at', 'event_type', 'severity', 'site_id', 'vehicle_id', 'service_id', 'location_detail', 'description', 'immediate_actions', 'injuries', 'fatalities', 'people_transported', 'damage_estimate', 'evacuation', 'reported_by_id', 'confidential_reporter', 'restricted'];

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

/** Whether the event has someone to tell when it closes (E41-05). */
const hasReporter = (row: Record<string, unknown>) => Boolean(row.reported_by_id) || row.confidential_reporter === true;

function Actions({ row, save, canEdit }: RecordContext) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Closing an event with a reporter asks what they are told (E41-05).
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [outcomeError, setOutcomeError] = useState('');
  // A button whose move the lifecycle does not allow is left out (E14-31); Edit offers the allowed statuses.
  const lifecycle = editableLifecycle(useResource('safety_event')?.lifecycle, 'status');
  const values = useLookup('safety_event_status').map((v) => v.value);
  const may = (to: string) => canMoveTo(lifecycle, row.status, to, values);
  if (!canEdit) return null;
  const move = async (status: string, done: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try { await save({ status, ...extra }); toast.success(done); setClosing(false); }
    catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields?.reporter_outcome) setOutcomeError(fields.reporter_outcome);
      else toast.error(errorMessage(err));
    }
    finally { setBusy(false); }
  };
  const close = () => {
    if (!hasReporter(row)) { void move('closed', 'Event closed.'); return; }
    setOutcome(row.reporter_outcome ?? ''); setOutcomeError(''); setClosing(true);
  };
  // The next step is the primary button (E18-64): a just-reported event is investigated, not closed.
  const investigate = row.status === 'reported' && may('investigating');
  const raise = row.status === 'investigating' && may('actions_open');
  const look = (next: boolean) => (next ? 'primary' : 'secondary');
  return (
    <>
      {investigate && <Button variant="primary" loading={busy} onClick={() => move('investigating', 'Investigation started.')}>Start investigation</Button>}
      {raise && <Button variant="primary" loading={busy} onClick={() => move('actions_open', 'Waiting on corrective actions.')}>Corrective actions raised</Button>}
      {row.status !== 'closed' && may('closed') && <Button variant={look(!investigate && !raise)} loading={busy} onClick={close}>Close event</Button>}
      {row.status === 'closed' && may('investigating') && <Button loading={busy} onClick={() => move('investigating', 'Event reopened.')}>Reopen</Button>}
      <Modal open={closing} title="Close the event" size="md" onClose={() => setClosing(false)} dirty={outcome !== (row.reporter_outcome ?? '')}
        footer={<><Button onClick={() => setClosing(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => move('closed', 'Event closed. The reporter has been told.', { reporter_outcome: outcome })}>Close and tell the reporter</Button></>}>
        <div className="stack">
          <p className="muted">
            {row.confidential_reporter
              ? 'The reporter asked to stay confidential. They are told the event is closed without naming it, and read these words under My safety reports in the portal.'
              : 'The reporter is told the event is closed, with these words.'}
          </p>
          <TextArea label="What the reporter is told" required rows={5} value={outcome} onChange={setOutcome} error={outcomeError}
            hint="In plain words: what was found and what was done about it. Leave out names and personal details." />
        </div>
      </Modal>
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
          <TableWrap label="Hazards linked to this event">
            <table className="table">
              <caption className="sr-only">Hazards linked to this event</caption>
              <thead><tr><th scope="col">Hazard</th><th scope="col">Rating</th><th scope="col">After mitigation</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((h) => (
                  <tr key={h.id}>
                    <td><Link className="row-title" to={`/safety/hazards/${h.id}`}><span className="ref">{h.ref}</span> {h.title}</Link></td>
                    <td><RatingChip scale={scale} rating={h.rating} /></td>
                    <td><RatingChip scale={scale} rating={h.residual_rating} /></td>
                    <td className="sf-actions">{can('safety.edit') && <Button size="sm" variant="ghost" aria-label={`Remove: ${h.ref} ${h.title}`} onClick={() => setRemoving(h)}>Remove</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
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

/**
 * A confidential reporter (E41-05): named people can look, and each look is recorded on the event's
 * history; everyone else is told who can.
 */
function ConfidentialReporter({ eventId, onLooked }: { eventId: string; onLooked: () => void }) {
  const toast = useToast();
  const { data } = useFetch<ViewerState>('/api/safety/confidential-viewers');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ name: string; email: string | null } | null | 'none'>(null);
  const look = async () => {
    setBusy(true);
    try {
      const r = await api.get<{ reporter?: { name: string; email: string | null } | null }>(`/api/safety-events/${eventId}/reporter`);
      setShown(r.reporter ?? 'none'); setAsking(false); onLooked();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <div className="notice sf-confidential">
      <p>
        Confidential reporter: the person who made this report asked for their identity to be kept confidential.
        {shown === 'none' ? ' Nobody is recorded: the report was made anonymously.'
          : shown ? <> Reported by <strong>{shown.name}</strong>{shown.email ? ` (${shown.email})` : ''}.</>
          : data?.named ? ' You are named to see who it is; your look is recorded on the history.'
          : ' Only the people named under Administration > Confidential safety reports can see who it is.'}
      </p>
      {data?.named && !shown && <Button size="sm" icon="eye" onClick={() => setAsking(true)}>Show who reported it</Button>}
      <ConfirmDialog open={asking} title="Show who reported it?" busy={busy} confirmLabel="Show"
        message="The reporter asked to stay confidential. Your look is recorded on this event's history. Do not share their identity."
        onConfirm={look} onCancel={() => setAsking(false)} />
    </div>
  );
}

export function EventDetail() {
  return (
    <RecordPage
      type="safety_event"
      banner={({ row, reload }) => (
        <div className="stack">
          {row.confidential_reporter && <ConfidentialReporter eventId={row.id} onLooked={reload} />}
          {row.restricted && <p className="notice notice-warn">Restricted: this event holds personal information and is visible only to people who may see restricted records.</p>}
          {row.reportable && <p className="notice notice-warn">Reportable: {(row.reportable_reasons ?? []).map((r: { party: string }) => r.party).join(', ')} must be notified. See the Reporting tab.</p>}
          <Stepper label="Progress" current={row.status} steps={STEPS} />
        </div>
      )}
      actions={(rec) => <Actions {...rec} />}
      summary={({ row, reload }) => (
        <div className="sf-summary sf-event-summary">
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="What happened"
            fields={['title', 'occurred_at', 'event_type', 'severity', 'description', 'immediate_actions', ...(row.confidential_reporter ? [] : ['reported_by_id']), 'restricted']} />
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="Harm and damage"
            fields={['injuries', 'fatalities', 'people_transported', 'damage_estimate', 'evacuation']} />
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="Where"
            fields={['site_id', 'vehicle_id', 'service_id', 'location_detail']} />
          <EditableSummary type="safety_event" row={row} onSaved={reload} title="Investigation"
            fields={['investigator_id', 'investigation_due', 'root_cause_category', 'root_cause', 'findings', 'closed_on', 'notes']} />
          {hasReporter(row) && (
            <EditableSummary type="safety_event" row={row} onSaved={reload} title="Telling the reporter"
              fields={['reporter_outcome', 'reporter_told_at']} />
          )}
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
