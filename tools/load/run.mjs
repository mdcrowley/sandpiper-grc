#!/usr/bin/env node
// Sandpiper GRC load test (E16-14). Node.js built-ins only: no packages, no outside services.
//
// It starts a throw-away instance of the application in a scratch data folder (or uses one you
// name with --base), fills it with an invented volume of records through the API, then measures
// how long people wait for lists, searches, the Overview dashboard, single records and saves while
// several of them use it at once, and (with --ops) how long backup, export, import and restore
// take at that volume. The results are printed as a table and written to --out as JSON and
// Markdown. See tools/load/README.md and docs/operations.md, "Performance".
//
//   node tools/load/run.mjs                          # scale 1, 8 people at once, 15 s per scenario
//   node tools/load/run.mjs --scale 4 --concurrency 16 --duration 30 --ops
//   node tools/load/run.mjs --base http://127.0.0.1:8080 --user admin --password ...   (a running instance: adds records to it!)
//
// Never point it at a real installation: it creates thousands of invented records.

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------------------------------------
// Options

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
if (flag('help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
let scale = Number(opt('scale', '1')); // with --reuse: the scale of the kept records
const concurrency = Number(opt('concurrency', '8'));
const duration = Number(opt('duration', '15')) * 1000;
const port = Number(opt('port', process.env.GRC_PORT ?? '8190'));
const outDir = resolve(opt('out', join(root, 'tools/load/out')));
const ops = flag('ops');
const keep = flag('keep');
const only = opt('only', '') ? opt('only', '').split(',') : null;
// A folder kept by an earlier run (--keep): its data is copied and measured again without seeding.
const reuse = opt('reuse', '') ? resolve(opt('reuse', '')) : '';
const seedOnly = flag('seed-only');
let base = opt('base', '');
if (reuse && base) throw new Error('--reuse starts its own instance; leave out --base.');
const user = opt('user', 'loadtest');
const password = opt('password', 'load-test-Passw0rd-only');

// Records per type at scale 1. A transit organization of a few hundred staff might have tens of
// thousands of tickets over some years, a few thousand assets, hundreds of risks and vendors.
const VOLUME = {
  ticket: 10000, asset: 3000, system: 300, site: 60, vendor: 400, contract: 600, risk: 400, action: 2000,
  change: 1500, vulnerability: 1500, policy: 120, project: 150, vehicle: 400, hazard: 300, knowledge_article: 400,
};

// Invented text for titles and descriptions (nothing real). Real text is far from uniform: a few
// words are in many records and most words are in few (E16-38). Words are therefore drawn with a
// Zipf distribution (the word of rank r about 1/r as often as the first) from a vocabulary of a
// few hundred, transit and IT words first, so common words match thousands of records and most
// match a handful. Searches pick a word of the vocabulary at random, as people search for the
// particular thing they want, sometimes two words, sometimes a code or a word nothing contains.
const WORDS = ('depot bus railcar platform fare validator dispatch radio signal shelter timetable route garage ' +
  'paratransit scheduling camera badge door brake battery charger network switch firewall laptop tablet printer ' +
  'portal backup outage update patch training inspection hazard slip lighting ramp escalator elevator kiosk ' +
  'invoice renewal contract license audit review policy exception incident alert phishing password account ' +
  'access request replacement failure delay noise leak heater cooling sensor counter display announcement ' +
  'server router cable fiber antenna modem keyboard monitor screen mouse headset phone voicemail email mailbox ' +
  'calendar spreadsheet report dashboard database query login token certificate encryption malware virus ' +
  'quarantine scanner vulnerability firmware driver installer subscription renewal warranty repair ' +
  'maintenance overhaul wheel axle tire wiper mirror seat handrail stanchion ticket machine turnstile gate ' +
  'barrier fence canopy bench bin graffiti vandalism litter spill fuel diesel electric hybrid hydrogen pantograph ' +
  'catenary substation transformer breaker fuse generator inverter compressor pump valve pipe drain gutter roof ' +
  'window glass frame panel bracket bolt weld crack corrosion rust paint coating marking stripe sign beacon ' +
  'horn bell chime speaker intercom alarm smoke fire extinguisher sprinkler exit stair corridor tunnel bridge ' +
  'viaduct track rail sleeper ballast switchgear interlocking crossing level siding yard workshop wash bay ' +
  'lift hoist crane forklift pallet shelf locker uniform glove helmet vest goggles harness ladder scaffold ' +
  'driver operator mechanic technician supervisor controller planner analyst manager inspector cleaner guard ' +
  'passenger customer complaint feedback survey compliment refund claim lost property wheelchair stroller ' +
  'bicycle rack accessibility hearing loop braille tactile paving announcement audio visual timetable headway ' +
  'frequency punctuality detour diversion closure roadwork weather snow ice flood heat wind storm lightning ' +
  'power cut blackout restart reboot freeze crash slow timeout error warning message popup notification ' +
  'sync upload download transfer import export archive retention deletion privacy consent breach exposure ' +
  'leakage disclosure ransom extortion spoofing impersonation fraud theft loss damage injury collision ' +
  'near miss trip fall burn cut strain fatigue stress shift roster overtime leave absence handover briefing ' +
  'toolbox talk drill exercise rehearsal tabletop scenario plan procedure checklist standard guideline ' +
  'framework control objective outcome evidence finding observation recommendation remediation mitigation ' +
  'owner deadline milestone budget estimate quote purchase order receipt delivery shipment supplier ' +
  'onboarding offboarding termination transfer promotion vacancy recruitment induction mentoring coaching').split(' ');
let seed = 42;
let serial = 0;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
// Cumulative Zipf weights over WORDS, for a binary search per word.
const ZIPF = (() => {
  const acc = [];
  let sum = 0;
  for (let r = 1; r <= WORDS.length; r++) acc.push((sum += 1 / r));
  return acc.map((v) => v / sum);
})();
const zipfWord = () => {
  const x = rand();
  let lo = 0;
  let hi = ZIPF.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ZIPF[mid] < x) lo = mid + 1; else hi = mid;
  }
  return WORDS[lo];
};
const phrase = (n) => Array.from({ length: n }, zipfWord).join(' ');
const sentence = () => `${phrase(1)[0].toUpperCase()}${phrase(8).slice(1)}.`;
/** What one person types into a search box: usually one word, sometimes two, a number or a miss. */
const searchText = () => {
  const x = rand();
  if (x < 0.65) return pick(WORDS);
  if (x < 0.85) return `${pick(WORDS)} ${pick(WORDS)}`;
  if (x < 0.95) return String(Math.floor(rand() * 99999));
  return `${pick(WORDS)}x${Math.floor(rand() * 99)}`; // a typing mistake: matches nothing
};

