// Saving the relationship map as a picture: a stand-alone SVG drawn from the layout (the whole
// map, whatever the zoom), with a heading and a legend, in the current theme or a print theme.
// `renderMapSvg` is pure, so it is tested without a browser; the rest needs one.
import { NODE_TYPES, shortLabel, typeInfo } from './mapLayout';
import type { Layout, PlacedNode } from './mapLayout';

export const PALETTE_COLORS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];

export interface Palette {
  /** Page background; `grid` draws the dotted background of the screen. */
  bg: string; grid: boolean;
  surface: string; border: string; borderControl: string; text: string; textMuted: string; font: string;
  colors: Record<PaletteColor, { bg: string; fg: string; solid: string }>;
}

export interface LegendTier { label: string; color: string }

export interface MapSvgOptions {
  palette: Palette;
  title: string;
  /** A second line under the title, for example who saved it and when. */
  subtitle?: string;
  /** The selected system and the records affected if it fails: drawn as on screen. */
  selectedId?: string | null;
  impacted?: Set<string> | null;
  /** Criticality tiers shown as dots on systems, for the legend. */
  tiers?: LegendTier[];
  /** The criticality color of a system node, or null for none. */
  criticalityColor?: (node: PlacedNode) => string | null;
}

const MARGIN = 28;
const HEAD_H = 64;
const LEGEND_ROW = 24;

/** Escapes text for use in SVG text and attribute values. */
export function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const colorOf = (p: Palette, name: string) => p.colors[(PALETTE_COLORS as readonly string[]).includes(name) ? (name as PaletteColor) : 'gray'];

/** Rough width of a line of text at a font size: enough to lay out the legend. */
const textWidth = (s: string, size: number) => s.length * size * 0.56;

interface LegendItem { width: number; draw: (x: number, y: number) => string }

function legendItems(layout: Layout, o: MapSvgOptions): LegendItem[] {
  const p = o.palette;
  const size = 12.5;
  const items: LegendItem[] = [];
  const text = (x: number, y: number, s: string) => `<text x="${x}" y="${y + 4.5}" font-size="${size}" fill="${p.textMuted}">${xml(s)}</text>`;
  const present = new Set(layout.nodes.map((n) => n.type));
  for (const t of NODE_TYPES) {
    if (!present.has(t.type)) continue;
    const c = colorOf(p, t.color);
    items.push({
      width: 18 + textWidth(t.plural, size),
      draw: (x, y) => `<rect x="${x}" y="${y - 6}" width="12" height="12" rx="3" fill="${c.bg}" stroke="${c.solid}"/>${text(x + 18, y, t.plural)}`,
    });
  }
  if (layout.edges.some((e) => e.kind === 'integration')) {
    const label = 'Integration (arrow: the way data flows)';
    items.push({
      width: 40 + textWidth(label, size),
      draw: (x, y) => `<path d="M${x} ${y}H${x + 26}" stroke="${p.textMuted}" stroke-width="1.6"/><path d="M${x + 24} ${y - 4}L${x + 33} ${y}L${x + 24} ${y + 4}z" fill="${p.textMuted}"/>${text(x + 40, y, label)}`,
    });
  }
  if (layout.edges.some((e) => e.kind !== 'integration')) {
    const label = 'Other relationship';
    items.push({
      width: 40 + textWidth(label, size),
      draw: (x, y) => `<path d="M${x} ${y}H${x + 33}" stroke="${p.textMuted}" stroke-width="1.2" stroke-dasharray="4 4"/>${text(x + 40, y, label)}`,
    });
  }
  if (o.selectedId && o.impacted?.size) {
    const label = 'Affected if the selected system fails';
    const red = p.colors.red.solid;
    items.push({
      width: 30 + textWidth(label, size),
      draw: (x, y) => `<rect x="${x}" y="${y - 6}" width="22" height="12" rx="3" fill="none" stroke="${red}" stroke-width="2" stroke-dasharray="5 3"/>${text(x + 30, y, label)}`,
    });
  }
  if (o.tiers?.length && layout.nodes.some((n) => o.criticalityColor?.(n))) {
    for (const [i, tier] of o.tiers.entries()) {
      const label = i === 0 ? `Criticality: ${tier.label}` : tier.label;
      items.push({
        width: 14 + textWidth(label, size),
        draw: (x, y) => `<circle cx="${x + 4.5}" cy="${y}" r="4.5" fill="${tier.color}"/>${text(x + 14, y, label)}`,
      });
    }
  }
  return items;
}

