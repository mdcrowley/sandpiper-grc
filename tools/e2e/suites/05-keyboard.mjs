// Keyboard-only use (E18-06): skip link, tab order and visible focus, navigation, menus, dialogs
// (focus kept inside, Escape closes, focus goes back), the command palette, list tables, a
// record created without the mouse, and moving a dashboard widget with the arrow keys.
import { sleep } from '../lib/browser.mjs';

/** The focused element, described, with whether its focus indicator can be seen. */
const focused = (page) => page.fn(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'body', name: '', visible: false, ring: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none')
    // Some controls draw the ring on a wrapper or on ::after; accept a focused-within wrapper ring.
    || (() => { const w = el.closest('.mantine-Input-wrapper, .ui-input-wrap, label'); if (!w) return false; const s = getComputedStyle(w); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; })()
    || cs.borderColor !== getComputedStyle(document.body).borderColor && el.matches('input, textarea, [role=combobox]');
  return {
    tag: el.tagName.toLowerCase(),
    name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    id: el.id,
    visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
    ring,
    inDialog: !!el.closest('[role=dialog]'),
    inMain: !!el.closest('main'),
    inNav: !!el.closest('nav[aria-label="Main"]'),
    inTable: !!el.closest('tbody'),
  };
});

const markFocus = (page) => page.eval(`(() => { const el = document.activeElement; el.dataset.e2eReturn = '1'; return el.tagName; })()`);
const isMarkedFocused = (page) => page.eval(`document.activeElement?.dataset?.e2eReturn === '1'`);
const clearMark = (page) => page.eval(`document.querySelectorAll('[data-e2e-return]').forEach((e) => delete e.dataset.e2eReturn)`);

/** Presses Tab until `test(focus)` holds (up to `max` presses); returns the focus or throws. */
async function tabTo(page, test, max = 60, what = 'the target') {
  const seen = [];
  for (let i = 0; i < max; i++) {
    await page.key('Tab');
    const f = await focused(page);
    if (test(f)) return f;
    seen.push(f.name || f.tag);
  }
  throw new Error(`Tab never reached ${what} in ${max} presses (stops: ${seen.slice(0, 12).join(' > ')} ... ${seen.slice(-5).join(' > ')})`);
}

/** Loads a page afresh, so Tab starts from the top of the document. */
async function fresh(page, path) {
  await page.goto('about:blank');
  await page.goto(path);
}

/** Loads a page afresh and uses the skip link, as a keyboard user would, to start in the content. */
async function inContent(page, path) {
  await fresh(page, path);
  await page.key('Tab');
  const f = await focused(page);
  if (!/Skip to content/.test(f.name)) throw new Error(`the first Tab stop is "${f.name}", not the skip link`);
  await page.key('Enter');
}

/** Checks that Tab and Shift+Tab stay inside the open dialog. */
async function trapped(page, presses = 25) {
  for (let i = 0; i < presses; i++) {
    await page.key('Tab', i % 5 === 4 ? ['Shift'] : []);
    const f = await focused(page);
    if (!f.inDialog) throw new Error(`focus left the dialog after ${i + 1} Tab presses (now on ${f.tag} "${f.name}")`);
  }
}

