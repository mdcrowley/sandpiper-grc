// Grid arithmetic for dashboards: twelve columns, fixed-height rows. Widgets never overlap: when
// one is moved or resized, anything it lands on is pushed down, then everything settles upwards.
import { GRID_COLUMNS, type Widget } from './types';

export const ROW_HEIGHT = 64;
export const GAP = 16;

type Box = Pick<Widget, 'id' | 'x' | 'y' | 'w' | 'h'>;
const overlap = (a: Box, b: Box) => a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function clampBox<T extends Box>(w: T): T {
  const width = Math.min(GRID_COLUMNS, Math.max(2, Math.round(w.w)));
  return { ...w, w: width, h: Math.min(12, Math.max(1, Math.round(w.h))), x: Math.min(GRID_COLUMNS - width, Math.max(0, Math.round(w.x))), y: Math.max(0, Math.round(w.y)) };
}

/** Places `moved` where asked and resolves every collision; other widgets keep their order. */
export function settle(widgets: Widget[], movedId?: string): Widget[] {
  const boxes = widgets.map(clampBox);
  const placed: Widget[] = [];
  const moved = boxes.find((w) => w.id === movedId);
  if (moved) placed.push(moved);
  const rest = boxes.filter((w) => w.id !== movedId).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const w of rest) {
    let next = { ...w };
    // Push down past anything already placed.
    for (let guard = 0; guard < 500 && placed.some((p) => overlap(next, p)); guard++) next = { ...next, y: next.y + 1 };
    placed.push(next);
  }
  // Settle the others upwards, top rows first, so no gaps are left behind. The widget just placed
  // stays exactly where it was put (otherwise it could never be moved down).
  const order = [...placed].sort((a, b) => a.y - b.y || a.x - b.x);
  const done: Widget[] = moved ? [moved] : [];
  for (const w of order) {
    if (w.id === movedId) continue;
    let next = { ...w };
    while (next.y > 0 && !done.some((p) => overlap({ ...next, y: next.y - 1 }, p))) next = { ...next, y: next.y - 1 };
    done.push(next);
  }
  // Keep the original array order (it is the reading and tab order).
  return widgets.map((w) => done.find((d) => d.id === w.id)!);
}

/** Reading order: top to bottom, then left to right. */
export const readingOrder = (widgets: Widget[]) => [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