// ---------------------------------------------------------------------------------------------
// HTTP

let cookie = '';
/** Network failures (no answer at all), counted and reported; a request is tried again once. */
let networkErrors = 0;
async function call(method, path, body) {
  const started = performance.now();
  const send = () => fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-grc-csrf': '1', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let res;
  try {
    res = await send();
  } catch (err) {
    // A dropped keep-alive connection is retried once; a stopped instance is reported with its output.
    networkErrors++;
    if (serverExit) throw new Error(`the instance stopped (${serverExit}); its last output:
${serverTail.join('')}`);
    if (process.env.LOAD_VERBOSE) console.error(`  network error on ${method} ${path}: ${err.cause?.code ?? err.message}; trying again`);
    res = await send();
  }
  const text = await res.text();
  const ms = performance.now() - started;
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, ms, headers: res.headers };
}

async function waitHealthy(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Runs `fn(i)` for i in 0..n-1 with `width` at a time. */
async function pool(n, width, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(width, n) }, async () => {
    while (next < n) await fn(next++);
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------------------------
// The instance

const scratch = base ? null : mkdtempSync(join(opt('data-parent', tmpdir()), 'grc-load-'));
const env = {
  ...process.env,
  GRC_DATA_DIR: scratch ? join(scratch, 'data') : process.env.GRC_DATA_DIR,
  GRC_BACKUP_DIR: scratch ? join(scratch, 'backups') : process.env.GRC_BACKUP_DIR,
  GRC_SEED_DIR: scratch ? join(scratch, 'no-seed') : process.env.GRC_SEED_DIR,
  GRC_PORT: String(port),
  GRC_LOG_REQUESTS: 'off',
};
const tsx = join(root, 'node_modules/tsx/dist/cli.mjs');
let server = null;
/** Why the instance stopped, when it stopped on its own; and the last of its output. */
let serverExit = '';
const serverTail = [];

function startServer() {
  server = spawn(process.execPath, [tsx, 'server/src/main.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const keep = (d) => { serverTail.push(String(d)); if (serverTail.length > 40) serverTail.shift(); };
  server.stderr.on('data', (d) => { keep(d); if (process.env.LOAD_VERBOSE) process.stderr.write(d); });
  server.stdout.on('data', keep);
  const mine = server;
  mine.on('exit', (code, signal) => { if (server === mine) serverExit = `exit code ${code}${signal ? `, signal ${signal}` : ''}`; });
}
async function stopServer() {
  if (!server || serverExit) { server = null; return; }
  const stopping = server;
  server = null; // an exit from here on is expected
  writeFileSync(join(env.GRC_DATA_DIR, 'grc.stop'), '');
  await new Promise((r) => { stopping.on('exit', r); setTimeout(r, 30000); });
}
function cli(...args) {
  const started = performance.now();
  const r = spawnSync(process.execPath, [tsx, 'server/src/cli.ts', ...args], { cwd: root, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cli ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return { ms: performance.now() - started, out: r.stdout };
}

// ---------------------------------------------------------------------------------------------
// Seeding

async function signIn() {
  if (scratch && !reuse) {
    const r = await call('POST', '/api/setup', { username: user, email: 'loadtest@example.test', displayName: 'Load test', password, secondFactor: 'notice' });
    if (r.status !== 200) throw new Error(`setup failed: ${r.status} ${JSON.stringify(r.json)}`);
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
    return;
  }
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-grc-csrf': '1' }, body: JSON.stringify({ username: user, password }) });
  if (!r.ok) throw new Error(`sign-in failed: ${r.status}`);
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
}

let meta;
let me;
const created = {}; // type -> ids

function valueFor(name, field, type) {
  switch (field.type) {
    // A number that never repeats, so a field that must be unique (a fleet number) is.
    case 'text': return name === 'ref' ? undefined : `${phrase(3)} ${10000 + ++serial}`;
    case 'longtext': return `${sentence()} ${sentence()}`;
    case 'number': return Math.floor(rand() * 100);
    case 'currency': return Math.round(rand() * 50000);
    case 'date': {
      const d = new Date(Date.UTC(2025, 0, 1) + Math.floor(rand() * 900) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    case 'datetime': return new Date(Date.UTC(2025, 0, 1) + Math.floor(rand() * 900 * 86400000)).toISOString();
    case 'boolean': return rand() < 0.3;
    case 'lookup': {
      const values = meta.lookups[field.list] ?? [];
      return values.length ? pick(values).value : undefined;
    }
    case 'user': return me;
    case 'ref': {
      const ids = created[field.to];
      return ids?.length ? pick(ids) : undefined;
    }
    default: return undefined;
  }
}

// Fields filled beyond the required ones: words to search, lists to filter and group by, people.
// Optional dates, numbers, references and free text are left out: their rules (an end after a
// start, a four-digit year, an e-mail address) differ by type, and they add nothing to the timing.
const FILLED = new Set(['longtext', 'lookup', 'user']);
const OVERRIDES = { action: { source: 'other' } };

function recordFor(type) {
  const def = meta.resources[type];
  const body = {};
  for (const [name, field] of Object.entries(def.fields)) {
    if (field.readOnly || field.custom || name === 'restricted' || field.type === 'json') continue;
    if (!field.required && (!FILLED.has(field.type) || (field.type === 'lookup' && field.default !== undefined && rand() < 0.5))) continue;
    const v = valueFor(name, field, type);
    if (v !== undefined) body[name] = v;
  }
  if (def.titleField && def.fields[def.titleField]?.type === 'text') body[def.titleField] = `${phrase(4)} ${Math.floor(rand() * 99999)}`;
  return { ...body, ...(OVERRIDES[type] ?? {}) };
}

/** Creates one record; a value refused by a type's own rule is left out and the record tried again. */
async function create(type, body) {
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await call('POST', meta.resources[type].path, body);
    const fields = r.json?.error?.fields;
    if (r.status !== 400 || !fields) break;
    const named = Object.keys(fields).filter((f) => f in body && !meta.resources[type].fields[f]?.required);
    if (!named.length) break;
    for (const f of named) delete body[f];
  }
  if (r.status === 400) {
    // A rule that depends on a combination: the required fields and the title only.
    const def = meta.resources[type];
    const minimal = Object.fromEntries(Object.entries(body).filter(([k]) => def.fields[k]?.required || k === def.titleField || k in (OVERRIDES[type] ?? {})));
    r = await call('POST', def.path, minimal);
  }
  return r;
}

async function seedAll() {
  meta = (await call('GET', '/api/meta')).json;
  me = (await call('GET', '/api/auth/state')).json?.user?.id;
  const report = [];
  // Types that others refer to first.
  const order = ['site', 'system', 'vendor', 'contract', 'asset', 'project', 'policy', 'vehicle', 'risk', 'ticket', 'change', 'vulnerability', 'action', 'hazard', 'knowledge_article'];
  for (const type of order) {
    if (!meta.resources[type]) continue;
    const n = Math.round((VOLUME[type] ?? 0) * scale);
    const started = performance.now();
    let failed = 0;
    let firstError = '';
    created[type] = [];
    await pool(n, 8, async () => {
      const r = await create(type, recordFor(type));
      if (r.status === 200 || r.status === 201) created[type].push(r.json.id);
      else { failed++; firstError ||= `${r.status} ${JSON.stringify(r.json?.error ?? r.json).slice(0, 200)}`; }
    });
    const s = (performance.now() - started) / 1000;
    report.push({ type, created: created[type].length, failed, seconds: Math.round(s * 10) / 10, perSecond: Math.round(created[type].length / s) });
    console.log(`  ${type.padEnd(18)} ${String(created[type].length).padStart(6)} created in ${s.toFixed(1)} s${failed ? `, ${failed} refused (${firstError})` : ''}`);
  }
  return report;
}

// ---------------------------------------------------------------------------------------------
// Scenarios

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

async function measure(name, once) {
  const times = [];
  let errors = 0;
  let firstError = '';
  const until = Date.now() + duration;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (Date.now() < until) {
      const t0 = performance.now();
      try {
        const bad = await once();
        if (bad) { errors++; firstError ||= bad; }
      } catch (err) {
        errors++;
        firstError ||= err.message;
      }
      times.push(performance.now() - t0);
    }
  }));
  const secs = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  const row = {
    scenario: name, requests: times.length, errors, perSecond: Math.round(times.length / secs),
    p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)), p99: Math.round(percentile(times, 99)), max: Math.round(times.at(-1) ?? 0),
    ...(firstError ? { firstError } : {}),
  };
  console.log(`  ${name.padEnd(34)} ${String(row.requests).padStart(6)} req  ${String(row.perSecond).padStart(5)}/s  p50 ${String(row.p50).padStart(5)} ms  p95 ${String(row.p95).padStart(5)} ms  p99 ${String(row.p99).padStart(5)} ms${errors ? `  ${errors} errors (${firstError})` : ''}`);
  return row;
}

const ok = (r) => (r.status >= 400 ? `${r.status} ${JSON.stringify(r.json?.error ?? '').slice(0, 120)}` : null);

async function scenarios() {
  const rows = [];
  const tickets = meta.resources.ticket?.path ?? '/api/tickets';
  const total = created.ticket?.length ?? 0;
  const lists = Object.values(meta.resources).filter((d) => (created[d.type]?.length ?? 0) > 0);
  const run = async (name, fn) => { if (!only || only.some((o) => name.includes(o))) rows.push(await measure(name, fn)); };

  await run('ticket list, first page', async () => ok(await call('GET', `${tickets}?page=1&pageSize=50`)));
  await run('ticket list, random page, sorted', async () => ok(await call('GET', `${tickets}?page=${1 + Math.floor(rand() * Math.max(1, total / 50))}&pageSize=50&sort=title&dir=asc`)));
  await run('ticket list, filtered by status', async () => {
    const status = pick(meta.lookups.ticket_status ?? [{ value: 'new' }]).value;
    return ok(await call('GET', `${tickets}?f.status=${status}&pageSize=50`));
  });
  await run('ticket list, full-text query', async () => ok(await call('GET', `${tickets}?q=${encodeURIComponent(searchText())}&pageSize=50`)));
  await run('ticket stats by status', async () => ok(await call('GET', `${tickets}/stats?group=status`)));
  await run('any list, first page (all types)', async () => ok(await call('GET', `${pick(lists).path}?page=1&pageSize=50`)));
  await run('global search', async () => ok(await call('GET', `/api/search?q=${encodeURIComponent(searchText())}`)));
  await run('one record', async () => {
    const d = pick(lists);
    return ok(await call('GET', `${d.path}/${pick(created[d.type])}`));
  });

  // The Overview page: everything it asks for at once, timed until the last answer.
  const overview = ['/api/dashboards/home', '/api/tickets/metrics', '/api/risks/summary', '/api/actions/summary', '/api/vulnerabilities/summary',
    '/api/projects/portfolio', '/api/contracts/renewals', '/api/security-incidents/clocks', '/api/training/summary', `${tickets}/stats?group=status`,
    '/api/notifications?unread=true&pageSize=5', '/api/me/watching'];
  const present = [];
  for (const path of overview) if ((await call('GET', path)).status !== 404) present.push(path);
  const parts = Object.fromEntries(present.map((p) => [p, []]));
  await run(`overview dashboard (${present.length} calls together)`, async () => {
    const all = await Promise.all(present.map((p) => call('GET', p)));
    all.forEach((r, i) => parts[present[i]].push(r.ms));
    return all.map(ok).find(Boolean) ?? null;
  });
  // Which of the Overview's calls people waited for: the 95th percentile of each, under the same load.
  const overviewRow = rows.find((r) => r.scenario.startsWith('overview'));
  if (overviewRow) {
    overviewRow.calls = Object.fromEntries(Object.entries(parts).map(([p, t]) => [p, Math.round(percentile(t.sort((a, b) => a - b), 95))]));
    console.log(`    each call, p95 ms: ${Object.entries(overviewRow.calls).map(([p, ms]) => `${p.replace('/api/', '')} ${ms}`).join(', ')}`);
  }

  await run('save: create a ticket', async () => {
    const r = await create('ticket', recordFor('ticket'));
    if (r.status < 400) created.ticket.push(r.json.id);
    return ok(r);
  });
  await run('save: update a ticket', async () => ok(await call('PATCH', `${tickets}/${pick(created.ticket)}`, { description: sentence() })));
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Operations at volume (--ops): the server is stopped for these, as the commands require.

async function operations() {
  const rows = [];
  const time = (name, fn) => {
    const { ms, out } = fn();
    rows.push({ operation: name, seconds: Math.round(ms / 100) / 10 });
    console.log(`  ${name.padEnd(34)} ${(ms / 1000).toFixed(1)} s   ${out.trim().split('\n')[0].slice(0, 100)}`);
  };
  await stopServer();
  time('backup (offline copy, verified)', () => cli('backup', '--label', 'load-test'));
  const exportDir = join(scratch, 'export');
  time('export-all (JSON Lines)', () => cli('export-all', '--out', exportDir));
  time('verify-backup', () => cli('verify-backup', 'latest'));
  // --force: a throw-away copy; another person's new migration in the same working tree must not stop it.
  time('restore (from the backup)', () => cli('restore', 'latest', '--force'));
  const imported = { ...env, GRC_DATA_DIR: join(scratch, 'imported') };
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [tsx, 'server/src/cli.ts', 'import-all', exportDir], { cwd: root, env: imported, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`import-all failed: ${r.stderr || r.stdout}`);
  rows.push({ operation: 'import-all into an empty installation', seconds: Math.round((performance.now() - t0) / 100) / 10 });
  console.log(`  ${'import-all into an empty installation'.padEnd(34)} ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const size = spawnSync(process.execPath, [tsx, 'server/src/cli.ts', 'status', '--json'], { cwd: root, env, encoding: 'utf8' });
  try { rows.push({ operation: 'data folder size (MB)', seconds: Math.round(JSON.parse(size.stdout).dataBytes / 1048576) }); } catch { /* left out */ }
  return rows;
}

// ---------------------------------------------------------------------------------------------

function markdown(result) {
  const lines = [
    `# Load test, ${result.at}`,
    '',
    `Scale ${result.scale}, ${result.concurrency} people at once, ${result.durationSeconds} s per scenario, ${result.database}.`,
    `Machine: ${result.machine.cpus} x ${result.machine.cpu}, ${result.machine.memoryGb} GB, ${result.machine.platform}, Node.js ${result.machine.node}. Version ${result.version}.`,
    `Requests that got no answer at all (each tried again once): ${result.networkErrors}.${result.startSeconds !== null ? ` The instance started (answered) in ${result.startSeconds} s.` : ''}`,
    '',
    '| Records | Created | Refused | Seconds | Per second |', '|---|---:|---:|---:|---:|',
    ...result.seeded.map((s) => `| ${s.type} | ${s.created} | ${s.failed} | ${s.seconds} | ${s.perSecond} |`),
    '',
    '| Scenario | Requests | Errors | Per second | p50 ms | p95 ms | p99 ms | max ms |', '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...result.scenarios.map((r) => `| ${r.scenario} | ${r.requests} | ${r.errors} | ${r.perSecond} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} |`),
  ];
  const overview = result.scenarios.find((r) => r.calls);
  if (overview) {
    lines.push('', '| Overview call (under the same load) | p95 ms |', '|---|---:|', ...Object.entries(overview.calls).map(([p, ms]) => `| ${p} | ${ms} |`));
  }
  if (result.operations?.length) {
    lines.push('', '| Operation | Seconds |', '|---|---:|', ...result.operations.map((o) => `| ${o.operation} | ${o.seconds} |`));
  }
  return `${lines.join('\n')}\n`;
}

/** Seconds from starting the instance until it answered (its start-up work at this volume, E16-39). */
let startSeconds = null;

async function main() {
  if (!base) {
    if (!existsSync(tsx)) throw new Error('Install the packages first (npm install).');
    base = `http://127.0.0.1:${port}`;
    mkdirSync(env.GRC_SEED_DIR, { recursive: true });
    if (reuse) {
      if (!existsSync(join(reuse, 'data')) || !existsSync(join(reuse, 'created.json'))) throw new Error(`${reuse} is not a folder kept by --keep (no data or created.json).`);
      console.log(`Copying the data kept in ${reuse}...`);
      cpSync(join(reuse, 'data'), env.GRC_DATA_DIR, { recursive: true, filter: (src) => !/grc\.(pid|stop)$/.test(src) });
    }
    console.log(`Starting a throw-away instance in ${scratch} on port ${port}...`);
    const t0 = performance.now();
    startServer();
    if (!(await waitHealthy(300000))) throw new Error(`The instance did not start${serverExit ? ` (${serverExit}): ${serverTail.join('').slice(-1500)}` : ' (LOAD_VERBOSE=1 shows its output)'}.`);
    startSeconds = Math.round((performance.now() - t0) / 100) / 10;
    console.log(`  started in ${startSeconds} s`);
  } else {
    console.log(`Using ${base}: it gets thousands of invented records.`);
  }
  await signIn();
  let seeded;
  if (reuse) {
    const kept = JSON.parse(readFileSync(join(reuse, 'created.json'), 'utf8'));
    meta = (await call('GET', '/api/meta')).json;
    me = (await call('GET', '/api/auth/state')).json?.user?.id;
    Object.assign(created, kept.created);
    seeded = kept.seeded;
    scale = kept.scale;
    console.log(`Measuring the records kept in ${reuse} (scale ${kept.scale}).`);
    // A copied folder starts with the planner statistics of when it was kept; the embedded database
    // gathers them again shortly after it starts (core/db.ts). Measure after that, as a long-running
    // installation would be.
    await new Promise((r) => setTimeout(r, 12_000));
  } else {
    console.log(`Seeding (scale ${scale})...`);
    seeded = await seedAll();
    // Kept beside the data, so that --reuse can measure the same records again.
    if (scratch) writeFileSync(join(scratch, 'created.json'), JSON.stringify({ scale, seeded, created }));
  }
  if (seedOnly) {
    console.log('Seeded; nothing measured (--seed-only, usually with --keep).');
    return 0;
  }
  console.log(`Measuring (${concurrency} at once, ${duration / 1000} s each)...`);
  const rows = await scenarios();
  const state = (await call('GET', '/api/version')).json;
  let opsRows = [];
  if (ops && scratch) {
    console.log('Operations at this volume (server stopped)...');
    opsRows = await operations();
  }
  const result = {
    at: new Date().toISOString(), version: state?.version ?? 'unknown', scale, concurrency, durationSeconds: duration / 1000,
    database: process.env.GRC_DATABASE_URL ? 'PostgreSQL server' : 'embedded database',
    machine: { cpus: cpus().length, cpu: cpus()[0]?.model.trim(), memoryGb: Math.round(totalmem() / 1073741824), platform: `${process.platform}-${process.arch}`, node: process.version },
    startSeconds, seeded, scenarios: rows, operations: opsRows, networkErrors,
  };
  mkdirSync(outDir, { recursive: true });
  const stamp = result.at.replace(/[:.]/g, '-');
  writeFileSync(join(outDir, `load-${stamp}.json`), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, `load-${stamp}.md`), markdown(result));
  console.log(`Results: ${join(outDir, `load-${stamp}.md`)}`);
  const errors = rows.reduce((n, r) => n + r.errors, 0);
  return errors ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`Load test failed: ${err.message}`);
} finally {
  await stopServer();
  if (scratch && !keep) rmSync(scratch, { recursive: true, force: true });
  else if (scratch) console.log(`Kept ${scratch}`);
}
process.exit(code);
