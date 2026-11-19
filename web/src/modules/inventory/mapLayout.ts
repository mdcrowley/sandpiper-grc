// Relationship map: types and the layout. The layout is worked out from the data alone (no
// simulation), so the same estate always draws the same way: systems sit in labeled boxes in
// the middle, vendors in a lane on the left, sites, data categories, assets and services in lanes on the
// right, each placed level with the systems it belongs to (or, when they are short, stacked in
// one column so the map stays narrow enough to read).

export type NodeType = 'system' | 'vendor' | 'site' | 'asset' | 'data_category' | 'service';
export interface GraphNode {
  id: string; type: NodeType; label: string; group: string; route: string | null; ref?: string | null;
  attrs?: Record<string, string | null>;
}
export interface GraphEdge { from: string; to: string; kind: string; label: string; direction?: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; focus?: string }

export const NODE_TYPES: { type: NodeType; label: string; plural: string; color: string }[] = [
  { type: 'system', label: 'System', plural: 'Systems', color: 'blue' },
  { type: 'vendor', label: 'Vendor', plural: 'Vendors', color: 'purple' },
  { type: 'site', label: 'Site', plural: 'Sites', color: 'green' },
  { type: 'data_category', label: 'Data category', plural: 'Data categories', color: 'amber' },
  { type: 'asset', label: 'Asset', plural: 'Assets', color: 'orange' },
  { type: 'service', label: 'Service', plural: 'Services', color: 'teal' },
];
export const typeInfo = (t: NodeType) => NODE_TYPES.find((x) => x.type === t) ?? NODE_TYPES[0];

/** Keeps only edges whose two ends are both present. */
export function pruneEdges(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.from) && ids.has(e.to));
}

export type GroupBy = 'group' | 'criticality' | 'hosting';
export interface GroupInfo { label: string; order: number }

export interface PlacedNode extends GraphNode { x: number; y: number; w: number; h: number; degree: number }
export interface GroupBox { key: string; label: string; x: number; y: number; w: number; h: number; count: number }
/** A column of one record type; y is the top of its heading (lanes on the right may be stacked). */
export interface Lane { type: NodeType; label: string; x: number; y: number; w: number }
export interface PlacedEdge extends GraphEdge { index: number; path: string }
export interface Layout {
  nodes: PlacedNode[]; byId: Map<string, PlacedNode>; groups: GroupBox[]; lanes: Lane[]; edges: PlacedEdge[];
  width: number; height: number;
}

export const NODE_W = 198;
export const NODE_H = 30;
const GAP_X = 10;
const GAP_Y = 8;
const PAD = 12;
const BOX_HEAD = 30;
const BOX_GAP = 22;
const LANE_HEAD = 34;
const LANE_GAP = 76; // room for the curves between a lane and the systems
const LANE_STACK_GAP = 26;
const STEP = NODE_H + GAP_Y;

/** A smooth curve between the facing sides of two nodes. */
function edgePath(a: PlacedNode, b: PlacedNode): string {
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  if (b.x >= a.x + a.w) {
    const sx = a.x + a.w; const ex = b.x; const d = Math.max(28, (ex - sx) / 2);
    return `M${sx} ${ay}C${sx + d} ${ay} ${ex - d} ${by} ${ex} ${by}`;
  }
  if (b.x + b.w <= a.x) {
    const sx = a.x; const ex = b.x + b.w; const d = Math.max(28, (sx - ex) / 2);
    return `M${sx} ${ay}C${sx - d} ${ay} ${ex + d} ${by} ${ex} ${by}`;
  }
  // Same column: leave and arrive on the right-hand side, bowing out with the distance.
  const sx = a.x + a.w; const ex = b.x + b.w;
  const bow = 22 + Math.min(70, Math.abs(by - ay) * 0.18);
  return `M${sx} ${ay}C${sx + bow} ${ay} ${ex + bow} ${by} ${ex} ${by}`;
}