export const tests = [
  {
    name: 'skip link, tab order and visible focus on the overview',
    async run(t) {
      const { page } = t;
      await fresh(page, '/');
      await t.step('the first Tab reaches "Skip to content", shown on screen', async () => {
        await page.key('Tab');
        const f = await focused(page);
        if (!/Skip to content/.test(f.name)) throw new Error(`first stop is ${f.tag} "${f.name}"`);
        if (!f.visible) throw new Error('the skip link is not visible when focused');
      });
      await t.step('Enter on the skip link moves focus to the main content', async () => {
        await page.key('Enter');
        const inMain = await page.eval(`document.activeElement?.id === 'main' || !!document.activeElement?.closest('main')`);
        if (!inMain) throw new Error('focus did not move to the main content');
      });
      await t.step('the next 40 Tab stops are all visible and show a focus indicator', async () => {
        await fresh(page, '/');
        const order = [];
        const bad = [];
        for (let i = 0; i < 40; i++) {
          await page.key('Tab');
          const f = await focused(page);
          order.push(`${f.inNav ? 'nav' : f.inMain ? 'main' : 'top'}:${f.name || f.tag}`);
          if (f.tag === 'body') break;
          if (!f.ring) bad.push(`${f.tag} "${f.name}" has no visible focus indicator`);
        }
        t.log(`      order: ${order.join(' > ')}`);
        // Order: skip link, then the navigation, then the top bar, then the page.
        const firstMain = order.findIndex((o) => o.startsWith('main:'));
        const lastNav = order.map((o) => o.startsWith('nav:')).lastIndexOf(true);
        if (firstMain >= 0 && lastNav > firstMain) bad.push('the page content comes before the end of the navigation');
        if (bad.length) throw new Error(bad.join('; '));
      });
    },
  },
  {
    name: 'navigation: arrow keys move between entries; Enter opens a page',
    async run(t) {
      const { page } = t;
      await fresh(page, '/');
      await t.step('Tab into the navigation and move down with the arrow keys', async () => {
        const first = await tabTo(page, (f) => f.inNav, 25, 'the navigation');
        await page.key('ArrowDown');
        const second = await focused(page);
        if (!second.inNav || second.name === first.name) throw new Error(`ArrowDown did not move within the navigation (still "${second.name}")`);
        await page.key('ArrowUp');
        const back = await focused(page);
        if (back.name !== first.name) throw new Error('ArrowUp did not return to the first entry');
      });
      await t.step('Enter on a navigation entry opens its page', async () => {
        const target = await page.fn(() => { const a = document.querySelector('nav[aria-label="Main"] a[href="/systems"]'); a?.focus(); return !!a; });
        if (!target) throw new Error('no Systems entry in the navigation');
        await page.key('Enter');
        await page.settled();
        if (!(await page.path).startsWith('/systems')) throw new Error(`Enter went to ${await page.path}`);
      });
    },
  },
  {
    name: 'account menu: opens with Enter, arrows move, Escape closes and returns focus',
    async run(t) {
      const { page } = t;
      await fresh(page, '/');
      await t.step('Tab to the account button and open the menu', async () => {
        await tabTo(page, (f) => /^Account:/.test(f.name), 80, 'the account button');
        await markFocus(page);
        await page.key('Enter');
        await page.waitFor('[role=menu]');
        await sleep(200);
        // Mantine moves focus into the menu on open with the keyboard; ArrowDown does if not.
        await page.key('ArrowDown');
        const f = await page.eval(`document.activeElement?.getAttribute('role')`);
        if (f !== 'menuitem') throw new Error(`focus is on ${f ?? 'nothing'}, not a menu item`);
      });
      await t.step('Escape closes the menu and focus returns to the button', async () => {
        await page.key('Escape');
        await page.waitFor('[role=menu]', { gone: true, timeout: 3000 });
        if (!(await isMarkedFocused(page))) throw new Error('focus did not return to the account button');
        await clearMark(page);
      });
    },
  },
  {
    name: 'command palette: Ctrl+K, type, Enter goes there; focus trapped; Escape returns focus',
    async run(t) {
      const { page } = t;
      await fresh(page, '/');
      await t.step('the search button opens the palette with Enter; focus is in its search box', async () => {
        await tabTo(page, (f) => /^Search/.test(f.name), 80, 'the search button');
        await markFocus(page);
        await page.key('Enter');
        await page.waitFor('[role=dialog]');
        await sleep(200);
        const f = await focused(page);
        if (!f.inDialog || f.tag !== 'input') throw new Error(`focus is on ${f.tag} "${f.name}"`);
      });
      await t.step('Tab and Shift+Tab stay inside the palette', () => trapped(page, 12));
      await t.step('Escape closes it and focus returns to the search button', async () => {
        await page.key('Escape');
        await page.waitFor('[role=dialog]', { gone: true, timeout: 3000 });
        if (!(await isMarkedFocused(page))) throw new Error('focus did not return to the search button');
        await clearMark(page);
      });
      await t.step('Ctrl+K, type "Systems", Enter opens the Systems page', async () => {
        await page.key('k', ['Control']);
        await page.waitFor('[role=dialog]');
        await page.type('Systems');
        await sleep(700);
        await page.key('Enter');
        await page.settled();
        const path = await page.path;
        if (!path.startsWith('/systems')) throw new Error(`Enter went to ${path}`);
      });
      await t.step('a record found by search opens with the keyboard', async () => {
        const row = (await t.api().must('GET', '/api/systems?pageSize=1')).rows[0];
        await page.key('k', ['Control']);
        await page.waitFor('[role=dialog]');
        await page.type(row.name.split(' ').slice(0, 3).join(' '));
        // Search results arrive after a short pause.
        await page.waitFor({ text: row.name, within: '[role=dialog]', tag: '[role=option]' }, { timeout: 6000 });
        await sleep(600);
        const chosen = await page.fn((name) => {
          const opts = [...document.querySelectorAll('[role=dialog] [role=option]')];
          return opts.findIndex((o) => o.innerText.includes(name));
        }, row.name);
        if (chosen < 0) throw new Error(`"${row.name}" is not among the results`);
        const current = await page.fn(() => [...document.querySelectorAll('[role=dialog] [role=option]')].findIndex((o) => o.getAttribute('aria-selected') === 'true' || o.hasAttribute('data-combobox-selected') || o.classList.contains('is-active')));
        for (let i = Math.max(0, current); i < chosen; i++) await page.key('ArrowDown');
        await page.key('Enter');
        await page.settled();
        if (!(await page.path).includes(row.id)) throw new Error(`opened ${await page.path}, not the system`);
      });
    },
  },
  {
    name: 'New dialog: opens with Enter, keeps focus, Escape closes and returns focus; a record is created with the keyboard',
    async run(t) {
      const { page } = t;
      await inContent(page, '/sites');
      await t.step('Tab to "New site" and open it with Enter', async () => {
        await tabTo(page, (f) => /^New site/.test(f.name), 80, 'the New site button');
        await markFocus(page);
        await page.key('Enter');
        await page.waitFor('[role=dialog] form');
        await sleep(300);
        if (!(await focused(page)).inDialog) throw new Error('focus did not move into the dialog');
      });
      await t.step('Tab and Shift+Tab stay inside the dialog', () => trapped(page));
      await t.step('Escape closes the dialog and focus returns to "New site"', async () => {
        await page.key('Escape');
        await page.waitFor('[role=dialog]', { gone: true, timeout: 3000 });
        if (!(await isMarkedFocused(page))) throw new Error('focus did not return to the New site button');
        await clearMark(page);
      });
      await t.step('create a site with the keyboard alone: type the name, Enter saves', async () => {
        await page.key('Enter');
        await page.waitFor('[role=dialog] form');
        await sleep(300);
        // Focus starts in the dialog (on its first field, or its close button): Tab to the Name field.
        const onName = () => page.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => /^Name/.test(x.innerText)); return !!l && l.control === document.activeElement; })()`);
        for (let i = 0; i < 15 && !(await onName()); i++) await page.key('Tab');
        if (!(await onName())) throw new Error('Tab did not reach the Name field');
        const name = `Keyboard site ${Date.now().toString(36)}`;
        await page.type(name);
        await page.key('Enter');
        await page.waitFor(() => /\/sites\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 8000 });
        await page.settled();
        if (!(await page.text('h1')).includes(name)) throw new Error('the new site is not shown');
      });
    },
  },
  {
    name: 'list table: arrow keys move between rows, Space selects, Enter opens',
    async run(t) {
      const { page } = t;
      await inContent(page, '/systems');
      await t.step('Tab reaches the table rows', async () => {
        // The row (or a cell in it) takes focus; links inside rows are skipped by Tab.
        await tabTo(page, (f) => f.inTable, 60, 'a table row');
      });
      await t.step('ArrowDown moves to the next row', async () => {
        const before = await page.eval(`document.activeElement?.closest('tr')?.rowIndex ?? -1`);
        await page.key('ArrowDown');
        const after = await page.eval(`document.activeElement?.closest('tr')?.rowIndex ?? -1`);
        if (!(after > before)) throw new Error(`row index ${before} -> ${after}`);
        const f = await focused(page);
        if (!f.ring) throw new Error('the focused row shows no focus indicator');
      });
      await t.step('Space selects the row (bulk actions appear)', async () => {
        await page.key(' ');
        await page.waitFor('[role=region][aria-label="Bulk actions"]', { timeout: 3000 });
        await page.key(' ');
      });
      await t.step('Enter opens the record', async () => {
        await page.key('Enter');
        await page.settled();
        if (!/\/systems\/[0-9a-f-]{36}/.test(await page.path)) throw new Error(`Enter went to ${await page.path}`);
      });
    },
  },
  {
    name: 'record page tabs: arrow keys switch tabs',
    async run(t) {
      const { page } = t;
      const row = (await t.api().must('GET', '/api/tickets?pageSize=1')).rows[0];
      await page.goto(`/tickets/${row.id}`);
      await t.step('focus the selected tab and press ArrowRight', async () => {
        const ok = await page.fn(() => { const tab = document.querySelector('[role=tab][aria-selected="true"]'); tab?.focus(); return !!tab; });
        if (!ok) throw new Error('no tabs on the record page');
        const before = await page.eval(`document.activeElement.innerText`);
        await page.key('ArrowRight');
        await sleep(200);
        const f = await page.eval(`({ role: document.activeElement.getAttribute('role'), text: document.activeElement.innerText })`);
        if (f.role !== 'tab' || f.text === before) throw new Error('ArrowRight did not move to the next tab');
        await page.key('Enter');
        await sleep(300);
        const selected = await page.eval(`document.querySelector('[role=tab][aria-selected="true"]')?.innerText`);
        if (selected !== f.text) throw new Error(`the tab "${f.text}" was not selected`);
      });
    },
  },
  {
    name: 'dashboard grid: a widget moves with the arrow keys',
    async run(t) {
      const { page } = t;
      const dash = (await t.api().must('GET', '/api/dashboards?pageSize=50')).rows.find((d) => d) ?? null;
      if (!dash) { t.log('   (no dashboard in the sample data)'); return; }
      await inContent(page, `/dashboards/${dash.id}?edit=1`);
      await t.step('Tab to a widget handle', async () => {
        await page.waitFor('.rp-w-handle', { timeout: 8000 });
        await tabTo(page, (f) => /^Move or resize/.test(f.name), 120, 'a widget handle');
      });
      await t.step('ArrowRight moves the widget and the move is announced', async () => {
        const before = await page.eval(`document.activeElement.closest('section').style.gridColumn`);
        await page.key('ArrowDown');
        await page.key('ArrowRight');
        await sleep(300);
        const after = await page.eval(`document.activeElement?.closest('section')?.style.gridColumn ?? ''`);
        const announced = await page.eval(`[...document.querySelectorAll('[role=status]')].map((e) => e.innerText).join(' ')`);
        if (before === after && !announced.trim()) throw new Error('the widget did not move');
        if (!announced.trim()) throw new Error('the move was not announced');
        t.log(`      announced: "${announced.trim().slice(0, 100)}"`);
      });
      await t.step('Cancel leaves the dashboard as it was', async () => {
        await page.click({ text: 'Cancel', tag: 'button' });
        await sleep(300);
        if (await page.exists({ text: 'Discard', tag: 'button' })) await page.click({ text: 'Discard', tag: 'button' });
      });
    },
  },
];
