// Generic form driving for the browser tests: find a form's controls by their labels, fill the
// required ones with sensible invented values whatever kind of control they are (text, long text,
// number, date, choice list, person or record picker), submit, and read the inline messages.
import { sleep } from './browser.mjs';

/** Describes every visible labelled control inside `scope`: label, kind, required, invalid, message. */
export function controls(page, scope) {
  return page.fn((scopeSel) => {
    const root = document.querySelector(scopeSel);
    if (!root) return [];
    const out = [];
    const seen = new Set();
    for (const label of root.querySelectorAll('label')) {
      if (!label.getClientRects().length) continue;
      const el = label.control ?? (label.htmlFor ? document.getElementById(label.htmlFor) : null);
      if (!el || seen.has(el) || el.type === 'hidden' || el.type === 'radio') continue;
      seen.add(el);
      const wrapper = el.closest('.mantine-InputWrapper-root, .mantine-Input-wrapper')?.closest('.mantine-InputWrapper-root') ?? el.parentElement;
      const text = label.innerText.replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').trim();
      const required = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label.innerText);
      let kind = 'text';
      if (el.tagName === 'TEXTAREA') kind = 'longtext';
      else if (el.type === 'checkbox') kind = 'checkbox';
      else if (el.getAttribute('aria-haspopup') === 'listbox' || el.closest('.mantine-Select-root, .mantine-MultiSelect-root') || el.getAttribute('role') === 'combobox') kind = 'choice';
      else if (el.tagName === 'BUTTON' && /Pick a date|date/i.test(el.innerText + (el.getAttribute('placeholder') ?? ''))) kind = 'datetime';
      else if (el.tagName === 'BUTTON') kind = 'button';
      else if (/Day Month Year/i.test(el.placeholder ?? '') || el.closest('.mantine-DateInput-root')) kind = 'date';
      else if (el.inputMode === 'decimal' || el.inputMode === 'numeric' || el.type === 'number' || el.closest('.mantine-NumberInput-root')) kind = 'number';
      const errId = el.getAttribute('aria-describedby')?.split(/\s+/).map((id) => document.getElementById(id)).find((n) => n && /error/i.test(n.id + ' ' + n.className));
      const message = (errId ?? wrapper?.querySelector('.mantine-InputWrapper-error, [class*=error]'))?.innerText?.trim() ?? '';
      if (!el.id) el.id = `e2e-${Math.random().toString(36).slice(2)}`;
      out.push({
        id: el.id, label: text, kind, required, disabled: !!el.disabled || el.readOnly && kind === 'text',
        invalid: el.getAttribute('aria-invalid') === 'true', message, value: el.value ?? el.innerText ?? '',
        placeholderOnly: !el.value,
      });
    }
    return out;
  }, scope);
}

/** Picks the first option offered by an open choice list (Mantine combobox), optionally after typing. */
async function pickFirstOption(page, id, { search = '' } = {}) {
  await page.click(`#${CSS.escape(id)}`);
  if (search) await page.type(search);
  const start = Date.now();
  while (Date.now() - start < 6000) {
    const ok = await page.fn((cid) => {
      const input = document.getElementById(cid);
      const listId = input?.getAttribute('aria-controls');
      const list = (listId && document.getElementById(listId)) ?? [...document.querySelectorAll('[role=listbox]')].find((l) => l.getClientRects().length);
      const option = list && [...list.querySelectorAll('[role=option]')].find((o) => o.getClientRects().length && o.getAttribute('aria-disabled') !== 'true' && o.getAttribute('data-combobox-disabled') === null);
      if (!option) return false;
      option.scrollIntoView({ block: 'nearest' });
      return true;
    }, id);
    if (ok) break;
    await sleep(150);
  }
  await page.key('ArrowDown');
  await page.key('Enter');
  await sleep(150);
}

/** A value for one control, by its kind. `stamp` makes text unique. */
export async function fillControl(page, c, stamp, override) {
  const sel = `#${CSS.escape(c.id)}`;
  if (override !== undefined) {
    if (c.kind === 'choice') return pickFirstOption(page, c.id, { search: override });
    return page.fill(sel, override);
  }
  switch (c.kind) {
    case 'longtext': return page.fill(sel, `Invented test text for ${c.label.toLowerCase()} (${stamp}).`);
    case 'number': return page.fill(sel, '3');
    case 'date': await page.fill(sel, '15 Jan 2027'); return page.key('Tab');
    case 'checkbox': return page.click(sel);
    case 'choice': return pickFirstOption(page, c.id);
    case 'datetime': {
      await page.click(sel);
      await sleep(250);
      // The first day button of the calendar, then the submit (check) button of the picker.
      await page.click({ css: '.mantine-Popover-dropdown [data-dates-day]:not([data-outside]):not([disabled]), .mantine-Popover-dropdown button.mantine-DateTimePicker-day:not([data-outside])' }).catch(() => null);
      await page.click({ css: '.mantine-Popover-dropdown .mantine-DateTimePicker-submitButton' }).catch(() => null);
      return page.key('Escape');
    }
    case 'button': return null;
    default: {
      const value = /e-?mail/i.test(c.label) ? `test.${stamp}@example.test` : /url|address|link/i.test(c.label) ? `https://example.test/${stamp}` : `E2E ${c.label} ${stamp}`;
      return page.fill(sel, value);
    }
  }
}

/** Fills every required control in `scope` that is still empty (and `extra` labels: { label: value|undefined }). */
export async function fillRequired(page, scope, stamp, extra = {}) {
  const done = new Set();
  // Filling one control can reveal another (a category reveals its own fields): go round twice.
  for (let round = 0; round < 2; round++) {
    const list = await controls(page, scope);
    for (const c of list) {
      if (done.has(c.label) || c.disabled) continue;
      const wanted = Object.prototype.hasOwnProperty.call(extra, c.label);
      if (!wanted && !(c.required && (c.placeholderOnly || c.kind === 'choice' && !c.value))) continue;
      done.add(c.label);
      await fillControl(page, c, stamp, wanted ? extra[c.label] : undefined);
    }
  }
  return done;
}

/** Clicks the form's submit button (the last visible submit button inside `scope`). */
export async function submit(page, scope) {
  const id = await page.fn((s) => {
    const root = document.querySelector(s);
    const visible = (b) => b.getClientRects().length;
    let buttons = [...(root?.querySelectorAll('button[type=submit]') ?? [])].filter(visible);
    // Some dialogs save with an ordinary button in their footer.
    if (!buttons.length) {
      const dialog = root?.closest('[role=dialog]') ?? root;
      buttons = [...(dialog?.querySelectorAll('button') ?? [])].filter(visible)
        .filter((b) => /^(Create|Save|Log|Add|Declare|Submit|Raise|Record)\b/.test(b.innerText.trim()));
    }
    const b = buttons[buttons.length - 1];
    if (!b) return null;
    if (!b.id) b.id = `e2e-submit-${Math.random().toString(36).slice(2)}`;
    return b.id;
  }, scope);
  if (!id) throw new Error(`no submit button in ${scope}`);
  await page.click(`#${CSS.escape(id)}`);
  await page.idle({ quiet: 300 });
}

/** The controls currently marked invalid in `scope`, with their messages. */
export async function invalidControls(page, scope) {
  return (await controls(page, scope)).filter((c) => c.invalid).map((c) => ({ label: c.label, message: c.message }));
}

// CSS.escape is a browser API; Node needs its own for building selectors.
const CSS = { escape: (s) => String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1') };
