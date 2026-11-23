// The journey session: a visible Edge or Chrome driven by keyboard only (key presses sent through
// the DevTools protocol), NVDA listening (nvda.mjs), and, after every action, what NVDA said and
// what the browser's accessibility tree says has the focus. See journeys.mjs.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { sleep } from '../e2e/lib/browser.mjs';

const FRONT = join(import.meta.dirname, 'front.ps1');
/** No keyboard or mouse use for this long before the browser is brought to the front. */
const IDLE_MS = Number(process.env.SR_IDLE_MS) || 20000;
/** How long a step waits for the browser to be in front before it is recorded as not measured. */
const WAIT_FRONT_MS = Number(process.env.SR_WAIT_FRONT_MS) || 30 * 60000;

/** One line describing an accessibility-tree node: role, name, states. */
export function describeAx(node) {
  if (!node) return '(nothing)';
  const props = Object.fromEntries((node.properties ?? []).map((p) => [p.name, p.value?.value]));
  const states = [];
  for (const k of ['expanded', 'checked', 'selected', 'pressed', 'required', 'invalid', 'disabled', 'readonly', 'haspopup', 'modal']) {
    const v = props[k];
    if (v === undefined || v === false || v === 'false') continue;
    states.push(v === true || v === 'true' ? k : `${k}=${v}`);
  }
  const role = node.role?.value ?? '?';
  const name = (node.name?.value ?? '').replace(/\s+/g, ' ').trim();
  return `${role} "${name}"${states.length ? ` (${states.join(', ')})` : ''}`;
}

export class Session {
  constructor({ page, sr, browserPid, log = console.log }) {
    this.page = page;
    this.sr = sr;
    this.browserPid = browserPid;
    this.log = log;
    this.journeys = [];
    this.current = null;
  }

