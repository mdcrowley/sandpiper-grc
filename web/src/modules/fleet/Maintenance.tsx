// Planned maintenance (wave 27, E46-71): what is due on which vehicle, the service intervals of each
// vehicle model or asset class, the services done and the odometer and hour readings (mileage
// history). The server works out when each vehicle is next due (GET /api/fleet/maintenance/due); the
// vehicle page has a Maintenance tab and a vehicle model page an Intervals tab.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge, Card, EmptyState, ErrorState, formatDate, formatNumber, Loading, PageHeader, RecordPage, ResourceList, Select, Stat, TableWrap, Tabs,
  useAuth, useFetch, useResource, type ColorName, type Row,
} from '../../core';
import { FleetTabs } from './shared';

export type DueState = 'overdue' | 'due_soon' | 'ok';
export interface DueRow {
  vehicle_id: string; fleet_number: string; depot: string | null; model: string | null;
  interval_id: string; interval_ref: string | null; interval: string; owner: string | null;
  every_miles: number | null; every_hours: number | null; every_days: number | null;
  last_done_on: string | null; basis: 'service' | 'start';
  current_miles: number | null; current_hours: number | null;
  next_miles: number | null; next_hours: number | null; next_date: string | null;
  miles_left: number | null; hours_left: number | null; days_left: number | null;
  miles_per_day: number | null; due_on: string | null; state: DueState;
}
interface DueAnswer { today: string; counts: Record<DueState, number>; total: number; rows: DueRow[] }

export const DUE_STATE: Record<DueState, { label: string; color: ColorName }> = {
  overdue: { label: 'Overdue', color: 'red' },
  due_soon: { label: 'Due soon', color: 'amber' },
  ok: { label: 'In date', color: 'green' },
};

const SECTIONS = [
  { key: 'due', label: 'Due', path: '/fleet/maintenance' },
  { key: 'intervals', label: 'Intervals', path: '/fleet/maintenance/intervals' },
  { key: 'records', label: 'Services done', path: '/fleet/maintenance/records' },
  { key: 'readings', label: 'Readings', path: '/fleet/readings' },
] as const;
type Section = (typeof SECTIONS)[number]['key'];

function MaintenanceHeader({ active, subtitle }: { active: Section; subtitle: string }) {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Planned maintenance" subtitle={subtitle} />
      <FleetTabs active="maintenance" />
      <Tabs label="Planned maintenance sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
        onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/fleet/maintenance')} />
    </>
  );
}

const miles = (n: number | null) => (n === null ? null : `${formatNumber(Math.round(n))} mi`);
const hours = (n: number | null) => (n === null ? null : `${formatNumber(Math.round(n))} h`);

/** What is left before the service: miles, hours and days, whichever the interval counts. */
function Left({ row }: { row: DueRow }) {
  const parts: string[] = [];
  const say = (n: number | null, unit: string, one: string) => {
    if (n === null) return;
    const v = Math.round(n);
    parts.push(v < 0 ? `${formatNumber(-v)} ${unit} over` : v === 0 ? `due now (${one})` : `${formatNumber(v)} ${unit} left`);
  };
  say(row.miles_left, 'mi', 'miles');
  say(row.hours_left, 'h', 'hours');
  if (row.days_left !== null) parts.push(row.days_left < 0 ? `${-row.days_left} ${row.days_left === -1 ? 'day' : 'days'} late` : row.days_left === 0 ? 'due today' : `${row.days_left} ${row.days_left === 1 ? 'day' : 'days'} left`);
  return parts.length ? <span className={row.state === 'overdue' ? 'fl-late' : undefined}>{parts.join(' · ')}</span> : <span className="muted">No readings</span>;
}

function Next({ row }: { row: DueRow }) {
  const parts = [miles(row.next_miles), hours(row.next_hours), row.next_date ? formatDate(row.next_date) : null].filter(Boolean);
  return parts.length ? <>{parts.join(' · ')}</> : <span className="muted">Not known</span>;
}

