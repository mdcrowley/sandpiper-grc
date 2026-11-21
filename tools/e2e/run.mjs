// Browser tests: starts a throw-away instance (fresh data folder, free port, dev seed, one user per
// default role), drives headless Edge or Chrome over the DevTools protocol through every suite in
// tools/e2e/suites, and exits non-zero when anything fails.
//
//   npm run test:e2e                          every suite
//   npm run test:e2e -- --only smoke,roles    some suites (file names without .mjs, with or without the number)
//   npm run test:e2e -- --grep ticket,site    only tests whose name contains one of these
//   npm run test:e2e -- --headed              show the browser
//   npm run test:e2e -- --keep                keep the scratch data folder afterwards
//
// Environment: E2E_WEB_DIST (serve this web build; default: build one, about a minute),
// E2E_CALL_TIMEOUT_MS (a browser call that gets no answer fails after this long; default 120000),
// E2E_BROWSER (browser path), E2E_PORT, E2E_BASE (use an instance started by serve.mjs),
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
const grep = value('--grep')?.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

const here = import.meta.dirname;
const outDir = resolve(here, 'out');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'failures'), { recursive: true });
const logFile = join(outDir, 'log.txt');
writeFileSync(logFile, '');
const started = Date.now();
const stamp = () => `${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`;
export const log = (m) => { const line = `${stamp()} ${m}`; console.log(line); appendFileSync(logFile, `${line}\n`); };

const suiteFiles = readdirSync(join(here, 'suites')).filter((f) => f.endsWith('.mjs')).sort()
  .filter((f) => !onlySuites || [f.replace(/\.mjs$/, ''), f.replace(/\.mjs$/, '').replace(/^\d+-/, '')].some((n) => onlySuites.includes(n)));
const suites = [];
for (const f of suiteFiles) {
  const mod = await import(pathToFileURL(join(here, 'suites', f)).href);
  suites.push({ name: f.replace(/\.mjs$/, '').replace(/^\d+-/, ''), file: f, tests: mod.tests ?? [] });
}

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
process.exit(failed.length || results.length === 0 ? 1 : 0);