/** Places legend items in rows no wider than `width`. */
function flowLegend(items: LegendItem[], width: number): { rows: LegendItem[][]; height: number } {
  const rows: LegendItem[][] = [];
  let row: LegendItem[] = [];
  let used = 0;
  for (const item of items) {
    if (row.length && used + item.width > width) { rows.push(row); row = []; used = 0; }
    row.push(item);
    used += item.width + 22;
  }
  if (row.length) rows.push(row);
  return { rows, height: rows.length * LEGEND_ROW };
}

/**
 * The whole map as a stand-alone SVG document: every color is written out (no stylesheet), so
 * it opens the same in a browser, an office suite or a drawing program.
 */
export function renderMapSvg(layout: Layout, o: MapSvgOptions): { svg: string; width: number; height: number } {
  const p = o.palette;
  const width = Math.max(560, Math.ceil(layout.width) + MARGIN * 2);
  const legend = flowLegend(legendItems(layout, o), width - MARGIN * 2);
  const mapTop = MARGIN + HEAD_H;
  const height = Math.ceil(mapTop + layout.height + 20 + legend.height + MARGIN);
  const hot = o.selectedId && o.impacted?.size ? o.impacted : null;
  const inHot = (id: string) => !!hot && (hot.has(id) || id === o.selectedId);
  const out: string[] = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${xml(p.font)}">`);
  out.push(`<title>${xml(o.title)}</title>`);
  out.push('<defs>');
  if (p.grid) {
    out.push(`<pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1" fill="${p.border}"/></pattern>`);
  }
  for (const [id, fill] of [['flow', p.textMuted], ['hot', p.colors.red.solid]] as const) {
    out.push(`<marker id="arrow-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${fill}"/></marker>`);
  }
  out.push('</defs>');
  out.push(`<rect width="100%" height="100%" fill="${p.bg}"/>`);
  if (p.grid) out.push('<rect width="100%" height="100%" fill="url(#grid)"/>');

  // Heading
  out.push(`<text x="${MARGIN}" y="${MARGIN + 22}" font-size="20" font-weight="700" fill="${p.text}">${xml(o.title)}</text>`);
  if (o.subtitle) out.push(`<text x="${MARGIN}" y="${MARGIN + 44}" font-size="13" fill="${p.textMuted}">${xml(o.subtitle)}</text>`);

  out.push(`<g transform="translate(${MARGIN} ${mapTop})">`);
  // Back to front as on screen (E18-65): group boxes, lines, then headings on a band that hides the lines under them, then nodes.
  for (const g of layout.groups) {
    out.push(`<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="12" fill="${p.surface}" stroke="${p.borderControl}"/>`);
  }
  for (const e of layout.edges) {
    const flow = e.kind === 'integration';
    const isHot = inHot(e.from) && inHot(e.to);
    const target = layout.byId.get(e.to);
    const stroke = isHot ? p.colors.red.solid : flow ? p.textMuted : colorOf(p, typeInfo(target?.type ?? 'system').color).solid;
    const marker = flow ? `url(#arrow-${isHot ? 'hot' : 'flow'})` : null;
    const attrs = [
      `d="${e.path}"`, 'fill="none"', `stroke="${stroke}"`, `stroke-width="${isHot ? 2.2 : flow ? 1.6 : 1.2}"`,
      flow ? '' : 'stroke-dasharray="4 4"', !isHot && !flow ? 'stroke-opacity="0.6"' : '',
      marker ? `marker-end="${marker}"` : '', marker && e.direction === 'two_way' ? `marker-start="${marker}"` : '',
    ].filter(Boolean);
    out.push(`<path ${attrs.join(' ')}/>`);
  }
  for (const l of layout.lanes) {
    out.push(`<text x="${l.x + (l.type === 'system' ? 0 : 2)}" y="${l.y + 18}" font-size="12" font-weight="650" letter-spacing="0.7" fill="${p.textMuted}" stroke="${p.bg}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${xml(l.label.toUpperCase())}</text>`);
  }
  for (const g of layout.groups) {
    out.push(`<rect class="group-band" x="${g.x + 1}" y="${g.y + 1}" width="${Math.max(0, g.w - 2)}" height="28" rx="11" fill="${p.surface}"/>`);
    out.push(`<text x="${g.x + 12}" y="${g.y + 21}" font-size="12.5" font-weight="650" fill="${p.text}">${xml(shortLabel(g.label, Math.max(8, Math.floor((g.w - 34) / 7))))}<tspan fill="${p.textMuted}" font-weight="500"> ${g.count}</tspan></text>`);
  }
  for (const n of layout.nodes) {
    const c = colorOf(p, typeInfo(n.type).color);
    const selected = n.id === o.selectedId;
    const affected = !selected && !!hot?.has(n.id);
    const stroke = selected ? p.text : affected ? p.colors.red.solid : c.solid;
    const crit = n.type === 'system' ? o.criticalityColor?.(n) ?? null : null;
    out.push(`<g transform="translate(${n.x} ${n.y})">`);
    out.push(`<title>${xml(`${n.ref ? `${n.ref} ` : ''}${n.label}`)}</title>`);
    out.push(`<rect width="${n.w}" height="${n.h}" rx="8" fill="${c.bg}" stroke="${stroke}" stroke-opacity="${selected || affected ? 1 : 0.5}" stroke-width="${selected ? 2.5 : affected ? 2 : 1}"${affected ? ' stroke-dasharray="5 3"' : ''}/>`);
    out.push(`<circle cx="13" cy="${n.h / 2}" r="4" fill="${c.solid}"/>`);
    out.push(`<text x="24" y="${n.h / 2 + 4.5}" font-size="12.5" font-weight="550" fill="${c.fg}">${xml(shortLabel(n.label, crit ? 28 : 30))}</text>`);
    if (crit) out.push(`<circle cx="${n.w - 12}" cy="${n.h / 2}" r="4.5" fill="${crit}" stroke="${p.surface}" stroke-width="1.5"/>`);
    out.push('</g>');
  }
  out.push('</g>');

  // Legend
  let y = mapTop + layout.height + 20 + LEGEND_ROW / 2;
  for (const row of legend.rows) {
    let x = MARGIN;
    for (const item of row) { out.push(item.draw(x, y)); x += item.width + 22; }
    y += LEGEND_ROW;
  }
  out.push('</svg>');
  return { svg: out.join('\n'), width, height };
}

