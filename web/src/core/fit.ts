// Width fitting for list columns and tab bars (E18-63): pure functions, so the rules are tested
// without a browser. The components measure the widths and apply the result.

/** Priority 1 columns always show; higher numbers give way first when the table is too wide. */
export type ColumnPriority = 1 | 2 | 3;

export interface FitColumn {
  field: string;
  priority: ColumnPriority;
  /** The column's natural width in pixels (0 while not yet measured). */
  width: number;
}

/**
 * The columns to leave out so the rest fit `available` pixels. Lower-priority columns go first
 * (priority 3, then 2), and among equals the rightmost goes first. Priority 1 columns are never left
 * out: if they alone are too wide the table scrolls sideways. `fixed` is width that is always there
 * (the selection check box column).
 */
export function fitColumns(columns: FitColumn[], available: number, fixed = 0): string[] {
  if (!(available > 0)) return [];
  let total = fixed + columns.reduce((sum, c) => sum + c.width, 0);
  if (total <= available) return [];
  const candidates = columns
    .map((c, index) => ({ ...c, index }))
    .filter((c) => c.priority > 1)
    .sort((a, b) => b.priority - a.priority || b.index - a.index);
  const dropped: string[] = [];
  for (const c of candidates) {
    if (total <= available) break;
    dropped.push(c.field);
    total -= c.width;
  }
  return dropped;
}

/**
 * The tabs (by index, in order) that fit `available` pixels, leaving `moreWidth` for the More
 * button when some do not fit. The active tab is always among them: if it would fall in the
 * overflow it takes the place of the last ones that fit. Unmeasured tabs (width 0) count as fitting,
 * so they are drawn and measured.
 */
export function fitTabs(widths: number[], available: number, moreWidth: number, active: number): number[] {
  const all = widths.map((_, i) => i);
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (!(available > 0) || total <= available) return all;
  const room = available - moreWidth;
  const shown: number[] = [];
  let used = 0;
  for (const i of all) {
    if (used + widths[i] > room) break;
    shown.push(i);
    used += widths[i];
  }
  if (active >= 0 && active < widths.length && !shown.includes(active)) {
    while (shown.length > 0 && used + widths[active] > room) used -= widths[shown.pop() as number];
    shown.push(active);
  }
  if (shown.length === 0) shown.push(active >= 0 && active < widths.length ? active : 0);
  return shown;
}