/** The due table, for the whole fleet, one interval or one vehicle. */
export function DueTable({ rows, caption, show }: { rows: DueRow[]; caption: string; show: 'vehicle' | 'interval' | 'both' }) {
  return (
    <TableWrap label={caption} fit>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {show !== 'interval' && <th scope="col">Vehicle</th>}
            {show !== 'vehicle' && <th scope="col" data-priority="1">Interval</th>}
            <th scope="col" data-priority="1">State</th>
            <th scope="col" data-priority="1">Next due</th>
            <th scope="col" data-priority="1">Left</th>
            <th scope="col" data-priority="2">Expected by</th>
            <th scope="col" data-priority="2">Last service</th>
            <th scope="col" data-priority="3">Now</th>
            {show !== 'vehicle' && <th scope="col" data-priority="3">Depot</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.vehicle_id}-${r.interval_id}`}>
              {show !== 'interval' && <td className="fl-wrap"><Link to={`/vehicles/${r.vehicle_id}?tab=maintenance`}>{r.fleet_number}</Link>{r.model && <span className="muted fl-sub"> {r.model}</span>}</td>}
              {show !== 'vehicle' && <td className="fl-wrap"><Link to={`/fleet/maintenance/intervals/${r.interval_id}`}>{r.interval}</Link></td>}
              <td><Badge color={DUE_STATE[r.state].color}>{DUE_STATE[r.state].label}</Badge></td>
              <td className="fl-wrap"><Next row={r} /></td>
              <td className="fl-wrap"><Left row={r} /></td>
              <td data-priority="2">{r.due_on ? formatDate(r.due_on) : <span className="muted">Not known</span>}</td>
              <td data-priority="2">{r.last_done_on ? formatDate(r.last_done_on) : <span className="muted">None recorded</span>}</td>
              <td data-priority="3">{[miles(r.current_miles), hours(r.current_hours)].filter(Boolean).join(' · ') || <span className="muted">No readings</span>}</td>
              {show !== 'vehicle' && <td data-priority="3">{r.depot ?? <span className="muted">None</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

const STATES = [
  { value: 'open', label: 'Overdue and due soon' }, { value: 'overdue', label: 'Overdue only' },
  { value: 'due_soon', label: 'Due soon only' }, { value: 'ok', label: 'In date only' }, { value: 'all', label: 'Everything' },
];

export function MaintenanceDuePage() {
  const [state, setState] = useState('open');
  const [model, setModel] = useState('');
  const [depot, setDepot] = useState('');
  const models = useFetch<{ rows: { id: string; name: string }[] }>('/api/vehicle-models?pageSize=500&sort=name');
  const { can } = useAuth();
  // The depot filter needs the sites list; a role without sites.view sees every depot (no filter).
  const depots = useFetch<{ rows: { id: string; name: string }[] }>(can('sites.view') ? '/api/sites?pageSize=500&sort=name' : null);
  const qs = new URLSearchParams(Object.entries({ state, model, depot }).filter(([, v]) => v)).toString();
  const { data, error, reload } = useFetch<DueAnswer>(`/api/fleet/maintenance/due?${qs}`, { keepPrevious: true });
  let body;
  if (error) body = <ErrorState title="What is due could not be worked out" error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Working out what is due" />;
  else if (!data.rows.length) {
    body = data.counts.overdue + data.counts.due_soon + data.counts.ok === 0
      ? <EmptyState icon="clipboard" title="No intervals yet" message="Add a maintenance interval for a vehicle model or an asset class, and each of its vehicles shows here with its next service." />
      : <EmptyState icon="check-circle" title="Nothing to show" message="No service matches. Choose Everything to see every vehicle and interval." />;
  } else body = <DueTable rows={data.rows} caption="Services due on each vehicle" show="both" />;
  return (
    <div className="stack">
      <MaintenanceHeader active="due" subtitle="When each vehicle is next due for each service interval of its model or asset class, by miles, hours or days." />
      {data && (
        <div className="grid-stats">
          <Stat label="Overdue" icon="alert" color={data.counts.overdue ? 'red' : 'green'} value={data.counts.overdue} />
          <Stat label="Due soon" icon="clock" color={data.counts.due_soon ? 'amber' : 'green'} value={data.counts.due_soon} />
          <Stat label="In date" icon="check-circle" color="green" value={data.counts.ok} />
        </div>
      )}
      <Card>
        <div className="fl-filters">
          <Select label="Show" value={state} onChange={(v) => setState(v || 'open')} options={STATES} />
          <Select label="Vehicle model" value={model} onChange={setModel} placeholder="Every model"
            options={[{ value: '', label: 'Every model' }, ...(models.data?.rows ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
          {can('sites.view') && <Select label="Depot or garage" value={depot} onChange={setDepot} placeholder="Every depot"
            options={[{ value: '', label: 'Every depot' }, ...(depots.data?.rows ?? []).map((s) => ({ value: s.id, label: s.name }))]} />}
        </div>
      </Card>
      <Card flush={Boolean(data?.rows.length)}>{body}</Card>
      <p className="muted">
        Each service is due from the latest one recorded (or, with none, from zero miles and hours and the day the vehicle entered service). The first
        of the interval&apos;s miles, hours and days reached counts. Expected by is worked out from the rate the vehicle has run at over the last year.
      </p>
    </div>
  );
}

// ---------- intervals ----------

export function IntervalList() {
  const resource = useResource('maintenance_interval');
  const cls = Boolean(resource?.fields.asset_class_id);
  return (
    <div className="stack">
      <MaintenanceHeader active="intervals" subtitle="What is done how often, for the vehicles of one vehicle model or one asset class." />
      <ResourceList
        type="maintenance_interval"
        urlState
        columns={['name', 'model_id', ...(cls ? [{ field: 'asset_class_id', priority: 3 as const }] : []), 'every_miles', 'every_hours', 'every_days',
          { field: 'owner_id', priority: 3 }, { field: 'active', priority: 3 }, { field: 'ref', hidden: true }]}
        filters={['model_id', ...(cls ? ['asset_class_id'] : []), 'owner_id', 'active']}
        createFields={['name', 'model_id', ...(cls ? ['asset_class_id'] : []), 'every_miles', 'every_hours', 'every_days', 'warn_miles', 'warn_hours', 'warn_days', 'owner_id', 'description', 'active']}
      />
    </div>
  );
}

function IntervalVehicles({ intervalId }: { intervalId: string }) {
  const { data, error, reload } = useFetch<DueAnswer>(`/api/fleet/maintenance/due?state=all&interval=${intervalId}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  if (!data.rows.length) return <EmptyState icon="bus" title="No vehicles" message="No vehicle in service has this interval's model or asset class." />;
  return <Card flush><DueTable rows={data.rows} caption="When each vehicle is next due" show="vehicle" /></Card>;
}

export function IntervalDetail() {
  return (
    <RecordPage
      type="maintenance_interval"
      title={(row) => row.name}
      breadcrumbs={[{ label: 'Planned maintenance', to: '/fleet/maintenance' }, { label: 'Intervals', to: '/fleet/maintenance/intervals' }]}
      summaryFields={['name', 'model_id', 'asset_class_id', 'every_miles', 'every_hours', 'every_days', 'warn_miles', 'warn_hours', 'warn_days', 'owner_id', 'active', 'description']}
      tabs={[{ key: 'vehicles', label: 'Vehicles', content: ({ row }) => <IntervalVehicles intervalId={row.id} /> }]}
    />
  );
}

/** The intervals of one vehicle model (a tab of the model's page). */
export function ModelIntervals({ modelId }: { modelId: string }) {
  return (
    <ResourceList
      type="maintenance_interval"
      baseFilter={{ model_id: modelId }}
      columns={['name', 'every_miles', 'every_hours', 'every_days', { field: 'owner_id', priority: 3 }, { field: 'active', priority: 3 }]}
      createFields={['name', 'every_miles', 'every_hours', 'every_days', 'warn_miles', 'warn_hours', 'warn_days', 'owner_id', 'description', 'active']}
      createInitial={{ model_id: modelId }}
      onCreated={() => window.dispatchEvent(new Event('grc:list-changed'))}
    />
  );
}

// ---------- services done and readings ----------

const RECORD_FIELDS = ['vehicle_id', 'interval_id', 'done_on', 'odometer_miles', 'engine_hours', 'work_order', 'notes'];
const READING_FIELDS = ['vehicle_id', 'read_on', 'odometer_miles', 'engine_hours', 'source', 'notes'];

export function RecordList() {
  return (
    <div className="stack">
      <MaintenanceHeader active="records" subtitle="Services done on each vehicle. The next service of an interval is due from the latest one." />
      <ResourceList
        type="maintenance_record"
        urlState
        columns={['ref', 'vehicle_id', 'interval_id', 'done_on', 'odometer_miles', { field: 'engine_hours', priority: 3 }, { field: 'work_order', priority: 3 }, { field: 'recorded_by', priority: 3 }]}
        defaultSort={{ field: 'done_on', dir: 'desc' }}
        filters={['vehicle_id', 'interval_id', 'done_on', 'recorded_by']}
        createFields={RECORD_FIELDS}
      />
    </div>
  );
}

export function RecordDetail() {
  return (
    <RecordPage
      type="maintenance_record"
      title={(row) => `Service ${row.ref ?? ''} on vehicle ${row._display?.vehicle_id ?? ''}`.replace(/\s+/g, ' ').trim()}
      breadcrumbs={[{ label: 'Planned maintenance', to: '/fleet/maintenance' }, { label: 'Services done', to: '/fleet/maintenance/records' }]}
      summaryFields={[...RECORD_FIELDS, 'recorded_by']}
    />
  );
}

export function ReadingList() {
  return (
    <div className="stack">
      <MaintenanceHeader active="readings" subtitle="Odometer and hour-meter readings: each vehicle's mileage history. A reading never goes backwards." />
      <ResourceList
        type="vehicle_reading"
        urlState
        columns={['ref', 'vehicle_id', 'read_on', 'odometer_miles', 'engine_hours', { field: 'source', priority: 3 }, { field: 'recorded_by', priority: 3 }]}
        defaultSort={{ field: 'read_on', dir: 'desc' }}
        filters={['vehicle_id', 'read_on', 'source', 'recorded_by']}
        createFields={READING_FIELDS}
      />
    </div>
  );
}

export function ReadingDetail() {
  return (
    <RecordPage
      type="vehicle_reading"
      title={(row) => `Reading ${row.ref ?? ''} of vehicle ${row._display?.vehicle_id ?? ''}`.replace(/\s+/g, ' ').trim()}
      breadcrumbs={[{ label: 'Planned maintenance', to: '/fleet/maintenance' }, { label: 'Readings', to: '/fleet/readings' }]}
      summaryFields={[...READING_FIELDS, 'recorded_by']}
    />
  );
}

// ---------- one vehicle ----------

interface VehicleMaintenance { today: string; due: DueRow[]; readings: Row[]; services: Row[] }

/** Mileage over the year as a simple list of points (the readings table has every one). */
function Trend({ readings }: { readings: Row[] }) {
  const pts = readings.filter((r) => r.odometer_miles !== null).slice(0, 13).reverse();
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const days = Math.max(1, Math.round((Date.parse(last.read_on) - Date.parse(first.read_on)) / 86_400_000));
  const perDay = (Number(last.odometer_miles) - Number(first.odometer_miles)) / days;
  return (
    <p className="muted fl-pad">
      {formatNumber(Math.round(Number(last.odometer_miles) - Number(first.odometer_miles)))} miles between {formatDate(first.read_on)} and {formatDate(last.read_on)},
      about {formatNumber(Math.round(perDay))} miles a day.
    </p>
  );
}

export function VehicleMaintenanceTab({ vehicleId }: { vehicleId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<VehicleMaintenance>(`/api/vehicles/${vehicleId}/maintenance`, { keepPrevious: true });
  // A new service or reading changes what is next due, and a service adds a reading.
  const changed = () => { reload(); window.dispatchEvent(new Event('grc:list-changed')); };
  if (error) return <ErrorState title="The maintenance could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} label="Loading the maintenance" />;
  return (
    <div className="stack">
      <Card title="Next services" flush={data.due.length > 0}>
        {data.due.length
          ? <DueTable rows={data.due} caption="When this vehicle is next due for each interval" show="interval" />
          : <EmptyState icon="clipboard" title="No intervals" message="No maintenance interval is set for this vehicle's model or asset class." />}
      </Card>
      <Card title="Services done" flush>
        <ResourceList type="maintenance_record" baseFilter={{ vehicle_id: vehicleId }} pageSize={10}
          columns={['ref', 'interval_id', 'done_on', 'odometer_miles', { field: 'engine_hours', priority: 3 }, { field: 'work_order', priority: 3 }]}
          defaultSort={{ field: 'done_on', dir: 'desc' }}
          createFields={can('fleet.create') ? RECORD_FIELDS.filter((f) => f !== 'vehicle_id') : undefined} createInitial={{ vehicle_id: vehicleId }} onCreated={changed} />
      </Card>
      <Card title="Readings" flush>
        <Trend readings={data.readings} />
        <ResourceList type="vehicle_reading" baseFilter={{ vehicle_id: vehicleId }} pageSize={10}
          columns={['ref', 'read_on', 'odometer_miles', 'engine_hours', { field: 'source', priority: 3 }, { field: 'recorded_by', priority: 3 }]}
          defaultSort={{ field: 'read_on', dir: 'desc' }}
          createFields={can('fleet.create') ? READING_FIELDS.filter((f) => f !== 'vehicle_id') : undefined} createInitial={{ vehicle_id: vehicleId }} onCreated={changed} />
      </Card>
    </div>
  );
}
