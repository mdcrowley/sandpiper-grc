// Keyboard-only use, module by module (E18-06). For each module's list and one of its records:
// start from the skip link, Tab through everything in the page content, and check that every stop
// shows where the focus is, that nothing that reacts to a click is left out of the Tab order, and
// that focus never gets stuck. On a list with a New button, the New dialog is opened with Enter,
// keeps the focus, and Escape closes it and puts the focus back.
//
// What a page does wrong is listed in the step log; findings already raised as issues are in
// KNOWN (by route pattern) and do not fail the run.
import { sleep } from '../lib/browser.mjs';

/** Findings already raised, so they are reported but do not fail: { [pattern]: issue }. */
const KNOWN = {};
/** Elements already raised as known defects wherever they appear (none at present). */
const KNOWN_ELEMENTS = []; // chart drill-down is reachable by keyboard since E18-42

/** Pages beyond the record lists that a keyboard user must be able to work. */
const EXTRA = ['/', '/systems/map', '/account/security', '/notifications', '/admin/users', '/admin/roles', '/help'];

const MAX_STOPS = 160;

/** The focused element: name, whether it shows a focus indicator, and where it sits. */
const focused = (page) => page.fn(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'body', name: '', ring: false, inMain: false, key: '' };
  const visibleRing = (node, pseudo) => {
    const s = getComputedStyle(node, pseudo);
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
  };
  const ring = visibleRing(el) || visibleRing(el, '::after') || visibleRing(el, '::before')
    || (() => { const w = el.closest('.mantine-Input-wrapper, .ui-input-wrap, label, [data-focus-ring], .mantine-Checkbox-body, .mantine-Switch-body'); return !!w && w !== el && visibleRing(w); })()
    || (el.matches('input, textarea, [role=combobox]') && getComputedStyle(el).borderColor !== getComputedStyle(document.body).color)
    // A drawing (the relationship map) marks its focused shape with the focus color.
    || (el instanceof SVGElement && (() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--focus)';
      document.body.append(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();
      return [el, ...el.querySelectorAll('rect, circle, path, ellipse')].some((n) => getComputedStyle(n).stroke === focusColor);
    })());
  const r = el.getBoundingClientRect();
  if (!el.dataset.e2eStop) el.dataset.e2eStop = String(Math.random()).slice(2, 10);
  return {
    tag: el.tagName.toLowerCase(),
    name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.value || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    ring,
    onScreen: r.width > 0 && r.height > 0,
    inMain: !!el.closest('main'),
    key: el.dataset.e2eStop,
  };
});

