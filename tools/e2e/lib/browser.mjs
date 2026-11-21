// A small DevTools-protocol driver for headless Edge or Chrome/Chromium, shared by the browser
// tests (tools/e2e) and the accessibility audit (tools/a11y). No npm packages: Node's own
// WebSocket and fetch.
//
//   const browser = await launchBrowser({ profileDir, debugPort });
//   const page = await browser.newPage({ base: 'http://127.0.0.1:1234' });
//   await page.goto('/tickets');
//   await page.click({ text: 'New ticket' });
//   ...
//   await browser.close();
//
// Browser: E2E_BROWSER (a path) wins; otherwise Edge, then Chrome, then Chromium, in the usual
// places on Windows, macOS and Linux, then on PATH.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The path of a Chromium-family browser, or throws with what was tried. */
export function findBrowser() {
  if (process.env.E2E_BROWSER) {
    if (!existsSync(process.env.E2E_BROWSER)) throw new Error(`E2E_BROWSER does not exist: ${process.env.E2E_BROWSER}`);
    return process.env.E2E_BROWSER;
  }
  const local = process.env.LOCALAPPDATA ?? '';
  const fixed = process.platform === 'win32'
    ? [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      local && join(local, 'Google/Chrome/Application/chrome.exe'),
      local && join(local, 'Chromium/Application/chrome.exe'),
    ]
    : process.platform === 'darwin'
      ? [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
      : [];
  const names = process.platform === 'win32'
    ? ['msedge.exe', 'chrome.exe']
    // On Linux, Chrome first: it starts quickly on a fresh CI machine, where Edge's first start can be slow.
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'];
  const onPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap((dir) => names.map((n) => join(dir, n)));
  const tried = [...fixed.filter(Boolean), ...onPath];
  const found = tried.find((p) => existsSync(p));
  if (!found) throw new Error(`No Edge, Chrome or Chromium found. Install one or set E2E_BROWSER. Looked for: ${names.join(', ')}`);
  return found;
}

/** RFC 6238 code (HMAC-SHA-1, 6 digits, 30 s step) for a base32 key. */
export function totp(key, at = Date.now()) {
  const clean = String(key).toUpperCase().replace(/[^A-Z2-7]/g, '');
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

const KEYS = {
  Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8,
  Home: 36, End: 35, ' ': 32, Space: 32, Delete: 46, PageDown: 34, PageUp: 33,
};
const MOD = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

/** Starts the browser and connects to it. */
export async function launchBrowser({ profileDir, debugPort = 0, headless = true } = {}) {
  const exe = findBrowser();
  mkdirSync(profileDir, { recursive: true });
  const port = debugPort || 9300 + Math.floor(Math.random() * 600);
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars',
    '--force-color-profile=srgb', '--font-render-hinting=none', '--lang=en-US',
  ];
  if (headless) args.unshift('--headless=new');
  // CI runners on Linux run as root inside a container-like sandbox.
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-dev-shm-usage');
  const proc = spawn(exe, [...args, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 240 && !ws; i++) { // up to 60 seconds: a first start on a fresh machine can be slow
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const socket = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
      ws = socket;
    } catch { await sleep(250); }
  }
  if (!ws) { proc.kill(); throw new Error(`could not reach the browser's DevTools port ${port} (${exe})`); }

  let seq = 0;
  const pending = new Map();
  const listeners = new Map(); // sessionId -> fn(event)
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${method}: ${msg.error.message}`)); else res(msg.result ?? {});
    } else if (msg.method && msg.sessionId && listeners.has(msg.sessionId)) listeners.get(msg.sessionId)(msg);
  };
  // A browser that stops answering (a page stuck in a script, a crashed renderer) fails the step
  // after two minutes, naming the call, instead of holding up the whole run.
  const CALL_TIMEOUT_MS = Number(process.env.E2E_CALL_TIMEOUT_MS) || 120_000;
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      rej(new Error(`${method}: the browser did not answer within ${CALL_TIMEOUT_MS / 1000} s`));
    }, CALL_TIMEOUT_MS);
    timer.unref?.();
    pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); }, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  // Downloads (exports) land in the profile folder rather than asking where to save.
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(profileDir, 'downloads') }).catch(() => null);

  return {
    exe,
    async newPage({ base, width = 1440, height = 900, theme = 'light' } = {}) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page({ send: (m, p) => send(m, p, sessionId), base, targetId, closeTarget: () => send('Target.closeTarget', { targetId }) });
      listeners.set(sessionId, (e) => page.onEvent(e));
      for (const d of ['Runtime', 'Page', 'Network', 'Log', 'DOM']) await page.send(`${d}.enable`);
      await page.setViewport(width, height);
      await page.setTheme(theme);
      return page;
    },
    async close() {
      const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((res) => proc.once('exit', res));
      try { await Promise.race([send('Browser.close'), sleep(3000)]); } catch { /* already gone */ }
      ws.close();
      if (!(await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]))) proc.kill();
      await sleep(500); // helper processes let go of the profile folder
    },
  };
}

export class Page {
  constructor({ send, base, closeTarget }) {
    this.send = send;
    this.base = base;
    this.closeTarget = closeTarget;
    this.theme = 'light';
    this.width = 1440;
    this.height = 900;
    this.problems = [];
    /** The latest responses (url, status, mimeType), newest last. */
    this.responses = [];
    this.inflight = new Map();
    /** HTTP statuses (and URL patterns) the current step expects, so they are not reported. */
    this.allowed = [];
  }

  onEvent(e) {
    const p = e.params;
    // A page with unsaved changes asks before it is left (core/unsaved.tsx). A test that moves on
    // with goto() means to leave: answer "Leave" so the navigation is not held up.
    if (e.method === 'Page.javascriptDialogOpening' && p.type === 'beforeunload') {
      this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      return;
    }
    if (e.method === 'Runtime.exceptionThrown') {
      this.problems.push(`script error: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split('\n')[0].slice(0, 300)}`);
    } else if (e.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
      this.problems.push(`console error: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
    } else if (e.method === 'Network.requestWillBeSent') {
      this.inflight.set(p.requestId, Date.now());
    } else if (e.method === 'Network.loadingFinished' || e.method === 'Network.loadingFailed') {
      this.inflight.delete(p.requestId);
    } else if (e.method === 'Network.responseReceived') {
      const { status, url } = p.response;
      this.responses.push({ url, status, mimeType: p.response.mimeType });
      if (this.responses.length > 300) this.responses.shift();
      if (status >= 400 && url.startsWith(this.base)) {
        const path = url.slice(this.base.length);
        if (!this.allowed.some((a) => (a.status === undefined || a.status === status) && (!a.url || a.url.test(path)))) {
          this.problems.push(`HTTP ${status} ${p.type === 'Document' ? 'page' : 'request'}: ${path.slice(0, 200)}`);
        }
      }
    }
  }

  /** Problems seen since the last call (script errors, console errors, failed requests). */
  takeProblems() {
    const out = [...new Set(this.problems)];
    this.problems = [];
    return out;
  }

  /** Lets a step expect some failed responses: { status: 403, url: /\/api\/foo/ }. */
  allow(...rules) { this.allowed.push(...rules); }
  clearAllowed() { this.allowed = []; }

  async setViewport(width, height = this.height) {
    this.width = width;
    this.height = height;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  async setTheme(theme) {
    this.theme = theme;
    // The application keeps an explicit choice (grc.theme) in localStorage, which wins over the
    // operating system: clear it first, so the emulated scheme decides (the page listens for it).
    await this.eval(`(() => { try { localStorage.removeItem('grc.theme'); } catch {} return true; })()`).catch(() => {});
    await this.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-color-scheme', value: theme }] });
  }

  async setSession(token) {
    await this.send('Network.setCookie', { name: 'grc_session', value: token, url: this.base, httpOnly: true });
  }

  async clearSession() {
    await this.send('Network.deleteCookies', { name: 'grc_session', url: this.base });
  }

  /** Evaluates an expression in the page; returns its value (promises are awaited). */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluation failed: ${(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split('\n')[0]}`);
    return r.result?.value;
  }

  /** Calls fn(...args) in the page; fn must be self-contained. */
  fn(fn, ...args) {
    return this.eval(`(${fn.toString()})(...${JSON.stringify(args)})`);
  }

  /** Waits until no request is in flight for `quiet` ms (or `max` ms pass). */
  async idle({ quiet = 350, max = 8000 } = {}) {
    const start = Date.now();
    let calmSince = Date.now();
    while (Date.now() - start < max) {
      // Requests open for over 10 s (long polls) do not count.
      const busy = [...this.inflight.values()].some((t) => Date.now() - t < 10000);
      if (busy) calmSince = Date.now();
      else if (Date.now() - calmSince >= quiet) return;
      await sleep(50);
    }
  }

  /** Waits until the page has no lazily loaded route or loading skeleton still showing. */
  async settled({ max = 12000 } = {}) {
    await this.idle({ max });
    const start = Date.now();
    while (Date.now() - start < max) {
      const busy = await this.eval(`!!document.querySelector('.route-loading, .mantine-Skeleton-root[data-visible], [aria-busy="true"]')`).catch(() => false);
      if (!busy) break;
      await sleep(100);
    }
    await this.idle({ quiet: 200, max: 3000 });
  }

  async goto(path) {
    if (path === 'about:blank') { await this.send('Page.navigate', { url: path }); await sleep(150); return; }
    const url = /^https?:\/\//i.test(path) ? path : this.base + path;
    await this.send('Page.navigate', { url });
    // The load event, then the application's own lazy loading.
    for (let i = 0; i < 100; i++) {
      if (await this.eval(`document.readyState === 'complete' && location.href !== 'about:blank'`).catch(() => false)) break;
      await sleep(100);
    }
    await this.settled();
  }

  async reload() { await this.goto(await this.eval('location.href')); }

  get path() { return this.eval('location.pathname + location.search'); }

  /**
   * A finder: a CSS selector string, or { text, within?, tag? } (a visible element whose text
   * contains `text`; exact match preferred), or { label } (a form control by its label text), or
   * { role, name } (an element with that role and accessible name).
   */
  static finder(target) {
    if (typeof target === 'string') return `document.querySelector(${JSON.stringify(target)})`;
    if (target.css) return `[...document.querySelectorAll(${JSON.stringify(target.css)})].find((e) => e.getClientRects().length)`;
    if (target.label !== undefined) {
      return `(() => {
        const want = ${JSON.stringify(target.label)}.toLowerCase();
        const scope = ${target.within ? `document.querySelector(${JSON.stringify(target.within)})` : 'document'};
        if (!scope) return null;
        const clean = (s) => (s || '').replace(/\\s*\\*\\s*$/, '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const labels = [...scope.querySelectorAll('label')].filter((l) => l.getClientRects().length);
        const l = labels.find((x) => clean(x.innerText) === want) ?? labels.find((x) => clean(x.innerText).startsWith(want));
        if (l) return l.control ?? (l.htmlFor ? document.getElementById(l.htmlFor) : null) ?? l.querySelector('input,textarea,select,button');
        return [...scope.querySelectorAll('input,textarea,select,[role=combobox],[role=textbox]')].filter((e) => e.getClientRects().length)
          .find((e) => clean(e.getAttribute('aria-label')) === want || clean(e.getAttribute('placeholder')) === want) ?? null;
      })()`;
    }
    if (target.role) {
      return `[...document.querySelectorAll(${JSON.stringify(roleSelector(target.role))})].filter((e) => e.getClientRects().length)
        .find((e) => ${target.name === undefined ? 'true' : `((e.getAttribute('aria-label') || e.innerText || e.value || '').replace(/\\s+/g, ' ').trim()).includes(${JSON.stringify(target.name)})`})`;
    }
    const tag = target.tag ?? 'button, a, [role=option], [role=menuitem], [role=tab], [role=radio], [role=checkbox], [role=switch], label, summary';
    return `(() => {
      const scope = ${target.within ? `document.querySelector(${JSON.stringify(target.within)})` : 'document'};
      if (!scope) return null;
      const want = ${JSON.stringify(target.text)};
      const norm = (e) => (e.innerText || e.getAttribute('aria-label') || e.value || '').replace(/\\s+/g, ' ').trim();
      const all = [...scope.querySelectorAll(${JSON.stringify(tag)})].filter((e) => e.getClientRects().length && !e.closest('[aria-hidden="true"]'));
      return all.find((e) => norm(e) === want) ?? all.find((e) => (e.getAttribute('aria-label') || '') === want) ?? all.find((e) => norm(e).includes(want)) ?? null;
    })()`;
  }

  /** The element's center, scrolled into view, or null. */
  async locate(target) {
    return this.eval(`(() => { const el = ${Page.finder(target)}; if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      // Something else (a toast, a sticky bar) may lie on top of it.
      const covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.tagName === 'INPUT' && el.labels && [...el.labels].some((l) => l.contains(hit)));
      if (covered) { window.__e2eTarget = el; }
      return { x, y, covered, disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true') }; })()`);
  }

  async exists(target) { return Boolean(await this.eval(`!!(${Page.finder(target)})`)); }

  async waitFor(target, { timeout = 10000, gone = false } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const there = typeof target === 'function' ? Boolean(await this.fn(target).catch(() => false)) : await this.exists(target).catch(() => false);
      if (there !== gone) return true;
      await sleep(100);
    }
    throw new Error(`timed out after ${timeout} ms waiting for ${gone ? 'the end of ' : ''}${describe(target)}`);
  }

  async click(target, { timeout = 8000 } = {}) {
    let at = null;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      at = await this.locate(target);
      if (at && !at.disabled) break;
      await sleep(120);
    }
    if (!at) throw new Error(`nothing matches ${describe(target)}`);
    if (at.disabled) throw new Error(`${describe(target)} is disabled`);
    await sleep(60); // let a smooth scroll finish
    at = (await this.locate(target)) ?? at;
    if (at.covered) {
      // Covered by a toast or similar: wait for it to go, then fall back to a keyboard press.
      for (let i = 0; i < 15 && at?.covered; i++) { await sleep(200); at = (await this.locate(target)) ?? at; }
      if (at.covered) {
        await this.eval(`(() => { const el = window.__e2eTarget; el.focus(); if (!/^(BUTTON|A)$/.test(el.tagName)) el.click(); return true; })()`);
        if (await this.eval(`/^(BUTTON|A)$/.test(window.__e2eTarget.tagName)`)) await this.key('Enter');
        await this.idle({ quiet: 150, max: 6000 });
        return;
      }
    }
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    }
    await this.idle({ quiet: 150, max: 6000 });
  }

  /** Focuses a control and replaces its value with `text`, as typing would. */
  async fill(target, text) {
    await this.click(target);
    await this.key('a', ['Control']);
    await this.key('Backspace');
    if (text) await this.send('Input.insertText', { text: String(text) });
    await this.idle({ quiet: 120, max: 3000 });
  }

  async type(text) {
    await this.send('Input.insertText', { text: String(text) });
    await this.idle({ quiet: 120, max: 3000 });
  }

  /** A key press; modifiers: ['Shift'], ['Control'] ... */
  async key(name, modifiers = []) {
    const code = KEYS[name] ?? name.toUpperCase().charCodeAt(0);
    const modifierBits = modifiers.reduce((n, m) => n | (MOD[m] ?? 0), 0);
    const printable = name.length === 1 && !(modifierBits & (MOD.Control | MOD.Meta | MOD.Alt));
    const text = name === 'Enter' ? '\r' : printable ? name : undefined;
    const keyName = name === 'Space' ? ' ' : name;
    const codeName = name.length === 1 ? (/[a-z]/i.test(name) ? `Key${name.toUpperCase()}` : undefined) : name === ' ' || name === 'Space' ? 'Space' : name;
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: keyName, code: codeName, windowsVirtualKeyCode: code, text, modifiers: modifierBits });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: codeName, windowsVirtualKeyCode: code, modifiers: modifierBits });
    await sleep(40);
  }

  /** Puts files into a file input (`selector` matches the <input type=file>). */
  async upload(selector, files) {
    const { root } = await this.send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no file input matches ${selector}`);
    await this.send('DOM.setFileInputFiles', { nodeId, files });
    await this.idle({ max: 8000 });
  }

  /** Text of the whole page (or of a selector). */
  text(selector = 'body') { return this.eval(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '')`); }

  async screenshot(file, { fullPage = false } = {}) {
    let clip;
    if (fullPage) {
      const h = await this.eval('Math.min(6000, document.documentElement.scrollHeight)');
      clip = { x: 0, y: 0, width: this.width, height: h, scale: 1 };
    }
    const shot = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  }

  async close() { await this.closeTarget(); }
}

function roleSelector(role) {
  const implicit = {
    button: 'button, [role=button], input[type=button], input[type=submit]',
    link: 'a[href], [role=link]',
    dialog: '[role=dialog], dialog',
    menuitem: '[role=menuitem]',
    tab: '[role=tab]',
    checkbox: 'input[type=checkbox], [role=checkbox]',
    heading: 'h1, h2, h3, h4, h5, h6, [role=heading]',
  };
  return implicit[role] ?? `[role=${role}]`;
}

function describe(target) {
  if (typeof target === 'function') return 'a condition';
  if (typeof target === 'string') return `"${target}"`;
  if (target.label !== undefined) return `the field labeled "${target.label}"`;
  if (target.role) return `${target.role} "${target.name ?? ''}"`;
  if (target.css) return `"${target.css}"`;
  return `"${target.text}"${target.within ? ` in ${target.within}` : ''}`;
}
