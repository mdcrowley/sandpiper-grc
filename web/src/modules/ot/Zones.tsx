// Security zones (E33-02): the list, and one zone with its members, its conduits, the controls
// covering it and the actions raised on it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EditableSummary, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, PageHeader,
  RecordPage, RecordPicker, ResourceList, Select, TableWrap, useAuth, useFetch, useToast,
} from '../../core';
import type { ReactNode } from 'react';
import type { RecordTab, Row } from '../../core';
import { actionsInBuild, controlsInBuild, OtActions, OtControls, OtTabs, TargetChip } from './shared';

const DETAILS = ['name', 'description', 'site_id', 'owner_id', 'criticality', 'notes'];
const LEVELS = ['target_level', 'achieved_level', 'level_assessed_on'];

export interface MatrixZone {
  id: string; ref: string; name: string; target_level: string | null; achieved_level: string | null; level_assessed_on: string | null;
  criticality: string | null; restricted: boolean; systems: number; assets: number; below_target: boolean;
}
export interface MatrixConduit {
  id: string; ref: string; name: string; from_zone_id: string; to_zone_id: string; protocols: string | null; remote_access: boolean;
  target_level: string | null; achieved_level: string | null; restricted: boolean; below_target: boolean; flagged: boolean;
}
export interface Matrix { zones: MatrixZone[]; conduits: MatrixConduit[] }

export function ZoneList() {
  const { can } = useAuth();
  const createFields = ['name', 'description', 'site_id', 'owner_id', 'criticality', 'target_level', 'achieved_level', ...(can('security.view') ? ['restricted'] : [])];
  return (
    <div className="stack">
      <PageHeader title="Security zones" subtitle="Groups of OT systems and assets that share security needs, with the level each should reach and the level it has reached." />
      <OtTabs active="zones" />
      <ResourceList
        type="ot_zone"
        urlState
        columns={['ref', 'name', 'target_level', 'achieved_level', 'level_assessed_on', 'criticality', 'site_id', 'owner_id', { field: 'restricted', hidden: true }]}
        filters={['target_level', 'achieved_level', 'criticality', 'site_id', 'owner_id', 'level_assessed_on']}
        createFields={createFields}
      />
    </div>
  );
}

/** Whether the zone is at target, as the server works it out (the matrix knows every zone the person may see). */
function ZoneTarget({ zoneId, version }: { zoneId: string; version: string }) {
  const { data } = useFetch<Matrix>(`/api/ot/matrix?v=${encodeURIComponent(version)}`, { keepPrevious: true });
  const zone = data?.zones.find((z) => z.id === zoneId);
  if (!zone) return null;
  return <TargetChip below={zone.below_target} assessed={!!zone.achieved_level} />;
}

interface Members { systems: Row[] | null; assets: Row[] | null }

