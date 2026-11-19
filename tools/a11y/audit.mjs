// Accessibility audit: injects axe-core through the DevTools protocol into every route of a
// throw-away instance (signed in as an administrator, so every screen is reachable) and checks
// the WCAG 2.1 A and AA rules, in light and dark at 1440 and 820 pixels wide. Also audits a few
// states that only appear after an action: each list's New dialog and the command palette.
//
//   node tools/a11y/audit.mjs [--quick] [--routes /a,/b] [--no-fail] [--keep]
//
//   --quick        light theme at 1440 only (a fast first look)
//   --routes       only these routes (as registered, e.g. /tickets,/tickets/:id)
//   --no-fail      exit 0 even when serious or critical violations are found
//   --keep         keep the scratch data folder afterwards
//
// Output (git-ignored): tools/a11y/out/report.md (readable summary by rule, with every route
// and element affected) and tools/a11y/out/report.json (everything axe returned, trimmed).
// Exit code 1 when any serious or critical violation remains that is not listed in
// tools/a11y/known.json, unless --no-fail. known.json holds findings already raised as issues:
// [{ "rule": "color-contrast", "route": "/safety", "issue": "E18-39" }] ("route" may be "*").
// They are reported as known and do not fail the run; an entry that no longer matches anything is
// reported as stale so it can be removed. With known.json empty, every finding fails the run.
//
// Environment: as for the browser tests (E2E_WEB_DIST, E2E_BROWSER, E2E_PORT, GRC_MODULES).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchBrowser, sleep } from '../e2e/lib/browser.mjs';
import { startInstance, repoRoot } from '../e2e/lib/instance.mjs';
import { concreteRoutes } from '../e2e/lib/routes.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const value = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const only = value('--routes')?.split(',').map((s) => s.trim()).filter(Boolean);
const combos = has('--quick') ? [['light', 1440]] : [['light', 1440], ['dark', 1440], ['light', 820], ['dark', 820]];

const outDir = resolve(import.meta.dirname, 'out');
mkdirSync(outDir, { recursive: true });
const scratch = join(tmpdir(), `sandpiper-a11y-${process.pid}`);
const log = (m) => console.log(`[a11y] ${m}`);
const axeSource = readFileSync(join(repoRoot, 'node_modules/axe-core/axe.min.js'), 'utf8');

const app = await startInstance({ dir: scratch, log, roles: false });
const browser = await launchBrowser({ profileDir: join(scratch, 'profile') });
const page = await browser.newPage({ base: app.base });
await page.setSession(app.admin.token);

const { visit, skipped, resources } = await concreteRoutes(page, app.api());
let targets = visit.map((v) => ({ path: v.path, pattern: v.pattern }));
// States after an action: each list's New dialog (lists that offer one), and the command palette.
for (const v of visit) {
  const res = v.type && resources[v.type];
  if (res && !v.record && res.route === v.pattern) targets.push({ path: `${v.path}?new=1`, pattern: `${v.pattern}?new=1`, dialog: true });
}
targets.push({ path: '/', pattern: '/ (command palette)', palette: true });
if (only) targets = targets.filter((t) => only.includes(t.pattern) || only.includes(t.path));

const knownFile = join(import.meta.dirname, 'known.json');
let known = [];
try { known = JSON.parse(readFileSync(knownFile, 'utf8')); } catch (err) { if (err.code !== 'ENOENT') throw new Error(`tools/a11y/known.json: ${err.message}`); }
const isKnown = (rule, pattern) => known.find((k) => k.rule === rule && (k.route === '*' || k.route === pattern));

const RULES = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] };
const found = new Map(); // rule id -> { id, impact, help, helpUrl, where: Map(pattern -> Set(combo)), nodes: Map(target -> { html, summary, patterns:Set }) }
let checked = 0;

