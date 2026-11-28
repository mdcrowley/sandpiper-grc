// Feature switches (E14-28, E14-34): a part of the application that is switched off is not shown
// anywhere except Administration > Features. Every optional area is switched off (and then only
// some of them), and as an administrator every page that stays is visited, with its New form for a
// record list, its drop-down lists opened, the Create menu and the search. A page fails on:
//   - a link to a page of a switched-off area (sidebar, Create menu, cards, tabs, help links...);
//   - an element whose whole text is the name of a switched-off record type ("Vehicles", "Ticket");
//   - text naming a switched-off area ("self-service portal", "hazard", "vulnerability"...);
//   - a drop-down option naming one.
// The server side that feeds those pages is checked too: metadata, search, the API description,
// notification kinds, the AI assistant's tools and the help index.
// Afterwards every area is switched back on and what was there before is checked to be back.
import { sleep } from '../lib/browser.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PASSWORD, repoRoot } from '../lib/instance.mjs';
import { concreteRoutes } from '../lib/routes.mjs';

/**
 * Words that name each area in running text. Case-insensitive, whole words. Kept to phrases that
 * cannot mean anything else (so "change" alone, "service" alone and "report" alone are not here:
 * the record type names of the area are matched as whole labels instead).
 */
const TERMS = {
  tickets: [/\btickets?\b/i, /\bservice desk\b/i, /\bknowledge (base|articles?)\b/i, /\bservice catalog\b/i, /\bcatalog items?\b/i],
  portal: [/\bself-service\b/i, /\bportal\b/i],
  changes: [/\bchange (requests?|calendar|enablement|advisory|freeze|windows?)\b/i, /\bpost-implementation\b/i, /\bCAB\b/],
  vendors: [/\bvendors?\b/i, /\bcontracts?\b/i],
  frameworks: [/\bframework outcomes?\b/i, /\bframeworks?\b/i, /\btarget profiles?\b/i],
  risks: [/\brisks?\b/i, /\bobligations?\b/i, /\brisk register\b/i],
  secincidents: [/\bsecurity incidents?\b/i, /\bnotification (tasks?|clocks?)\b/i, /\bincident kit\b/i],
  policies: [/\bpolic(y|ies)\b/i, /\bpolicy exceptions?\b/i, /\battestations?\b/i],
  training: [/\btraining\b/i, /\bcourses?\b/i, /\bexercises?\b/i],
  vulnerabilities: [/\bvulnerabilit(y|ies)\b/i],
  projects: [/\bprojects?\b/i, /\bportfolio\b/i],
  reports: [/\breport (catalog|builder|packs?|schedules?)\b/i, /\bscheduled reports?\b/i, /\bsaved dashboards?\b/i, /\bdashboards\b/i],
  fleet: [/\bvehicles?\b/i, /\bfleet\b/i],
  safety: [/\bsafety\b/i, /\bhazards?\b/i],
  // Not "funding" or "funder" alone: a project's or asset's funding source and the inventory's funder
  // interest option are not the funding area.
  funding: [/\bgrant (compliance|awards?)\b/i, /\bfunding (awards?|certifications?)\b/i, /\bfunder compliance reviews?\b/i, /\bsub-?recipients?\b/i],
  // Wave 25 (E45-06). Not "evidence" alone: evidence files on records (attachments) stay on.
  evidence: [/\bevidence library\b/i, /\bevidence to renew\b/i, /\bEVD-\d/],
  // Wave 26 (E46). Not "procurement", "insurance", "purchase order" or "strategic plan" alone: funder
  // review areas, vendor offboarding steps, risk descriptions and project scoring use them as plain words.
  procurement: [/\bsolicitations?\b/i, /\bPRC-\d/, /\bBUD-\d/],
  insurance: [/\binsurance claims?\b/i, /\bIPL-\d/, /\bICL-\d/, /\bCOI-\d/],
  civilrights: [/\bcivil rights\b/i, /\bparticipation goals?\b/i],
  strategy: [/\boperating statistics\b/i, /\bstatistical submissions?\b/i, /\bstrategic measures?\b/i, /\bKPI-\d/, /\bOBJ-\d/],
};

