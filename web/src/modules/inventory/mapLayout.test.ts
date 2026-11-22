import { describe, expect, it } from 'vitest';
import { PALETTE_COLORS, renderMapSvg } from './mapExport';
import type { Palette } from './mapExport';
import { computeLayout, neighborhood, NODE_H, NODE_W, NODE_TYPES, pruneEdges, shortLabel } from './mapLayout';
import type { GraphEdge, GraphNode, GroupBy, Layout, NodeType } from './mapLayout';

// An invented estate: systems in a few groups, with vendors, sites, data, assets, services and
// vehicle groups (one node per depot and mode).
interface Extra { vendors: number; sites: number; data: number; assets: number; services: number; vehicles?: number }
function estate(systems: number, groups: string[], extra: Extra = { vendors: 6, sites: 4, data: 5, assets: 8, services: 6, vehicles: 3 }) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const add = (type: NodeType, i: number, group: string, attrs?: Record<string, string>) => {
    const id = `${type}-${String(i).padStart(3, '0')}`;
    nodes.push({ id, type, label: `${type} ${i}`, group, route: null, attrs });
    return id;
  };
  const sys = Array.from({ length: systems }, (_, i) => add('system', i, groups[i % groups.length], {
    criticality: ['tier_1', 'tier_2', 'tier_3'][i % 3], hosting: i % 2 ? 'cloud' : 'on_premises',
  }));
  sys.forEach((id, i) => { if (i > 0) edges.push({ from: sys[i - 1], to: id, kind: 'integration', label: 'API', direction: i % 4 ? 'one_way' : 'two_way' }); });
  const around: [NodeType, number, string, string][] = [
    ['vendor', extra.vendors, 'vendor', 'supplied by'], ['site', extra.sites, 'site', 'serves'], ['data_category', extra.data, 'data', 'holds'],
    ['asset', extra.assets, 'asset', 'runs on'], ['service', extra.services, 'service', 'needed for CAD/AVL'],
    ['vehicle', extra.vehicles ?? 0, 'vehicle', 'equipment on 12 of 40'],
  ];
  for (const [type, count, kind, label] of around) {
    for (let i = 0; i < count; i++) {
      const id = add(type, i, type);
      edges.push({ from: sys[(i * 7) % sys.length], to: id, kind, label });
      edges.push({ from: sys[(i * 3 + 1) % sys.length], to: id, kind, label });
    }
  }
  return { nodes, edges };
}

const groupInfo = (key: string) => ({ label: key || 'Ungrouped', order: key ? 0 : 9999 });

function layoutOf(data: { nodes: GraphNode[]; edges: GraphEdge[] }, groupBy: GroupBy = 'group', aspect = 1.4): Layout {
  return computeLayout(data.nodes, data.edges, groupBy, groupInfo, aspect);
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectNoOverlap(layout: Layout) {
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i]; const b = layout.nodes[j];
      if (overlaps(a, b)) throw new Error(`${a.id} overlaps ${b.id}`);
    }
  }
  for (let i = 0; i < layout.groups.length; i++) {
    for (let j = i + 1; j < layout.groups.length; j++) expect(overlaps(layout.groups[i], layout.groups[j])).toBe(false);
  }
}

