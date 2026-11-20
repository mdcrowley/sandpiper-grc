// The drawing surface of the relationship map: an SVG with zoom, pan and keyboard support.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconArrowsMaximize, IconArrowsMinimize, IconDownload, IconFocusCentered, IconMinus, IconPlus } from '@tabler/icons-react';
import { lookupColor, lookupLabel } from '../../core';
import { neighborhood, shortLabel as short, typeInfo } from './mapLayout';
import type { Layout, PlacedNode } from './mapLayout';

export interface MapCanvasProps {
  layout: Layout;
  label: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Records affected if the selected system fails: outlined in red. */
  impacted?: Set<string>;
  /** Center the view on this node; change `n` to ask again for the same node. */
  center?: { id: string; n: number } | null;
  full: boolean;
  onToggleFull: () => void;
  /** Opens the "save as a picture" dialog; no button without it. */
  onSave?: () => void;
  /** Records to point out (for example what a change affects): outlined, with their neighbors kept bright while nothing is selected. */
  marked?: Set<string>;
}

interface View { k: number; x: number; y: number }
const MIN_K = 0.15;
const MAX_K = 2.5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A node's colors as custom properties, from its type's design-token color. The stylesheet's
 * `inv-node-<color>` classes say the same for the original colors; these cover any token color
 * (vehicle groups are gray) without a rule per color.
 */
const nodeVars = (color: string) => ({
  '--node-bg': `var(--c-${color}-bg)`, '--node-fg': `var(--c-${color}-fg)`, '--node-solid': `var(--c-${color}-solid)`,
  '--node-line': `color-mix(in srgb, var(--c-${color}-solid) 45%, transparent)`,
}) as React.CSSProperties;

