// The GitHub workflow's "what changed" step (wave 27, .github/workflows/ci.yml). Works out the
// commit to compare with, the plan (tools/ci/plan.mjs), and writes the job switches and matrices to
// $GITHUB_OUTPUT and a summary to $GITHUB_STEP_SUMMARY.
//
//   node tools/ci/github.mjs                 the outputs for this event (reads GITHUB_* variables)
//   node tools/ci/github.mjs --unit-list f   writes the unit test files for BASE (environment; FULL=true: every test) to f;
//                                            prints "all" instead when every test runs
//
// The base: a pull request compares with the merge base of its target branch; a push with the
// commit before the push (github.event.before). When that commit is unknown (the first push of a
// branch: all zeros; a force push: a commit no longer in the history) it falls back to the merge base
// with main, and on main itself to the previous commit. Everything runs on the nightly schedule, on
// a version tag, when "full" is ticked on a manual run, when the workflow or the selection rules
// change, and when no base can be found.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { changedFiles, git, repoRoot } from './affected.mjs';
import { describe, plan, snapshot } from './plan.mjs';

const env = process.env;
const argv = process.argv.slice(2);

const isCommit = (ref) => { try { git(repoRoot, ['cat-file', '-e', `${ref}^{commit}`]); return true; } catch { return false; } };
const mergeBase = (ref) => { try { return git(repoRoot, ['merge-base', 'HEAD', ref]); } catch { return null; } };

/** { base, why } or { full: why }. */
export function chooseBase() {
  const event = env.GITHUB_EVENT_NAME ?? '';
  const ref = env.GITHUB_REF ?? '';
  let payload = {};
  try { payload = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {}; } catch { /* none */ }
  if (event === 'schedule') return { full: 'the nightly run' };
  if (ref.startsWith('refs/tags/')) return { full: `the release tag ${env.GITHUB_REF_NAME}` };
  if (event === 'workflow_dispatch' && String(payload.inputs?.full) === 'true') return { full: 'a manual full run' };
  if (env.GRC_CI_FULL === 'true') return { full: 'asked for a full run' };
  if (event === 'pull_request') {
    const target = payload.pull_request?.base?.ref ?? env.GITHUB_BASE_REF;
    const base = target && mergeBase(`origin/${target}`);
    return base ? { base, why: `the merge base with ${target}` } : { full: `the merge base with ${target} could not be found` };
  }
  const before = payload.before;
  if (before && !/^0+$/.test(before) && isCommit(before)) return { base: before, why: 'the commit before this push' };
  const onMain = ref === 'refs/heads/main';
  if (!onMain) {
    const base = mergeBase('origin/main');
    if (base) return { base, why: /^0+$/.test(before ?? '0') ? 'the merge base with main (first push of this branch)' : 'the merge base with main (the commit before this push is gone: a force push)' };
  }
  if (isCommit('HEAD~1')) return { base: git(repoRoot, ['rev-parse', 'HEAD~1']), why: 'the previous commit' };
  return { full: 'no commit to compare with' };
}

const ESCALATE = [/^\.github\/workflows\/ci\.yml$/, /^tools\/ci\//];

function output(name, value) {
  const line = `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

function main() {
  const snap = snapshot(repoRoot);
  if (argv[0] === '--unit-list') {
    const changed = env.BASE ? changedFiles(repoRoot, env.BASE)?.files ?? null : null;
    const p = plan(snap, changed, { full: env.FULL === 'true' || !env.BASE });
    if (p.tests.all) { console.log('all'); return; }
    writeFileSync(argv[1], `${[...p.tests.tests.keys()].sort().join('\n')}\n`);
    console.log(`${p.tests.tests.size} test files`);
    return;
  }
  let chosen = chooseBase();
  const changes = chosen.base ? changedFiles(repoRoot, chosen.base) : null;
  if (chosen.base && !changes) chosen = { full: 'the changed files could not be worked out' };
  const hit = changes?.files.find((f) => ESCALATE.some((re) => re.test(f)));
  if (hit) chosen = { full: `${hit} changed (the workflow or its selection rules)` };
  const p = plan(snap, chosen.full ? null : changes.files, { full: !!chosen.full });

  const full = p.full;
  const b = p.browser;
  const unitCount = p.tests.all ? Infinity : p.tests.tests.size;
  // Unit tests: four parts for every test, fewer for a smaller selection; Windows too.
  const unitParts = p.tests.all ? 4 : Math.min(4, Math.max(1, Math.ceil(unitCount / 60)));
  const unit = unitCount === 0 ? [] : [
    ...Array.from({ length: unitParts }, (_, i) => ({ os: 'ubuntu-latest', part: i + 1, of: unitParts })),
    ...Array.from({ length: p.tests.all ? 2 : 1 }, (_, i) => ({ os: 'windows-latest', part: i + 1, of: p.tests.all ? 2 : 1 })),
  ];
  // Browser tests: about twelve minutes per machine, at most eight machines.
  const browserParts = b.suites.length ? Math.min(8, Math.max(1, Math.ceil(b.minutes / 12))) : 0;
  const browser = Array.from({ length: browserParts }, (_, i) => ({ part: i + 1, of: browserParts }));
  const areas = full || b.everything ? '' : [...b.areas.keys()].join(',');
  const dbCode = full || (p.changed ?? []).some((f) => /^server\/src\/(core\/db|ops\/|.*\/migrations\/)/.test(f));

  output('full', String(full));
  output('base', chosen.base ?? '');
  output('unit', { include: unit });
  output('unit_any', String(unit.length > 0));
  output('database_server', String(p.jobs.databaseServer.run));
  output('browser', { include: browser });
  output('browser_any', String(browser.length > 0));
  output('browser_args', full || b.everything ? '' : `--affected --base ${chosen.base}`);
  output('browser_postgres', String(browser.length > 0 && dbCode));
  output('areas', areas);
  output('accessibility', String(p.jobs.accessibility.run));
  output('web_build', String(browser.length > 0 || p.jobs.accessibility.run || p.build.run));
  for (const k of ['container', 'install', 'mobile', 'apiClient']) output(k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), String(p.jobs[k].run));
  output('audit', String(p.audit.run));
  output('typecheck', String(p.typecheck.server || p.typecheck.web));

  const skippedAreas = full || b.everything ? 0 : snap.areas.size - b.areas.size;
  const lines = [
    '## What this run checks',
    '',
    full ? `**Everything** (${chosen.full}).` : `Compared with ${chosen.why} (\`${chosen.base.slice(0, 10)}\`): ${p.changed.length} changed file(s).`,
    '',
    full || b.everything ? `Affected: every area${b.why && !full ? ` (${b.why})` : ''}.`
      : `Affected: ${b.areas.size ? [...b.areas.keys()].join(', ') : 'no area'}; skipped: ${skippedAreas} areas.`,
    '',
    `Unit tests: ${p.tests.all ? `every test (${p.tests.reason})` : `${unitCount} file(s)`} on ${unit.length} machine(s). Browser: ${b.suites.length} suite(s), about ${Math.round(b.minutes)} minutes, on ${browserParts} machine(s).`,
    '',
    '<details><summary>The whole plan</summary>',
    '',
    '```',
    describe(p, changes ? { why: chosen.why } : null),
    '```',
    '</details>',
  ];
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main();