  /** Brings the browser window to the front, so NVDA follows it (it reads the foreground window). */
  front(activate = false) {
    try {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FRONT,
        ...(activate ? ['-Activate', String(this.browserPid)] : [])], { encoding: 'utf8', timeout: 20000 });
      const [pid, idle] = out.trim().split(/\s+/).map(Number);
      return { inFront: pid === Number(this.browserPid), idle };
    } catch {
      return { inFront: false, idle: 0 };
    }
  }

  /**
   * Waits until the browser is the window in front. It is brought there only when nobody has used
   * the machine for IDLE_MS, so a person working at it is not interrupted; the run waits meanwhile.
   */
  async activate() {
    const start = Date.now();
    let said = false;
    for (;;) {
      let f = this.front();
      if (f.inFront) return true;
      if (f.idle >= IDLE_MS) { f = this.front(true); if (f.inFront) { await sleep(600); return true; } }
      if (!said) { this.log(`    (waiting for the browser to be in front; it is brought there after ${IDLE_MS / 1000} s without keyboard or mouse use)`); said = true; }
      if (Date.now() - start > WAIT_FRONT_MS) return false;
      await sleep(5000);
    }
  }

  /** The focused element as the browser's accessibility tree describes it. */
  async focusAx() {
    const { result } = await this.page.send('Runtime.evaluate', {
      expression: '(() => { let e = document.activeElement; while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement; return e; })()',
    });
    if (!result?.objectId) return null;
    const isBody = await this.page.eval('document.activeElement === document.body || document.activeElement === null');
    const { nodes } = await this.page.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false }).catch(() => ({ nodes: [] }));
    const node = nodes?.find((n) => !n.ignored) ?? nodes?.[0] ?? null;
    return { node, text: isBody ? 'document body' : describeAx(node), lost: isBody };
  }

  /** Starts a journey (one role). */
  journey(title, role) {
    this.current = { title, role, steps: [], problems: [] };
    this.journeys.push(this.current);
    this.log(`\n== ${title} (${role})`);
    return this.current;
  }

  /**
   * One step: runs `act` (key presses), then records the keys, what NVDA said, where the focus is,
   * and anything the step's `check` says is wrong. `check(info)` returns a problem text or null.
   */
  async step(name, act, { check, quiet = 1000, max = 9000, settle = true, pageLoad = false } = {}) {
    const keys = [];
    this.keysLog = keys;
    if (!(await this.activate())) throw new Error('the browser could not be brought to the front');
    await this.pageFocus();
    this.sr.mark();
    let error = null;
    try {
      await act();
      if (settle) await this.page.settled({ max: 10000 }).catch(() => {});
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    let spoken = await this.sr.since({ quiet, max });
    const focus = await this.focusAx().catch(() => null);
    // Only speech about the browser counts: if another window came to the front meanwhile, what NVDA
    // said may be about that window (someone else's work), so it is dropped, not recorded.
    const stayed = this.front().inFront;
    if (!stayed) spoken = [];
    const rec = { name, keys: [...keys], spoken, focus: focus?.text ?? '(unknown)', problems: [] };
    if (!stayed) rec.problems.push('not measured: another window came to the front during the step');
    if (error) rec.problems.push(`could not be completed by keyboard: ${error}`);
    // After a page load the focus starts on the document itself; anywhere else that means it was lost.
    if (focus?.lost && !pageLoad) rec.problems.push('focus was lost to the page body');
    if (!spoken.length && stayed) rec.problems.push('NVDA said nothing');
    if (check && !error && stayed) {
      const p = await check({ spoken, focus, joined: spoken.join(' | ') });
      if (p) rec.problems.push(p);
    }
    this.current.steps.push(rec);
    this.log(`  - ${name}\n      keys: ${keys.join(' ') || '(none)'}\n      said: ${spoken.join(' | ') || '(nothing)'}\n      focus: ${rec.focus}${rec.problems.length ? `\n      PROBLEM: ${rec.problems.join('; ')}` : ''}`);
    return rec;
  }

  /**
   * Makes sure the keyboard is in the page, not in the browser's toolbar (where Tab past the end of a
   * page goes): NVDA reads the page's focus only while the page itself has the window's focus.
   */
  async pageFocus() {
    if (await this.page.eval('document.hasFocus()').catch(() => true)) return;
    await this.page.send('Page.bringToFront').catch(() => {});
    await sleep(300);
    if (await this.page.eval('document.hasFocus()').catch(() => true)) return;
    // F6 moves the browser's focus between its toolbar and the page.
    for (let i = 0; i < 4 && !(await this.page.eval('document.hasFocus()').catch(() => true)); i++) {
      await this.sr.key('F6');
      await sleep(400);
    }
    if (!(await this.page.eval('document.hasFocus()').catch(() => true))) this.log('    (the page does not have the focus: NVDA will not follow it)');
  }

  // Keyboard only. Every key is logged against the step.
  async press(key, modifiers = []) {
    this.keysLog?.push([...modifiers, key].join('+'));
    await this.page.key(key, modifiers);
    await sleep(120);
  }

  async tab(n = 1) { for (let i = 0; i < n; i++) await this.press('Tab'); }

  /** Types text as a keyboard would (one insertion; NVDA's typed-character echo is off). */
  async type(text) {
    this.keysLog?.push(`type "${text}"`);
    await this.page.send('Input.insertText', { text: String(text) });
    await sleep(150);
  }

  /**
   * Presses Tab (or Shift+Tab) until the focused element matches: `{ name: RegExp, role?: string }`.
   * Fails after `max` presses: the control cannot be reached with Tab.
   */
  async tabTo(match, { max = 60, back = false } = {}) {
    for (let i = 0; i < max; i++) {
      const pressedAt = Date.now();
      await this.page.key('Tab', back ? ['Shift'] : []);
      await sleep(60);
      // Tab past the last stop of the page leaves the page for the browser's own toolbar.
      if (!(await this.page.eval('document.hasFocus()'))) throw new Error(`Tab left the page without reaching ${match.role ?? ''} ${match.name ?? ''} (${i + 1} presses)`);
      const f = await this.focusAx();
      const role = f?.node?.role?.value ?? '';
      const name = (f?.node?.name?.value ?? '').replace(/\s+/g, ' ');
      if ((!match.role || role === match.role) && (!match.name || match.name.test(name))) {
        this.keysLog?.push(`${back ? 'Shift+Tab' : 'Tab'} x${i + 1} (to ${role} "${name}")`);
        // Only what NVDA says from the last press on counts: the stops passed on the way are not the step.
        this.sr.mark(pressedAt);
        return;
      }
    }
    throw new Error(`no Tab stop matching ${match.role ?? ''} ${match.name ?? ''} within ${max} presses`);
  }

  /** Opens an address as if typed into the address bar (the start of a journey). */
  async goto(path) {
    this.keysLog?.push(`(address bar) ${path}`);
    await this.page.goto(path);
  }
}
