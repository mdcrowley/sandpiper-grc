// Drives headless Edge (or Chrome/Chromium) over the DevTools protocol against a scratch server:
// visits each route signed in, records script errors and failed API calls, saves screenshots.
//
// Usage:
//   node tools/browse.mjs <baseUrl> <outDir> <username> <password> [light|dark] [width] [flags]
//
// Screenshots may show private data: keep outDir outside the repository and delete it afterwards.
//
// Flags (anywhere on the command line):
//   --print                 emulate print media (same as MEDIA=print) for the tour and for scripts
//   --user2 name:password   a second account (same as USER2 / PASS2), for { "signInAs": 2 } and --as2
//   --as2                   run the route tour as the second account
//   --all-routes            tour every static route the web application registers, in place of the
//                           built-in list: after "/" has loaded, the application sets
//                           window.__grcRoutes to an array of every module route path (waited for,
//                           up to 10 s). Paths without ":" or "*" are visited; the rest are listed
//                           as skipped. Wins over ROUTES.
//   --insecure-tls          accept an untrusted (self-signed) certificate on an https:// baseUrl, both
//                           here and in the browser. For local testing only
//
// Environment:
//   ROUTES=/a,/b     visit only these routes
//   DEBUG_PORT       the browser's DevTools port (default 9333); use your own when several run
//   WAIT             settle time per page in ms (default 2800)
//   MEDIA=print      emulate print media (default screen); screenshot names then end in -print
//   USER2, PASS2     the second account
//   TOTP_KEY, CODE   for an account that has a second factor: its authenticator key in base32
//                    (the current code is worked out from it), or a ready-made code such as a
//                    single-use recovery code. TOTP_KEY2 and CODE2 are the same for the second account
//   HEIGHT           window height in pixels (default 900); a tall one shows a long page in one shot
//   PDF=1            the route tour also saves each page as a paginated PDF beside its screenshot
//   SCRIPT=<file>    run scripted steps in place of the route tour (see below)
//   VIRTUAL_AUTHENTICATOR=1
//                    give the browser a software passkey device (DevTools WebAuthn domain: platform
//                    authenticator, stores passkeys, user verified, presence confirmed automatically),
//                    so scripts can add a passkey and sign in with it. Use a host name base URL such as
//                    http://localhost:<port>: browsers refuse passkeys at an IP address
//
// Route tour. For each route: load it, wait WAIT ms and then until no ".route-loading" element
// is left (shown while a lazily loaded page arrives; up to 10 s), then report script errors,
// console errors, HTTP 4xx/5xx responses, a missing <h1>, visible error states and horizontal
// scrolling, and save a screenshot <nn>-<route>-<theme>-<width>[-print].png.
//
// Scripted interaction. SCRIPT=<file.json> holds an array of steps, run in order in place of
// the route tour. Each step is an object with one of:
//   { "goto": "/path" }                 navigate (then settles for WAIT ms, and until no
//                                       .route-loading is left); a full http(s) URL is used as it is
//   { "click": "css selector" }         real mouse click on the first match
//   { "clickText": "Save", "within": "css selector (optional)", "tag": "button,a (optional)" }
//   { "clickLabel": "Title" }           click the form control whose <label> is (or else starts with) this text
//   { "type": "text", "into": "css selector (optional: focus it first)" }
//   { "key": "Enter" }                  Enter, Escape, Tab, ArrowDown, ArrowUp, Backspace, or one character
//   { "waitFor": "css selector" }       up to 10 s
//   { "wait": 500 }                     milliseconds
//   { "eval": "js expression" }         printed in the output
//   { "evalStore": "name", "eval": "js expression" }
//                                       keeps the result (not printed) under a name; later steps
//                                       may use {{name}} inside any text value (goto, type,
//                                       selectors, eval). For example: capture a one-time link
//                                       shown on the page, sign out, then goto "{{link}}"
//   { "totp": "css selector of the element holding the base32 key", "into": "css selector (optional)" }
//                                       types the current 6-digit authenticator code (RFC 6238:
//                                       SHA-1, 30 s) for the key shown on the page (text or input
//                                       value; spaces and hyphens ignored; an otpauth:// address works too)
//   { "signInAs": 2 }                   swap the session cookie to the second account (1 = the first).
//                                       The page is not reloaded: follow with a goto
//   { "signOut": true }                 remove the session cookie from the browser (the server-side
//                                       session stays, so signInAs can bring it back). Follow with a goto
//   { "media": "print" }                emulate print media; "screen" switches back
//   { "theme": "dark" }                 switch the emulated color scheme ("light" | "dark")
//   { "viewport": 820 }                 change the window width (height stays 900)
//   { "shot": "name" }                  screenshot <name>-<theme>-<width>[-print].png
//   { "pdf": "name" }                   save the page as <name>.pdf, paginated as the print window would
// Script errors, failed API calls and failed steps are listed at the end.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findBrowser } from './e2e/lib/browser.mjs';

