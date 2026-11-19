// Checks the color contrast of the design tokens against WCAG 2.1 AA, in both themes.
//
// Usage:
//   node tools/contrast.mjs [path/to/tokens.css] [--json] [--fails]
//
//   (no arguments)   reads web/src/core/tokens.css and prints a table of every pair checked
//   --fails          prints only the pairs that fail
//   --json           prints { file, pairs, failures, missing } as JSON instead of the table
//
// Exit code: 0 when every pair passes, 1 when any fails or could not be checked because a
// token is missing, 2 when the file cannot be read.
//
// What it does: reads the custom properties of the light theme (`:root`) and the dark theme
// (`:root[data-theme="dark"]`, which falls back to the light value for anything it does not
// redefine), follows var() references, and understands hex, rgb()/rgba() and hsl()/hsla()
// colors. A see-through color is laid over what is behind it before measuring: a
// see-through background over the surface it sits on (the navigation tints over --nav-bg,
// anything else over --surface), then a see-through foreground over that background.
//
// The pairs (edit PAIRS below when tokens are added or renamed):
//   text, 4.5:1      --text, --text-muted, --link, --danger-text on each surface;
//                    --brand-contrast on --brand and --brand-hover; --danger-contrast on --danger;
//                    --text and --brand-strong on --brand-soft; each chip's --c-<name>-fg on its
//                    --c-<name>-bg; --nav-text and --nav-muted on the navigation backgrounds
//   non-text, 3:1    --border-strong and --focus on --surface and --bg; --nav-focus and
//                    --nav-accent on --nav-bg; --c-<name>-solid and --series-1..8 on --surface
//   for information  each chip background --c-<name>-bg against --surface (a chip is read by
//                    its text, so no minimum applies; the figure shows how far it stands out)
// A pair whose token is not in the file is reported as "missing" and listed at the end; it
// also makes the run fail, so a renamed token cannot slip through unchecked.
//
// For each failing pair the nearest passing value of the foreground token is suggested: the
// same hue and saturation, made lighter or darker until every pair that token takes part in
// (in that theme) passes. It is a starting point; look at the result on screen.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failsOnly = args.includes('--fails');
const file = args.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src', 'core', 'tokens.css');

const COLORS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'];
const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-hover'];
const NAV = ['--nav-bg', '--nav-hover', '--nav-active'];
const TEXT = 4.5;
const NON_TEXT = 3;

/** [foreground, background, minimum ratio (0 = for information), what is under a see-through background] */
const PAIRS = [
  ...['--text', '--text-muted', '--link', '--danger-text'].flatMap((fg) => SURFACES.map((bg) => [fg, bg, TEXT])),
  ['--brand-contrast', '--brand', TEXT],
  ['--brand-contrast', '--brand-hover', TEXT],
  ['--danger-contrast', '--danger', TEXT],
  ['--text', '--brand-soft', TEXT],
  ['--brand-strong', '--brand-soft', TEXT],
  ...COLORS.map((c) => [`--c-${c}-fg`, `--c-${c}-bg`, TEXT]),
  ...COLORS.map((c) => [`--c-${c}-bg`, '--surface', 0]),
  ...['--nav-text', '--nav-muted'].flatMap((fg) => NAV.map((bg) => [fg, bg, TEXT, '--nav-bg'])),
  ...['--border-strong', '--focus'].flatMap((fg) => ['--surface', '--bg'].map((bg) => [fg, bg, NON_TEXT])),
  ['--nav-focus', '--nav-bg', NON_TEXT, '--nav-bg'],
  ['--nav-accent', '--nav-bg', NON_TEXT, '--nav-bg'],
  ...COLORS.map((c) => [`--c-${c}-solid`, '--surface', NON_TEXT]),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`--series-${n}`, '--surface', NON_TEXT]),
];

// ---------- reading the tokens ----------

function readThemes(css) {
  const light = {};
  const dark = {};
  const plainCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors, body] of plainCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // An at-rule statement before the block (`@layer a, b;`) is not part of its selector.
    for (const selector of selectors.slice(selectors.lastIndexOf(';') + 1).split(',').map((x) => x.trim().replace(/\s+/g, ' ').replace(/'/g, '"'))) {
      const target = selector === ':root' || selector === ':root[data-theme="light"]' ? light
        : /^:root\[data-theme="?dark"?\]$/.test(selector) ? dark : null;
      if (!target) continue;
      for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) target[name] = value.trim();
    }
  }
  return { light, dark: { ...light, ...dark } };
}

/** Follows var(--x) and var(--x, fallback) until a plain value is left. */
function resolve(tokens, value, depth = 0) {
  if (value === undefined || depth > 20) return undefined;
  let missing = false;
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, name, fallback) => {
    const found = resolve(tokens, tokens[name] ?? fallback, depth + 1);
    if (found === undefined) missing = true;
    return found ?? '';
  });
  return missing ? undefined : out.trim();
}

const NAMED = { white: '#ffffff', black: '#000000', transparent: 'rgba(0,0,0,0)' };

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

