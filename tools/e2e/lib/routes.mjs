// Route discovery shared by the browser tests and the accessibility audit: every route the web
// application registers (window.__grcRoutes), with ":id" filled in from the first record the
// signed-in user can see, using /api/meta to match a route to its record type.
import { sleep } from './browser.mjs';
import { CORE_ROUTES } from '../suite-map.mjs';

// The area filter (wave 27): with E2E_AREAS set (run.mjs --affected or --areas), the tours visit
// only the routes owned by those areas' web modules (window.__grcRouteModules) plus the core routes
// (the overview, with the shell around it), and only those areas' record types (E2E_TYPES).
const listEnv = (name) => (process.env[name] ? new Set(process.env[name].split(',').map((s) => s.trim()).filter(Boolean)) : null);

/** The affected areas when the run is filtered, else null (every route). */
export function areaFilter() {
  return listEnv('E2E_AREAS');
}

/** True when the run visits record type `type` (always, unless filtered). */
export function typeAllowed(type) {
  const types = listEnv('E2E_TYPES');
  return !areaFilter() || !!types?.has(type);
}

let owners = null;
async function routeOwners(page) {
  if (!owners) owners = (await page.eval(`window.__grcRouteModules ?? null`)) ?? {};
  return owners;
}

/** The route pattern that matches a concrete path ("/risks/12" -> "/risks/:id"), from the owners table. */
function patternOf(table, path) {
  const clean = path.split(/[?#]/)[0];
  if (table[clean]) return clean;
  const parts = clean.split('/');
  return Object.keys(table).find((p) => {
    const q = p.split('/');
    return q.length === parts.length && q.every((s, i) => s.startsWith(':') || s === parts[i]);
  }) ?? clean;
}

/** True when the run visits this route pattern or concrete path (always, unless filtered). */
export async function routeAllowed(page, pathOrPattern) {
  const areas = areaFilter();
  if (!areas) return true;
  const table = await routeOwners(page);
  const pattern = patternOf(table, pathOrPattern);
  return CORE_ROUTES.includes(pattern) || areas.has(table[pattern]);
}

/** Every route path the application registers (after "/" has loaded). */
export async function registeredRoutes(page) {
  await page.goto('/');
  for (let i = 0; i < 60; i++) {
    const listed = await page.eval(`Array.isArray(window.__grcRoutes) ? window.__grcRoutes.filter((p) => typeof p === 'string') : null`);
    if (listed) return [...new Set(listed)];
    await sleep(200);
  }
  throw new Error('window.__grcRoutes did not appear: is the web application built with the route registry?');
}

/** Resource metadata: { [type]: { route, path, module, label, restricted, ... } }. */
export async function resourceMeta(api) {
  const meta = await api.must('GET', '/api/meta');
  return meta.resources ?? {};
}

/**
 * Concrete routes to visit: static ones as they are, and "<route>/:id" for each record type,
 * filled with the first visible record. Public routes (sign-in links and pages, which send a signed-in
 * person home), the assistant sign-in consent
 * page (it needs the request it answers, under /oauth/) and "*" are left out.
 * Returns { visit: [{ path, pattern, type? }], skipped: [pattern] }.
 */
export async function concreteRoutes(page, api, { publicPrefixes = ['/redeem', '/portal/', '/oauth/', '/sign-in/'] } = {}) {
  let patterns = await registeredRoutes(page);
  if (areaFilter()) {
    const all = patterns.length;
    const kept = [];
    for (const p of patterns) if (await routeAllowed(page, p)) kept.push(p);
    patterns = kept;
    console.log(`      area filter ${[...areaFilter()].join(',')}: ${kept.length} of ${all} routes`);
  }
  const resources = await resourceMeta(api);
  const byRoute = new Map(Object.entries(resources).filter(([, r]) => r.route).map(([type, r]) => [r.route, { type, ...r }]));
  const firstId = new Map();
  const idFor = async (res) => {
    if (!firstId.has(res.type)) {
      const r = await api.get(`${res.path}?pageSize=1`);
      firstId.set(res.type, r.status === 200 ? r.body?.rows?.[0]?.id ?? null : null);
    }
    return firstId.get(res.type);
  };
  const visit = [];
  const skipped = [];
  for (const pattern of patterns) {
    if (publicPrefixes.some((p) => pattern.startsWith(p)) || pattern.includes('*')) { skipped.push(pattern); continue; }
    if (!pattern.includes(':')) { visit.push({ path: pattern, pattern, type: byRoute.get(pattern)?.type }); continue; }
    const m = /^(.*)\/:id$/.exec(pattern);
    const res = m && byRoute.get(m[1]);
    const id = res ? await idFor(res) : null;
    if (id) visit.push({ path: `${m[1]}/${id}`, pattern, type: res.type, record: true });
    else skipped.push(pattern);
  }
  return { visit, skipped, resources };
}

/** Facts about the page on screen: heading, error states, "No access", horizontal scrolling. */
export function pageFacts(page) {
  return page.fn(() => {
    const visible = (e) => e && e.getClientRects().length > 0;
    const text = document.body.innerText;
    return {
      h1: document.querySelector('main h1, h1')?.innerText?.trim() ?? null,
      noAccess: /You do not have access to this page/.test(text) || /^\s*No access\s*$/m.test(text),
      notFound: /Page not found/.test(document.querySelector('h1')?.innerText ?? ''),
      // Error states, and alerts that read as a failure (an alert may also carry an ordinary notice).
      errors: [...document.querySelectorAll('.error-state, [role=alert]')].filter(visible)
        .filter((e) => e.matches('.error-state') || /could not|couldn't|failed|went wrong|error|unknown record type/i.test(e.innerText))
        .map((e) => e.innerText.trim().slice(0, 160)).filter((t) => t && !/^(Pilot|Use sample)/.test(t)),
      wide: document.documentElement.scrollWidth > window.innerWidth + 2,
      title: document.title,
    };
  });
}
