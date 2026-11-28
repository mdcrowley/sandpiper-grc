// Browser tests: starts a throw-away instance (fresh data folder, free port, dev seed, one user per
// default role), drives headless Edge or Chrome over the DevTools protocol through every suite in
// tools/e2e/suites, and exits non-zero when anything fails.
//
//   npm run test:e2e                          every suite
//   npm run test:e2e -- --only smoke,roles    some suites (file names without .mjs, with or without the number)
//   npm run test:e2e -- --skip roles,smoke    every suite but these (same names as --only)
//   npm run test:e2e -- --grep ticket,site    only tests whose name contains one of these
//   npm run test:e2e -- --headed              show the browser
//   npm run test:e2e -- --keep                keep the scratch data folder afterwards
//   npm run test:e2e -- --affected            only what the current changes need (tools/ci/plan.mjs):
//                                             the suites of the affected areas, and the tours over
//                                             those areas' routes and record types only
//   npm run test:e2e -- --affected --base main   ... compared with another commit
//   npm run test:e2e -- --areas risks,tickets the same for named areas (tools/ci/plan.mjs --areas lists them)
//   npm run test:e2e -- --plan                print what would run, run nothing
//   npm run test:e2e -- --shard 2/4           this machine's part of the chosen tests (GitHub)
//
// Environment: E2E_WEB_DIST (serve this web build; default: build one, about a minute),
// E2E_CALL_TIMEOUT_MS (a browser call that gets no answer fails after this long; default 120000),
// E2E_BROWSER (browser path), E2E_PORT, E2E_BASE (use an instance started by serve.mjs),
// E2E_DATABASE_URL (run on a PostgreSQL server: an account that may create databases; each run
// uses a fresh database there and drops it afterwards, see lib/instance.mjs),
// GRC_MODULES (limit the server modules, as for the server).
//
// Output (git-ignored) in tools/e2e/out: log.txt (every step), failures/*.png (a screenshot at
// the step that failed), role-matrix.md (role x page results of the roles suite).
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './lib/browser.mjs';
import { signIn, startInstance } from './lib/instance.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const value = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const onlySuites = value('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
const skipSuites = value('--skip')?.split(',').map((s) => s.trim()).filter(Boolean);
const grep = value('--grep')?.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const shard = value('--shard')?.split('/').map(Number);

const here = import.meta.dirname;

// Change-based selection (wave 27): --affected works out the areas from the changed files,
// --areas names them. The chosen suites and the area filter (E2E_AREAS, E2E_TYPES) are set here.
let chosen = null; // suite name -> why, when selecting
if (has('--affected') || has('--areas') || has('--plan')) {
  const { snapshot, browserPlan } = await import('../ci/plan.mjs');
  const { changedFiles } = await import('../ci/affected.mjs');
  const { chooseSuites, estimateMinutes } = await import('./suite-map.mjs');
  const snap = snapshot();
  let plan;
  if (has('--areas')) {
    const names = value('--areas').split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = names.filter((n) => !snap.areas.has(n));
    if (unknown.length) { console.error(`Unknown area(s): ${unknown.join(', ')}. The areas: ${[...snap.areas.keys()].join(', ')}`); process.exit(2); }
    const areas = new Map(names.map((n) => [n, 'named with --areas']));
    const suites = chooseSuites({ everything: false, areas, suites: new Set() });
    for (const s of suites) s.minutes = estimateMinutes(s, areas.size, snap.areas.size);
    plan = { everything: false, areas, types: names.flatMap((n) => snap.areas.get(n).types), suites };
  } else {
    const changes = changedFiles(snap.root, value('--base'));
    plan = browserPlan(snap, changes?.files ?? null);
    console.log(`Changed files ${changes ? `${changes.why}: ${changes.files.length}` : 'could not be worked out: running everything'}`);
  }
  if (plan.everything) console.log(`Every suite and route: ${plan.why}`);
  else {
    console.log(`Affected areas: ${[...plan.areas].map(([k, w]) => `${k} (${w})`).join('; ') || 'none'}`);
    // ' ' when no area is affected (only a suite changed): the tours then visit the core routes only.
    process.env.E2E_AREAS = [...plan.areas.keys()].join(',') || ' ';
    process.env.E2E_TYPES = plan.types.join(',');
  }
  for (const s of plan.suites) console.log(`  run  ${s.suite}${s.filtered ? ' (filtered to the affected areas)' : ''}: ${s.why}`);
  if (has('--plan')) process.exit(0);
  if (!plan.suites.length) { console.log('Nothing in the browser suites covers these changes.'); process.exit(0); }
  chosen = new Map(plan.suites.map((s) => [s.suite, s.why]));
}
const outDir = resolve(here, 'out');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'failures'), { recursive: true });
const logFile = join(outDir, 'log.txt');
writeFileSync(logFile, '');
const started = Date.now();
const stamp = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
export const log = (m) => { const line = `${stamp()} ${m}`; console.log(line); appendFileSync(logFile, `${line}\n`); };

