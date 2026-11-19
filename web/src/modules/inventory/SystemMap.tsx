// The estate-wide relationship map (/systems/map) and the Map tab on a system record.
import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chip, Group, SegmentedControl, Select as MantineSelect, Text } from '@mantine/core';
import {
  Button, EmptyState, ErrorState, Icon, Loading, lookupColor, lookupLabel, PageHeader, Select, TextField, useFetch, useLookup, useMediaQuery,
} from '../../core';
import { MapCanvas } from './MapCanvas';
import { MapPanel } from './MapPanel';
import { MapPictureDialog } from './MapPicture';
import { computeLayout, NODE_TYPES, pruneEdges, typeInfo } from './mapLayout';
import type { GraphData, GraphEdge, GraphNode, GroupBy, NodeType } from './mapLayout';

const DEFAULT_TYPES: NodeType[] = ['vendor', 'site', 'data_category'];

// "Start the map from a change" (E05-08) comes from the changes module: its hook, its banner and
// the ids to highlight. Found by file name, so the map builds and works without that module.
interface ChangeAffectedLike { systems: { id: string }[]; assets: { id: string }[] }
interface ChangeOnMapModule {
  useChangeAffected: (id: string | null | undefined) => { data: ChangeAffectedLike | null | undefined; error: unknown };
  affectedIds: (a: ChangeAffectedLike | null | undefined) => string[];
  ChangeOnMapBanner: ComponentType<{ affected: ChangeAffectedLike | null | undefined; onClear: () => void }>;
}
const changeOnMap = Object.values(import.meta.glob<ChangeOnMapModule>('../changes/ChangeOnMap.tsx', { eager: true }))[0] ?? null;
const noChange = () => ({ data: null, error: null });
const useChangeAffected = changeOnMap?.useChangeAffected ?? noChange;
const GROUP_BY: { value: GroupBy; label: string; list?: string; none: string }[] = [
  { value: 'group', label: 'Group', none: 'Ungrouped' },
  { value: 'criticality', label: 'Criticality', list: 'criticality_tier', none: 'No criticality recorded' },
  { value: 'hosting', label: 'Hosting', list: 'hosting_type', none: 'No hosting recorded' },
];