describe('relationship map layout', () => {
  it('draws a box per OT security zone when arranged by zone (E33-04), with unzoned systems in their own box', () => {
    const data = estate(9, ['Operations'], { vendors: 0, sites: 0, data: 0, assets: 0, services: 0 });
    data.nodes.filter((n) => n.type === 'system').forEach((n, i) => { n.attrs = { ...n.attrs, ...(i % 3 === 2 ? {} : { ot: 'true', zone: i % 3 ? 'zone-b' : 'zone-a' }) }; });
    const names: Record<string, string> = { 'zone-a': 'Train control zone', 'zone-b': 'Station systems zone' };
    const layout = computeLayout(data.nodes, data.edges, 'zone', (key) => (key ? { label: names[key], order: 0 } : { label: 'No security zone', order: 9999 }));
    expect(layout.groups.map((g) => [g.label, g.count])).toEqual([['Station systems zone', 3], ['Train control zone', 3], ['No security zone', 3]]);
    expectNoOverlap(layout);
  });

  it('places every node once, inside the drawing', () => {
    const data = estate(24, ['Operations', 'Finance', 'Customer', 'Corporate']);
    const layout = layoutOf(data);
    expect(layout.nodes).toHaveLength(data.nodes.length);
    expect(new Set(layout.nodes.map((n) => n.id)).size).toBe(data.nodes.length);
    for (const n of layout.nodes) {
      expect(n.w).toBe(NODE_W);
      expect(n.h).toBe(NODE_H);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.h).toBeLessThanOrEqual(layout.height);
    }
    expect(layout.edges).toHaveLength(data.edges.length);
    for (const e of layout.edges) expect(e.path).toMatch(/^M[\d.-]+ [\d.-]+C/);
  });

  it('lays out the same data the same way, whatever order it arrives in', () => {
    const data = estate(30, ['A', 'B', 'C']);
    const first = layoutOf(data);
    const shuffled = { nodes: [...data.nodes].reverse(), edges: [...data.edges] };
    const second = layoutOf(shuffled);
    const at = (l: Layout) => Object.fromEntries(l.nodes.map((n) => [n.id, [n.x, n.y]]));
    expect(at(second)).toEqual(at(first));
    expect(second.groups.map((g) => [g.key, g.x, g.y, g.w, g.h])).toEqual(first.groups.map((g) => [g.key, g.x, g.y, g.w, g.h]));
    expect([second.width, second.height]).toEqual([first.width, first.height]);
    // And again, from scratch: nothing depends on earlier calls.
    expect(at(layoutOf(data))).toEqual(at(first));
  });

  it('never overlaps records or group boxes, for small and large estates and every arrangement', () => {
    for (const [systems, groups] of [[1, ['Only']], [7, ['A', 'B']], [40, ['A', 'B', 'C', 'D', 'E', 'F']], [120, ['A', 'B', 'C']]] as const) {
      for (const groupBy of ['group', 'criticality', 'hosting'] as GroupBy[]) {
        for (const aspect of [0.95, 1.4, 1.9]) expectNoOverlap(layoutOf(estate(systems, [...groups]), groupBy, aspect));
      }
    }
  });

  it('keeps each system inside its group box, and the box count right', () => {
    const data = estate(18, ['North', 'South', 'East']);
    const layout = layoutOf(data);
    expect(layout.groups.map((g) => g.label).sort()).toEqual(['East', 'North', 'South']);
    for (const g of layout.groups) {
      const members = layout.nodes.filter((n) => n.type === 'system' && n.group === g.key);
      expect(members).toHaveLength(g.count);
      for (const m of members) {
        expect(m.x).toBeGreaterThanOrEqual(g.x);
        expect(m.y).toBeGreaterThanOrEqual(g.y);
        expect(m.x + m.w).toBeLessThanOrEqual(g.x + g.w);
        expect(m.y + m.h).toBeLessThanOrEqual(g.y + g.h);
      }
    }
  });

  it('wraps a large group into several columns instead of one tall strip', () => {
    const layout = layoutOf(estate(80, ['Everything']), 'group', 1.4);
    const box = layout.groups[0];
    expect(box.count).toBe(80);
    expect(box.w).toBeGreaterThan(NODE_W * 2);
    expect(new Set(layout.nodes.filter((n) => n.type === 'system').map((n) => n.x)).size).toBeGreaterThan(1);
    // Roughly the shape asked for, not a strip many times taller than wide.
    expect(layout.height / layout.width).toBeLessThan(3);
  });

  it('wraps a long lane into several columns', () => {
    const layout = layoutOf(estate(6, ['A'], { vendors: 0, sites: 0, data: 0, assets: 90, services: 0 }));
    const assets = layout.nodes.filter((n) => n.type === 'asset');
    expect(new Set(assets.map((n) => n.x)).size).toBeGreaterThan(1);
    expectNoOverlap(layout);
  });

  it('puts vendors on the left and the other lanes, services included, on the right', () => {
    const layout = layoutOf(estate(12, ['A', 'B']));
    const systemsLeft = Math.min(...layout.nodes.filter((n) => n.type === 'system').map((n) => n.x));
    const systemsRight = Math.max(...layout.nodes.filter((n) => n.type === 'system').map((n) => n.x + n.w));
    for (const n of layout.nodes) {
      if (n.type === 'vendor') expect(n.x + n.w).toBeLessThanOrEqual(systemsLeft);
      if (['site', 'data_category', 'asset', 'service', 'vehicle'].includes(n.type)) expect(n.x).toBeGreaterThanOrEqual(systemsRight);
    }
    expect(layout.lanes.map((l) => l.type)).toEqual(expect.arrayContaining(['system', 'vendor', 'site', 'data_category', 'asset', 'service', 'vehicle']));
    expect(layout.lanes.find((l) => l.type === 'service')?.label).toBe('Services');
    expect(layout.lanes.find((l) => l.type === 'vehicle')?.label).toBe('Vehicles');
  });

  it('draws vehicle groups in their own lane, beside the systems whose equipment they carry, and in the picture', () => {
    // A large fleet arrives as a few groups (depot and mode), so the lane stays short.
    const data = estate(10, ['A', 'B'], { vendors: 0, sites: 2, data: 0, assets: 0, services: 0, vehicles: 4 });
    data.edges.push({ from: 'vehicle-000', to: 'site-000', kind: 'depot', label: 'based at' });
    const layout = layoutOf(data);
    expectNoOverlap(layout);
    const vehicles = layout.nodes.filter((n) => n.type === 'vehicle');
    expect(vehicles).toHaveLength(4);
    const lane = layout.lanes.find((l) => l.type === 'vehicle')!;
    for (const v of vehicles) {
      expect(v.x).toBeGreaterThanOrEqual(lane.x);
      expect(v.y).toBeGreaterThan(lane.y);
    }
    expect(layout.edges.filter((e) => e.kind === 'vehicle')).toHaveLength(8);
    expect(layout.edges.some((e) => e.kind === 'depot')).toBe(true);
    expect(NODE_TYPES.find((t) => t.type === 'vehicle')).toMatchObject({ plural: 'Vehicles', color: 'gray' });

    const palette: Palette = {
      bg: '#ffffff', grid: false, surface: '#ffffff', border: '#dddddd', borderControl: '#bbbbbb', text: '#111111', textMuted: '#555555', font: 'sans-serif',
      colors: Object.fromEntries(PALETTE_COLORS.map((c, i) => [c, { bg: `#e0000${i}`, fg: `#20000${i}`, solid: `#90000${i}` }])) as Palette['colors'],
    };
    const { svg } = renderMapSvg(layout, { palette, title: 'Relationship map' });
    expect(svg).toContain('>VEHICLES</text>');
    expect(svg).toContain('vehicle 0');
    // The legend names them, in the palette's gray (its first color).
    expect(svg).toMatch(/fill="#e00000" stroke="#900000"\/><text[^>]*>Vehicles<\/text>/);
    expect(svg).not.toContain('var(--');
  });

  it('draws an empty map without failing', () => {
    const layout = layoutOf({ nodes: [], edges: [] });
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe('map helpers', () => {
  it('drops edges with a missing end', () => {
    const nodes = estate(3, ['A'], { vendors: 0, sites: 0, data: 0, assets: 0, services: 0 }).nodes;
    const edges: GraphEdge[] = [
      { from: 'system-000', to: 'system-001', kind: 'integration', label: 'API' },
      { from: 'system-000', to: 'gone', kind: 'site', label: 'serves' },
    ];
    expect(pruneEdges(nodes, edges)).toEqual([edges[0]]);
  });

  it('finds the records one step away', () => {
    const edges: GraphEdge[] = [
      { from: 'a', to: 'b', kind: 'integration', label: '' }, { from: 'c', to: 'a', kind: 'site', label: '' }, { from: 'b', to: 'd', kind: 'data', label: '' },
    ];
    const near = neighborhood('a', edges);
    expect([...near.ids].sort()).toEqual(['a', 'b', 'c']);
    expect([...near.edges].sort()).toEqual([0, 1]);
  });

  it('shortens labels at a word boundary', () => {
    expect(shortLabel('Short name')).toBe('Short name');
    expect(shortLabel('Computer-aided dispatch and vehicle location', 22)).toBe('Computer-aided…');
    expect(shortLabel('Averyveryverylongsinglewordname', 12)).toBe('Averyveryve…');
  });
});