/** Elements in the content that react to the pointer but cannot be reached with Tab. */
const unreachable = (page) => page.fn(() => {
  const main = document.querySelector('main');
  if (!main) return [];
  const focusable = (e) => e.matches('a[href], button, input:not([type=hidden]), select, textarea, summary, [contenteditable=true]') && !e.disabled || e.tabIndex >= 0;
  const composite = '[role=tablist], [role=listbox], [role=grid], [role=menu], [role=radiogroup], [role=toolbar], [role=tree], [role=treegrid], [role=menubar]';
  const out = [];
  for (const e of main.querySelectorAll('*')) {
    if (!e.getClientRects().length || e.closest('[aria-hidden="true"], [inert]')) continue;
    if (getComputedStyle(e).cursor !== 'pointer') continue;
    if (e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
    // Inherited pointer: only the outermost element that has it counts.
    if (e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer') continue;
    if (focusable(e) || e.closest('a[href], button, label, summary') || e.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) continue;
    // The label part of a checkbox, switch or radio: clicking it works the input beside it.
    if (e.closest('.mantine-Checkbox-root, .mantine-Switch-root, .mantine-Radio-root, .mantine-Chip-root')?.querySelector('input')) continue;
    // Roving focus: one member of the group is in the Tab order, the arrows move between the rest.
    if (e.tabIndex === -1 && e.closest(composite)) continue;
    // A table row whose cells hold the link is opened from the link.
    if (e.matches('tr') && e.querySelector('a[href]')) continue;
    // A clickable chart has a keyboard twin beside it: one button per part, shown on focus (E18-42).
    if (e.matches('.rc-chart') && e.parentElement?.querySelector(':scope > .rc-chart-keys button')) continue;
    out.push(`${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''} "${(e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`);
  }
  return [...new Set(out)].slice(0, 12);
});

async function tour(t, page, path, pattern) {
  const problems = [];
  await page.goto('about:blank');
  await page.goto(path);
  await page.key('Tab');
  const first = await focused(page);
  if (!/Skip to content/.test(first.name)) problems.push(`the first Tab stop is "${first.name}", not the skip link`);
  else await page.key('Enter');
  const seen = new Set();
  const noRing = [];
  let stops = 0;
  let left = false;
  for (; stops < MAX_STOPS; stops++) {
    await page.key('Tab');
    const f = await focused(page);
    if (!f.inMain) { left = true; break; }
    if (seen.has(f.key)) break; // came round again (a dialog or a menu would trap; main cannot)
    seen.add(f.key);
    if (!f.ring && f.onScreen) noRing.push(`${f.tag} "${f.name}"`);
  }
  if (stops === 0) problems.push('Tab from the skip link reaches nothing in the page content');
  if (!left && stops >= MAX_STOPS) t.log(`      (stopped after ${MAX_STOPS} Tab stops still in the content)`);
  if (noRing.length) problems.push(`no visible focus indicator on: ${[...new Set(noRing)].slice(0, 8).join(', ')}`);
  const lost = [];
  for (const el of await unreachable(page)) {
    const k = KNOWN_ELEMENTS.find((x) => x.match.test(el));
    if (k) t.log(`      KNOWN ${k.issue}: ${pattern}: ${el} reacts to a click but cannot be reached with Tab`);
    else lost.push(el);
  }
  if (lost.length) problems.push(`react to a click but cannot be reached with Tab: ${lost.join(', ')}`);
  t.log(`      ${pattern}: ${stops} Tab stops in the content`);
  return problems;
}

async function newDialog(t, page, path, label) {
  const want = `New ${label.toLowerCase()}`;
  await page.goto('about:blank');
  await page.goto(path);
  if (!(await page.exists({ text: want, within: 'main', tag: 'button, a' }))) return [];
  await page.key('Tab');
  await page.key('Enter'); // skip link
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.key('Tab');
    reached = await page.eval(`(document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(want)})`);
  }
  if (!reached) return [`Tab never reached "${want}"`];
  const problems = [];
  const tag = await page.eval(`document.activeElement.tagName`);
  await page.eval(`document.activeElement.dataset.e2eReturn = '1'`);
  const before = await page.eval('location.pathname');
  await page.key('Enter');
  if (tag === 'A') { await page.settled(); return problems; } // a page of its own, not a dialog
  try { await page.waitFor('[role=dialog]', { timeout: 4000 }); } catch {
    if ((await page.eval('location.pathname')) !== before) return problems; // a button that opens a page of its own
    return [`Enter on "${want}" opened no dialog`];
  }
  await sleep(350);
  if (!(await page.eval(`!!document.activeElement?.closest('[role=dialog]')`))) problems.push(`focus did not move into the "${want}" dialog`);
  for (let i = 0; i < 12; i++) {
    await page.key('Tab', i % 4 === 3 ? ['Shift'] : []);
    if (!(await page.eval(`!!document.activeElement?.closest('[role=dialog]')`))) { problems.push(`focus left the "${want}" dialog`); break; }
  }
  // A field's open list closes on the first Escape (record pickers open theirs on focus); the
  // dialog on the next.
  let closed = false;
  for (let i = 0; i < 3 && !closed; i++) {
    await page.key('Escape');
    closed = await page.waitFor('[role=dialog]', { gone: true, timeout: 1200 }).then(() => true, () => false);
  }
  if (!closed) problems.push(`Escape did not close the "${want}" dialog`);
  await sleep(150);
  if (!(await page.eval(`document.activeElement?.dataset?.e2eReturn === '1'`))) problems.push(`focus did not return to "${want}" after Escape`);
  await page.eval(`document.querySelectorAll('[data-e2e-return]').forEach((e) => delete e.dataset.e2eReturn)`);
  return problems;
}

/** One test per permission module: its record lists and one record of each, plus the extra pages. */
async function plan(api) {
  const meta = await api.must('GET', '/api/meta');
  const byModule = new Map();
  for (const [type, r] of Object.entries(meta.resources ?? {})) {
    if (!r.route) continue;
    if (!byModule.has(r.module)) byModule.set(r.module, []);
    byModule.get(r.module).push({ type, ...r });
  }
  return byModule;
}

const MODULES = ['tickets', 'knowledge', 'assets', 'systems', 'sites', 'data', 'changes', 'vendors', 'contracts', 'frameworks', 'risks', 'security', 'vulnerabilities', 'policies', 'training', 'exceptions', 'obligations', 'exercises', 'actions', 'projects', 'reports', 'dashboards', 'fleet', 'safety'];

function moduleTest(key) {
  return {
    name: `keyboard tour: ${key}`,
    async run(t) {
      const { page } = t;
      const api = t.api();
      const types = (await plan(api)).get(key) ?? [];
      if (!types.length) { t.log(`   (no record type of module ${key} is loaded; skipped)`); return; }
      for (const r of types) {
        const pages = [{ path: r.route, pattern: r.route, list: true }];
        const first = (await api.get(`${r.path}?pageSize=1`)).body?.rows?.[0];
        if (first) pages.push({ path: `${r.route}/${first.id}`, pattern: `${r.route}/:id` });
        for (const p of pages) {
          await t.step(`${r.label}: Tab through ${p.pattern}`, async () => {
            const problems = await tour(t, page, p.path, p.pattern);
            if (p.list) problems.push(...await newDialog(t, page, p.path, r.label));
            for (const msg of problems) {
              if (KNOWN[p.pattern]) t.log(`      KNOWN ${KNOWN[p.pattern]}: ${p.pattern}: ${msg}`);
              else t.soft(false, `${p.pattern}: ${msg}`);
            }
          });
        }
      }
    },
  };
}

export const tests = [
  ...MODULES.map(moduleTest),
  {
    name: 'keyboard tour: overview, relationship map, account, notifications, administration, help',
    async run(t) {
      for (const path of EXTRA) {
        await t.step(`Tab through ${path}`, async () => {
          const problems = await tour(t, t.page, path, path);
          for (const msg of problems) {
            if (KNOWN[path]) t.log(`      KNOWN ${KNOWN[path]}: ${path}: ${msg}`);
            else t.soft(false, `${path}: ${msg}`);
          }
        });
      }
    },
  },
];