/**
 * Places where a word may still appear, with the reason. `route` is a route pattern (or a regular
 * expression over it); `text` the line it may appear on.
 */
const ALLOWED = [
  // The one place a switched-off area is shown: its switch.
  { route: '/admin/features', text: /./, why: 'the feature switches themselves' },
  // History is not rewritten: the audit log and record history keep what happened.
  { route: /^\/admin\/audit/, text: /./, why: 'the audit log records past events as they were' },
  // Words that are not about the area: "password policy", "retention policy", "sign-in policy", "content security policy", "notification policy".
  { route: /./, text: /\b(password|retention|sign-in|signin|content security|lockout|session|mfa|second-factor|access|privacy|cookie) polic(y|ies)\b/i, why: 'policies that are settings, not the policy module' },
  { route: /./, text: /\bpolicy\b.*\b(role|token|password|session)\b/i, why: 'a setting policy' },
  // Generic risk words in security settings ("at risk", "risky sign-in").
  { route: /./, text: /\b(at risk|risky|low-risk|high-risk)\b/i, why: 'plain English, not the risk register' },
  { route: /./, text: /\bgovernance, risk and compliance\b/i, why: 'what the product is' },
  { route: /./, text: /\bsafety copy\b/i, why: 'a backup kept for safety, not safety management' },
  // A security incident's playbooks, notification parties and severity wording are the organization's
  // own text (they may mention vehicles or safety), not the fleet or safety parts.
  { route: /^\/security-incidents\/(kit|declare)/, text: /./, why: 'incident playbooks and notification parties are data' },
  // Field labels of types that stay on that happen to be a switched-off type's name.
  { route: /^\/(vendors|vulnerabilities)/, text: /^Services?$/, why: 'a vendor\'s services and a vulnerability\'s network service are their own fields' },
  // The guide page on risks also covers the action tracker, which is always on.
  { route: /^\/help/, text: /^Risks, actions and obligations$/, why: 'the guide page also covers the always-on action tracker' },
];

const AREA_OF_ALLOWED_LINES = (route, line) => ALLOWED.some((a) => (typeof a.route === 'string' ? a.route === route : a.route.test(route)) && a.text.test(line));

