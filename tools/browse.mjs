// Drives headless Edge over the DevTools protocol against a scratch server:
// visits each route signed in, records script errors and failed API calls, saves screenshots.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Usage: node tools/browse.mjs <baseUrl> <outDir> <username> <password> [light|dark] [width]
//   ROUTES=/a,/b limits the routes; DEBUG_PORT picks the browser's DevTools port (default 9333);
//   WAIT is the settle time per page in ms. Screenshots may show private data: keep outDir
//   outside the repository and delete it afterwards.
const [base, outDir, user, pass, theme = 'light', width = '1440'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-grc-csrf': '1' },
  body: JSON.stringify({ username: user, password: pass }),
});
const token = /grc_session=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1];
if (!token) throw new Error('login failed ' + login.status);
const api = async (u) => (await fetch(base + u, { headers: { cookie: `grc_session=${token}` } })).json();
const first = async (u) => (await api(u)).rows?.[0]?.id;

const routes = process.env.ROUTES ? process.env.ROUTES.split(',') : [
  '/', '/tickets', `/tickets/${await first('/api/tickets?pageSize=1')}`, '/tickets/dashboard', '/problems', '/knowledge', '/catalogue',
  '/systems', `/systems/${await first('/api/systems?pageSize=1')}`, '/systems/map', '/assets', `/assets/${await first('/api/assets?pageSize=1')}`,
  '/sites', '/data-categories', '/inventory/reports',
  '/vendors', `/vendors/${await first('/api/vendors?pageSize=1')}`, '/vendors/terms', '/contracts', '/contracts/renewals',
  '/frameworks', `/frameworks/outcomes/${await first('/api/framework-outcomes?pageSize=1')}`, '/assessments',
  '/risks', `/risks/${await first('/api/risks?pageSize=1')}`, '/actions', '/obligations',
  '/security-incidents', `/security-incidents/${await first('/api/security-incidents?pageSize=1')}`, '/security-incidents/kit',
  '/projects', `/projects/${await first('/api/projects?pageSize=1')}`,
  '/evidence', '/evidence/expiring', '/assets/import', '/projects/new', '/projects/settings', '/security-incidents/declare',
  '/security-incidents/rules', '/tickets?new=1', `/contracts/${await first('/api/contracts?pageSize=1')}`,
  `/knowledge/${await first('/api/knowledge-articles?pageSize=1')}`, `/problems/${await first('/api/problems?pageSize=1')}`,
  `/actions/${await first('/api/actions?pageSize=1')}`, `/sites/${await first('/api/sites?pageSize=1')}`,
  `/assessments/${await first('/api/assessment-snapshots?pageSize=1')}`,
  '/admin/users', '/admin/roles', '/admin/lists', '/admin/settings', '/admin/audit', '/account/security',
];

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const { existsSync } = await import('node:fs');
const exe = edge.find(existsSync);
const port = Number(process.env.DEBUG_PORT ?? 9333);
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, 'profile')}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 40; i++) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    break;
  } catch { await new Promise((r) => setTimeout(r, 250)); }
}
let seq = 0;
const pending = new Map();
let events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
for (const d of ['Runtime', 'Page', 'Network', 'Log']) await send(`${d}.enable`, {}, s);
await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: 900, deviceScaleFactor: 1, mobile: false }, s);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, s);
await send('Network.setCookie', { name: 'grc_session', value: token, url: base, httpOnly: true }, s);

