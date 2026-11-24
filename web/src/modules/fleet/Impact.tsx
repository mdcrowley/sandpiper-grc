// What is affected: choose a system that has failed and see the vehicles carrying its equipment
// and the services that depend on it (optionally through the systems it feeds).
import { Link, useSearchParams } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Loading, Notice, PageHeader, RecordPicker, Stat, Switch, useFetch } from '../../core';
import { AffectedLists, type AffectedData } from './AffectedPanel';
import { FleetTabs } from './shared';

interface Impact extends AffectedData {
  system: { id: string; ref: string | null; name: string };
  systems: { id: string; ref: string | null; name: string; depth: number; route: string }[];
  counts: { systems: number; vehicles: number; services: number };
  /** The most rows listed of each kind (the counts are whole). */
  limit?: number;
}

export function ImpactPage() {
  const [params, setParams] = useSearchParams();
  const systemId = params.get('system');
  const downstream = params.get('downstream') === 'true';
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const { data, error, reload } = useFetch<Impact>(systemId ? `/api/fleet/impact?system_id=${systemId}&downstream=${downstream}` : null, { keepPrevious: true });
  const shown = systemId && data && data.system.id === systemId ? data : null;

  return (
    <div className="stack">
      <PageHeader title="What is affected" subtitle="If a system fails, which vehicles and services feel it." />
      <FleetTabs active="impact" />
      <Card>
        <div className="fl-filters">
          <RecordPicker label="System that has failed" type="system" value={systemId} display={shown ? `${shown.system.ref ?? ''} ${shown.system.name}`.trim() : undefined}
            onChange={(id) => set('system', id)} placeholder="Search systems" />
          <Switch label="Include systems it feeds" hint="Follows the recorded integrations downstream." checked={downstream} onChange={(on) => set('downstream', on ? 'true' : null)} />
        </div>
      </Card>
      {!systemId ? (
        <EmptyState icon="target" title="Choose a system" message="For example the CAD/AVL system or the onboard video system. The vehicles that carry its equipment and the services that depend on it are listed here." />
      ) : error && !shown ? <ErrorState title="The impact could not be worked out" error={error} onRetry={reload} />
        : !shown ? <Loading lines={6} label="Working out what is affected" />
        : (
          <>
            <div className="grid-stats">
              <Stat label="Systems" value={shown.counts.systems} icon="server" hint={downstream ? 'The system and those it feeds' : 'The system itself'} />
              <Stat label="Services affected" value={shown.counts.services} icon="route" color={shown.counts.services ? 'amber' : undefined} />
              <Stat label="Vehicles affected" value={shown.counts.vehicles} icon="bus" color={shown.counts.vehicles ? 'amber' : undefined} />
            </div>
            {(shown.counts.vehicles > shown.vehicles.length || shown.counts.services > shown.services.length || shown.counts.systems > shown.systems.length) && (
              <Notice tone="info">
                The lists show the first {shown.limit ?? shown.vehicles.length} of each kind; the figures above count them all. Choose a system nearer the failure to narrow them.
              </Notice>
            )}
            {shown.systems.length > 1 && (
              <Card title="Systems reached">
                <ul className="fl-chips" aria-label="Systems reached">
                  {shown.systems.map((s) => (
                    <li key={s.id}><Link to={s.route}>{s.ref && <span className="ref">{s.ref}</span>} {s.name}</Link>{s.depth > 0 && <span className="muted"> · {s.depth} step{s.depth === 1 ? '' : 's'} away</span>}</li>
                  ))}
                </ul>
              </Card>
            )}
            <AffectedLists data={shown} />
          </>
        )}
    </div>
  );
}
