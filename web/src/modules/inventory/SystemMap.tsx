// The estate-wide relationship map (/systems/map) and the Map tab on a system record.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, Loading, MultiSelect, PageHeader, Select, Stat, Tabs, useFetch,
} from '../../core';
import { GraphView, NODE_TYPES, pruneEdges, RelationshipTable } from './graph';
import type { GraphData, NodeType } from './graph';

export function MapPage() {
  const { data, error, reload } = useFetch<GraphData>('/api/systems/graph');
  const [group, setGroup] = useState('');
  const [types, setTypes] = useState<string[]>(['vendor', 'site', 'data_category']);
  const [layout, setLayout] = useState<'force' | 'circular'>('force');

  const groups = useMemo(
    () => [...new Set((data?.nodes ?? []).filter((n) => n.type === 'system').map((n) => n.group))].sort(),
    [data],
  );
  const view = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
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

  const count = (t: NodeType) => view.nodes.filter((n) => n.type === t).length;
  const header = (
    <PageHeader
      title="Relationship map"
      subtitle="Systems, the integrations between them, and the vendors, sites, data and assets around them."
      breadcrumbs={[{ label: 'Systems', to: '/systems' }, { label: 'Relationship map' }]}
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading the relationship map" /></div>;
  if (!data.nodes.length) {
    return (
      <div className="stack">
        {header}
        <EmptyState icon="server" title="No systems yet" message="Add systems, or load the seed data, and they will appear here."
          action={<Link className="btn btn-primary" to="/systems?new=1">Add a system</Link>} />
      </div>
    );
  }

  return (
    <div className="stack">
      {header}
      <div className="grid-stats">
        <Stat label="Systems shown" value={count('system')} color="blue" />
        <Stat label="Integrations" value={view.edges.filter((e) => e.kind === 'integration').length} />
        <Stat label="Vendors" value={count('vendor')} color="purple" />
        <Stat label="Sites" value={count('site')} color="green" />
        <Stat label="Data categories" value={count('data_category')} color="amber" />
      </div>
      <Card>
        <div className="row inv-filters">
          <Select label="Group" value={group} onChange={setGroup} placeholder="All groups"
            options={groups.map((g) => ({ value: g, label: g }))} />
          <MultiSelect label="Show around systems" value={types} onChange={setTypes}
            options={NODE_TYPES.filter((t) => t.type !== 'system').map((t) => ({ value: t.type, label: t.plural }))} />
          <Select label="Layout" value={layout} onChange={(v) => setLayout(v === 'circular' ? 'circular' : 'force')}
            options={[{ value: 'force', label: 'Clustered' }, { value: 'circular', label: 'Circle' }]} />
          {(group || types.length !== 3) && (
            <Button variant="ghost" size="sm" onClick={() => { setGroup(''); setTypes(['vendor', 'site', 'data_category']); }}>
              Reset filters
            </Button>
          )}
        </div>
      </Card>
      <Tabs
        label="Map or table"
        tabs={[
          {
            key: 'map', label: 'Map',
            content: (
              <Card>
                <GraphView nodes={view.nodes} edges={view.edges} layout={layout} height={680}
                  label={`Relationship map of ${count('system')} systems and ${view.edges.length} relationships. The Table tab lists the same relationships.`} />
              </Card>
            ),
          },
          { key: 'table', label: 'Table', count: view.edges.length, content: <RelationshipTable nodes={view.nodes} edges={view.edges} /> },
        ]}
      />
    </div>
  );
}

interface ImpactItem {
  id: string; label: string; ref?: string | null; route: string; depth?: number; method?: string | null;
  criticality_label?: string | null; sensitivity_label?: string | null;
  via: { id: string; label: string; direct?: boolean };
}
interface Impact {
  system: { id: string; label: string };
  downstream: ImpactItem[]; sites: ImpactItem[]; data_categories: ImpactItem[]; assets: ImpactItem[];
  counts: { systems: number; sites: number; data_categories: number; assets: number };
}

function ImpactList({ title, items, empty, detail }: { title: string; items: ImpactItem[]; empty: string; detail: (i: ImpactItem) => string }) {
  return (
    <section>
      <h3 className="inv-subhead">{title} <span className="muted">({items.length})</span></h3>
      {items.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="inv-impact">
          {items.map((i) => (
            <li key={`${i.id}-${i.via.id}`}>
              <Link to={i.route}>{i.ref ? `${i.ref} ` : ''}{i.label}</Link>
              <span className="muted"> {detail(i)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Map tab: the system's neighbourhood and what is affected if it fails. */
export function SystemMapTab({ systemId, name }: { systemId: string; name: string }) {
  const [depth, setDepth] = useState('1');
  const graph = useFetch<GraphData>(`/api/systems/graph?focus=${systemId}&depth=${depth}`);
  const impact = useFetch<Impact>(`/api/systems/${systemId}/impact`);
  const via = (i: ImpactItem) => (i.via.direct || i.via.id === systemId ? 'directly' : `through ${i.via.label}`);

  return (
    <div className="stack">
      <Card title="Neighbourhood" actions={<Link className="btn btn-secondary btn-sm" to="/systems/map">Whole estate</Link>}>
        <div className="inv-narrow">
          <Select label="Show" value={depth} onChange={(v) => setDepth(v || '1')}
            options={[{ value: '1', label: 'Direct connections' }, { value: '2', label: 'Two steps away' }, { value: '3', label: 'Three steps away' }]} />
        </div>
        {graph.error ? <ErrorState error={graph.error} onRetry={graph.reload} />
          : !graph.data ? <Loading lines={6} label="Loading the map" />
          : graph.data.nodes.length <= 1 ? (
            <EmptyState icon="link" title="No connections recorded" message="Add integrations, data categories, sites or a vendor to see this system's neighbourhood." />
          ) : (
            <Tabs label="Map or table" tabs={[
              { key: 'map', label: 'Map', content: <GraphView nodes={graph.data.nodes} edges={graph.data.edges} focusId={systemId} height={440} label={`Connections of ${name}. The Table tab lists the same relationships.`} /> },
              { key: 'table', label: 'Table', count: graph.data.edges.length, content: <RelationshipTable nodes={graph.data.nodes} edges={graph.data.edges} /> },
            ]} />
          )}
      </Card>

      <Card title={`What is affected if ${name} fails`}>
        {impact.error ? <ErrorState error={impact.error} onRetry={impact.reload} />
          : !impact.data ? <Loading lines={5} label="Working out the impact" />
          : (
            <div className="stack">
              <div className="grid-stats">
                <Stat label="Downstream systems" value={impact.data.counts.systems} color={impact.data.counts.systems ? 'red' : 'gray'} />
                <Stat label="Sites" value={impact.data.counts.sites} />
                <Stat label="Data categories" value={impact.data.counts.data_categories} />
                <Stat label="Assets" value={impact.data.counts.assets} />
              </div>
              <p className="muted">
                Downstream systems are those that receive data from this one, directly or through another system. Sites, data
                and assets are those of this system and of every downstream system.
              </p>
              <div className="grid-2">
                <ImpactList title="Downstream systems" items={impact.data.downstream} empty="No other system depends on data from this one."
                  detail={(i) => `${i.depth === 1 ? 'fed directly' : `fed through ${i.via.label}`}${i.method ? ` by ${i.method.toLowerCase()}` : ''}${i.criticality_label ? ` · ${i.criticality_label}` : ''}`} />
                <ImpactList title="Sites" items={impact.data.sites} empty="No sites are recorded as served." detail={via} />
                <ImpactList title="Data categories" items={impact.data.data_categories} empty="No data categories are recorded as held."
                  detail={(i) => `${via(i)}${i.sensitivity_label ? ` · ${i.sensitivity_label}` : ''}`} />
                <ImpactList title="Assets" items={impact.data.assets} empty="No assets are linked." detail={via} />
              </div>
            </div>
          )}
      </Card>
    </div>
  );
}