function MembersTab({ zone }: { zone: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Members>(`/api/ot-zones/${zone.id}/members`);
  const [kind, setKind] = useState<'system' | 'asset'>('system');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={4} label="Loading the zone's members" /></Card>;
  const kinds = [
    ...(data.systems && can('systems.edit') ? [{ value: 'system', label: 'System' }] : []),
    ...(data.assets && can('assets.edit') ? [{ value: 'asset', label: 'Asset' }] : []),
  ];
  const chosen = kinds.some((k) => k.value === kind) ? kind : (kinds[0]?.value as 'system' | 'asset' | undefined);

  const add = async () => {
    if (!picked || !chosen) return;
    setBusy(true);
    try {
      await api.patch(`/api/${chosen === 'system' ? 'systems' : 'assets'}/${picked}`, { zone_id: zone.id });
      toast.success(`${chosen === 'system' ? 'System' : 'Asset'} added to the zone.`);
      setPicked(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const table = (title: string, rows: Row[], route: string, refField: string, cols: [string, string, (r: Row) => ReactNode][]) => (
    <Card title={`${title} (${rows.length})`} flush>
      {rows.length === 0 ? <EmptyState icon="server" title={`No ${title.toLowerCase()} in this zone`} message="Set the zone on a record's OT details, or add one here." /> : (
        <TableWrap label={`${title} in this zone`}>
          <table className="table">
            <caption className="sr-only">{title} in this zone</caption>
            <thead><tr><th scope="col">Name</th>{cols.map(([k, label]) => <th key={k} scope="col">{label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ot-wrap"><Link to={`${route}/${r.id}`}>{r[refField] && <span className="ref">{r[refField]}</span>} {r.name}</Link></td>
                  {cols.map(([k, , cell]) => <td key={k}>{cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
  const chip = (list: string, v: unknown) => (v ? <LookupChip list={list} value={String(v)} /> : <span className="muted">—</span>);
  const yes = (v: unknown) => (v ? 'Yes' : 'No');

  return (
    <div className="stack">
      {kinds.length > 0 && chosen && (
        <Card title="Add to this zone">
          <div className="ot-add">
            {kinds.length > 1 && (
              <Select label="Kind of record" value={chosen} options={kinds} onChange={(v) => { setKind(v as 'system' | 'asset'); setPicked(null); }} />
            )}
            <RecordPicker key={chosen} label={chosen === 'system' ? 'System' : 'Asset'} type={chosen} value={picked} placeholder="Search by reference or name" onChange={(id) => setPicked(id)} />
            <Button variant="primary" icon="plus" disabled={!picked} loading={busy} onClick={add}>Add</Button>
          </div>
        </Card>
      )}
      {data.systems && table('Systems', data.systems, '/systems', 'ref', [
        ['control_level', 'Control level', (r) => chip('ot_control_level', r.control_level)],
        ['safety_related', 'Life-critical', (r) => yes(r.safety_related)],
        ['patchability', 'Patching', (r) => chip('ot_patchability', r.patchability)],
        ['vendor_remote_access', 'Supplier remote access', (r) => chip('vendor_remote_access', r.vendor_remote_access)],
      ])}
      {data.assets && table('Assets', data.assets, '/assets', 'tag', [
        ['control_level', 'Control level', (r) => chip('ot_control_level', r.control_level)],
        ['safety_related', 'Life-critical', (r) => yes(r.safety_related)],
        ['firmware_version', 'Firmware', (r) => r.firmware_version || <span className="muted">—</span>],
      ])}
    </div>
  );
}

/** The conduits joining a zone to others, from the matrix (only those the person may see). */
export function ZoneConduits({ zoneId }: { zoneId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Matrix>('/api/ot/matrix');
  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={3} label="Loading the conduits" /></Card>;
  const names = new Map(data.zones.map((z) => [z.id, z.name]));
  const rows = data.conduits.filter((c) => c.from_zone_id === zoneId || c.to_zone_id === zoneId);
  return (
    <Card title="Conduits" flush
      actions={can('systems.create') ? <Link className="btn btn-ghost btn-sm" to={`/ot/conduits?new=1`}>New conduit</Link> : undefined}>
      {rows.length === 0 ? <EmptyState icon="link" title="No conduits" message="Record a conduit for each way data passes between this zone and another." /> : (
        <TableWrap label="Conduits joining this zone to others">
          <table className="table">
            <caption className="sr-only">Conduits joining this zone to others</caption>
            <thead><tr><th scope="col">Conduit</th><th scope="col">Other zone</th><th scope="col">Remote access</th><th scope="col">Target</th><th scope="col">Achieved</th><th scope="col">Flag</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const other = c.from_zone_id === zoneId ? c.to_zone_id : c.from_zone_id;
                return (
                  <tr key={c.id}>
                    <td className="ot-wrap"><Link to={`/ot/conduits/${c.id}`}><span className="ref">{c.ref}</span> {c.name}</Link></td>
                    <td className="ot-wrap"><Link to={`/ot/zones/${other}`}>{names.get(other) ?? 'Zone'}</Link></td>
                    <td>{c.remote_access ? <span className="chip chip-orange">Yes</span> : 'No'}</td>
                    <td>{c.target_level ? <LookupChip list="ot_security_level" value={c.target_level} /> : <span className="muted">—</span>}</td>
                    <td>{c.achieved_level ? <LookupChip list="ot_security_level" value={c.achieved_level} /> : <span className="muted">Not assessed</span>}</td>
                    <td>{c.flagged ? <span className="chip chip-orange" title="Remote access, or a zone below target">Flagged</span> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function ZoneDetail() {
  const { can, areaOn } = useAuth();
  const tabs: RecordTab[] = [
    { key: 'members', label: 'Members', content: ({ row }) => <MembersTab zone={row} /> },
    { key: 'conduits', label: 'Conduits', content: ({ row }) => <ZoneConduits zoneId={String(row.id)} /> },
  ];
  if (controlsInBuild && areaOn('controls') && can('controls.view')) {
    tabs.push({ key: 'controls', label: 'Controls', content: ({ row }) => <OtControls recordType="ot_zone" recordId={String(row.id)} /> });
  }
  if (actionsInBuild && can('actions.view')) {
    tabs.push({ key: 'actions', label: 'Actions', content: ({ row }) => <OtActions sourceType="ot_zone" sourceId={String(row.id)} source="ot" /> });
  }
  return (
    <RecordPage
      type="ot_zone"
      subtitle={(row) => (row.level_assessed_on ? `Level assessed on ${formatDate(row.level_assessed_on)}` : 'Level not assessed yet')}
      status={(row) => (
        <span className="row">
          <ZoneTarget zoneId={String(row.id)} version={String(row.updated_at ?? '')} />
          {row.restricted && <span className="chip chip-red">Restricted</span>}
        </span>
      )}
      summary={(rec) => (
        <div className="ot-summary">
          <EditableSummary type="ot_zone" row={rec.row} onSaved={rec.reload} title="Zone"
            fields={[...DETAILS, ...(can('security.view') ? ['restricted'] : [])]} />
          <EditableSummary type="ot_zone" row={rec.row} fields={LEVELS} onSaved={rec.reload} title="Security levels" />
        </div>
      )}
      tabs={tabs}
    />
  );
}