const suiteNames = (f) => [f.replace(/\.mjs$/, ''), f.replace(/\.mjs$/, '').replace(/^\d+-/, '')];
const suiteFiles = readdirSync(join(here, 'suites')).filter((f) => f.endsWith('.mjs')).sort()
  .filter((f) => !onlySuites || suiteNames(f).some((n) => onlySuites.includes(n)))
  .filter((f) => !skipSuites || !suiteNames(f).some((n) => skipSuites.includes(n)))
  .filter((f) => !chosen || chosen.has(f.replace(/\.mjs$/, '')));
let suites = [];
for (const f of suiteFiles) {
  const mod = await import(pathToFileURL(join(here, 'suites', f)).href);
  // A test that names its record types (`types`) is left out when the area filter does not visit them.
  const types = process.env.E2E_TYPES !== undefined && process.env.E2E_AREAS ? new Set(process.env.E2E_TYPES.split(',').filter(Boolean)) : null;
  // A test that names its areas (`areas`) is left out when none of them is affected.
  const areas = process.env.E2E_AREAS ? new Set(process.env.E2E_AREAS.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const tests = (mod.tests ?? [])
    .filter((t) => !types || !t.types || t.types.some((x) => types.has(x)))
    .filter((t) => !areas || !t.areas || t.areas.some((x) => areas.has(x)));
  suites.push({ name: f.replace(/\.mjs$/, '').replace(/^\d+-/, ''), file: f, tests });
}
// --shard i/n: this machine's share, by the minutes in tools/e2e/suite-map.mjs. A suite marked
// `split` is shared out test by test, any other one goes whole to one machine.
if (shard) {
  const [index, count] = shard;
  if (!(count >= 1 && index >= 1 && index <= count)) { console.error('--shard expects i/n, for example 2/4'); process.exit(2); }
  const { SUITES, shareOut } = await import('./suite-map.mjs');
  const units = [];
  for (const s of suites) {
    const key = s.file.replace(/\.mjs$/, '');
    const minutes = SUITES[key]?.minutes ?? 1;
    // A test marked everyShard runs on every machine that runs some of its suite (not shared out).
    if (SUITES[key]?.split && s.tests.length > 1) s.tests.forEach((t, i) => { if (!t.everyShard) units.push({ id: `${key}#${String(i).padStart(3, '0')}`, minutes: minutes / s.tests.length, suite: s, test: t }); });
    else units.push({ id: key, minutes, suite: s });
  }
  const mine = shareOut(units, count, index);
  suites = suites.map((s) => {
    const picked = s.tests.filter((t) => mine.some((u) => u.suite === s && (!u.test || u.test === t)));
    return { ...s, tests: picked.length ? s.tests.filter((t) => picked.includes(t) || t.everyShard) : [] };
  }).filter((s) => s.tests.length);
  console.log(`shard ${index}/${count}: ${suites.map((s) => `${s.name} (${s.tests.length})`).join(', ') || 'nothing'}`);
  if (!suites.length) process.exit(0);
}

if (chosen && !suites.some((s) => s.tests.length)) { log('No browser test to run for this selection.'); process.exit(0); }

const scratch = join(tmpdir(), `sandpiper-e2e-${process.pid}`);
const app = await startInstance({ dir: scratch, log });
const browser = await launchBrowser({ profileDir: join(scratch, 'profile'), headless: !has('--headed') });
log(`browser: ${browser.exe}`);

const results = [];
const reports = {}; // extra outputs suites hand back (e.g. the role matrix)
let failShot = 0;

for (const suite of suites) {
  log(`== ${suite.name}`);
  for (const test of suite.tests) {
    const full = `${suite.name}: ${test.name}`;
    if (grep && !grep.some((g) => full.toLowerCase().includes(g))) continue;
    // Fresh sessions for every test: a long run outlasts the 30-minute idle time-out.
    for (const u of Object.values(app.users)) if (u.password) u.token = await signIn(app.base, u.username, u.password).catch(() => u.token);
    const page = await browser.newPage({ base: app.base, width: test.width ?? 1440, theme: test.theme ?? 'light' });
    await page.setSession(app.users[test.as ?? 'administrator'].token);
    const t0 = Date.now();
    const notes = [];
    let current = '';
    const ctx = {
      app, page, browser, log, reports,
      users: app.users,
      api: (role = 'administrator') => app.api(app.users[role].token),
      /** A named step: logged with its time; a screenshot is saved if it throws. */
      async step(label, fn) {
        current = label;
        const s = Date.now();
        try {
          const out = await fn();
          log(`   ok  ${label} (${Date.now() - s} ms)`);
          return out;
        } catch (err) {
          log(`   FAIL ${label}: ${err.message}`);
          throw err;
        }
      },
      /** Records a problem without stopping the test; the test fails at the end. */
      soft(cond, message) { if (!cond) { notes.push(message); log(`   FAIL ${message}`); } return cond; },
      /** Signs the page in as another role (no reload; follow with a goto). */
      async as(role) { await page.setSession(app.users[role].token); },
      /** Fails on script errors and unexpected failed requests seen so far. */
      clean(where) {
        const problems = page.takeProblems();
        for (const p of problems) notes.push(`${where}: ${p}`);
        if (problems.length) log(`   FAIL ${where}: ${problems.join(' | ')}`);
        return problems.length === 0;
      },
    };
    log(`-- ${full}`);
    let error = null;
    try {
      await test.run(ctx);
      ctx.clean('end of test');
    } catch (err) {
      error = err;
    }
    if (error || notes.length) {
      const file = join(outDir, 'failures', `${String(++failShot).padStart(2, '0')}-${full.replace(/[^a-z0-9]+/gi, '-').slice(0, 70)}.png`);
      await page.screenshot(file).catch(() => null);
      results.push({ name: full, ok: false, ms: Date.now() - t0, error: error ? `${current ? `[${current}] ` : ''}${error.message}` : null, notes, shot: file });
      log(`   => FAILED (${Date.now() - t0} ms); screenshot ${file}`);
    } else {
      results.push({ name: full, ok: true, ms: Date.now() - t0 });
      log(`   => passed (${Date.now() - t0} ms)`);
    }
    await page.close().catch(() => null);
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
if (reports.roleMatrix) writeFileSync(join(outDir, 'role-matrix.md'), reports.roleMatrix);
if (failed.length) {
  const tail = app.serverLog().split('\n').filter((l) => /error|exception/i.test(l)).slice(-20).join('\n');
  if (tail) log(`server log (errors only, last 20 lines):\n${tail}`);
}
await app.stop({ keep: has('--keep') });
// The browser may hold its profile open for a moment after closing.
if (!has('--keep')) try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { log(`(could not remove ${scratch}; remove it by hand)`); }

log('');
log(`${results.length} tests, ${results.length - failed.length} passed, ${failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`);
for (const f of failed) {
  log(`FAILED ${f.name}${f.error ? `\n       ${f.error}` : ''}${f.notes.map((n) => `\n       - ${n}`).join('')}`);
}
if (reports.roleMatrix) log(`role x page matrix: ${join(outDir, 'role-matrix.md')}`);
log(`step log: ${logFile}`);
// No test at all is a failure, unless the area filter or the shard left none to run.
process.exit(failed.length || (results.length === 0 && !chosen && !shard) ? 1 : 0);
