// Vehicles and services affected by one or more systems. Other modules embed it (for example
// the incident workspace or the relationship map) without importing the rest of fleet:
//
//   const loaders = import.meta.glob('../fleet/AffectedPanel.tsx');
//   <AffectedPanel systemIds={[systemId]} />
//
// It renders nothing for people without fleet.view.
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Loading, useAuth, useFetch } from '../../core';
import type { AffectedService, AffectedVehicle } from './shared';

export interface AffectedData { vehicles: AffectedVehicle[]; services: AffectedService[] }

export function AffectedLists({ data }: { data: AffectedData }) {
  return (
    <div className="fl-affected">
      <Card title={<>Services affected <span className="tab-count">{data.services.length}</span></>} flush>
        {data.services.length === 0 ? <EmptyState icon="map-pin" title="No services depend on these systems" /> : (
          <ul className="fl-list">
            {data.services.map((s) => (
              <li key={s.id}>
                <Link className="row-title" to={s.route}><span className="ref">{s.route_code}</span> {s.name}</Link>
                <span className="muted">{[s.mode_label, ...s.dependencies.map((d) => d.dependency_label).filter(Boolean)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={<>Vehicles affected <span className="tab-count">{data.vehicles.length}</span></>} flush>
        {data.vehicles.length === 0 ? <EmptyState icon="box" title="No vehicle carries equipment of these systems" /> : (
          <ul className="fl-list">
            {data.vehicles.map((v) => (
              <li key={v.id}>
                <Link className="row-title" to={v.route}>{v.fleet_number}</Link>
                <span className="muted">{[v.mode_label, v.depot_name, `${v.equipment.length} piece${v.equipment.length === 1 ? '' : 's'} of equipment`].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function AffectedPanel({ systemIds }: { systemIds: string[] }) {
  const { can } = useAuth();
  const ids = [...new Set(systemIds)].filter(Boolean);
  const { data, error, reload } = useFetch<AffectedData>(can('fleet.view') && ids.length ? `/api/fleet/affected?system_ids=${ids.join(',')}` : null);
  if (!can('fleet.view') || !ids.length) return null;
  if (error) return <ErrorState title="Affected vehicles and services could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} label="Loading affected vehicles and services" />;
  return <AffectedLists data={data} />;
}

export default AffectedPanel;
