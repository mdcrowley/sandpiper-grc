// Local continuous integration (`.\grc.ps1 ci`, `./grc.sh ci`), wave 27. By default it checks what
// changed since the merge base with main (on main: the last commit), plus uncommitted and new files
// (tools/ci/plan.mjs), and says what it skipped and why:
//   - typecheck: incremental (tsc's cache in node_modules/.cache/tsc), server and/or web as needed;
//   - unit tests: the tests the changed files need, then the same tests with the clock on UTC;
//   - web build: only when web/, shared/, docs/user/, vite.config.ts or the packages changed;
//   - dependency audit: only when package.json or package-lock.json changed.
// Options: --full (grc ci -Full, grc.sh ci --full) runs everything as before; --plan (grc ci -Plan)
// prints the plan, including the browser suites and GitHub jobs, and runs nothing; --base <ref>
// compares with another commit. Exit code 0 when every step that ran passed, 1 otherwise.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, repoRoot } from './affected.mjs';
import { describe, plan, snapshot } from './plan.mjs';

const argv = process.argv.slice(2);
const full = argv.includes('--full');
const planOnly = argv.includes('--plan') || argv.includes('--dry-run');
const baseAt = argv.indexOf('--base');
const base = baseAt >= 0 ? argv[baseAt + 1] : process.env.GRC_CI_BASE || undefined;

const tty = process.stdout.isTTY || process.env.FORCE_COLOR;
const color = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const [cyan, yellow, green, red] = [36, 33, 32, 31].map(color);

const node = process.execPath;
const bin = (pkg, file) => join(repoRoot, 'node_modules', pkg, file);
const cacheDir = join(repoRoot, 'node_modules', '.cache');

const snap = snapshot(repoRoot);
const changes = full ? null : changedFiles(repoRoot, base);
const p = plan(snap, changes?.files ?? null, { full });

if (planOnly) {
  console.log(describe(p, changes));
  process.exit(0);
}

console.log(cyan('== What this run checks'));
if (p.full) console.log(`Everything (${p.why}).`);
else {
  console.log(`${p.changed.length} changed file(s) ${changes.why}.`);
  for (const f of p.changed.slice(0, 15)) console.log(`  ${f}`);
  if (p.changed.length > 15) console.log(`  ... and ${p.changed.length - 15} more`);
}

const steps = [];
const skipped = [];
const skip = (name, why) => skipped.push({ name, why });

// Typecheck, incremental: tsc keeps what it learned and checks again only what changed.
const tsc = (project) => [node, bin('typescript', 'bin/tsc'), '--noEmit', '-p', project, '--incremental', '--tsBuildInfoFile', join(cacheDir, 'tsc', `${project}.tsbuildinfo`)];
if (p.typecheck.server) steps.push({ name: 'Typecheck (server)', cmd: tsc('server') });
else skip('Typecheck (server)', 'nothing in server/, shared/, the packages or the TypeScript settings changed');
if (p.typecheck.web) steps.push({ name: 'Typecheck (web)', cmd: tsc('web') });
else skip('Typecheck (web)', 'nothing in web/, shared/, the packages or the TypeScript settings changed');

// Unit tests, then the same tests with the clock on UTC.
const vitest = [node, bin('vitest', 'vitest.mjs'), 'run'];
let testEnv = {};
let note = '';
if (p.tests.all) note = `every test (${p.tests.reason})`;
else if (p.tests.tests.size === 0) {
  skip('Tests', 'no test covers the changed files');
  skip('Tests on UTC', 'no test covers the changed files');
} else {
  const list = [...p.tests.tests.keys()].sort();
  mkdirSync(join(cacheDir, 'grc-ci'), { recursive: true });
  const listFile = join(cacheDir, 'grc-ci', 'tests.txt');
  writeFileSync(listFile, `${list.join('\n')}\n`);
  testEnv = { GRC_TEST_LIST: listFile };
  const reasons = new Map();
  for (const why of p.tests.tests.values()) {
    const k = why.startsWith('imports ') ? 'import a changed file' : why.startsWith('area ') ? `in area ${why.split(' ')[1]}` : why;
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  note = `${list.length} of the test files (${[...reasons].map(([k, n]) => `${n} ${k}`).join('; ')})`;
}
if (p.tests.all || p.tests.tests.size) {
  steps.push({ name: 'Tests', cmd: vitest, env: testEnv, note });
  steps.push({ name: 'Tests on UTC', cmd: vitest, env: { ...testEnv, TZ: 'UTC' }, note });
}

if (p.build.run) steps.push({ name: 'Web build', cmd: [node, bin('vite', 'bin/vite.js'), 'build'] });
else skip('Web build', p.build.why);

if (p.audit.run) steps.push({ name: 'Dependency audit', cmd: [node, bin('tsx', 'dist/cli.mjs'), 'server/src/cli.ts', 'audit-deps'], audit: true });
else skip('Dependency audit', p.audit.why);

for (const s of steps) console.log(`  run   ${s.name}${s.note ? `: ${s.note}` : ''}`);
for (const s of skipped) console.log(yellow(`  skip  ${s.name}: ${s.why}`));
if (!p.full) {
  const b = p.browser;
  const suites = b.suites.map((s) => s.suite.replace(/^\d+-/, '')).join(',');
  console.log(b.suites.length
    ? `Browser tests for this change (not run by grc ci): npm run test:e2e -- --affected   (${suites}; about ${Math.round(b.minutes)} min)`
    : 'Browser tests: none needed for this change.');
  console.log('Everything (every test twice, the build and the audit): grc ci -Full (Windows) or ./grc.sh ci --full. The plan alone: grc ci -Plan.');
}

const failed = [];
const times = [];
for (const s of steps) {
  console.log(cyan(`== ${s.name}`));
  const started = Date.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, ...(s.env ?? {}) } });
  times.push(`${s.name} ${Math.round((Date.now() - started) / 1000)} s`);
  // The audit needs the npm registry: without a network (exit 3) it is a warning, not a failure.
  if (s.audit && r.status === 3) { console.log(yellow('Dependency audit skipped: the npm registry could not be reached.')); continue; }
  if (r.status !== 0) failed.push(s.name);
}
console.log(`Times: ${times.join(', ') || 'nothing ran'}.`);
if (failed.length) {
  console.log(red(`CI FAILED: ${failed.join(', ')}`));
  process.exit(1);
}
console.log(green(p.full ? 'CI passed (full run): typecheck, tests, tests on UTC, web build and dependency audit.'
  : `CI passed for the changed files${skipped.length ? `; skipped: ${skipped.map((s) => s.name).join(', ')}` : ''}.`));