export function computeLayout(
  nodes: GraphNode[], edges: GraphEdge[], groupBy: GroupBy, groupInfo: (key: string) => GroupInfo,
  /** Width over height of the space the map is drawn in. */
  aspect = 1.4,
): Layout {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const placed: PlacedNode[] = [];
  const byId = new Map<string, PlacedNode>();
  const put = (n: GraphNode, x: number, y: number) => {
    const p: PlacedNode = { ...n, x, y, w: NODE_W, h: NODE_H, degree: degree.get(n.id) ?? 0 };
    placed.push(p);
    byId.set(n.id, p);
  };
  const byLabel = (a: GraphNode, b: GraphNode) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  const of = (t: NodeType) => nodes.filter((n) => n.type === t).sort(byLabel);

  // ----- systems, in boxes -----
  const systems = of('system');
  const keyOf = (n: GraphNode) => (groupBy === 'group' ? n.group : n.attrs?.[groupBy] ?? '') || '';
  const buckets = new Map<string, GraphNode[]>();
  for (const s of systems) {
    const k = keyOf(s);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(s);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    const ia = groupInfo(a); const ib = groupInfo(b);
    return ia.order - ib.order || ia.label.localeCompare(ib.label);
  });
  // `inner`: columns of records inside every box. More than one when a group is so large that a
  // single column would make the map a tall, thin strip (for example arranged by criticality).
  const boxW = (inner: number) => inner * NODE_W + (inner - 1) * GAP_X + PAD * 2;
  const boxH = (count: number, inner: number) => BOX_HEAD + Math.ceil(count / inner) * STEP - GAP_Y + PAD;

  const vendors = of('vendor');
  const laneCols = (count: number, height: number) => Math.max(1, Math.ceil((count * STEP) / Math.max(height, 340)));
  const laneW = (count: number, height: number) => (count ? laneCols(count, height) * (NODE_W + GAP_X) - GAP_X + LANE_GAP : 0);
  /** Boxes go into the shortest column so far, in a fixed order: the same data always packs the same way. */
  const pack = (columns: number, inner: number) => {
    const colHeights = new Array<number>(columns).fill(0);
    const slots: { key: string; col: number; top: number }[] = [];
    for (const k of keys) {
      let col = 0;
      for (let c = 1; c < columns; c++) if (colHeights[c] < colHeights[col] - 0.5) col = c;
      slots.push({ key: k, col, top: colHeights[col] });
      colHeights[col] += boxH(buckets.get(k)!.length, inner) + BOX_GAP;
    }
    return { slots, centerH: Math.max(0, ...colHeights) - (keys.length ? BOX_GAP : 0) };
  };
  // Lanes on the right (sites, data, assets, services) share one column, one under another, when they are
  // short enough to fit beside the systems: the map is then narrower and easier to read.
  const right = (['site', 'data_category', 'asset', 'service'] as NodeType[]).map((t) => ({ t, items: of(t) })).filter((l) => l.items.length);
  const stackedH = (count: number) => LANE_HEAD + count * STEP - GAP_Y;
  const stacks = (height: number) => right.length > 1
    && right.every((l) => laneCols(l.items.length, height) === 1)
    && right.reduce((s, l) => s + stackedH(l.items.length), 0) + (right.length - 1) * LANE_STACK_GAP <= Math.max(height, 340) * 1.2 + LANE_HEAD;
  const rightW = (height: number) => (stacks(height) ? NODE_W + LANE_GAP : right.reduce((s, l) => s + laneW(l.items.length, height), 0));

  // Choose the box columns (and records per box row) whose overall shape is closest to the space
  // the map is drawn in. One record per row is preferred when the shapes are about as good.
  let columns = 1;
  let inner = 1;
  let best = Infinity;
  const largest = Math.max(1, ...[...buckets.values()].map((b) => b.length));
  for (let i = 1; i <= Math.min(4, largest); i++) {
    for (let c = 1; c <= Math.min(8, Math.max(1, keys.length)); c++) {
      const h = pack(c, i).centerH;
      const w = c * (boxW(i) + BOX_GAP) + laneW(vendors.length, h) + rightW(h);
      const off = Math.abs(Math.log(w / Math.max(h + LANE_HEAD, 1) / aspect)) + (i - 1) * 0.12;
      if (off < best - 1e-6) { best = off; columns = c; inner = i; }
    }
  }
  const { slots, centerH } = pack(columns, inner);

  const lanes: Lane[] = [];
  const vendorCols = vendors.length ? laneCols(vendors.length, centerH) : 0;
  const vendorW = vendorCols ? vendorCols * NODE_W + (vendorCols - 1) * GAP_X : 0;
  const centerX = vendorW ? vendorW + LANE_GAP : 0;
  const centerW = columns * boxW(inner) + (columns - 1) * BOX_GAP;

  const groups: GroupBox[] = [];
  for (const slot of slots) {
    const members = buckets.get(slot.key)!;
    const x = centerX + slot.col * (boxW(inner) + BOX_GAP);
    const y = LANE_HEAD + slot.top;
    groups.push({ key: slot.key, label: groupInfo(slot.key).label, x, y, w: boxW(inner), h: boxH(members.length, inner), count: members.length });
    members.forEach((s, i) => put(s, x + PAD + (i % inner) * (NODE_W + GAP_X), y + BOX_HEAD + Math.floor(i / inner) * STEP));
  }
  if (systems.length) lanes.push({ type: 'system', label: 'Systems', x: centerX, y: 0, w: centerW });

  // ----- lanes around the systems -----
  const neighbors = new Map<string, string[]>();
  for (const e of edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!neighbors.has(a)) neighbors.set(a, []);
      neighbors.get(a)!.push(b);
    }
  }
  /** Average height of the already-placed records a node is tied to. */
  const level = (n: GraphNode): number => {
    const ys = (neighbors.get(n.id) ?? []).map((id) => byId.get(id)).filter((p): p is PlacedNode => !!p).map((p) => p.y + p.h / 2);
    return ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : LANE_HEAD + centerH / 2;
  };
  /**
   * One lane. Alone in its column (`packed` false), each record sits level with the records it is
   * tied to; stacked with other lanes, the lane is packed tight in that order instead.
   */
  function placeLane(type: NodeType, items: GraphNode[], x: number, top = 0, packed = false): { right: number; bottom: number } {
    const cols = packed ? 1 : laneCols(items.length, centerH);
    const first = top + LANE_HEAD;
    const sorted = items.map((n) => ({ n, at: level(n) })).sort((a, b) => a.at - b.at || byLabel(a.n, b.n));
    let bottom = first;
    if (packed) {
      sorted.forEach((s, i) => put(s.n, x, first + i * STEP));
    } else if (cols === 1) {
      const ys: number[] = [];
      let y = first;
      for (const s of sorted) { y = Math.max(y, s.at - NODE_H / 2); ys.push(y); y += STEP; }
      let limit = first + Math.max(centerH, sorted.length * STEP - GAP_Y) - NODE_H;
      for (let i = ys.length - 1; i >= 0; i--) { if (ys[i] > limit) ys[i] = limit; limit = ys[i] - STEP; }
      sorted.forEach((s, i) => put(s.n, x, Math.max(first, ys[i])));
    } else {
      const per = Math.ceil(sorted.length / cols);
      sorted.forEach((s, i) => put(s.n, x + Math.floor(i / per) * (NODE_W + GAP_X), first + (i % per) * STEP));
    }
    for (const s of sorted) bottom = Math.max(bottom, byId.get(s.n.id)!.y + NODE_H);
    const w = cols * NODE_W + (cols - 1) * GAP_X;
    lanes.push({ type, label: typeInfo(type).plural, x, y: top, w });
    return { right: x + w, bottom };
  }
  if (vendors.length) placeLane('vendor', vendors, 0);
  let x = centerX + (systems.length ? centerW : 0);
  if (stacks(centerH)) {
    x += LANE_GAP;
    let top = 0;
    for (const l of right) top = placeLane(l.t, l.items, x, top, true).bottom + LANE_STACK_GAP;
  } else {
    for (const l of right) x = placeLane(l.t, l.items, x + (x > 0 ? LANE_GAP : 0)).right;
  }

  const placedEdges: PlacedEdge[] = [];
  edges.forEach((e, index) => {
    const a = byId.get(e.from); const b = byId.get(e.to);
    if (a && b) placedEdges.push({ ...e, index, path: edgePath(a, b) });
  });
  const width = Math.max(NODE_W, ...placed.map((p) => p.x + p.w), ...groups.map((g) => g.x + g.w)) + 40; // room for same-column bows
  const height = Math.max(LANE_HEAD + NODE_H, ...placed.map((p) => p.y + p.h), ...groups.map((g) => g.y + g.h)) + 8;
  return { nodes: placed, byId, groups, lanes, edges: placedEdges, width, height };
}

/** Everything one step from `id`, with the edges that tie them. */
export function neighborhood(id: string, edges: GraphEdge[]): { ids: Set<string>; edges: Set<number> } {
  const ids = new Set<string>([id]);
  const hit = new Set<number>();
  edges.forEach((e, i) => {
    if (e.from === id) { ids.add(e.to); hit.add(i); }
    if (e.to === id) { ids.add(e.from); hit.add(i); }
  });
  return { ids, edges: hit };
}

/**
 * Shortens a label to n characters, at a word boundary where one is near, so the words drawn on a
 * node are whole words of its accessible name (speech users say what they see).
 */
export function shortLabel(s: string, n = 22): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(' ');
  return `${space >= n / 2 ? cut.slice(0, space) : cut}…`;
}
