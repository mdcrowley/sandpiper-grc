// The hazard log: the list, and one hazard scored on the hazard matrix, with its mitigations and events.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, EditableSummary, EmptyState, errorMessage, ErrorState, formatDateTime, Loading, LookupChip, PageHeader, RecordPage, ResourceList, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { HazardMatrix, RatingChip, SafetyActions, SafetyTabs, useHazardScale } from './shared';

export function HazardList() {
  const { scale } = useHazardScale();
  return (
    <div className="stack">
      <PageHeader title="Hazard log" subtitle="Hazards to passengers, staff and the public, scored on the safety hazard matrix." />
      <SafetyTabs active="hazards" />
      <ResourceList
        type="hazard"
        urlState
        columns={[
          'ref', 'title', 'status',
          { field: 'rating', label: 'Rating', sortable: true, render: (r) => <RatingChip scale={scale} rating={r.rating} /> },
          { field: 'residual_rating', label: 'After mitigation', render: (r) => <RatingChip scale={scale} rating={r.residual_rating} /> },
          'owner_id', 'review_date', { field: 'mode', hidden: true }, { field: 'source', hidden: true },
        ]}
        filters={['status', 'source', 'mode', 'owner_id', 'site_id', 'review_date']}
        createFields={['title', 'description', 'source', 'consequence', 'existing_controls', 'mode', 'site_id', 'owner_id', 'review_date']}
      />
    </div>
  );
}

function Scoring({ row, save, canEdit }: RecordContext) {
  const toast = useToast();
  const { scale, error } = useHazardScale();
  const [busy, setBusy] = useState(false);
  if (error) return <Card title="Risk on the hazard matrix"><p className="muted">The hazard matrix is not available: it is kept by the risks module.</p></Card>;
  if (!scale) return <Card title="Risk on the hazard matrix"><Loading lines={4} /></Card>;
  const pick = (prefix: '' | 'residual_') => async (likelihood: number, severity: number) => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      await save({ [`${prefix}likelihood`]: likelihood, [`${prefix}severity`]: severity });
      toast.success(prefix ? 'Rating after mitigation saved.' : 'Rating saved.');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const level = (list: { value: number; label: string }[], v: unknown) => list.find((l) => l.value === Number(v))?.label ?? '—';
  return (
    <div className="sf-scoring">
      {([['', 'Current risk', 'With the existing controls.'], ['residual_', 'After mitigation', 'Once the mitigations below are in place.']] as const).map(([p, title, hint]) => (
        <Card key={title} title={title} actions={<RatingChip scale={scale} rating={row[`${p}rating`]} />}>
          <p className="muted sf-hint">
            {hint} {row[`${p}likelihood`] ? `${level(scale.likelihood_levels, row[`${p}likelihood`])} likelihood, ${level(scale.impact_levels, row[`${p}severity`]).toLowerCase()} severity.` : 'Not scored yet.'}
            {canEdit && ' Choose a cell to score it.'}
          </p>
          <HazardMatrix scale={scale} label={`${title}: ${scale.name}`}
            value={{ likelihood: row[`${p}likelihood`] ?? null, severity: row[`${p}severity`] ?? null }}
            onPick={canEdit ? pick(p) : undefined} />
        </Card>
      ))}
    </div>
  );
}

interface LinkedEvent { id: string; ref: string; title: string; occurred_at: string; event_type: string; severity: string; status: string }

function Events({ hazardId }: { hazardId: string }) {
  const { data, error, reload } = useFetch<LinkedEvent[]>(`/api/hazards/${hazardId}/events`);
  return (
    <Card title="Safety events showing this hazard" flush>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="sf-pad"><Loading lines={3} /></div>
        : data.length === 0 ? <EmptyState icon="alert" title="No events linked" message="Link events to this hazard from the event's Hazards tab." />
        : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Safety events linked to this hazard</caption>
              <thead><tr><th scope="col">Event</th><th scope="col">When</th><th scope="col">Type</th><th scope="col">Severity</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id}>
                    <td><Link className="row-title" to={`/safety/events/${e.id}`}><span className="ref">{e.ref}</span> {e.title}</Link></td>
                    <td>{formatDateTime(e.occurred_at)}</td>
                    <td><LookupChip list="safety_event_type" value={e.event_type} /></td>
                    <td><LookupChip list="safety_event_severity" value={e.severity} /></td>
                    <td><LookupChip list="safety_event_status" value={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

export function HazardDetail() {
  return (
    <RecordPage
      type="hazard"
      summary={(rec) => (
        <div className="stack">
          <EditableSummary type="hazard" row={rec.row} onSaved={rec.reload} title="Hazard"
            fields={['title', 'description', 'source', 'consequence', 'existing_controls', 'mode', 'site_id', 'owner_id', 'review_date', 'status', 'notes']} />
          <Scoring {...rec} />
        </div>
      )}
      tabs={[
        { key: 'mitigations', label: 'Mitigations', content: ({ row }) => <SafetyActions sourceType="hazard" sourceId={row.id} /> },
        { key: 'events', label: 'Safety events', content: ({ row }) => <Events hazardId={row.id} /> },
      ]}
    />
  );
}
