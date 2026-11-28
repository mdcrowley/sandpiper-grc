// The area map (wave 27): which parts of the product a change touches. Generated from the code
// every time it is asked for, so it cannot fall behind:
//   - an area is a module: a folder in server/src/modules and/or web/src/modules with the same name;
//   - its files are the files in those folders;
//   - its record types and API paths come from `defineResource({ type: ..., path: '/api/...' })` (a quoted type, or a constant resolved in the file or the files it imports)
//     in its server folder, its pages from the `{ path: '...', element: ... }` routes in its web
//     index.tsx;
//   - the areas it imports come from the import graph (tools/ci/affected.mjs).
// A changed file affects its own area and every area whose files import it, directly or through
// other files. A change that reaches core (the server's core and start-up, the web shell and its
// shared components, the build and test set-up, the packages) affects every area, and the reason
// names the file. `node tools/ci/plan.mjs --areas` prints the map.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { importGraph, repoFiles } from './affected.mjs';

/** Files that every area depends on: a change here affects everything (pattern, why). */
export const CORE_PATTERNS = [
  [/^server\/src\/core\//, 'server core (every module runs on it)'],
  [/^server\/src\/(app|main|cli)\.ts$/, 'server start-up'],
  [/^server\/src\/test\//, 'the server test helpers'],
  [/^server\/src\/[^/]+\.ts$/, 'server start-up'],
  [/^web\/src\/core\//, 'the web shell and the shared screens (lists, forms, record pages)'],
  [/^web\/src\/[^/]+\.(tsx?|css)$/, 'the web application shell'],
  [/^web\/(index\.html|public\/)/, 'the web application shell'],
  [/^vite\.config\.ts$/, 'the web build'],
  [/^vitest\.config\.ts$/, 'the test configuration'],
  [/^package(-lock)?\.json$/, 'the packages'],
  [/^(server|web)\/tsconfig\.json$/, 'the TypeScript settings'],
  [/^tools\/node-version\.txt$/, 'the Node.js version'],
  [/^tools\/e2e\/(lib\/|run\.mjs|serve\.mjs|suite-map\.mjs)/, 'the browser test runner'],
  [/^tools\/a11y\//, 'the accessibility audit'],
  [/^tools\/ci\/(affected|areas|plan)\.mjs$/, 'the selection rules themselves'],
];

const MOD = /^(server|web)\/src\/modules\/([^/]+)\//;

/** The operations code (backup, restore, export, import, status): an area of its own, with no pages. */
export const OPERATIONS = 'operations';

/** The folders holding an area's unit tests, by side. */
export function testFolders(key) {
  if (key === OPERATIONS) return { server: ['server/src/ops/'], web: [] };
  return { server: [`server/src/modules/${key}/`], web: [`web/src/modules/${key}/`] };
}

/**
 * The area a file belongs to: { area, side } for a module ('server' or 'web'), { core: why } for
 * core, or null (not product code).
 */
export function ownerOf(file) {
  const m = MOD.exec(file);
  if (m) return { area: m[2], side: m[1] };
  if (/^server\/src\/ops\//.test(file)) return { area: OPERATIONS, side: 'server' };
  if (/^docs\/user\//.test(file)) return { area: 'help', side: 'web' }; // the user guide is the in-app Help
  for (const [re, why] of CORE_PATTERNS) if (re.test(file)) return { core: why };
  return null;
}

const strings = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
const escape = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The value of a resource's `type:` as written in `file`: a quoted string, a constant (`type: PAYMENT`,
 * defined in the file or in a file it imports by a relative path), or a property of a constant object
 * (`type: T.plan`). null when it is worked out at run time.
 */
export function resolveValue(root, file, expr, seen = new Set()) {
  const quoted = /^'([^']+)'$/.exec(expr);
  if (quoted) return quoted[1];
  if (seen.has(file)) return null;
  seen.add(file);
  let text = '';
  try { text = readFileSync(join(root, file), 'utf8'); } catch { return null; }
  const [name, prop] = expr.split('.');
  if (prop === undefined) {
    const m = new RegExp(`\\bconst ${escape(name)}\\s*(?::[^=]+)?=\\s*'([^']+)'`).exec(text);
    if (m) return m[1];
  } else {
    const obj = new RegExp(`\\bconst ${escape(name)}\\s*(?::[^=]+)?=\\s*\\{([\\s\\S]*?)\\}`).exec(text);
    const m = obj && new RegExp(`\\b${escape(prop)}:\\s*'([^']+)'`).exec(obj[1]);
    if (m) return m[1];
  }
  // A constant imported from another file of the repository.
  for (const imp of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
    const names = imp[1].split(',').map((x) => x.trim().replace(/^type\s+/, '')).filter(Boolean);
    const hit = names.find((x) => x === name || x.endsWith(` as ${name}`));
    if (!hit) continue;
    const original = hit.split(/\s+as\s+/)[0];
    const target = join(dirname(file), imp[2]).replace(/\\/g, '/');
    return resolveValue(root, target, prop === undefined ? original : `${original}.${prop}`, seen);
  }
  return null;
}

/** The area map, generated from the code. */
export function areaMap(root, files = repoFiles(root), graph = importGraph(root, files)) {
  const areas = new Map();
  const area = (key) => {
    if (!areas.has(key)) areas.set(key, { key, server: false, web: false, files: [], types: [], apiPaths: [], routes: [], imports: new Set(), importedBy: new Set() });
    return areas.get(key);
  };
  for (const f of files) {
    const own = ownerOf(f);
    if (!own?.area || /^docs\//.test(f)) continue;
    const m = MOD.exec(f) ?? [f, own.side, own.area];
    const a = area(own.area);
    a[own.side] = true;
    a.files.push(f);
    if (/\.test\.ts$/.test(f) || !/\.(ts|tsx)$/.test(f)) continue;
    const text = readFileSync(join(root, f), 'utf8');
    if (m[1] === 'server') {
      for (const block of text.split('defineResource(').slice(1)) {
        const head = block.slice(0, 600);
        // The resource's own `type:` comes first, before its fields' types.
        const typeExpr = /\btype:\s*('[a-z0-9_]+'|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/.exec(head)?.[1];
        const type = typeExpr ? resolveValue(root, f, typeExpr) : null;
        // Worked out at run time (`type: kind.modelType`): every literal value of that property in the folder.
        if (!type && typeExpr?.includes('.')) {
          const prop = escape(typeExpr.split('.').pop());
          const dir = join(root, dirname(f));
          for (const other of readdirSync(dir).filter((x) => /\.ts$/.test(x) && !/\.test\.ts$/.test(x))) {
            a.types.push(...strings(readFileSync(join(dir, other), 'utf8'), new RegExp(`\\b${prop}:\\s*'([a-z0-9_]+)'`, 'g')));
          }
        }
        const path = /\bpath:\s*'(\/api\/[^']+)'/.exec(head)?.[1];
        if (type) a.types.push(type);
        if (path) a.apiPaths.push(path);
      }
    } else if (f === `web/src/modules/${m[2]}/index.tsx`) {
      a.routes.push(...strings(text, /\{\s*path:\s*'([^']+)',\s*element:/g));
    }
  }
  for (const [f, deps] of graph) {
    const from = ownerOf(f)?.area;
    if (!from || /\.test\.ts$/.test(f) || /^docs\//.test(f)) continue;
    for (const d of deps) {
      const to = /^docs\//.test(d) ? null : ownerOf(d)?.area;
      if (to && to !== from) { areas.get(from).imports.add(to); areas.get(to).importedBy.add(from); }
    }
  }
  for (const a of areas.values()) {
    a.types = [...new Set(a.types)].sort();
    a.apiPaths = [...new Set(a.apiPaths)].sort();
    a.routes = [...new Set(a.routes)];
    a.imports = [...a.imports].sort();
    a.importedBy = [...a.importedBy].sort();
  }
  return new Map([...areas].sort(([x], [y]) => x.localeCompare(y)));
}

/**
 * The areas a set of changed files affects.
 * Returns { everything: false, areas: Map(area -> why), sides: Map(area -> Set('server' | 'web')),
 * suites: Set(suite files changed), none: [files outside every area] }
 * or { everything: true, why }.
 */
export function affectedAreas(root, changed, files = repoFiles(root), graph = importGraph(root, files)) {
  const users = new Map();
  for (const [f, ds] of graph) for (const d of ds) { if (!users.has(d)) users.set(d, []); users.get(d).push(f); }
  const areas = new Map();
  const sides = new Map();
  const suites = new Set();
  const none = [];
  const add = (own, why) => {
    if (!areas.has(own.area)) areas.set(own.area, why);
    if (!sides.has(own.area)) sides.set(own.area, new Set());
    sides.get(own.area).add(own.side);
  };
  for (const c of changed) {
    const suite = /^tools\/e2e\/suites\/([^/]+)\.mjs$/.exec(c)?.[1];
    if (suite) { suites.add(suite); continue; }
    const own = ownerOf(c);
    if (own?.core) return { everything: true, why: `${c} is ${own.core}` };
    if (own?.area) add(own, `${c} changed`);
    else if (!/\.(ts|tsx|mjs)$/.test(c)) { none.push(c); continue; }
    // Everything that imports the file, directly or through other files.
    const seen = new Set([c]);
    const queue = [c];
    while (queue.length) {
      const f = queue.shift();
      for (const u of users.get(f) ?? []) {
        if (seen.has(u) || /\.test\.ts$/.test(u)) continue;
        seen.add(u);
        const o = ownerOf(u);
        if (o?.core) return { everything: true, why: `${c} is used by ${u}, which is ${o.core}` };
        if (o?.area) add(o, `uses ${c} (through ${u})`);
        queue.push(u);
      }
    }
    if (!own) none.push(c);
  }
  return { everything: false, areas, sides, suites, none };
}