/** Converts a React Router pattern into a regular expression over a pathname. */
const patternRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:[^/]+/g, '/[^/]+').replace(/\/\*$/, '(/.*)?')}/?$`);

/**
 * Everything visible on the page: lines of text, short labels, links and the options of its lists.
 * Record data is not the application speaking: table bodies, field values, a record page's title and
 * guide prose (`prose`: only its links count) are left out of the text; record names elsewhere are
 * stripped by `dataStrings` in findLeaks.
 */
const harvest = (page, { record = false, prose = false } = {}) => page.fn((record, prose) => {
  const vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // Guide prose (and the summaries of guide pages) describes the whole product; its links still count.
  const dataSel = ['main tbody', 'main dd', '.help-card-summary', '.help-result-snippet', '.palette-snippet', ...(record ? ['main h1'] : []), ...(prose ? ['.help-body', '.help-onpage'] : [])].join(', ');
  const hidden = [...document.querySelectorAll(dataSel)];
  const was = hidden.map((e) => e.style.display);
  hidden.forEach((e) => { e.style.display = 'none'; });
  // Group headings of the sidebar: groups are shown while they hold anything that is on.
  const groupHeads = [...document.querySelectorAll('nav[aria-label="Main"] .nav-group > button, nav[aria-label="Main"] .nav-group-title')];
  const ghWas = groupHeads.map((e) => e.style.display);
  groupHeads.forEach((e) => { e.style.display = 'none'; });
  const lines = (document.body.innerText || '').split('\n').map(norm).filter(Boolean);
  const labels = [...document.querySelectorAll('a, button, th, label, legend, h1, h2, h3, h4, [role=tab], [role=option], [role=menuitem], [role=radio], [role=checkbox], [role=switch], li, dt, .badge, .mantine-Badge-root, .mantine-Chip-label, .mantine-SegmentedControl-label, option')]
    .filter((e) => e.tagName === 'OPTION' || vis(e)).map((e) => norm(e.innerText || e.textContent || e.getAttribute('aria-label'))).filter((t) => t && t.length < 60);
  hidden.forEach((e, i) => { e.style.display = was[i]; });
  groupHeads.forEach((e, i) => { e.style.display = ghWas[i]; });
  // A row button's name carries its row's record ("Edit: <statement>", wave 15): record data, like the row itself.
  const attrs = [...document.querySelectorAll('[aria-label], [title], [placeholder]')].filter((e) => vis(e) && !e.matches('nav[aria-label="Main"] ul') && !hidden.some((h) => h.contains(e)))
    .flatMap((e) => ['aria-label', 'title', 'placeholder'].map((a) => norm(e.getAttribute(a)))).filter(Boolean);
  const links = [...document.querySelectorAll('a[href]')].filter(vis).map((a) => {
    try { const u = new URL(a.href); return u.origin === location.origin ? { path: u.pathname, search: u.search, text: norm(a.innerText || a.getAttribute('aria-label')).slice(0, 60) } : null; } catch { return null; }
  }).filter(Boolean);
  const selectOptions = [...document.querySelectorAll('select option')].map((o) => norm(o.textContent)).filter(Boolean);
  return { lines, labels, attrs, links, selectOptions };
}, record, prose);

/** Opens each visible drop-down list on the page in turn and reads its options. */
async function dropdownOptions(page, limit = 14) {
  const count = await page.fn(() => {
    document.querySelectorAll('[data-e2e-dd]').forEach((e) => e.removeAttribute('data-e2e-dd'));
    const els = [...document.querySelectorAll('input[aria-haspopup="listbox"], button[aria-haspopup="listbox"], [role=combobox]:not([aria-haspopup="dialog"])')]
      .filter((e) => e.getClientRects().length && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[role=dialog][aria-hidden=true]'));
    els.forEach((e, i) => e.setAttribute('data-e2e-dd', String(i)));
    return els.length;
  });
  const out = [];
  for (let i = 0; i < Math.min(count, limit); i++) {
    const sel = `[data-e2e-dd="${i}"]`;
    if (!(await page.exists(sel))) continue;
    try {
      await page.click(sel, { timeout: 2000 });
      await sleep(250);
      const opts = await page.fn(() => [...document.querySelectorAll('[role=option]')].filter((e) => e.getClientRects().length)
        .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
      out.push(...opts);
      await page.key('Escape');
      await sleep(80);
    } catch { /* covered or gone: skip */ }
  }
  return out;
}

/**
 * Builds the checker for one set of off areas.
 * ctx: { offAreas, offTypes: Map<type, meta>, offRoutes: [pattern], allRoutes }
 */
function checker({ offAreas, offTypes, offRoutes, offApiPaths, dataStrings }) {
  const offRouteRes = offRoutes.map((p) => ({ p, re: patternRe(p) }));
  const typeLabels = new Map();
  for (const [type, r] of offTypes) for (const l of [r.label, r.plural].filter(Boolean)) typeLabels.set(l.toLowerCase(), type);
  const terms = offAreas.flatMap((a) => (TERMS[a] ?? []).map((re) => ({ area: a, re })));
  // Longest first, so a record name is removed whole before a shorter one inside it.
  const data = [...dataStrings].filter((s) => s.length > 2).sort((a, b) => b.length - a.length);
  const strip = (line) => {
    let s = line;
    for (const d of data) if (s.includes(d)) s = s.split(d).join(' ');
    return s;
  };
  return {
    offApiPaths,
    isData(s) { return dataStrings.has(s); },
    linkOff(path) { return offRouteRes.find(({ re }) => re.test(path))?.p; },
    labelOff(text) { return dataStrings.has(text) ? undefined : typeLabels.get(text.toLowerCase()); },
    termOff(line) {
      const first = terms.find(({ re }) => re.test(line));
      if (!first) return undefined;
      // A record name cut short to fit ("Example Fleet…").
      if (line.endsWith('…') && data.some((d) => d.startsWith(line.slice(0, -1).trim()))) return undefined;
      // A search result: its parts (" - ") are pieces of the record's own text, cut to the words found.
      if (line.includes(' - ') && line.split(' - ').every((part) => !terms.some(({ re }) => re.test(part)) || data.some((d) => d.includes(part.trim())))) return undefined;
      const rest = strip(line);
      return terms.find(({ re }) => re.test(rest));
    },
  };
}

/** Problems on the page now. */
function findLeaks(route, facts, check, extraOptions = []) {
  const out = new Set();
  for (const l of facts.links) {
    const hit = check.linkOff(l.path);
    if (hit) out.add(`link to ${l.path}${l.search} ("${l.text}") of switched-off page ${hit}`);
  }
  for (const t of [...facts.labels, ...facts.selectOptions, ...extraOptions]) {
    const type = check.labelOff(t);
    if (type && !AREA_OF_ALLOWED_LINES(route, t)) out.add(`label "${t}" names switched-off type ${type}`);
  }
  for (const line of [...facts.lines, ...facts.attrs, ...extraOptions]) {
    const hit = check.termOff(line);
    if (hit && !AREA_OF_ALLOWED_LINES(route, line)) out.add(`text names ${hit.area} (${hit.re}): "${line.slice(0, 140)}"`);
  }
  return [...out];
}

/**
 * Names and words that are records of the parts that stay on (system and site names, people, the
 * values of their lists): data an organization entered, which may well mention a vehicle or a
 * vendor, not the application offering a switched-off part.
 */
async function recordData(api, resources, meta, offTypes) {
  const typeNames = new Set([...offTypes.values()].flatMap((r) => [r.label, r.plural]));
  const out = new Set();
  const add = (v) => { if (typeof v === 'string') { const s = v.replace(/\s+/g, ' ').trim(); if (s && s.length < 5000) out.add(s); } };
  for (const [type, r] of Object.entries(resources)) {
    const res = await api.get(`${r.path}?pageSize=500`);
    for (const row of res.body?.rows ?? []) {
      // Every stored text of the record (fields hidden by a switch included: their values are kept),
      // except list values, which are checked (below, from the metadata).
      for (const [f, v] of Object.entries(row)) if (r.fields?.[f]?.type !== 'lookup') add(v);
      for (const [f, v] of Object.entries(row._display ?? {})) if (r.fields?.[f]?.type !== 'lookup') add(v);
      if (r.refField) add(`${row[r.refField]} ${row[r.titleField]}`);
    }
    void type;
  }
  // A list value that is the name of a switched-off record type ("Risk" as an action source) is not data.
  for (const values of Object.values(meta.lookups ?? {})) for (const v of values) if (!typeNames.has(v.label)) add(v.label);
  // Roles are not data here (E18-64): a default role of a switched-off area is not shown, and an unedited
  // default description names only the areas that are on. Both are checked on the pages and below.
  const users = await api.get('/api/admin/users?pageSize=500');
  for (const u of listOf(users.body)) { add(u.displayName ?? u.display_name); add(u.username); add(u.email); }
  return out;
}

const shared = { before: null };

/** A list answer, bare or wrapped. */
const listOf = (b) => (Array.isArray(b) ? b : b?.rows ?? b?.roles ?? b?.users ?? []);

/** Records what the application offers with everything on (types, routes, records) once. */
async function baseline(t) {
  if (shared.before) return shared.before;
  const api = t.api();
  await api.must('POST', '/api/auth/confirm', { password: PASSWORD });
  const initial = Object.fromEntries((await api.must('GET', '/api/admin/features')).areas.map((a) => [a.key, a.on]));
  await api.must('PATCH', '/api/admin/features', { features: Object.fromEntries(Object.keys(initial).map((k) => [k, true])) });
  await t.page.goto('/');
  const { visit, resources } = await concreteRoutes(t.page, api);
  const routeModules = await t.page.eval('window.__grcRouteModules');
  const moduleArea = await t.page.eval('window.__grcModuleArea');
  const nav = await t.page.fn(() => [...document.querySelectorAll('nav[aria-label="Main"] a[href]')].map((a) => new URL(a.href).pathname));
  const areas = (await api.must('GET', '/api/admin/features')).areas.map((a) => a.key);
  // Pages with an address of their own that no record type gives: each role, a user, every guide page.
  for (const r of listOf(await api.must('GET', '/api/admin/roles'))) visit.push({ path: `/admin/roles/${r.id}`, pattern: '/admin/roles/:id' });
  const someUser = listOf(await api.must('GET', '/api/admin/users'))[0];
  if (someUser) visit.push({ path: `/admin/users/${someUser.id}`, pattern: '/admin/users/:id' });
  const guide = readdirSync(join(repoRoot, 'docs/user')).filter((x) => /^d+-.*.md$/.test(x)).map((x) => x.replace(/^d+-/, '').replace(/.md$/, ''));
  for (const slug of guide) visit.push({ path: `/help/${slug}`, pattern: `/help/${slug}`, prose: true });
  const pageArea = Object.fromEntries([...readFileSync(join(repoRoot, 'web/src/modules/help/areas.ts'), 'utf8').matchAll(/^s+'?([a-z-]+)'?: '([a-z]+)',$/gm)].map((m) => [m[1], m[2]]));
  shared.before = { visit, resources, routeModules, moduleArea, nav, areas, initial, pageArea };
  return shared.before;
}

async function setAreas(t, on) {
  const api = t.api();
  await api.must('POST', '/api/auth/confirm', { password: PASSWORD });
  await api.must('PATCH', '/api/admin/features', { features: on });
  await sleep(300);
}

/** The server answers that feed the pages: no switched-off type, route, kind or tool. */
async function serverLeaks(t, offTypes, offAreas, check) {
  const api = t.api();
  const problems = [];
  const meta = await api.must('GET', '/api/meta');
  for (const [type, r] of Object.entries(meta.resources ?? {})) {
    if (offTypes.has(type)) problems.push(`/api/meta lists switched-off type ${type}`);
    for (const [f, d] of Object.entries(r.fields ?? {})) {
      if (d.type === 'ref' && offTypes.has(d.to)) problems.push(`/api/meta: ${type}.${f} refers to switched-off type ${d.to}`);
      const hit = check.termOff(d.label ?? '');
      if (hit) problems.push(`/api/meta: ${type}.${f} is labeled "${d.label}" (${hit.area})`);
    }
  }
  for (const q of ['a', 'e', 'bus', 'depot', 'brake', 'door']) {
    const r = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
    const rows = Array.isArray(r.body) ? r.body : r.body?.results ?? r.body?.rows ?? [];
    for (const x of rows) if (offTypes.has(x.type)) problems.push(`/api/search?q=${q} returns a ${x.type}`);
  }
  const oa = await api.must('GET', '/api/openapi.json');
  for (const p of Object.keys(oa.paths ?? {})) {
    if (check.offApiPaths.some((ap) => p === ap || p.startsWith(`${ap}/`))) problems.push(`/api/openapi.json describes ${p}`);
  }
  // Every catalog-like answer the pages read: nothing in it may name a switched-off area.
  for (const path of ['/api/notifications/preferences', '/api/mcp/admin', '/api/admin/webhooks/events', '/api/reports/catalog', '/api/admin/retention', '/api/admin/custom-fields', '/api/import/types', '/api/workflows/types']) {
    const r = await api.get(path);
    if (r.status !== 200) continue;
    const text = r.text;
    // A record type named as a value ("type":"vehicle") or as an event or field key ("vehicle.created").
    for (const type of offTypes.keys()) {
      if (new RegExp(`"(type|record_type|recordType|to|resource)":"${type}"|"${type}\\.[a-z_]+"`).test(text)) problems.push(`${path} mentions switched-off type ${type}`);
    }
    for (const a of offAreas) for (const re of TERMS[a] ?? []) {
      for (const m of text.matchAll(new RegExp(`"[^"]*${re.source}[^"]*"`, 'gi'))) {
        if (AREA_OF_ALLOWED_LINES('(api)', m[0]) || check.isData(m[0].slice(1, -1))) continue;
        problems.push(`${path} names ${a}: ${m[0].slice(0, 120)}`);
        break;
      }
    }
  }
  // E18-64: set-up that belongs to an area. Roles (names and descriptions), the risk scales offered and
  // the asset classes listed: none of them names, or rates, a switched-off part.
  const named = (where, text) => {
    for (const a of offAreas) for (const re of TERMS[a] ?? []) if (re.test(text ?? '')) { problems.push(`${where} names ${a}: "${String(text).slice(0, 120)}"`); return; }
  };
  for (const r of listOf((await api.get('/api/admin/roles')).body)) { named('/api/admin/roles', r.name); named('/api/admin/roles', r.description); }
  const mcp = await api.get('/api/mcp/admin');
  for (const r of mcp.body?.roles ?? []) named('/api/mcp/admin roles', r.name);
  const scales = await api.get('/api/risks/scales');
  if (scales.status === 200) for (const s of scales.body.filter((x) => x.offered !== false)) { named('/api/risks/scales', s.name); named('/api/risks/scales', s.description); }
  const classes = await api.get('/api/asset-classes?pageSize=500');
  if (classes.status === 200) {
    for (const c of listOf(classes.body)) if (offTypes.has(c.applies_to)) problems.push(`/api/asset-classes lists "${c.name}", which rates switched-off ${c.applies_to} records`);
  }
  return [...new Set(problems)];
}

/**
 * Dashboards (BW-04). Their names and descriptions are records, so the page tour treats them as data;
 * checked here instead: a standard dashboard about switched-off areas only is not listed, and no
 * dashboard that stays shows a tile about a part that is off.
 */
async function dashboardLeaks(t, offTypes) {
  const api = t.api();
  const problems = [];
  const typeOf = (w) => w?.config?.spec?.type;
  if (offTypes.has('dashboard')) return problems; // dashboards are switched off themselves: the page tour covers them
  const dashes = listOf(await api.must('GET', '/api/dashboards?pageSize=200'));
  const offOnly = dashes.filter((d) => d.key && d.widgets.some(typeOf) && d.widgets.filter(typeOf).every((w) => offTypes.has(typeOf(w))));
  await t.page.goto('/dashboards');
  const gallery = await t.page.eval(`document.querySelector('main')?.innerText ?? ''`);
  for (const d of offOnly) if (gallery.includes(d.name)) problems.push(`/dashboards lists the standard dashboard "${d.name}", which is only about switched-off areas`);
  for (const d of dashes.filter((x) => x.key && !offOnly.includes(x))) {
    await t.page.goto(`/dashboards/${d.id}`);
    await sleep(500);
    const text = await t.page.eval(`document.querySelector('main')?.innerText ?? ''`);
    if (/not switched on here/i.test(text)) problems.push(`/dashboards/${d.id} ("${d.name}") shows a tile about a switched-off part`);
  }
  return problems;
}

/** One tour: switch `offAreas` off, check the server and every page that stays, switch back on. */
function tour(name, pickOff) {
  return {
    name,
    async run(t) {
      const before = await t.step('everything on: record the routes, types and records', () => baseline(t));
      const offAreas = pickOff(before.areas);
      const api = t.api();
      await t.step(`switch off: ${offAreas.join(', ')}`, () => setAreas(t, Object.fromEntries(before.areas.map((a) => [a, !offAreas.includes(a)]))));
      const metaAfter = (await api.must('GET', '/api/meta')).resources ?? {};
      const offTypes = new Map(Object.entries(before.resources).filter(([type]) => !metaAfter[type]));
      t.log(`   types now hidden: ${[...offTypes.keys()].join(' ')}`);
      const offModules = Object.entries(before.moduleArea).filter(([, a]) => offAreas.includes(a)).map(([m]) => m);
      const offRoutes = [...new Set([
        ...Object.entries(before.routeModules).filter(([, m]) => offModules.includes(m)).map(([p]) => p),
        ...[...offTypes.values()].flatMap((r) => (r.route ? [r.route, `${r.route}/:id`] : [])),
        ...Object.entries(before.pageArea).filter(([, a]) => offAreas.includes(a)).map(([slug]) => `/help/${slug}`),
      ])];
      const offApiPaths = [...offTypes.values()].map((r) => r.path).filter(Boolean);
      const dataStrings = await t.step('record data of the parts that stay', async () => recordData(api, metaAfter, await api.must('GET', '/api/meta'), offTypes));
      const check = checker({ offAreas, offTypes, offRoutes, offApiPaths, dataStrings });

      for (const p of await t.step('the server answers', () => serverLeaks(t, offTypes, offAreas, check))) t.soft(false, p);
      for (const p of await t.step('dashboards', () => dashboardLeaks(t, offTypes))) t.soft(false, p);

      // Pages that stay: those of modules and types still on.
      const stays = before.visit.filter((v) => !check.linkOff(v.path) && !offRoutes.includes(v.pattern));
      t.log(`   ${stays.length} pages to visit`);
      for (const v of stays) {
        await t.page.goto(v.path);
        t.page.takeProblems();
        const facts = await harvest(t.page, { record: v.record, prose: v.prose });
        const options = v.prose ? [] : await dropdownOptions(t.page);
        const leaks = findLeaks(v.pattern, facts, check, options);
        if (leaks.length) for (const l of leaks) t.soft(false, `${v.pattern}: ${l}`);
        else t.log(`   ok  ${v.pattern}`);
        // A record list's New form.
        if (v.type && !v.record) {
          await t.page.goto(`${v.path}?new=1`);
          const f2 = await harvest(t.page);
          const o2 = await dropdownOptions(t.page, 20);
          for (const l of findLeaks(v.pattern, f2, check, o2)) t.soft(false, `${v.pattern}?new=1: ${l}`);
        }
      }

      // The shell: Create menu and search.
      await t.page.goto('/');
      if (await t.page.exists({ role: 'button', name: 'Create' })) {
        await t.page.click({ role: 'button', name: 'Create' });
        await sleep(300);
        const items = await t.page.fn(() => [...document.querySelectorAll('[role=menuitem]')].filter((e) => e.getClientRects().length).map((e) => e.innerText.trim()));
        for (const l of findLeaks('(create menu)', { lines: items, labels: items, attrs: [], links: [], selectOptions: [] }, check)) t.soft(false, `Create menu: ${l}`);
        await t.page.key('Escape');
      }
      for (const q of ['ve', 'tick', 'haz', 'saf', 'por', 'chan', 'vend', 'risk', 'polic', 'train', 'vuln', 'proj', 'rep', 'dash', 'fleet']) {
        await t.page.key('k', ['Control']);
        await sleep(200);
        await t.page.type(q);
        await sleep(600);
        const f = await harvest(t.page);
        for (const l of findLeaks('(search)', f, check)) t.soft(false, `search "${q}": ${l}`);
        await t.page.key('Escape');
        await sleep(150);
      }

      // Back on: what was in the sidebar is there again.
      await t.step('switch everything back on', () => setAreas(t, Object.fromEntries(before.areas.map((a) => [a, true]))));
      await t.page.goto('/');
      const nav = await t.page.fn(() => [...document.querySelectorAll('nav[aria-label="Main"] a[href]')].map((a) => new URL(a.href).pathname));
      const missing = before.nav.filter((p) => !nav.includes(p));
      t.soft(missing.length === 0, `after switching back on, the sidebar lacks ${missing.join(' ')}`);
      const metaBack = (await api.must('GET', '/api/meta')).resources ?? {};
      const lost = Object.keys(before.resources).filter((k) => !metaBack[k]);
      t.soft(lost.length === 0, `after switching back on, /api/meta lacks ${lost.join(' ')}`);
      const fieldsLost = Object.entries(before.resources).flatMap(([k, r]) => Object.keys(r.fields ?? {}).filter((f) => !metaBack[k]?.fields?.[f]).map((f) => `${k}.${f}`));
      t.soft(fieldsLost.length === 0, `after switching back on, /api/meta lacks the fields ${fieldsLost.join(' ')}`);
      await setAreas(t, before.initial);
    },
  };
}

/**
 * Vehicle and asset models (E39): vehicle models belong to Fleet and services, asset models to the
 * inventory (always on). With fleet off, vehicle models are gone from the server and the pages, and
 * the asset model pages name no vehicle.
 */
const modelsTest = {
  name: 'fleet off: vehicle models are gone, asset models stay and name no vehicle',
  async run(t) {
    const api = t.api();
    await api.must('POST', '/api/auth/confirm', { password: PASSWORD });
    const initial = Object.fromEntries((await api.must('GET', '/api/admin/features')).areas.map((a) => [a.key, a.on]));
    const model = listOf(await api.must('GET', '/api/asset-models?pageSize=1'))[0];
    await setAreas(t, { ...Object.fromEntries(Object.keys(initial).map((k) => [k, true])), fleet: false });
    try {
      const meta = (await api.must('GET', '/api/meta')).resources ?? {};
      t.soft(!meta.vehicle_model, '/api/meta still lists vehicle models');
      t.soft(Boolean(meta.asset_model) && Boolean(meta.asset?.fields?.model_id), '/api/meta lost asset models or the asset\'s model field');
      for (const path of ['/api/vehicle-models', '/api/vehicle-models/suggestions', '/api/vehicle-models/inherited-fields']) {
        const r = await api.get(path);
        t.soft(r.status === 404 && r.body?.error?.code === 'switched_off', `${path} answers ${r.status} while fleet is off`);
      }
      await t.page.goto('/vehicle-models');
      await t.page.waitFor(() => /switched off/i.test(document.querySelector('main')?.innerText ?? ''), { timeout: 10000 });
      for (const path of ['/asset-models', ...(model ? [`/asset-models/${model.id}`] : [])]) {
        await t.page.goto(path);
        const text = await t.page.eval(`document.querySelector('main')?.innerText ?? ''`);
        const named = (TERMS.fleet ?? []).find((re) => re.test(text.replace(/\[Sample\][^\n]*/g, '')));
        t.soft(!named, `${path} names the fleet while it is off`);
      }
    } finally {
      await setAreas(t, initial);
    }
  },
};

export const tests = [
  modelsTest,
  tour('every area off: nothing of them is shown', (areas) => areas),
  tour('portal, fleet, safety and funding off: nothing of them is shown', () => ['portal', 'fleet', 'safety', 'funding']),
  {
    // Areas with standard dashboards of their own, while dashboards stay on (BW-04): those dashboards
    // are not listed, and no dashboard that stays shows a tile about them.
    name: 'service desk, portal and vendors off: their standard dashboards are not shown',
    async run(t) {
      const before = await t.step('everything on: record the routes, types and records', () => baseline(t));
      const offAreas = ['portal', 'tickets', 'vendors'];
      await t.step(`switch off: ${offAreas.join(', ')}`, () => setAreas(t, Object.fromEntries(before.areas.map((a) => [a, !offAreas.includes(a)]))));
      const metaAfter = (await t.api().must('GET', '/api/meta')).resources ?? {};
      const offTypes = new Map(Object.entries(before.resources).filter(([type]) => !metaAfter[type]));
      for (const p of await t.step('dashboards', () => dashboardLeaks(t, offTypes))) t.soft(false, p);
      await setAreas(t, before.initial);
    },
  },
];