export function MapCanvas({ layout, label, selectedId, onSelect, impacted, center, full, onToggleFull, onSave, marked }: MapCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const fit = useCallback(() => {
    if (!width || !height) return;
    // 56px on the right is kept clear for the zoom buttons.
    const k = clamp(Math.min((width - 88) / layout.width, (height - 32) / layout.height), MIN_K, 1.15);
    setView({ k, x: Math.max(16, (width - 56 - layout.width * k) / 2), y: Math.max(16, (height - layout.height * k) / 2) });
  }, [width, height, layout.width, layout.height]);
  useEffect(fit, [fit]);

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setView((v) => {
      const k = clamp(v.k * factor, MIN_K, MAX_K);
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  }, []);

  // The wheel listener must be non-passive to stop the page scrolling while the map zooms.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    if (!center || !width || !height) return;
    const n = layout.byId.get(center.id);
    if (!n) return;
    const k = Math.max(viewRef.current.k, 0.9);
    setView({ k, x: width / 2 - (n.x + n.w / 2) * k, y: height / 2 - (n.y + n.h / 2) * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.id, center?.n, width > 0 && height > 0]);

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.px; const dy = ev.clientY - d.py;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setMoving(true);
      setView((v) => ({ ...v, x: d.x + dx, y: d.y + dy }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMoving(false);
      // Cleared after the click that follows, so a drag that ends on a node does not select it.
      setTimeout(() => { drag.current = null; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  const wasDrag = () => !!drag.current?.moved;

  function onKeyDown(e: ReactKeyboardEvent) {
    const pan = 60;
    if (e.key === '+' || e.key === '=') zoomAt(width / 2, height / 2, 1.25);
    else if (e.key === '-') zoomAt(width / 2, height / 2, 0.8);
    else if (e.key === '0') fit();
    else if (e.key === 'ArrowLeft') setView((v) => ({ ...v, x: v.x + pan }));
    else if (e.key === 'ArrowRight') setView((v) => ({ ...v, x: v.x - pan }));
    else if (e.key === 'ArrowUp') setView((v) => ({ ...v, y: v.y + pan }));
    else if (e.key === 'ArrowDown') setView((v) => ({ ...v, y: v.y - pan }));
    else if (e.key === 'Escape' && full) onToggleFull();
    else return;
    e.preventDefault();
  }

  // Zoomed far out, the names of records are too small to read: group and lane headings grow so the shape of the estate still is.
  const headSize = clamp(9.5 / view.k, 12.5, 22);
  const activeId = selectedId ?? hoverId;
  const markedNear = useMemo(() => {
    if (!marked?.size) return null;
    const ids = new Set(marked);
    const edges = new Set<number>();
    for (const e of layout.edges) {
      if (marked.has(e.from) || marked.has(e.to)) { ids.add(e.from); ids.add(e.to); edges.add(e.index); }
    }
    return { ids, edges };
  }, [marked, layout.edges]);
  const near = useMemo(() => (activeId ? neighborhood(activeId, layout.edges) : markedNear), [activeId, layout.edges, markedNear]);
  const hot = impacted && selectedId ? impacted : null;

  const nodeClass = (n: PlacedNode) => {
    const c = ['inv-node', `inv-node-${typeInfo(n.type).color}`];
    if (n.id === selectedId) c.push('is-selected');
    else if (hot?.has(n.id)) c.push('is-impacted');
    else if (marked?.has(n.id)) c.push('is-marked');
    if (near && !near.ids.has(n.id) && !hot?.has(n.id)) c.push('is-dim');
    return c.join(' ');
  };

  return (
    <div
      ref={ref} className={`inv-canvas${moving ? ' is-moving' : ''}`} tabIndex={0} role="group"
      aria-label={`${label} Use the arrow keys to move, plus and minus to zoom, zero to fit. The Table view lists the same relationships.`}
      onKeyDown={onKeyDown}
    >
      <svg
        // A group, not an image: its nodes are buttons, and an image may not hold controls.
        width="100%" height="100%" role="group" aria-label={label}
        onPointerDown={onPointerDown}
        onClick={() => { if (!wasDrag()) onSelect(null); }}
      >
        <defs>
          {['flow', 'near', 'hot'].map((m) => (
            <marker key={m} id={`inv-arrow-${m}`} className={`inv-arrow inv-arrow-${m}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} className={`inv-world${layout.edges.length > 90 ? ' is-dense' : ''}`}>
          {layout.lanes.map((l) => (
            <text key={l.type} x={l.x + (l.type === 'system' ? 0 : 2)} y={l.y + 18} className="inv-lane-label" style={{ fontSize: Math.min(headSize, 16) }}>{l.label}</text>
          ))}
          {layout.groups.map((g) => (
            <g key={g.key} className="inv-group">
              <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={12} />
              <text x={g.x + 12} y={g.y + 21} style={{ fontSize: headSize }}>
                <title>{g.label} ({g.count})</title>
                {short(g.label, Math.max(8, Math.floor((g.w - 34) / (headSize * 0.56))))}
                <tspan className="inv-group-count"> {g.count}</tspan>
              </text>
            </g>
          ))}
          <g fill="none">
            {layout.edges.map((e) => {
              const flow = e.kind === 'integration';
              const isNear = near?.edges.has(e.index);
              // An edge is part of the impact when both its ends are the failing system or something affected.
              const inHot = (id: string) => !!hot && (hot.has(id) || id === selectedId);
              const isHot = inHot(e.from) && inHot(e.to);
              const state = isHot ? 'hot' : isNear ? 'near' : near ? 'dim' : 'rest';
              const marker = flow ? `url(#inv-arrow-${isHot ? 'hot' : isNear ? 'near' : 'flow'})` : undefined;
              const target = layout.byId.get(e.to);
              const color = typeInfo(target?.type ?? 'system').color;
              return (
                <path
                  key={e.index} d={e.path}
                  className={`inv-edge inv-edge-${flow ? 'flow' : color} is-${state}`}
                  // Presentation attributes: any stylesheet rule (the color classes, hot, near) wins over them.
                  {...(flow ? {} : { stroke: 'currentColor', strokeDasharray: '4 4', style: { color: `var(--c-${color}-solid)` } })}
                  markerEnd={marker} markerStart={flow && e.direction === 'two_way' ? marker : undefined}
                />
              );
            })}
          </g>
          {layout.nodes.map((n) => {
            const crit = n.type === 'system' ? n.attrs?.criticality : null;
            return (
              <g
                key={n.id} className={nodeClass(n)} transform={`translate(${n.x} ${n.y})`} style={nodeVars(typeInfo(n.type).color)}
                tabIndex={0} role="button" aria-pressed={n.id === selectedId}
                // The name starts with the label drawn on the node, so speech users can say what they see.
                aria-label={`${n.label} (${typeInfo(n.type).label.toLowerCase()})${hot?.has(n.id) ? ', affected' : marked?.has(n.id) ? ', affected by the change' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (!wasDrag()) onSelect(n.id === selectedId ? null : n.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(n.id === selectedId ? null : n.id); } }}
                onPointerEnter={() => setHoverId(n.id)} onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
              >
                <title>{n.ref ? `${n.ref} ` : ''}{n.label}{crit ? ` · ${lookupLabel('criticality_tier', crit)}` : ''}</title>
                <rect width={n.w} height={n.h} rx={8} />
                <circle cx={13} cy={n.h / 2} r={4} className="inv-node-dot" />
                <text x={24} y={n.h / 2 + 4.5}>{short(n.label, crit ? 24 : 26)}</text>
                {crit && <circle cx={n.w - 12} cy={n.h / 2} r={4.5} className="inv-node-crit" style={{ fill: `var(--c-${lookupColor('criticality_tier', crit) ?? 'gray'}-solid)` }} />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="inv-canvas-tools">
        <ActionIcon.Group orientation="vertical">
          <Tooltip label="Zoom in" position="left"><ActionIcon variant="default" size="lg" aria-label="Zoom in" onClick={() => zoomAt(width / 2, height / 2, 1.3)}><IconPlus size={18} /></ActionIcon></Tooltip>
          <Tooltip label="Zoom out" position="left"><ActionIcon variant="default" size="lg" aria-label="Zoom out" onClick={() => zoomAt(width / 2, height / 2, 1 / 1.3)}><IconMinus size={18} /></ActionIcon></Tooltip>
          <Tooltip label="Fit the whole map" position="left"><ActionIcon variant="default" size="lg" aria-label="Fit the whole map" onClick={fit}><IconFocusCentered size={18} /></ActionIcon></Tooltip>
          <Tooltip label={full ? 'Leave full screen' : 'Full screen'} position="left">
            <ActionIcon variant="default" size="lg" aria-label={full ? 'Leave full screen' : 'Full screen'} onClick={onToggleFull}>
              {full ? <IconArrowsMinimize size={18} /> : <IconArrowsMaximize size={18} />}
            </ActionIcon>
          </Tooltip>
          {onSave && (
            <Tooltip label="Save as a picture" position="left">
              <ActionIcon variant="default" size="lg" aria-label="Save as a picture" onClick={onSave}><IconDownload size={18} /></ActionIcon>
            </Tooltip>
          )}
        </ActionIcon.Group>
      </div>
      <span className="inv-canvas-zoom" aria-hidden="true">{Math.round(view.k * 100)}%</span>
    </div>
  );
}