// Optional scripted interaction: SCRIPT=<file.json> holds an array of steps, run in order in
// place of the route tour. Each step is an object with one of:
//   { "goto": "/path" }                 navigate (then settles for WAIT ms)
//   { "click": "css selector" }         real mouse click on the first match
//   { "clickText": "Save", "within": "css selector (optional)", "tag": "button,a (optional)" }
//   { "clickLabel": "Title" }           click the form control whose <label> is (or else starts with) this text
//   { "type": "text", "into": "css selector (optional: focus it first)" }
//   { "key": "Enter" }                  Enter, Escape, Tab, ArrowDown, ArrowUp, Backspace, or one character
//   { "waitFor": "css selector" }       up to 10 s
//   { "wait": 500 }                     milliseconds
//   { "eval": "js expression" }         printed in the output
//   { "shot": "name" }                  screenshot <name>-<theme>-<width>.png
// Script errors, failed API calls and failed steps are listed at the end.
if (process.env.SCRIPT) {
  const { readFileSync } = await import('node:fs');
  const steps = JSON.parse(readFileSync(process.env.SCRIPT, 'utf8').replace(/^﻿/, ''));
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s)).result?.value;
  const locate = async (finder) => evaluate(`(() => { const el = ${finder}; if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const click = async (finder, what) => {
    let at = null;
    for (let i = 0; i < 40 && !at; i++) { at = await locate(finder); if (!at) await sleep(250); }
    if (!at) throw new Error(`nothing matches ${what}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, s);
    }
  };
  const KEYS = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Home: 36, End: 35, ' ': 32 };
  const failures = [];
  const seen = new Set();
  for (const [n, step] of steps.entries()) {
    try {
      if (step.goto !== undefined) { await send('Page.navigate', { url: base + step.goto }, s); await sleep(Number(process.env.WAIT ?? 2800)); }
      else if (step.click) await click(`document.querySelector(${JSON.stringify(step.click)})`, step.click);
      else if (step.clickText) {
        await click(`[...(${step.within ? `document.querySelector(${JSON.stringify(step.within)})` : 'document'})?.querySelectorAll(${JSON.stringify(step.tag ?? 'button, a, [role=option], [role=menuitem], [role=tab], label, [role=radio]')}) ?? []].filter((e) => e.getClientRects().length).find((e) => e.innerText.trim().replace(/\\s+/g, ' ').includes(${JSON.stringify(step.clickText)}))`, `text "${step.clickText}"`);
      }
      else if (step.clickLabel) {
        await click(`(() => { const all = [...document.querySelectorAll('label')].filter((l) => l.getClientRects().length); const want = ${JSON.stringify(step.clickLabel)}; return (all.find((l) => l.innerText.replace(/\\s*\\*\\s*$/, '').trim() === want) ?? all.find((l) => l.innerText.trim().startsWith(want)))?.control; })()`, `the control labelled "${step.clickLabel}"`);
      }
      else if (step.type !== undefined) {
        if (step.into) await click(`document.querySelector(${JSON.stringify(step.into)})`, step.into);
        await send('Input.insertText', { text: step.type }, s);
      }
      else if (step.key) {
        const code = KEYS[step.key] ?? step.key.toUpperCase().charCodeAt(0);
        const text = step.key === 'Enter' ? '\r' : step.key.length === 1 ? step.key : undefined;
        await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: step.key, code: step.key.length === 1 ? undefined : step.key, windowsVirtualKeyCode: code, text }, s);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: step.key, windowsVirtualKeyCode: code }, s);
      }
      else if (step.waitFor) {
        let found = false;
        for (let i = 0; i < 40 && !found; i++) { found = await evaluate(`!!document.querySelector(${JSON.stringify(step.waitFor)})`); if (!found) await sleep(250); }
        if (!found) throw new Error(`timed out waiting for ${step.waitFor}`);
      }
      else if (step.wait) await sleep(step.wait);
      else if (step.eval) console.log(`eval[${n}]: ${JSON.stringify(await evaluate(step.eval))}`);
      else if (step.shot) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, s);
        writeFileSync(join(outDir, `${step.shot}-${theme}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      if (!step.wait && !step.shot && !step.goto) await sleep(350);
    } catch (err) {
      failures.push(`step ${n} ${JSON.stringify(step)}: ${err.message}`);
    }
    for (const e of events) {
      if (e.method === 'Runtime.exceptionThrown') seen.add('exception: ' + (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).slice(0, 300));
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') seen.add('console: ' + e.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) seen.add(`http ${e.params.response.status}: ${e.params.response.url.replace(base, '')}`);
    }
    events = [];
  }
  await send('Browser.close');
  proc.kill();
  console.log(`${steps.length} steps run, ${failures.length} failed`);
  for (const f of failures) console.log('  FAILED ' + f);
  for (const p of seen) console.log('  - ' + p);
  process.exit(0);
}

const report = [];
for (const [i, route] of routes.entries()) {
  events = [];
  if (route.includes('undefined')) { report.push({ route, problems: ['no record id found for this route'] }); continue; }
  await send('Page.navigate', { url: base + route }, s);
  await sleep(Number(process.env.WAIT ?? 2800));
  const problems = [];
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).slice(0, 300));
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') problems.push('log: ' + e.params.entry.text.slice(0, 200) + ' ' + (e.params.entry.url ?? ''));
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') problems.push('console: ' + e.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) problems.push(`http ${e.params.response.status}: ${e.params.response.url.replace(base, '')}`);
  }
  const { result } = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ h1: document.querySelector('h1')?.innerText ?? null, err: [...document.querySelectorAll('.error-state, [role=alert]')].map(e => e.innerText.slice(0,120)), len: document.body.innerText.length, wide: document.documentElement.scrollWidth > window.innerWidth + 2 })`,
    returnByValue: true,
  }, s);
  const page = JSON.parse(result.value);
  if (!page.h1) problems.push('no page heading rendered');
  if (page.err.length) problems.push('error shown: ' + page.err.join(' | '));
  if (page.wide) problems.push('page scrolls horizontally');
  const shot = await send('Page.captureScreenshot', { format: 'png' }, s);
  const file = `${String(i).padStart(2, '0')}${route.replace(/[^a-z]+/gi, '-').replace(/-[0-9a-f-]{20,}/, '-id').slice(0, 40)}-${theme}-${width}.png`;
  writeFileSync(join(outDir, file), Buffer.from(shot.data, 'base64'));
  report.push({ route: route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, ':id'), h1: page.h1, problems: [...new Set(problems)] });
}
await send('Browser.close');
proc.kill();
const bad = report.filter((r) => r.problems.length);
console.log(`${report.length} routes visited, ${bad.length} with problems`);
for (const r of bad) console.log(`\n${r.route}  [${r.h1}]\n  - ` + r.problems.join('\n  - '));
console.log('\nOK: ' + report.filter((r) => !r.problems.length).map((r) => r.route).join('  '));
process.exit(0);