const flags = { print: false, as2: false, allRoutes: false, user2: null, insecureTls: false };
const positional = [];
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print') flags.print = true;
    else if (a === '--as2') flags.as2 = true;
    else if (a === '--all-routes') flags.allRoutes = true;
    else if (a === '--insecure-tls') flags.insecureTls = true;
    else if (a === '--user2') flags.user2 = argv[++i];
    else if (a.startsWith('--user2=')) flags.user2 = a.slice('--user2='.length);
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else positional.push(a);
  }
}
const [base, outDir, user, pass] = positional;
let theme = positional[4] ?? 'light';
let width = positional[5] ?? '1440';
let media = flags.print || (process.env.MEDIA ?? '').toLowerCase() === 'print' ? 'print' : 'screen';
// The password may itself contain a colon: only the first one separates name from password.
const user2 = flags.user2 ? flags.user2.slice(0, flags.user2.indexOf(':')) : process.env.USER2;
const pass2 = flags.user2 ? flags.user2.slice(flags.user2.indexOf(':') + 1) : process.env.PASS2;
if (flags.user2 && !flags.user2.includes(':')) throw new Error('--user2 takes name:password');
mkdirSync(outDir, { recursive: true });
// A self-signed test certificate: accept it here (sign-in and look-ups) and in the browser.
if (flags.insecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// An account with a second factor also needs a code: `secret` is its authenticator key (base32,
// the code is worked out here) and `code` a ready-made code, for example a recovery code.
const signIn = async (username, password, { secret, code } = {}) => {
  const second = secret ? totp(secret) : code;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-grc-csrf': '1' },
    body: JSON.stringify(second ? { username, password, totp: second } : { username, password }),
  });
  const found = /grc_session=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1];
  if (!found) {
    const why = (await login.json().catch(() => null))?.error?.code;
    throw new Error(`login failed ${login.status}${why ? ` (${why})` : ''} for ${username}${why === 'mfa_required' ? ': set TOTP_KEY or CODE' : ''}`);
  }
  return found;
};
const tokens = { 1: await signIn(user, pass, { secret: process.env.TOTP_KEY, code: process.env.CODE }) };
if (user2) tokens[2] = await signIn(user2, pass2 ?? '', { secret: process.env.TOTP_KEY2, code: process.env.CODE2 });
if (flags.as2 && !tokens[2]) throw new Error('--as2 needs a second account: USER2 and PASS2, or --user2 name:password');
// The account the route tour (and its record look-ups) runs as.
const token = flags.as2 ? tokens[2] : tokens[1];
const api = async (u) => (await fetch(base + u, { headers: { cookie: `grc_session=${token}` } })).json();
const first = async (u) => (await api(u)).rows?.[0]?.id;

