// What a change needs (wave 27): the unit tests, the local CI steps, the browser suites and the
// GitHub jobs, each with why it runs or is skipped. Built on the import graph (affected.mjs) and the
// area map (areas.mjs). Run it to see the plan for the current changes without running anything:
//
//   node tools/ci/plan.mjs [--base <ref>] [--full] [--json]     (npm run test:affected -- --plan, grc ci -Plan)
//   node tools/ci/plan.mjs --areas                              the area map itself
//
// Unit tests: a test runs when it is changed, imports a changed file (directly or through other
// files), belongs to an affected area (server/src/modules/<area> or web/src/modules/<area>), names a
// changed file that is not code, or is marked "// ci: every module" and a server module changed.
// Every unit test runs when the packages, the test configuration or set-up, the TypeScript
// settings, a core migration or these rules change.
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODE, TEST_FILE, changedFiles, importGraph, repoFiles, repoRoot } from './affected.mjs';
import { affectedAreas, areaMap, testFolders } from './areas.mjs';
import { SUITES, chooseSuites, estimateMinutes } from '../e2e/suite-map.mjs';

/** A change here runs every unit test (with the reason shown). */
export const FULL_TEST_TRIGGERS = [
  [/^package(-lock)?\.json$/, 'the packages changed'],
  [/^vitest\.config\.ts$/, 'the test configuration changed'],
  [/^(server|web)\/tsconfig\.json$/, 'the TypeScript settings changed'],
  [/^server\/src\/test\//, 'the test set-up changed'],
  [/^server\/src\/core\/(.*\/)?migrations\//, 'a core migration changed (every module builds on its tables)'],
  [/^tools\/ci\/(affected|areas|plan)\.mjs$/, 'the selection rules changed'],
  [/^tools\/node-version\.txt$/, 'the Node.js version changed'],
];

/** The repository as the plan sees it: files, import graph, area map (built once). */
export function snapshot(root = repoRoot) {
  const files = repoFiles(root);
  const graph = importGraph(root, files);
  return { root, files, graph, areas: areaMap(root, files, graph) };
}

/**
 * The unit tests a set of changed files needs: `{ all: true, reason }`, or
 * `{ all: false, tests: Map(test file -> why) }`.
 */
export function selectTests(snap, changed) {
  const { root, files, graph } = snap;
  for (const f of changed) for (const [re, reason] of FULL_TEST_TRIGGERS) if (re.test(f)) return { all: true, reason: `${reason}: ${f}` };
  const tests = files.filter((f) => TEST_FILE.test(f));
  const picked = new Map();
  const pick = (t, why) => { if (!picked.has(t) && existsSync(join(root, t))) picked.set(t, why); };
  const users = new Map();
  for (const [f, ds] of graph) for (const d of ds) { if (!users.has(d)) users.set(d, []); users.get(d).push(f); }
  for (const c of changed) {
    if (TEST_FILE.test(c)) pick(c, 'changed');
    const seen = new Set([c]);
    const queue = [c];
    while (queue.length) {
      for (const u of users.get(queue.shift()) ?? []) {
        if (seen.has(u)) continue;
        seen.add(u);
        if (TEST_FILE.test(u)) pick(u, `imports ${c}`);
        queue.push(u);
      }
    }
  }
  // The affected areas' own test folders. When a change reaches core, the import graph above has
  // already found every test that depends on it, so no folder is added for "everything".
  const hit = affectedAreas(root, changed, files, graph);
  if (!hit.everything) {
    for (const [key, why] of hit.areas) {
      // By side: a changed web page runs the area's web tests, a changed server file its server tests.
      const folders = testFolders(key);
      const dirs = [...hit.sides.get(key)].flatMap((side) => folders[side] ?? []);
      for (const t of tests) if (dirs.some((d) => t.startsWith(d))) pick(t, `area ${key} (${why})`);
    }
  }
  const text = new Map();
  const textOf = (t) => { if (!text.has(t)) text.set(t, readFileSync(join(root, t), 'utf8')); return text.get(t); };
  // Tests that check every module through the registry (the route sweep, the API conventions...).
  if (changed.some((c) => /^server\/src\/modules\//.test(c) && !TEST_FILE.test(c))) {
    for (const t of tests) if (/^\/\/ ci: every module/m.test(textOf(t))) pick(t, 'checks every module (a server module changed)');
  }
  // Not code: the tests that name the file or its folder (docs, examples, JSON and CSV read at run time).
  for (const c of changed) {
    if (CODE.test(c)) continue;
    const name = posix.basename(c);
    const dir = posix.dirname(c);
    for (const t of tests) {
      const s = textOf(t);
      if (s.includes(c) || (name.length > 6 && s.includes(name)) || (dir !== '.' && (s.includes(`'${dir}'`) || s.includes(`${dir}/`)))) pick(t, `names ${c}`);
    }
  }
  return { all: false, tests: picked };
}

const any = (files, re) => files.some((f) => re.test(f));
const PKG = /^package(-lock)?\.json$/;
const TS_SETTINGS = /^(server|web)\/tsconfig\.json$/;

/** The browser suites a change needs: { everything, areas: Map, suites: [{ suite, filtered, why, minutes }], minutes }. */
export function browserPlan(snap, changed) {
  const hit = changed === null ? { everything: true, why: 'everything (a full run)' } : affectedAreas(snap.root, changed, snap.files, snap.graph);
  const suites = chooseSuites(hit);
  const n = hit.everything ? snap.areas.size : hit.areas.size;
  for (const s of suites) s.minutes = estimateMinutes(s, n, snap.areas.size);
  // Nothing in an area and no suite changed: no browser run at all.
  const none = !hit.everything && hit.areas.size === 0 && !(hit.suites?.size);
  return {
    everything: hit.everything,
    why: hit.everything ? hit.why : null,
    areas: hit.everything ? new Map() : hit.areas,
    types: hit.everything ? [] : [...hit.areas.keys()].flatMap((k) => snap.areas.get(k)?.types ?? []),
    suites: none ? [] : suites,
    minutes: none ? 0 : suites.reduce((m, s) => m + s.minutes, 0),
  };
}

/** Every step of local CI and every GitHub job, each { run, why }. `changed === null` or `full` runs everything. */
export function plan(snap, changed, { full = false } = {}) {
  if (full || changed === null) {
    const why = full ? 'a full run' : 'the changed files could not be worked out';
    const all = { run: true, why };
    return {
      full: true, why, changed: null,
      typecheck: { server: true, web: true, why },
      tests: { all: true, reason: why },
      build: all, audit: all,
      browser: browserPlan(snap, null),
      jobs: { unit: all, databaseServer: all, container: all, install: all, mobile: all, apiClient: all, installer: all, accessibility: all },
    };
  }
  const server = any(changed, /^(server|shared)\//) || any(changed, PKG) || any(changed, TS_SETTINGS);
  const web = any(changed, /^(web|shared)\//) || any(changed, PKG) || any(changed, TS_SETTINGS);
  const build = any(changed, /^(web|shared|docs\/user)\//) || any(changed, /^vite\.config\.ts$/) || any(changed, PKG);
  const tests = selectTests(snap, changed);
  const browser = browserPlan(snap, changed);
  const step = (run, yes, no) => ({ run, why: run ? yes : no });
  const unitCount = tests.all ? Infinity : tests.tests.size;
  const serverCode = any(changed, /^server\/src\/(?!.*\.test\.ts$)/);
  return {
    full: false, changed,
    typecheck: { server, web, why: server || web ? 'TypeScript in server/, web/ or shared/ changed' : 'no TypeScript in server/, web/ or shared/ changed' },
    tests,
    build: step(build, 'web/, shared/, docs/user/, vite.config.ts or the packages changed', 'nothing the web build uses changed (web/, shared/, docs/user/, vite.config.ts, packages)'),
    audit: step(any(changed, PKG), 'package.json or package-lock.json changed', 'package.json and package-lock.json are unchanged (the full and nightly runs always audit)'),
    browser,
    jobs: {
      unit: step(unitCount > 0, 'some unit tests cover the change', 'no unit test covers the change'),
      // The database-server runs check the server driver: worth it when server code or its tests change.
      databaseServer: step(unitCount > 0 && any(changed, /^(server|shared)\//), 'server code or its tests changed', 'no server code changed'),
      container: step(any(changed, /^(Dockerfile|\.dockerignore|compose[^/]*\.ya?ml|deploy\/(docker|secrets)\/)/) || any(changed, PKG) || any(changed, /^tools\/node-version\.txt$/) || any(changed, /^server\/src\/(main|cli)\.ts$/) || any(changed, /^server\/src\/ops\//),
        'the image, compose files, packages or start-up changed', 'nothing the container image depends on beyond the application code changed (checked nightly)'),
      install: step(any(changed, /^(grc\.ps1|grc\.sh|tools\/install-node\.(ps1|sh)|tools\/node-version\.txt|tools\/code-snapshot\.mjs|deploy\/(systemd|launchd)\/)/) || any(changed, PKG) || any(changed, /^server\/src\/(cli|main)\.ts$/) || any(changed, /^server\/src\/ops\//),
        'the install scripts, grc.ps1/grc.sh, operations code or packages changed', 'nothing the installation uses changed (checked nightly)'),
      apiClient: step(serverCode || any(changed, /^packages\/api-client\//), 'server code changed: the API client must still match', 'no server code changed'),
      mobile: step(any(changed, /^(mobile|packages\/api-client|shared)\//), 'mobile/, packages/api-client/ or shared/ changed', 'nothing the mobile app uses changed'),
      installer: step(any(changed, /^(deploy\/windows|tools\/installer)\//) || serverCode || any(changed, PKG), 'the installer or server code changed', 'neither the installer nor server code changed'),
      accessibility: step(browser.everything || any(changed, /^web\//), 'web pages changed', 'no web page changed'),
    },
  };
}

/** The plan as text: what runs, what is skipped, and why. */
export function describe(p, changes) {
  const out = [];
  out.push(p.full ? `Everything runs (${p.why}).` : `${p.changed.length} changed file(s) ${changes?.why ?? ''}:`);
  if (!p.full) for (const f of p.changed.slice(0, 20)) out.push(`  ${f}`);
  if (!p.full && p.changed.length > 20) out.push(`  ... and ${p.changed.length - 20} more`);
  out.push('Unit tests:');
  if (p.tests.all) out.push(`  every test (${p.tests.reason})`);
  else if (!p.tests.tests.size) out.push('  none (no test covers the changed files)');
  else for (const [t, why] of [...p.tests.tests].sort()) out.push(`  ${t}  <- ${why}`);
  const b = p.browser;
  out.push('Browser suites:');
  if (b.everything) out.push(`  every suite, every route (${b.why})`);
  else {
    out.push(`  affected areas: ${b.areas.size ? [...b.areas].map(([k, w]) => `${k} (${w})`).join('; ') : 'none'}`);
    out.push(`  record types visited: ${b.types.join(', ') || 'none'}`);
  }
  for (const s of b.suites) out.push(`  run   ${s.suite}${s.filtered ? ' (filtered)' : ''}: ${s.why} (~${s.minutes} min)`);
  const skipped = Object.keys(SUITES).filter((s) => !b.suites.some((x) => x.suite === s));
  if (skipped.length) out.push(`  skip  ${skipped.length} suite(s): ${skipped.join(', ')}`);
  out.push(`  about ${Math.round(b.minutes)} browser minutes in all`);
  out.push('GitHub jobs:');
  for (const [k, v] of Object.entries(p.jobs)) out.push(`  ${v.run ? 'run ' : 'skip'}  ${k}: ${v.why}`);
  return out.join('\n');
}

function main(argv) {
  const has = (f) => argv.includes(f);
  const at = argv.indexOf('--base');
  const base = at >= 0 ? argv[at + 1] : process.env.GRC_CI_BASE || undefined;
  const snap = snapshot();
  if (has('--areas')) {
    for (const a of snap.areas.values()) {
      console.log(`${a.key}: ${a.server ? 'server' : ''}${a.server && a.web ? ' + ' : ''}${a.web ? 'web' : ''}, ${a.files.length} files`);
      if (a.types.length) console.log(`  record types: ${a.types.join(', ')}`);
      if (a.routes.length) console.log(`  pages: ${a.routes.join(' ')}`);
      if (a.imports.length) console.log(`  imports: ${a.imports.join(', ')}`);
      if (a.importedBy.length) console.log(`  imported by: ${a.importedBy.join(', ')}`);
    }
    return;
  }
  const changes = has('--full') ? null : changedFiles(snap.root, base);
  const p = plan(snap, changes?.files ?? null, { full: has('--full') });
  if (has('--json')) console.log(JSON.stringify(p, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v === Infinity ? null : v), 2));
  else console.log(describe(p, changes));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