async function audit(target, theme, width) {
  await page.setViewport(width);
  await page.setTheme(theme);
  await page.goto(target.path);
  if (target.dialog) {
    // Only a list with a New dialog opens one on ?new=1; a page without one is audited as it is.
    await page.waitFor('[role=dialog]', { timeout: 2500 }).catch(() => null);
  }
  if (target.palette) {
    await page.key('k', ['Control']);
    await page.waitFor('[role=dialog]', { timeout: 4000 }).catch(() => null);
    await page.type('risk');
    await sleep(600);
  }
  await sleep(250); // let transitions finish so colors are measured at rest
  page.takeProblems();
  const result = await page.eval(`(async () => {
    if (!window.axe) { ${axeSource}\n }
    const r = await window.axe.run(document, ${JSON.stringify(RULES)});
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
      nodes: v.nodes.slice(0, 25).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 220), summary: (n.failureSummary || '').slice(0, 400) })) }));
  })()`);
  checked++;
  const combo = `${theme} ${width}`;
  for (const v of result) {
    if (!found.has(v.id)) found.set(v.id, { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, where: new Map(), nodes: new Map() });
    const f = found.get(v.id);
    if (!f.where.has(target.pattern)) f.where.set(target.pattern, new Set());
    f.where.get(target.pattern).add(combo);
    for (const n of v.nodes) {
      // Generated ids differ on every render: group by the element, not by its id.
      const key = n.target.replace(/#mantine-[a-z0-9]+/gi, '#mantine-*').replace(/:nth-child\(\d+\)/g, '');
      if (!f.nodes.has(key)) f.nodes.set(key, { html: n.html, summary: n.summary, patterns: new Set() });
      f.nodes.get(key).patterns.add(target.pattern);
    }
  }
  return result;
}

const started = Date.now();
for (const [theme, width] of combos) {
  log(`${theme} ${width}: ${targets.length} pages`);
  for (const t of targets) {
    try {
      const v = await audit(t, theme, width);
      const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
      if (bad.length) log(`  ${t.pattern}: ${bad.map((x) => `${x.id}(${x.nodes.length})`).join(', ')}`);
    } catch (err) {
      log(`  ${t.pattern}: could not audit: ${err.message}`);
    }
  }
}
await browser.close();
await app.stop({ keep: has('--keep') });

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const rules = [...found.values()].sort((a, b) => (order[a.impact] - order[b.impact]) || a.id.localeCompare(b.id));
const json = rules.map((r) => ({
  id: r.id, impact: r.impact, help: r.help, helpUrl: r.helpUrl,
  routes: Object.fromEntries([...r.where].map(([p, c]) => [p, [...c]])),
  nodes: [...r.nodes].map(([target, n]) => ({ target, html: n.html, summary: n.summary, routes: [...n.patterns] })),
}));
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ when: new Date().toISOString(), combos, pages: targets.length, checked, skipped, rules: json }, null, 2));

const serious = rules.filter((r) => r.impact === 'serious' || r.impact === 'critical');
// Serious or critical findings by rule and route, split into those already raised and new ones.
const pairs = serious.flatMap((r) => [...r.where.keys()].map((pattern) => ({ rule: r.id, pattern, known: isKnown(r.id, pattern) })));
const fresh = pairs.filter((p) => !p.known);
const stale = known.filter((k) => !pairs.some((p) => p.known === k));
const md = [
  '# Accessibility audit (axe-core, WCAG 2.1 A and AA)',
  '',
  `${new Date().toISOString()} · ${targets.length} pages × ${combos.map((c) => c.join(' ')).join(', ')} = ${checked} checks · ${Math.round((Date.now() - started) / 1000)} s`,
  '',
  `**${serious.length} serious or critical rule(s)**, ${rules.length - serious.length} moderate or minor. ${fresh.length} new serious or critical finding(s) (rule on a page), ${pairs.length - fresh.length} already raised as issues (\`tools/a11y/known.json\`).`,
  '',
  ...(pairs.length - fresh.length ? ['Already raised:', '', ...pairs.filter((p) => p.known).map((p) => `- ${p.rule} on \`${p.pattern}\`: ${p.known.issue}`), ''] : []),
  ...(stale.length ? ['Stale entries in known.json (no longer found; remove them):', '', ...stale.map((k) => `- ${k.rule} on \`${k.route}\` (${k.issue})`), ''] : []),
  ...(rules.length ? ['| Rule | Impact | Pages | Elements |', '|---|---|---|---|', ...rules.map((r) => `| [${r.id}](${r.helpUrl}) | ${r.impact} | ${r.where.size} | ${r.nodes.size} |`)] : ['No violations.']),
  '',
  ...rules.flatMap((r) => [
    `## ${r.id} (${r.impact}): ${r.help}`,
    '',
    `Pages: ${[...r.where].map(([p, c]) => `\`${p}\` (${[...c].join(', ')})`).join(', ')}`,
    '',
    ...[...r.nodes].slice(0, 30).map(([target, n]) => `- \`${target}\` on ${[...n.patterns].slice(0, 4).join(', ')}${n.patterns.size > 4 ? ` and ${n.patterns.size - 4} more` : ''}\n  \`${n.html.replace(/`/g, "'").replace(/\s+/g, ' ')}\`\n  ${n.summary.replace(/\s+/g, ' ')}`),
    r.nodes.size > 30 ? `- and ${r.nodes.size - 30} more elements` : '',
    '',
  ]),
  skipped.length ? `Not audited (need a record that does not exist in the sample data, or public): ${skipped.map((s) => `\`${s}\``).join(', ')}` : '',
].join('\n');
writeFileSync(join(outDir, 'report.md'), md);
log(`${checked} checks; ${serious.length} serious/critical rule(s), ${rules.length - serious.length} other. Report: ${join(outDir, 'report.md')}`);
for (const p of pairs.filter((x) => x.known)) log(`known: ${p.rule} on ${p.pattern} (${p.known.issue})`);
for (const k of stale) log(`stale entry in known.json, no longer found: ${k.rule} on ${k.route} (${k.issue})`);
for (const p of fresh) log(`NEW: ${p.rule} on ${p.pattern}`);
process.exit(fresh.length && !has('--no-fail') ? 1 : 0);