/** A file name for the picture: "relationship-map-2026-11-19.svg". */
export function pictureName(base: string, day: string, ext: 'svg' | 'png'): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'map';
  return `${slug}-${day}.${ext}`;
}

// ---------- browser only ----------

const TOKENS = {
  bg: '--bg', surface: '--surface', border: '--border', borderControl: '--border-control', text: '--text', textMuted: '--text-muted', font: '--font',
} as const;

/** The light theme's token values, read from the `:root` rule of the loaded stylesheets. */
function lightTokens(): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
        for (const name of Array.from(rule.style)) if (name.startsWith('--')) found.set(name, rule.style.getPropertyValue(name).trim());
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules); } catch { /* a stylesheet from another origin cannot be read */ }
  }
  return found;
}

/**
 * The colors to draw with. `current` is the theme on screen, dotted background included;
 * `print` is the light theme on a plain white page.
 */
export function readPalette(mode: 'current' | 'print'): Palette {
  const computed = getComputedStyle(document.documentElement);
  const light = mode === 'print' ? lightTokens() : new Map<string, string>();
  const get = (name: string) => light.get(name) || computed.getPropertyValue(name).trim();
  const colors = Object.fromEntries(PALETTE_COLORS.map((c) => [c, { bg: get(`--c-${c}-bg`), fg: get(`--c-${c}-fg`), solid: get(`--c-${c}-solid`) }])) as Palette['colors'];
  return {
    bg: mode === 'print' ? '#ffffff' : get(TOKENS.bg), grid: mode === 'current',
    surface: mode === 'print' ? '#ffffff' : get(TOKENS.surface),
    border: get(TOKENS.border), borderControl: get(TOKENS.borderControl), text: get(TOKENS.text), textMuted: get(TOKENS.textMuted),
    font: get(TOKENS.font) || 'system-ui, sans-serif',
    colors,
  };
}

/** Draws an SVG onto a canvas and returns it as a PNG, at up to twice the size (smaller for very large maps). */
export async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  const scale = Math.max(0.5, Math.min(2, 12000 / Math.max(width, height), Math.sqrt(60_000_000 / (width * height))));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The picture could not be drawn.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('This browser cannot draw pictures.');
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Hands a file to the browser to save. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