let routes = flags.allRoutes ? [] : process.env.ROUTES ? process.env.ROUTES.split(',') : [
  '/', '/tickets', `/tickets/${await first('/api/tickets?pageSize=1')}`, '/tickets/dashboard', '/problems', '/knowledge', '/catalog',
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

// Edge, Chrome or Chromium on Windows, macOS or Linux (or E2E_BROWSER): the same search as the browser tests.
const exe = findBrowser();
const port = Number(process.env.DEBUG_PORT ?? 9333);
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, 'profile')}`, '--no-first-run', '--disable-gpu', ...(flags.insecureTls ? ['--ignore-certificate-errors'] : []), 'about:blank'], { stdio: 'ignore' });

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
const settle = Number(process.env.WAIT ?? 2800);

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true });
for (const d of ['Runtime', 'Page', 'Network', 'Log']) await send(`${d}.enable`, {}, s);
// VIRTUAL_AUTHENTICATOR=1: a software passkey device for WebAuthn (DevTools "WebAuthn" domain).
if (process.env.VIRTUAL_AUTHENTICATOR === '1') {
  await send('WebAuthn.enable', { enableUI: false }, s);
  const added = await send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } }, s);
  if (!added.authenticatorId) throw new Error(`the browser did not add a virtual authenticator: ${JSON.stringify(added)}`);
}

const applyViewport = () => send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(process.env.HEIGHT ?? 900), deviceScaleFactor: 1, mobile: false }, s);
/** Saves the page as <name>.pdf, paginated as the browser's print window would produce it. */
const savePdf = async (name) => {
  const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }, s);
  if (!pdf.data) throw new Error('the browser did not produce a PDF');
  writeFileSync(join(outDir, `${name}.pdf`), Buffer.from(pdf.data, 'base64'));
};
// Media type and color scheme are set by one call, so always send both.
const applyMedia = () => send('Emulation.setEmulatedMedia', { media: media === 'print' ? 'print' : '', features: [{ name: 'prefers-color-scheme', value: theme }] }, s);
const useSession = (value) => send('Network.setCookie', { name: 'grc_session', value, url: base, httpOnly: true }, s);
const dropSession = () => send('Network.deleteCookies', { name: 'grc_session', url: base }, s);
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s)).result?.value;
/** Name ending shared by every screenshot: -<theme>-<width>, plus -print in print media. */
const shotSuffix = () => `-${theme}-${width}${media === 'print' ? '-print' : ''}.png`;
/** Waits (up to 10 s) until no lazily loaded route is still arriving. False when one still is. */
const routeLoaded = async () => {
  for (let i = 0; i < 40; i++) {
    if (!(await evaluate(`!!document.querySelector('.route-loading')`))) return true;
    await sleep(250);
  }
  return false;
};
const closeBrowser = async () => { await send('Browser.close'); proc.kill(); };

await applyViewport();
await applyMedia();
await useSession(token);

/** RFC 6238 code (HMAC-SHA-1, 6 digits, 30 s step) for a base32 key. */
function totp(key, at = Date.now()) {
  const clean = key.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (!clean) throw new Error('no base32 key found');
  let bits = '';
  for (const ch of clean) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5, '0');
  const secret = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

if (process.env.SCRIPT) {
  const steps = JSON.parse(readFileSync(process.env.SCRIPT, 'utf8').replace(/^\uFEFF/, ''));
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
  const stored = {};
  // {{name}} in any text value becomes the value kept by an earlier evalStore step.
  const fill = (raw) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' && k !== 'evalStore'
    ? v.replace(/\{\{([\w-]+)\}\}/g, (whole, name) => (name in stored ? stored[name] : whole)) : v]));
  for (const [n, raw] of steps.entries()) {
    const step = fill(raw);
    try {
      if (step.goto !== undefined) {
        await send('Page.navigate', { url: /^https?:\/\//i.test(step.goto) ? step.goto : base + step.goto }, s);
        await sleep(settle);
        await routeLoaded();
      }
      else if (step.click) await click(`document.querySelector(${JSON.stringify(step.click)})`, step.click);
      else if (step.clickText) {
        await click(`[...(${step.within ? `document.querySelector(${JSON.stringify(step.within)})` : 'document'})?.querySelectorAll(${JSON.stringify(step.tag ?? 'button, a, [role=option], [role=menuitem], [role=tab], label, [role=radio]')}) ?? []].filter((e) => e.getClientRects().length).find((e) => e.innerText.trim().replace(/\\s+/g, ' ').includes(${JSON.stringify(step.clickText)}))`, `text "${step.clickText}"`);
      }
      else if (step.clickLabel) {
        await click(`(() => { const all = [...document.querySelectorAll('label')].filter((l) => l.getClientRects().length); const want = ${JSON.stringify(step.clickLabel)}; return (all.find((l) => l.innerText.replace(/\\s*\\*\\s*$/, '').trim() === want) ?? all.find((l) => l.innerText.trim().startsWith(want)))?.control; })()`, `the control labeled "${step.clickLabel}"`);
      }
      else if (step.type !== undefined) {
        if (step.into) await click(`document.querySelector(${JSON.stringify(step.into)})`, step.into);
        await send('Input.insertText', { text: step.type }, s);
      }
      else if (step.totp) {
        let shown = null;
        for (let i = 0; i < 40 && !shown; i++) {
          shown = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.totp)}); return el ? String(el.value ?? el.textContent ?? '') : null; })()`);
          if (!shown) await sleep(250);
        }
        if (!shown) throw new Error(`nothing matches ${step.totp}, or it is empty`);
        const key = /[?&]secret=([^&\s]+)/i.exec(shown)?.[1] ?? shown;
        // Too close to the end of a 30 s window, the code could expire while it is typed.
        const left = 30000 - (Date.now() % 30000);
        if (left < 3000) await sleep(left + 200);
        const code = totp(decodeURIComponent(key));
        if (step.into) await click(`document.querySelector(${JSON.stringify(step.into)})`, step.into);
        await send('Input.insertText', { text: code }, s);
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
      else if (step.pdf) await savePdf(step.pdf);
      else if (step.eval) {
        const value = await evaluate(step.eval);
        if (step.evalStore) {
          if (value === undefined || value === null || value === '') throw new Error(`nothing to keep as "${step.evalStore}": the expression gave ${JSON.stringify(value) ?? 'undefined'}`);
          stored[step.evalStore] = typeof value === 'string' ? value : JSON.stringify(value);
          console.log(`eval[${n}]: kept as {{${step.evalStore}}}`);
        }
        else console.log(`eval[${n}]: ${JSON.stringify(value)}`);
      }
      else if (step.signInAs !== undefined) {
        const next = tokens[step.signInAs];
        if (!next) throw new Error(step.signInAs === 2 ? 'no second account: set USER2 and PASS2, or pass --user2 name:password' : 'signInAs takes 1 or 2');
        await useSession(next);
      }
      else if (step.signOut) await dropSession();
      else if (step.media) {
        if (step.media !== 'print' && step.media !== 'screen') throw new Error('media takes "print" or "screen"');
        media = step.media;
        await applyMedia();
      }
      else if (step.theme) {
        if (step.theme !== 'light' && step.theme !== 'dark') throw new Error('theme takes "light" or "dark"');
        theme = step.theme;
        await applyMedia();
      }
      else if (step.viewport) {
        if (!(Number(step.viewport) > 0)) throw new Error('viewport takes a width in pixels');
        width = String(step.viewport);
        await applyViewport();
      }
      else if (step.shot) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, s);
        writeFileSync(join(outDir, `${step.shot}${shotSuffix()}`), Buffer.from(shot.data, 'base64'));
      }
      if (!step.wait && !step.shot && !step.goto) await sleep(350);
    } catch (err) {
      // The step as written, so a kept value (a one-time link, say) is not printed.
      failures.push(`step ${n} ${JSON.stringify(raw)}: ${err.message}`);
    }
    for (const e of events) {
      if (e.method === 'Runtime.exceptionThrown') seen.add('exception: ' + (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).slice(0, 300));
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') seen.add('console: ' + e.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) seen.add(`http ${e.params.response.status}: ${e.params.response.url.replace(base, '')}`);
    }
    events = [];
  }
  await closeBrowser();
  console.log(`${steps.length} steps run, ${failures.length} failed`);
  for (const f of failures) console.log('  FAILED ' + f);
  for (const p of seen) console.log('  - ' + p);
  process.exit(0);
}