function rgbToHsl({ r, g, b }) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** A CSS color to { r, g, b (0-255), a (0-1) }, or null when it is not a color we read. */
function parseColor(text) {
  if (!text) return null;
  let v = text.trim().toLowerCase();
  v = NAMED[v] ?? v;
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length < 6 ? [...hex].map((c) => c + c).join('') : hex;
    const n = (i) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(v);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p, scale) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p));
  const a = parts[3] === undefined ? 1 : Math.max(0, Math.min(1, num(parts[3], 1)));
  if (fn[1].startsWith('rgb')) return { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255), a };
  const hue = parseFloat(parts[0]) * (parts[0].endsWith('turn') ? 360 : parts[0].endsWith('rad') ? 180 / Math.PI : 1);
  return { ...hslToRgb(((hue % 360) + 360) % 360, parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100), a };
}

// ---------- measuring ----------

const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

function measure(tokens, [fg, bg, need, under = '--surface'], override) {
  const color = (name) => (override && name === override.name ? override.color : parseColor(resolve(tokens, tokens[name])));
  const f = color(fg);
  const b = color(bg);
  if (!f || !b) return { fg, bg, need, missing: [!f && fg, !b && bg].filter(Boolean) };
  const base = color(under) ?? { r: 255, g: 255, b: 255, a: 1 };
  const solidBase = base.a < 1 ? over(base, { r: 255, g: 255, b: 255, a: 1 }) : base;
  const back = b.a < 1 ? over(b, solidBase) : b;
  const front = f.a < 1 ? over(f, back) : f;
  const value = ratio(front, back);
  return { fg, bg, need, ratio: Math.round(value * 100) / 100, pass: need === 0 || value >= need, fgHex: toHex(front), bgHex: toHex(back), opaque: f.a === 1, front, back };
}

/** The nearest lightness of `name` (same hue and saturation) at which all its pairs pass. */
function suggest(tokens, name, pairs) {
  const start = parseColor(resolve(tokens, tokens[name]));
  if (!start || start.a < 1) return null;
  const mine = pairs.filter((p) => p[0] === name && p[2] > 0);
  const measured = mine.map((p) => measure(tokens, p)).filter((m) => !m.missing);
  if (!measured.length) return null;
  const { h, s, l } = rgbToHsl(start);
  const backs = measured.reduce((sum, m) => sum + luminance(m.back), 0) / measured.length;
  const step = backs > luminance(start) ? -0.0025 : 0.0025;
  for (let next = l + step; next >= 0 && next <= 1; next += step) {
    const color = { ...hslToRgb(h, s, next), a: 1 };
    const rounded = parseColor(toHex(color));
    if (mine.every((p) => { const m = measure(tokens, p, { name, color: rounded }); return m.missing || m.ratio >= p[2]; })) return toHex(rounded);
  }
  return null;
}

// ---------- report ----------

let css;
try { css = readFileSync(file, 'utf8'); } catch (err) {
  console.error(`Cannot read ${file}: ${err.message}`);
  process.exit(2);
}
const themes = readThemes(css);
const rows = [];
for (const [theme, tokens] of Object.entries(themes)) {
  for (const pair of PAIRS) {
    const m = measure(tokens, pair);
    const kind = pair[2] === TEXT ? 'text' : pair[2] === NON_TEXT ? 'non-text' : 'info';
    const row = { theme, kind, fg: m.fg, bg: m.bg, need: m.need };
    if (m.missing) rows.push({ ...row, missing: m.missing });
    else {
      rows.push({ ...row, fgColor: m.fgHex, bgColor: m.bgHex, ratio: m.ratio, pass: m.pass, ...(m.pass ? {} : { suggestion: suggest(tokens, m.fg, PAIRS) }) });
    }
  }
}
const failures = rows.filter((r) => r.pass === false);
const missing = rows.filter((r) => r.missing);

if (asJson) {
  console.log(JSON.stringify({ file, pairs: rows, failures, missing }, null, 2));
} else {
  const shown = failsOnly ? failures : rows;
  const head = ['Theme', 'Kind', 'Foreground', 'Background', 'Colors', 'Ratio', 'Need', 'Result'];
  const table = shown.map((r) => [
    r.theme, r.kind, r.fg, r.bg,
    r.missing ? '' : `${r.fgColor} on ${r.bgColor}`,
    r.missing ? '' : r.ratio.toFixed(2),
    r.need ? `${r.need}:1` : '-',
    r.missing ? `missing ${r.missing.join(', ')}` : r.need === 0 ? 'info' : r.pass ? 'pass' : 'FAIL',
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...table.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  if (shown.length) {
    console.log(line(head));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const row of table) console.log(line(row));
  }
  const checked = rows.filter((r) => !r.missing && r.need > 0).length;
  console.log(`\n${checked} pairs checked in ${file}: ${failures.length} below WCAG 2.1 AA${missing.length ? `, ${missing.length} not checked (token missing)` : ''}.`);
  if (failures.length) {
    console.log('\nBelow AA (4.5:1 for text, 3:1 for non-text):');
    for (const r of failures) {
      console.log(`  ${r.theme.padEnd(5)} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}:1, needs ${r.need}:1`
        + (r.suggestion ? `. Try ${r.fg}: ${r.suggestion} (now ${r.fgColor})` : ''));
    }
  }
}
if (missing.length && !asJson) {
  console.log('\nNot checked, because a token is not in the file (rename it in PAIRS, or restore it):');
  for (const r of missing) console.log(`  ${r.theme.padEnd(5)} ${r.fg} on ${r.bg}: missing ${r.missing.join(', ')}`);
}
process.exit(failures.length || missing.length ? 1 : 0);
