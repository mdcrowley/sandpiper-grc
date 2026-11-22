// The OT security overview (E33-05): OT systems by control level, zones below target, conduits with
// remote access and systems that cannot be patched. The figures count every record and are the same
// for everyone; the lists below them show only the zones and conduits the person may see.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, Chart, chartColor, EmptyState, ErrorState, Loading, LookupChip, PageHeader, Stat, useAuth, useFetch,
} from '../../core';
import type { ChartOption, ColorName } from '../../core';
import { OtTabs, TargetChip } from './shared';
import type { Matrix } from './Zones';

interface Summary {
  ot_systems: number; ot_assets: number; safety_related: number; zones: number; zones_below_target: number;
  conduits: number; conduits_with_remote_access: number; conduits_flagged: number; unpatchable: number;
  always_connected: number; without_zone: number;
  by_control_level: { value: string; label: string; color: string; count: number }[];
}

export function OtOverview() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const summary = useFetch<Summary>('/api/ot/summary');
  const matrix = useFetch<Matrix>('/api/ot/matrix');
  const s = summary.data;

  const byLevel = useMemo<ChartOption>(() => {
    const levels = s?.by_control_level ?? [];
    return {
      tooltip: { trigger: 'item' },
      grid: { top: 24, right: 16, bottom: 56, left: 40 },
      xAxis: { type: 'category', data: levels.map((l) => l.label), axisLabel: { interval: 0, width: 90, overflow: 'break' } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        name: 'OT systems', type: 'bar', barMaxWidth: 40, label: { show: true, position: 'top', color: 'var(--text-muted)' },
        data: levels.map((l) => ({ value: l.count, key: l.value, name: l.label, itemStyle: { color: chartColor(l.color as ColorName) } })),
      }],
    };
  }, [s]);

  const header = (
    <>
      <PageHeader title="OT security" subtitle="Operational technology on the inventory: control levels, security zones against their targets, conduits that allow remote access and systems that cannot be patched."
        actions={<>
          <Button icon="refresh" loading={summary.loading && !!s} onClick={() => { summary.reload(); matrix.reload(); }}>Refresh</Button>
          {can('systems.create') && <Link className="btn btn-primary" to="/ot/zones?new=1">New zone</Link>}
        </>} />
      <OtTabs active="overview" />
    </>
  );
  if (summary.error && !s) return <div className="stack">{header}<ErrorState title="The overview could not be loaded" error={summary.error} onRetry={summary.reload} /></div>;
  if (!s) return <div className="stack">{header}<Loading lines={10} label="Loading the OT overview" /></div>;

  const m = matrix.data;
  const names = new Map((m?.zones ?? []).map((z) => [z.id, z.name]));
  const below = (m?.zones ?? []).filter((z) => z.below_target);
  const flagged = (m?.conduits ?? []).filter((c) => c.flagged);

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="OT systems" value={s.ot_systems} icon="server" hint={`${s.safety_related} life-critical · ${s.ot_assets} OT asset${s.ot_assets === 1 ? '' : 's'}`} to="/systems?f.ot_system=true" />
        <Stat label="Zones below target" value={s.zones_below_target} icon="lock" color={s.zones_below_target ? 'orange' : undefined}
          hint={`of ${s.zones} zone${s.zones === 1 ? '' : 's'}; not assessed counts as below`} to="/ot/zones" />
        <Stat label="Conduits with remote access" value={s.conduits_with_remote_access} icon="link" color={s.conduits_with_remote_access ? 'amber' : undefined}
          hint={`${s.conduits_flagged} of ${s.conduits} conduit${s.conduits === 1 ? '' : 's'} flagged`} to="/ot/conduits?f.remote_access=true" />
        <Stat label="Cannot be patched" value={s.unpatchable} icon="alert-circle" color={s.unpatchable ? 'red' : undefined}
          hint={`${s.always_connected} always connected for the supplier`} to="/systems?f.patchability=cannot_patch" />
        <Stat label="OT systems with no zone" value={s.without_zone} icon="help" to="/systems?f.ot_system=true&f.zone_id.null=true" />
      </div>

      <div className="ot-grid">
        <Card title="OT systems by control level">
          <Chart label="OT systems in use by their control level" option={byLevel} height={260} empty={s.ot_systems === 0}
            emptyMessage="No system is marked as operational technology yet"
            onSegmentClick={(seg) => { const v = (seg.data as { key: string }).key; navigate(v ? `/systems?f.ot_system=true&f.control_level=${v}` : '/systems?f.ot_system=true&f.control_level.null=true'); }} />
        </Card>
        <Card title="Zones below target" actions={<Link className="btn btn-ghost btn-sm" to="/ot/zones">All zones</Link>} flush>
          {matrix.error ? <ErrorState error={matrix.error} onRetry={matrix.reload} />
            : !m ? <div className="ot-pad"><Loading lines={3} label="Loading the zones" /></div>
            : below.length === 0 ? <EmptyState icon="lock" title="Every zone you can see is at target" message="A zone is below target when its achieved level is lower than its target, or it has not been assessed." />
            : (
              <ul className="ot-list">
                {below.map((z) => (
                  <li key={z.id}>
                    <Link to={`/ot/zones/${z.id}`}><span className="ref">{z.ref}</span> {z.name}</Link>
                    <span className="row">
                      {z.achieved_level ? <LookupChip list="ot_security_level" value={z.achieved_level} /> : null}
                      <TargetChip below assessed={!!z.achieved_level} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>

      <Card title="Flagged conduits" actions={<Link className="btn btn-ghost btn-sm" to="/ot/conduits">All conduits</Link>} flush>
        {!m ? (matrix.error ? null : <div className="ot-pad"><Loading lines={3} label="Loading the conduits" /></div>)
          : flagged.length === 0 ? <EmptyState icon="link" title="No conduit is flagged" message="A conduit is flagged when it allows remote access or touches a zone below target." />
          : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Conduits that allow remote access or touch a zone below target</caption>
                <thead><tr><th scope="col">Conduit</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Why</th></tr></thead>
                <tbody>
                  {flagged.map((c) => {
                    const why = [c.remote_access && 'Remote access',
                      (m.zones.find((z) => z.id === c.from_zone_id)?.below_target || m.zones.find((z) => z.id === c.to_zone_id)?.below_target) && 'Zone below target']
                      .filter(Boolean).join(', ') || 'Zone below target';
                    return (
                      <tr key={c.id}>
                        <td className="ot-wrap"><Link to={`/ot/conduits/${c.id}`}><span className="ref">{c.ref}</span> {c.name}</Link></td>
                        <td className="ot-wrap">{names.get(c.from_zone_id) ?? '—'}</td>
                        <td className="ot-wrap">{names.get(c.to_zone_id) ?? '—'}</td>
                        <td>{why}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}