// --all-routes: ask the application which routes it has.
let skipped = [];
if (flags.allRoutes) {
  await send('Page.navigate', { url: base + '/' }, s);
  let listed = null;
  for (let i = 0; i < 40 && !listed; i++) {
    await sleep(250);
    listed = await evaluate(`Array.isArray(window.__grcRoutes) ? window.__grcRoutes.filter((p) => typeof p === 'string') : null`);
  }
  if (!listed) {
    await closeBrowser();
    console.log('--all-routes: window.__grcRoutes did not appear within 10 s of loading "/". Is the web application built with the route registry?');
    process.exit(1);
  }
  const unique = [...new Set(listed)];
  routes = unique.filter((p) => !/[:*]/.test(p));
  skipped = unique.filter((p) => /[:*]/.test(p));
}

const report = [];
for (const [i, route] of routes.entries()) {
  events = [];
  if (route.includes('undefined')) { report.push({ route, problems: ['no record id found for this route'] }); continue; }
  await send('Page.navigate', { url: base + route }, s);
  await sleep(settle);
  const problems = [];
  if (!(await routeLoaded())) problems.push('still loading after 10 s (.route-loading is showing)');
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
  const file = `${String(i).padStart(2, '0')}${route.replace(/[^a-z]+/gi, '-').replace(/-[0-9a-f-]{20,}/, '-id').slice(0, 40)}${shotSuffix()}`;
  writeFileSync(join(outDir, file), Buffer.from(shot.data, 'base64'));
  if (process.env.PDF) await savePdf(file.replace(/\.png$/, ''));
  report.push({ route: route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, ':id'), h1: page.h1, problems: [...new Set(problems)] });
}
await closeBrowser();
const bad = report.filter((r) => r.problems.length);
console.log(`${report.length} routes visited, ${bad.length} with problems`);
for (const r of bad) console.log(`\n${r.route}  [${r.h1}]\n  - ` + r.problems.join('\n  - '));
console.log('\nOK: ' + report.filter((r) => !r.problems.length).map((r) => r.route).join('  '));
if (skipped.length) console.log(`\nSkipped (need a record id): ${skipped.join('  ')}`);
process.exit(0);
