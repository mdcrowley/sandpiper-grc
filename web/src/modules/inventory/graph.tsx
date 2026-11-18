// Shared pieces of the relationship map: types, the ECharts graph and its table alternative.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chart, chartColor, EmptyState, TextField } from '../../core';
import type { ChartOption } from '../../core';

export type NodeType = 'system' | 'vendor' | 'site' | 'asset' | 'data_category';
export interface GraphNode { id: string; type: NodeType; label: string; group: string; route: string | null; ref?: string | null }
export interface GraphEdge { from: string; to: string; kind: string; label: string; direction?: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

export const NODE_TYPES: { type: NodeType; label: string; plural: string; color: string }[] = [
  { type: 'system', label: 'System', plural: 'Systems', color: 'blue' },
  { type: 'vendor', label: 'Vendor', plural: 'Vendors', color: 'purple' },
  { type: 'site', label: 'Site', plural: 'Sites', color: 'green' },
  { type: 'data_category', label: 'Data category', plural: 'Data categories', color: 'amber' },
  { type: 'asset', label: 'Asset', plural: 'Assets', color: 'orange' },
];
const typeInfo = (t: NodeType) => NODE_TYPES.find((x) => x.type === t) ?? NODE_TYPES[0];

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Keeps only edges whose two ends are both present. */
export function pruneEdges(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}

export interface GraphViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height?: number;
  layout?: 'force' | 'circular';
  /** Drawn larger with a ring, e.g. the system whose neighbourhood this is. */
  focusId?: string;
  label: string;
}

/** Interactive map: coloured by type, hover highlights neighbours, click opens the record. */
export function GraphView({ nodes, edges, height = 620, layout = 'force', focusId, label }: GraphViewProps) {
  const navigate = useNavigate();
  const option = useMemo<ChartOption>(() => {
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const present = NODE_TYPES.filter((t) => nodes.some((n) => n.type === t.type));
    const taken = new Set<string>();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return {
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: { dataType?: string; data: Record<string, unknown> }) => {
          const d = p.data;
          if (p.dataType === 'edge') {
            return `${esc(byId.get(String(d.source))?.label)} <b>${esc(d.relation)}</b> ${esc(byId.get(String(d.target))?.label)}`;
          }
          const lines = [`<b>${esc(d.fullLabel)}</b>`, esc(d.typeLabel) + (d.group ? ` · ${esc(d.group)}` : '')];
          lines.push(`${d.value} ${d.value === 1 ? 'connection' : 'connections'}`);
          if (d.route) lines.push('Click to open');
          return lines.join('<br>');
        },
      },
      legend: { bottom: 0, data: present.map((t) => t.plural) },
      series: [{
        type: 'graph',
        layout,
        top: 16, bottom: 48, left: 24, right: 24,
        roam: true,
        draggable: layout === 'force',
        categories: present.map((t) => ({ name: t.plural, itemStyle: { color: chartColor(t.color) } })),
        force: { repulsion: nodes.length > 60 ? 170 : 260, edgeLength: [40, 130], gravity: 0.12, friction: 0.25, layoutAnimation: false },
        circular: { rotateLabel: true },
        label: { show: true, position: 'right', fontSize: 11, formatter: (p: { name: string }) => short(p.name.replace(/ \((vendor|site|asset|data)\)$/, '')) },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', label: { show: true, fontWeight: 'bold' }, lineStyle: { width: 3, opacity: 1 } },
        blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.08 }, label: { opacity: 0.2 } },
        edgeSymbolSize: 7,
        data: nodes.map((n) => {
          // ECharts wants unique node names; two records may share a label.
          let name = n.label;
          if (taken.has(name)) name = `${n.label} (${n.type === 'data_category' ? 'data' : n.type})`;
          while (taken.has(name)) name += ' ';
          taken.add(name);
          const d = degree.get(n.id) ?? 0;
          const focus = n.id === focusId;
          return {
            id: n.id, name, fullLabel: n.ref ? `${n.ref} ${n.label}` : n.label,
            category: present.findIndex((t) => t.type === n.type),
            value: d, route: n.route, group: n.group, typeLabel: typeInfo(n.type).label,
            symbolSize: focus ? 34 : n.type === 'system' ? 16 + Math.min(d, 8) * 1.5 : 11,
            itemStyle: focus ? { borderColor: 'var(--text)', borderWidth: 3 } : undefined,
            cursor: n.route ? 'pointer' : 'default',
          };
        }),
        links: edges.map((e) => {
          const integration = e.kind === 'integration';
          return {
            source: e.from, target: e.to, relation: e.label,
            symbol: integration ? [e.direction === 'two_way' ? 'arrow' : 'none', 'arrow'] : ['none', 'none'],
            lineStyle: integration ? { width: 2, opacity: 0.9, curveness: 0.12 } : { width: 1, opacity: 0.45, type: 'dashed' },
          };
        }),
      }],
    };
  }, [nodes, edges, layout, focusId]);

  if (!nodes.length) return <EmptyState icon="link" title="Nothing to show" message="No records match the current filters." />;
  return (
    <div className="inv-graph">
      <Chart
        label={label}
        option={option}
        height={height}
        onSegmentClick={(seg) => {
          const route = (seg.data as { route?: string | null } | null)?.route;
          if (route) navigate(route);
        }}
      />
      <p className="muted inv-graph-hint">
        Solid arrows are integrations and point the way data flows; dashed lines are other relationships. Drag to move,
        scroll to zoom, hover to highlight neighbours, click a node to open it. Click a legend entry to hide that type.
      </p>
    </div>
  );
}

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

  return (
    <div className="stack">
      <div className="inv-narrow">
        <TextField label="Search relationships" type="search" value={q} onChange={setQ} placeholder="System, vendor, site…" />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="link" title="No relationships" message={q ? 'Nothing matches that search.' : 'No relationships have been recorded yet.'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Relationships between systems, vendors, sites, data categories and assets</caption>
            <thead>
              <tr><th scope="col">From</th><th scope="col">Type</th><th scope="col">Relationship</th><th scope="col">To</th><th scope="col">Type</th></tr>
            </thead>
            <tbody>
              {rows.map(({ e, from, to }, i) => (
                <tr key={i}>
                  <td className="row-title">{cell(from)}</td>
                  <td><span className={`chip chip-${typeInfo(from.type).color}`}>{typeInfo(from.type).label}</span></td>
                  <td>{e.kind === 'integration' ? `${e.direction === 'two_way' ? 'exchanges data with' : 'sends data to'} (${e.label})` : e.label}</td>
                  <td>{cell(to)}</td>
                  <td><span className={`chip chip-${typeInfo(to.type).color}`}>{typeInfo(to.type).label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">{rows.length} of {edges.length} relationships</p>
    </div>
  );
}