/** The same relationships as a searchable table, for keyboard and screen-reader use. */
export function RelationshipTable({ nodes, edges }: GraphData) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return edges
      .map((e) => ({ e, from: byId.get(e.from), to: byId.get(e.to) }))
      .filter((r): r is { e: GraphEdge; from: GraphNode; to: GraphNode } => !!r.from && !!r.to)
      .filter((r) => !needle || `${r.from.label} ${r.to.label} ${r.e.label} ${r.from.group}`.toLowerCase().includes(needle))
      .sort((a, b) => a.from.label.localeCompare(b.from.label) || a.e.kind.localeCompare(b.e.kind) || a.to.label.localeCompare(b.to.label));
  }, [edges, byId, q]);
  const cell = (n: GraphNode) => (n.route ? <Link to={n.route}>{n.label}</Link> : n.label);
  const chip = (n: GraphNode) => <span className={`chip chip-${typeInfo(n.type).color}`}>{typeInfo(n.type).label}</span>;

  return (
    <div className="stack inv-map-table">
      <Group justify="space-between" align="flex-end">
        <div className="inv-narrow">
          <TextField label="Search relationships" type="search" value={q} onChange={setQ} placeholder="System, vendor, site…" />
        </div>
        <Text c="dimmed" size="sm" role="status">{rows.length} of {edges.length} relationships</Text>
      </Group>
      {rows.length === 0 ? (
        <EmptyState icon="link" title="No relationships" message={q ? 'Nothing matches that search.' : 'No relationships have been recorded yet.'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Relationships between systems, vendors, sites, data categories, assets and services</caption>
            <thead>
              <tr><th scope="col">From</th><th scope="col">Type</th><th scope="col">Relationship</th><th scope="col">To</th><th scope="col">Type</th></tr>
            </thead>
            <tbody>
              {rows.map(({ e, from, to }, i) => (
                <tr key={i}>
                  <td className="row-title">{cell(from)}</td>
                  <td>{chip(from)}</td>
                  <td>{e.kind === 'integration' ? `${e.direction === 'two_way' ? 'exchanges data with' : 'sends data to'} (${e.label})` : e.label}</td>
                  <td>{cell(to)}</td>
                  <td>{chip(to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Legend({ criticality, marked }: { criticality: boolean; marked?: boolean }) {
  const tiers = useLookup('criticality_tier');
  return (
    <ul className="inv-legend" aria-label="Legend">
      <li><svg width="34" height="10" aria-hidden="true"><path d="M1 5H26" className="inv-edge inv-edge-flow is-rest" /><path d="M24 1L33 5L24 9z" className="inv-legend-arrow" /></svg> Integration; the arrow shows the way data flows</li>
      <li><svg width="34" height="10" aria-hidden="true"><path d="M1 5H33" className="inv-edge inv-edge-green is-near" /></svg> Other relationship</li>
      <li><span className="inv-legend-hot" aria-hidden="true" /> Affected if the selected system fails</li>
      {marked && <li><span className="inv-legend-marked" aria-hidden="true" /> Affected by the change</li>}
      {criticality && tiers.length > 0 && (
        <li className="inv-legend-tiers">
          Criticality:
          {tiers.map((t) => <span key={t.value}><span className="inv-tier-dot" style={{ background: `var(--c-${t.color ?? 'gray'}-solid)` }} aria-hidden="true" /> {t.label}</span>)}
        </li>
      )}
    </ul>
  );
}

export interface MapExplorerProps {
  data: GraphData;
  label: string;
  /** Heading of a saved picture, for example "Relationship map". */
  title: string;
  /** Selected to start with (the system whose neighborhood this is, or the one asked for in the address). */
  initialId?: string | null;
  /** Extra controls at the start of the toolbar. */
  toolbar?: ReactNode;
  compact?: boolean;
  /** Records to point out, for example what a change affects: outlined, with their neighbors. */
  marked?: string[];
}

/** Toolbar, canvas, side panel, legend and the table alternative. */
export function MapExplorer({ data, label, title, initialId = null, toolbar, compact, marked }: MapExplorerProps) {
  const [types, setTypes] = useState<string[]>(compact ? NODE_TYPES.map((t) => t.type) : DEFAULT_TYPES);
  const [groupBy, setGroupBy] = useState<GroupBy>('group');
  const [group, setGroup] = useState('');
  const [mode, setMode] = useState<'map' | 'table'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [center, setCenter] = useState<{ id: string; n: number } | null>(initialId && !compact ? { id: initialId, n: 0 } : null);
  const [impacted, setImpacted] = useState<Set<string>>(new Set());
  const [full, setFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const markedKey = (marked ?? []).join();
  const markedSet = useMemo(() => (marked?.length ? new Set(marked) : undefined), [markedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Records to point out are drawn even when their type is not shown yet, and the map moves to the first.
  useEffect(() => {
    if (!markedSet) return;
    const needed = data.nodes.filter((n) => markedSet.has(n.id) && n.type !== 'system').map((n) => n.type);
    setTypes((t) => (needed.every((x) => t.includes(x)) ? t : [...new Set([...t, ...needed])]));
    const first = data.nodes.find((n) => markedSet.has(n.id) && n.type === 'system') ?? data.nodes.find((n) => markedSet.has(n.id));
    if (first && !initialId) setCenter((c) => ({ id: first.id, n: (c?.n ?? 0) + 1 }));
  }, [markedSet, data.nodes, initialId]);
  const tiers = useLookup('criticality_tier');
  const hosting = useLookup('hosting_type');
  // The shape the layout aims for: the canvas is wide beside the panel, squarer when the panel drops below it.
  const narrow = useMediaQuery('(max-width: 1100px)');
  const aspect = narrow ? 0.95 : full ? 1.9 : compact ? 1.6 : 1.35;

  const groups = useMemo(
    () => [...new Set(data.nodes.filter((n) => n.type === 'system').map((n) => n.group))].sort(),
    [data],
  );
  const view = useMemo(() => {
    // Filter systems by group, then keep other records only when they touch a remaining system.
    const systems = new Set(data.nodes.filter((n) => n.type === 'system' && (!group || n.group === group)).map((n) => n.id));
    const typed = data.nodes.filter((n) => (n.type === 'system' ? systems.has(n.id) : types.includes(n.type)));
    let edges = pruneEdges(typed, data.edges);
    const touched = new Set<string>();
    for (const e of edges) if (systems.has(e.from) || systems.has(e.to)) { touched.add(e.from); touched.add(e.to); }
    const nodes = typed.filter((n) => n.type === 'system' || touched.has(n.id));
    edges = pruneEdges(nodes, edges);
    return { nodes, edges };
  }, [data, group, types]);

  const layout = useMemo(() => {
    const def = GROUP_BY.find((g) => g.value === groupBy)!;
    const list = groupBy === 'criticality' ? tiers : groupBy === 'hosting' ? hosting : [];
    return computeLayout(view.nodes, view.edges, groupBy, (key) => {
      if (!key || (groupBy === 'group' && key === 'Ungrouped')) return { label: def.none, order: 9999 };
      const at = list.findIndex((v) => v.value === key);
      return { label: def.list ? lookupLabel(def.list, key) : key, order: at < 0 ? 0 : at };
    }, aspect);
  }, [view, groupBy, tiers, hosting, aspect]);

  const selected = view.nodes.find((n) => n.id === selectedId) ?? null;
  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) setCenter((c) => ({ id, n: (c?.n ?? 0) + 1 }));
  };
  // While full screen the page behind must not scroll, and Escape leaves.
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const options = useMemo(() => NODE_TYPES.map((t) => ({
    group: t.plural,
    items: view.nodes.filter((n) => n.type === t.type).sort((a, b) => a.label.localeCompare(b.label))
      .map((n) => ({ value: n.id, label: n.ref ? `${n.label} (${n.ref})` : n.label })),
  })).filter((g) => g.items.length), [view.nodes]);
  const changed = group !== '' || groupBy !== 'group' || types.join() !== (compact ? NODE_TYPES.map((t) => t.type) : DEFAULT_TYPES).join();
  const present = NODE_TYPES.filter((t) => t.type !== 'system' && data.nodes.some((n) => n.type === t.type));

  return (
    <div className={`inv-map${full ? ' inv-map-full' : ''}${compact ? ' inv-map-compact' : ''}`}>
      <div className="inv-map-bar">
        {toolbar}
        <MantineSelect
          className="inv-map-search" aria-label="Find on the map" placeholder="Find a system, vendor, site…" searchable clearable
          leftSection={<Icon name="search" size={16} />} nothingFoundMessage="Nothing on the map matches"
          data={options} value={selectedId && selected ? selectedId : null} maxDropdownHeight={320}
          onChange={(id) => { setMode('map'); select(id); }} comboboxProps={{ withinPortal: !full }}
        />
        <div className="inv-map-field">
          <span className="inv-map-field-label" id="inv-groupby">Arrange systems by</span>
          <SegmentedControl size="xs" aria-labelledby="inv-groupby" value={groupBy} onChange={(v) => setGroupBy(v as GroupBy)}
            data={GROUP_BY.map((g) => ({ value: g.value, label: g.label }))} />
        </div>
        {!compact && groups.length > 1 && (
          <div className="inv-map-group">
            <Select label="Group" hideLabel size="xs" value={group} onChange={setGroup} placeholder="All groups" options={groups.map((g) => ({ value: g, label: g }))} />
          </div>
        )}
        {present.length > 0 && (
          <div className="inv-map-field">
            <span className="inv-map-field-label" id="inv-show">Show</span>
            <Chip.Group multiple value={types} onChange={setTypes}>
              <Group gap={6} role="group" aria-labelledby="inv-show">
                {present.map((t) => (
                  <Chip key={t.type} value={t.type} size="xs" variant="light" color={t.color}>{t.plural}</Chip>
                ))}
              </Group>
            </Chip.Group>
          </div>
        )}
        {changed && <Button variant="ghost" size="sm" onClick={() => { setGroup(''); setGroupBy('group'); setTypes(compact ? NODE_TYPES.map((t) => t.type) : DEFAULT_TYPES); }}>Reset</Button>}
        <SegmentedControl className="inv-map-mode" size="xs" aria-label="Map or table" value={mode} onChange={(v) => setMode(v as 'map' | 'table')}
          data={[{ value: 'map', label: 'Map' }, { value: 'table', label: `Table (${view.edges.length})` }]} />
      </div>

      {mode === 'table' ? <RelationshipTable nodes={view.nodes} edges={view.edges} /> : !view.nodes.length ? (
        <EmptyState icon="link" title="Nothing to show" message="No records match the current filters." />
      ) : (
        <>
          <div className="inv-map-body">
            <MapCanvas layout={layout} label={label} selectedId={selected ? selectedId : null} onSelect={select}
              impacted={impacted} center={center} full={full} onToggleFull={() => setFull((f) => !f)} onSave={() => setSaving(true)} marked={markedSet} />
            <MapPanel data={view} selected={selected} onSelect={select} onImpact={setImpacted} />
          </div>
          <Legend criticality={view.nodes.some((n) => n.attrs?.criticality && lookupColor('criticality_tier', n.attrs.criticality))} marked={!!markedSet} />
          <MapPictureDialog open={saving} onClose={() => setSaving(false)} layout={layout} title={title} impacted={impacted}
            selected={selected ? layout.byId.get(selected.id) ?? null : null}
            details={[groupBy !== 'group' ? `systems arranged by ${GROUP_BY.find((g) => g.value === groupBy)!.label.toLowerCase()}` : null, group ? `group ${group}` : null].filter(Boolean).join(' · ') || undefined} />
        </>
      )}
    </div>
  );
}

export function MapPage() {
  const { data, error, reload } = useFetch<GraphData>('/api/systems/graph');
  const [params, setParams] = useSearchParams();
  const changeId = params.get('change');
  const affected = useChangeAffected(changeId);
  const marked = changeOnMap && affected.data ? changeOnMap.affectedIds(affected.data) : undefined;
  const Banner = changeOnMap?.ChangeOnMapBanner;
  const clearChange = () => setParams((p) => { p.delete('change'); return p; }, { replace: true });
  const header = (
    <PageHeader
      title="Relationship map"
      subtitle="Systems, the integrations between them, and the vendors, sites, data, assets and services around them."
      breadcrumbs={[{ label: 'Systems', to: '/systems' }, { label: 'Relationship map' }]}
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading the relationship map" /></div>;
  if (!data.nodes.length) {
    return (
      <div className="stack">
        {header}
        <EmptyState icon="server" title="No systems yet" message="Add systems and record their integrations, sites and data, and they will appear here."
          action={<Link className="btn btn-primary" to="/systems?new=1">Add a system</Link>} />
      </div>
    );
  }
  const systems = data.nodes.filter((n) => n.type === 'system').length;
  return (
    <div className="stack">
      {header}
      {changeId && Banner && <Banner affected={affected.data} onClear={clearChange} />}
      {changeId && affected.error ? <ErrorState title="The change could not be loaded" error={affected.error} /> : null}
      <MapExplorer data={data} initialId={params.get('focus')} title="Relationship map" marked={marked}
        label={`Relationship map of ${systems} systems and ${data.edges.length} relationships.`} />
    </div>
  );
}

/** Map tab: the system's neighborhood, with what is affected if it fails in the side panel. */
export function SystemMapTab({ systemId, name }: { systemId: string; name: string }) {
  const [depth, setDepth] = useState('1');
  const graph = useFetch<GraphData>(`/api/systems/graph?focus=${systemId}&depth=${depth}`, { keepPrevious: true });
  if (graph.error) return <ErrorState error={graph.error} onRetry={graph.reload} />;
  if (!graph.data) return <Loading lines={6} label="Loading the map" />;
  const reach = (
    <div className="inv-map-group">
      <Select label="How far to look" hideLabel size="xs" value={depth} onChange={(v) => setDepth(v || '1')}
        options={[{ value: '1', label: 'Direct connections' }, { value: '2', label: 'Two steps away' }, { value: '3', label: 'Three steps away' }]} />
    </div>
  );
  if (graph.data.nodes.length <= 1) {
    return (
      <EmptyState icon="link" title="No connections recorded" message="Add integrations, data categories, sites or a vendor to see this system's neighborhood and what is affected if it fails."
        action={<Link className="btn btn-secondary" to="/systems/map">Open the whole map</Link>} />
    );
  }
  return (
    <div className="stack">
      <MapExplorer key={systemId} compact data={graph.data} initialId={systemId} toolbar={reach}
        title={`Connections of ${name}`} label={`Connections of ${name}.`} />
      <Text size="sm" c="dimmed">
        Select {name} on the map to see what is affected if it fails. <Link to={`/systems/map?focus=${systemId}`}>Open the whole map</Link>
      </Text>
    </div>
  );
}
