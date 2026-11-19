// The dashboard grid: twelve columns of fixed-height rows on CSS grid. In edit mode each widget
// can be moved by dragging its handle and resized from its corner (pointer events, so mouse, pen
// and touch all work), or with the keyboard: arrow keys move the focused widget, Shift with the
// arrows resizes it. Below about 760px the grid shows in reading order (two columns, or one on a
// phone); while editing it keeps its twelve columns down to 480px, so dragging works on a tablet.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Icon, IconButton, cx } from '../../core';
import { GAP, ROW_HEIGHT, clampBox, readingOrder, settle } from './layout';
import { GRID_COLUMNS, type Widget } from './types';

const NARROW = 760;
/** While editing, the real grid (and dragging) is kept down to this width. */
const EDIT_NARROW = 480;
const HEAD = 44;
const PAD = 32;

/** Pixel height of a widget's body for `h` rows. */
export const bodyHeight = (h: number) => h * ROW_HEIGHT + (h - 1) * GAP - HEAD - PAD;

interface Drag { id: string; mode: 'move' | 'resize'; x0: number; y0: number; box: Widget; preview: Widget; pointer: number }

export interface DashboardGridProps {
  widgets: Widget[];
  editing: boolean;
  onChange: (widgets: Widget[]) => void;
  renderBody: (w: Widget, height: number) => ReactNode;
  headerActions?: (w: Widget) => ReactNode;
  onEdit?: (w: Widget) => void;
  onDuplicate?: (w: Widget) => void;
  onRemove?: (w: Widget) => void;
}

export function DashboardGrid({ widgets, editing, onChange, renderBody, headerActions, onEdit, onDuplicate, onRemove }: DashboardGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width < (editing ? EDIT_NARROW : NARROW);
  const colWidth = (width - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

  // While dragging, the others make room live; nothing is committed until the pointer is let go.
  const shown = useMemo(
    () => (drag ? settle(widgets.map((w) => (w.id === drag.id ? drag.preview : w)), drag.id) : widgets),
    [widgets, drag],
  );
  const describe = (w: Widget) => `${w.title || 'Widget'}: column ${w.x + 1}, row ${w.y + 1}, ${w.w} columns wide, ${w.h} rows tall.`;

  function start(e: PointerEvent<HTMLElement>, w: Widget, mode: Drag['mode']) {
    if (!editing || narrow || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: w.id, mode, x0: e.clientX, y0: e.clientY, box: w, preview: w, pointer: e.pointerId });
  }
  function move(e: PointerEvent<HTMLElement>) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = Math.round((e.clientX - drag.x0) / (colWidth + GAP));
    const dy = Math.round((e.clientY - drag.y0) / (ROW_HEIGHT + GAP));
    const b = drag.box;
    const preview = clampBox(drag.mode === 'move' ? { ...b, x: b.x + dx, y: b.y + dy } : { ...b, w: b.w + dx, h: b.h + dy });
    if (preview.x !== drag.preview.x || preview.y !== drag.preview.y || preview.w !== drag.preview.w || preview.h !== drag.preview.h) setDrag({ ...drag, preview });
  }
  function end(e: PointerEvent<HTMLElement>, cancel = false) {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!cancel) {
      const next = settle(widgets.map((w) => (w.id === drag.id ? drag.preview : w)), drag.id);
      onChange(next);
      const moved = next.find((w) => w.id === drag.id);
      if (moved) setAnnounce(describe(moved));
    }
    setDrag(null);
  }

  function onKey(e: KeyboardEvent<HTMLElement>, w: Widget) {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    const box = clampBox(e.shiftKey ? { ...w, w: w.w + d[0], h: w.h + d[1] } : { ...w, x: w.x + d[0], y: w.y + d[1] });
    // Moving up past a widget swaps places with it rather than stopping against it.
    const next = settle(widgets.map((x) => (x.id === w.id ? box : x)), w.id);
    onChange(next);
    const moved = next.find((x) => x.id === w.id);
    if (moved) setAnnounce(describe(moved));
  }

  const ordered = narrow ? readingOrder(shown) : shown;
  return (
    <>
      {editing && narrow && <p className="notice rp-grid-narrow-note">The screen is too narrow to drag widgets. Use the handle with the arrow keys to move them (Shift and the arrow keys to resize), or widen the window.</p>}
      <div ref={ref} className={cx('rp-grid', editing && 'is-editing', narrow && 'is-narrow', drag && 'is-dragging')}
        style={narrow ? undefined : { gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: `${ROW_HEIGHT}px`, gap: `${GAP}px` }}>
        {editing && !narrow && drag && (
          <div className="rp-grid-ghost" aria-hidden="true"
            style={{ gridColumn: `${drag.preview.x + 1} / span ${drag.preview.w}`, gridRow: `${drag.preview.y + 1} / span ${drag.preview.h}` }} />
        )}
        {ordered.map((w) => {
          const h = w.h;
          // Narrow: two columns, small widgets side by side and wide ones across (one column on a phone).
          const style = narrow
            ? { height: w.kind === 'text' ? undefined : h * ROW_HEIGHT + (h - 1) * GAP, minHeight: w.kind === 'text' ? ROW_HEIGHT : undefined, gridColumn: w.w <= 4 && width >= 520 ? 'span 1' : '1 / -1' }
            : { gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${h}` };
          const titleId = `rp-w-${w.id}`;
          return (
            <section key={w.id} className={cx('rp-w', `rp-w-${w.kind}`, drag?.id === w.id && 'is-moving', !w.title && 'rp-w-untitled')} style={style} aria-labelledby={w.title ? titleId : undefined} aria-label={w.title ? undefined : 'Widget'}>
              {(w.title || editing) && (
                <header className="rp-w-head">
                  {editing && (
                    <button type="button" className="rp-w-handle" aria-label={`Move or resize ${w.title || 'this widget'}`}
                      title="Drag to move. With the keyboard: arrow keys move, Shift and arrow keys resize."
                      aria-describedby="rp-grid-help"
                      onPointerDown={(e) => start(e, w, 'move')} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)}
                      onKeyDown={(e) => onKey(e, w)}>
                      <Icon name="menu" size={16} />
                    </button>
                  )}
                  <h2 className="rp-w-title truncate" id={titleId}>{w.title || <span className="muted">Untitled</span>}</h2>
                  <span className="rp-w-actions">
                    {!editing && headerActions?.(w)}
                    {editing && onEdit && <IconButton icon="edit" label={`Change ${w.title || 'widget'}`} variant="ghost" size="sm" onClick={() => onEdit(w)} />}
                    {editing && onDuplicate && <IconButton icon="plus" label={`Duplicate ${w.title || 'widget'}`} variant="ghost" size="sm" onClick={() => onDuplicate(w)} />}
                    {editing && onRemove && <IconButton icon="trash" label={`Remove ${w.title || 'widget'}`} variant="ghost" size="sm" onClick={() => onRemove(w)} />}
                  </span>
                </header>
              )}
              <div className="rp-w-body">{renderBody(w, Math.max(120, bodyHeight(h) + (w.title || editing ? 0 : HEAD)))}</div>
              {editing && !narrow && (
                <span className="rp-w-resize" aria-hidden="true" title="Drag to resize"
                  onPointerDown={(e) => start(e, w, 'resize')} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)} />
              )}
            </section>
          );
        })}
      </div>
      {editing && <p id="rp-grid-help" className="sr-only">Arrow keys move the widget one step. Shift with the arrow keys makes it wider, narrower, taller or shorter.</p>}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </>
  );
}
