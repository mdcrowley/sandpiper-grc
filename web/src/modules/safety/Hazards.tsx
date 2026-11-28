// The hazard log: the list, and one hazard scored on the hazard matrix, with its mitigations and events.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, EditableSummary, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Loading, LookupChip, PageHeader, RecordPage, ResourceList, StatusChip, TableWrap,
  todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { HazardMatrix, RatingChip, SafetyActions, SafetyTabs, useHazardScale } from './shared';

// The controls covering a hazard (E26-11), from the control library when it is part of the build. The
// panel renders nothing while the controls area is off or without controls.view.
const controlsLoaders = import.meta.glob<{ ControlsPanel: ComponentType<{ recordType: string; recordId: string }> }>('../controls/ControlsPanel.tsx');
const loadControls = Object.values(controlsLoaders)[0];
const ControlsPanel = loadControls ? lazy(() => loadControls().then((m) => ({ default: m.ControlsPanel }))) : null;

export function HazardList() {
  const { scale } = useHazardScale();
  const { can } = useAuth();
  const today = todayInZone();
  // Quick views (wave 26): hazards past their review date, and hazards nobody owns.
  const quick = [
    { label: 'Past review', to: `/safety/hazards?f.review_date.lt=${today}&sort=review_date&dir=asc` },
    { label: 'No owner', to: '/safety/hazards?f.owner_id.null=true' },
    { label: 'All hazards', to: '/safety/hazards' },
  ];
  return (
    <div className="stack">
      <PageHeader title="Hazard log" subtitle="Hazards to passengers, staff and the public, scored on the safety hazard matrix. Every hazard needs an owner and a review date."
        actions={can('safety.administer') ? <Link className="btn btn-secondary" to="/safety/matrix">Hazard matrix</Link> : undefined} />
      <SafetyTabs active="hazards" />
      <nav className="sf-quick" aria-label="Quick views of the hazard log">
        {quick.map((q) => <Link key={q.label} className="btn btn-secondary btn-sm" to={q.to}>{q.label}</Link>)}
      </nav>
      <ResourceList
        type="hazard"
        urlState
        columns={[
          'ref', 'title',
          // The rating matters more than the status, so it stays on narrow screens (wave 26).
          { field: 'rating', label: 'Rating', sortable: true, priority: 1, render: (r) => <RatingChip scale={scale} rating={r.rating} /> },
          { field: 'status', priority: 2 },
          { field: 'residual_rating', label: 'After mitigation', priority: 3, render: (r) => <RatingChip scale={scale} rating={r.residual_rating} /> },
          { field: 'owner_id', label: 'Owner', priority: 2, render: (r) => (r.owner_id ? (r._display?.owner_id ?? '—') : <StatusChip color="amber" label="No owner" />) },
          { field: 'review_date', label: 'Next review', priority: 1, render: (r) => {
            if (!r.review_date) return <StatusChip color="amber" label="No review date" />;
            return String(r.review_date) < today ? <span className="sf-overdue">{formatDate(r.review_date)} (overdue)</span> : formatDate(r.review_date);
          } },
          { field: 'mode', hidden: true }, { field: 'source', hidden: true },
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
  if (error) return <Card title="Risk on the hazard matrix"><p className="muted">The hazard matrix is not available on this installation.</p></Card>;
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
          <TableWrap label="Safety events linked to this hazard">
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
          </TableWrap>
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
          {ControlsPanel && <Suspense fallback={null}><ControlsPanel recordType="hazard" recordId={rec.row.id} /></Suspense>}
        </div>
      )}
      tabs={[
        { key: 'mitigations', label: 'Mitigations', content: ({ row }) => <SafetyActions sourceType="hazard" sourceId={row.id} /> },
        { key: 'events', label: 'Safety events', content: ({ row }) => <Events hazardId={row.id} /> },
      ]}
    />
  );
}
