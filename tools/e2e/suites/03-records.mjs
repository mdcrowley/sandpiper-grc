// One journey per record type, through the screens an administrator uses: open the New form,
// submit it empty (refused, with messages beside the fields), fill it in and create, check the
// saved values, edit (an invalid edit is refused first), change the status, comment, attach a file.
// Covers the create and edit form of every record type (E18-08) and each module's main flow (E18-12).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sleep } from '../lib/browser.mjs';
import { controls, fillControl, fillRequired, invalidControls, submit } from '../lib/forms.mjs';

/**
 * Record types and how their New form is reached. `open`: text of the button or link that opens
 * the form on the list page (default "New <label>"). `skip`: steps this type does not offer.
 */
const TYPES = [
  { type: 'ticket', open: 'New ticket' },
  { type: 'problem' },
  { type: 'knowledge_article' },
  { type: 'catalog_item', start: 'Manage items' },
  { type: 'system' },
  { type: 'asset' },
  { type: 'site' },
  { type: 'data_category' },
  { type: 'change' },
  { type: 'vendor' },
  { type: 'contract' },
  { type: 'evidence_item' },
  { type: 'risk' },
  { type: 'action' },
  { type: 'obligation' },
  // Security incidents keep a log of entries in place of comments.
  { type: 'security_incident', comment: { tab: 'Log', label: 'Add a log entry' } },
  { type: 'policy' },
  { type: 'policy_exception' },
  { type: 'course' },
  { type: 'exercise' },
  { type: 'vulnerability' },
  { type: 'project' },
  // A report is created and changed in the same builder: the create step drives it.
  { type: 'report_definition', pick: 'Tickets', skip: ['edit', 'status', 'comment', 'attachment'] },
  // A dashboard opens in its layout editor once created; the layout is covered by the keyboard suite.
  { type: 'dashboard', skip: ['edit', 'status', 'comment', 'attachment'] },
  // A report pack is edited section by section in its own editor (covered by the reports module's tests).
  { type: 'report_pack', skip: ['edit', 'status', 'comment', 'attachment'] },
];

/**
 * Steps a type does not offer are listed in `skip`; `known` names a step that fails because of a
 * defect already raised as an issue: it is reported as "KNOWN" with the issue and does not fail the run.
 * `start`: a button to press on the list page before the New button; `pick`: a choice to make on the
 * first step of a step-by-step New page.
 */

const UUID = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/;

/** The scope that holds the form just opened: a dialog if one is open, otherwise the page's main form. */
async function formScope(page) {
  await sleep(300);
  return page.fn(() => {
    const dialogs = [...document.querySelectorAll('[role=dialog]')].filter((d) => d.getClientRects().length && d.querySelector('form, input, textarea'));
    if (dialogs.length) {
      const d = dialogs[dialogs.length - 1];
      (d.querySelector('form') ?? d).setAttribute('data-e2e-scope', '1');
      return '[data-e2e-scope="1"]';
    }
    const form = [...document.querySelectorAll('main form')].find((f) => f.getClientRects().length && f.querySelector('button[type=submit]'));
    if (!form) return null;
    form.setAttribute('data-e2e-scope', '1');
    return '[data-e2e-scope="1"]';
  });
}
const clearScope = (page) => page.eval(`document.querySelectorAll('[data-e2e-scope]').forEach((e) => e.removeAttribute('data-e2e-scope'))`);

/**
 * Drives a step-by-step New page: on each step, picks a kind if a choice is offered ("Normal" when
 * there is one), fills the required fields, then presses Next, or on the last step the button
 * that creates the record. Stops when the address shows the new record.
 */
async function wizard(page, stamp, extra) {
  for (let i = 0; i < 10; i++) {
    if (UUID.test(await page.path)) return;
    await clearScope(page);
    // The last step may ask for details in a dialog ("Save report"): fill it and save.
    const dialog = await formScope(page);
    if (dialog && (await page.exists('[role=dialog] [data-e2e-scope]'))) {
      await fillRequired(page, dialog, stamp, extra);
      await submit(page, dialog);
      await page.settled();
      continue;
    }
    await clearScope(page);
    await page.eval(`document.querySelector('main').setAttribute('data-e2e-scope', '1')`);
    await page.fn(() => {
      const v = (e) => e.getClientRects().length;
      const cards = [...document.querySelectorAll('main [role=radio], main button[aria-pressed]')].filter(v);
      if (cards.length && !cards.some((c) => c.getAttribute('aria-checked') === 'true' || c.getAttribute('aria-pressed') === 'true')) {
        (cards.find((c) => /Normal/.test(c.innerText)) ?? cards[0]).click();
      }
    });
    await sleep(200);
    await fillRequired(page, '[data-e2e-scope="1"]', stamp, extra);
    const next = await page.fn(() => {
      const v = (e) => e.getClientRects().length && !e.disabled;
      const buttons = [...document.querySelectorAll('main button')].filter(v);
      const text = (b) => b.innerText.replace(/\s+/g, ' ').trim();
      // "Next", "Next: preview" or "Continue": not a field or column whose name starts with the word
      // (the report builder's field list offers "Next assessment due", "Next review" ...).
      const b = buttons.find((x) => /^(Next|Continue)(:|$)/.test(text(x)))
        ?? buttons.reverse().find((x) => /^(Create|Save|Submit|Declare|Log|Raise|Record|Finish)\b/.test(text(x)));
      if (!b) return null;
      b.id ||= `e2e-next-${Math.random().toString(36).slice(2)}`;
      return b.id;
    });
    if (!next) throw new Error('the step has neither Next nor a button that creates the record');
    await page.click(`#${next}`);
    await page.settled();
  }
}

/** Opens the first "Edit ..." button on a record page; returns the scope of the form it shows. */
async function openEdit(page) {
  await clearScope(page);
  const id = await page.fn(() => {
    // An Edit button, or an Edit link to a page of its own.
    const b = [...document.querySelectorAll('main button, main a')].filter((x) => x.getClientRects().length && !x.disabled)
      .find((x) => /^Edit\b/.test((x.innerText || x.getAttribute('aria-label') || '').trim()) && !/selected/.test(x.innerText));
    if (!b) return null;
    b.id ||= `e2e-edit-${Math.random().toString(36).slice(2)}`;
    return b.id;
  });
  if (!id) return null;
  await page.click(`#${id}`);
  return formScope(page);
}

function journey({ type, open, skip = [], known = {}, start, pick, comment }) {
  return {
    name: `${type}: create, edit, status, comment, attachment`,
    types: [type], // left out when an area filter does not visit this record type (run.mjs --affected)
    async run(t) {
      const { page } = t;
      const api = t.api();
      const meta = (await api.must('GET', '/api/meta')).resources[type];
      if (!meta) { t.log(`   (record type ${type} is not loaded; skipped)`); return; }
      const titleLabel = meta.fields[meta.titleField]?.label ?? 'Title';
      const stamp = `${type.slice(0, 6)}-${Date.now().toString(36)}`;
      const title = `E2E ${meta.label} ${stamp}`;

      /** A step that may fail for a defect already raised (`known`): reported, not failed. */
      const guarded = async (key, label, fn) => {
        if (!known[key]) return t.step(label, fn);
        try { return await t.step(label, fn); } catch (err) {
          t.log(`      KNOWN DEFECT ${known[key]}: ${err.message} (does not fail the run)`);
          page.clearAllowed();
          page.takeProblems();
          return undefined;
        }
      };

      const scope = await t.step(`open the New ${meta.label.toLowerCase()} form from ${meta.route}`, async () => {
        await page.goto(meta.route);
        if (start) { await page.click({ text: start, within: 'main', tag: 'button, a' }); await page.settled(); }
        const wanted = open ?? `New ${meta.label.toLowerCase()}`;
        const opener = await page.fn((want) => {
          // The page's own New button: not a row of the list that happens to start with "New".
          const all = [...document.querySelectorAll('main button, main a')].filter((e) => e.getClientRects().length && !e.closest('table, [role=table], li, [role=dialog]'));
          const text = (e) => (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          const el = all.find((e) => text(e) === want) ?? all.find((e) => /^(New|Declare|Log|Raise|Record)\b/.test(text(e)));
          if (!el) return null;
          el.id ||= `e2e-open-${Math.random().toString(36).slice(2)}`;
          return el.id;
        }, wanted);
        if (!opener) throw new Error(`no "${wanted}" button on ${meta.route}`);
        await page.click(`#${opener}`);
        await page.settled();
        if (pick) { await page.click({ text: pick, within: 'main', tag: 'button, a, [role=radio]' }); await page.settled(); }
        // A dialog or a page with one form; otherwise a step-by-step page (wizard).
        return (await formScope(page)) ?? 'wizard';
      });

      if (scope !== 'wizard') await guarded('empty', 'an empty form is refused, with a message beside the field', async () => {
        page.allow({ status: 400 });
        const before = await page.path;
        await submit(page, scope);
        await sleep(400);
        const bad = await invalidControls(page, scope);
        const formError = await page.eval(`[...document.querySelectorAll('${scope} [role=alert], ${scope} .form-error')].map((e) => e.innerText).join(' ')`);
        if (!bad.length && !formError) throw new Error('nothing was marked invalid');
        if (bad.length && !bad.some((b) => b.message)) throw new Error(`fields marked invalid without a message: ${bad.map((b) => b.label).join(', ')}`);
        if ((await page.path) !== before && UUID.test(await page.path)) throw new Error('the empty form was saved');
        t.log(`      refused: ${bad.map((b) => `${b.label}: "${b.message}"`).join('; ') || formError}`);
        page.clearAllowed();
      });

      const id = await t.step(scope === 'wizard' ? 'go through the steps, filling in the required fields, and create' : 'fill in the required fields and create', async () => {
        if (scope === 'wizard') await wizard(page, stamp, { [titleLabel]: title });
        else {
          await fillRequired(page, scope, stamp, { [titleLabel]: title });
          await submit(page, scope);
          // A page form may be the first of several steps ("Continue"): carry on through them.
          await sleep(800);
          const inDialog = await page.exists('[role=dialog] [data-e2e-scope]');
          // Saved already (some lists stay put, or offer a follow-up step such as attaching a file)?
          const saved = (await api.get(`${meta.path}?q=${encodeURIComponent(stamp)}&pageSize=5`)).body?.rows?.find((r) => r[meta.titleField] === title);
          if (saved && !UUID.test(await page.path)) {
            if (await page.exists({ text: 'Done', within: '[role=dialog]', tag: 'button' })) await page.click({ text: 'Done', within: '[role=dialog]', tag: 'button' });
            await page.goto(`${meta.route}/${saved.id}`);
          } else if (!UUID.test(await page.path) && !inDialog && (await invalidControls(page, scope).catch(() => [])).length === 0) {
            await wizard(page, stamp, { [titleLabel]: title });
          }
        }
        for (let i = 0; i < 50; i++) {
          const m = UUID.exec(await page.path);
          if (m) return m[1];
          await sleep(200);
        }
        // Some lists stay put after creating: find the record by its title.
        const found = await api.get(`${meta.path}?q=${encodeURIComponent(stamp)}&pageSize=5`);
        const row = found.body?.rows?.find((r) => r[meta.titleField] === title);
        if (row) { await page.goto(`${meta.route}/${row.id}`); return row.id; }
        const bad = await invalidControls(page, scope).catch(() => []);
        throw new Error(`not created${bad.length ? `; still invalid: ${bad.map((b) => `${b.label} (${b.message})`).join(', ')}` : ''}`);
      });
      await clearScope(page);

      await t.step('the record page shows what was saved', async () => {
        await page.settled();
        const row = await api.must('GET', `${meta.path}/${id}`);
        if (row[meta.titleField] !== title) throw new Error(`saved ${meta.titleField} is "${row[meta.titleField]}", not "${title}"`);
        await page.waitFor(() => document.querySelector('h1')?.innerText.length > 0);
        const h1 = await page.text('h1');
        if (!h1.includes(stamp)) throw new Error(`page heading "${h1}" does not show the title`);
      });

      const edited = `${title} (edited)`;
      if (!skip.includes('edit')) await guarded('edit', 'edit: an empty title is refused, then a new title is saved', async () => {
        const s = await openEdit(page);
        if (!s) throw new Error('no Edit button on the record page');
        let list = await controls(page, s);
        let titleControl = list.find((c) => c.label === titleLabel && !c.disabled);
        if (!titleControl) {
          // The title is often edited from its own section: try the other Edit buttons.
          const more = await page.fn(() => [...document.querySelectorAll('main button')].filter((x) => x.getClientRects().length && /^Edit\b/.test((x.innerText || x.getAttribute('aria-label') || '').trim())).length);
          for (let i = 1; i < more && !titleControl; i++) {
            await page.key('Escape');
            await page.click({ text: 'Cancel', within: s, tag: 'button' }).catch(() => null);
            await page.fn((n) => { const b = [...document.querySelectorAll('main button')].filter((x) => x.getClientRects().length && /^Edit\b/.test((x.innerText || x.getAttribute('aria-label') || '').trim()))[n]; if (b) b.id ||= `e2e-edit-${n}`; return b?.id; }, i)
              .then((bid) => bid && page.click(`#${bid}`));
            const s2 = await formScope(page);
            if (s2) { list = await controls(page, s2); titleControl = list.find((c) => c.label === titleLabel && !c.disabled); }
          }
        }
        if (!titleControl) {
          // No title in any edit form: change the first editable long text instead.
          const other = list.find((c) => (c.kind === 'longtext' || c.kind === 'text') && !c.disabled);
          if (!other) throw new Error('the edit form has no text field to change');
          await fillControl(page, other, stamp, `Edited by the browser test ${stamp}`);
          await submit(page, '[data-e2e-scope="1"]');
          await sleep(500);
          const row = await api.must('GET', `${meta.path}/${id}`);
          if (!JSON.stringify(row).includes(`Edited by the browser test ${stamp}`)) throw new Error(`"${other.label}" was not saved`);
          t.log(`      (no title in the edit form; changed "${other.label}" instead)`);
          return;
        }
        page.allow({ status: 400 });
        await page.fill(`#${titleControl.id.replace(/([^a-zA-Z0-9_-])/g, '\\$1')}`, '');
        await submit(page, '[data-e2e-scope="1"]');
        await sleep(400);
        const bad = await invalidControls(page, '[data-e2e-scope="1"]');
        if (!bad.find((b) => b.label === titleLabel && b.message)) throw new Error(`an empty ${titleLabel.toLowerCase()} was not refused beside the field`);
        page.clearAllowed();
        await page.fill(`#${titleControl.id.replace(/([^a-zA-Z0-9_-])/g, '\\$1')}`, edited);
        await submit(page, '[data-e2e-scope="1"]');
        await sleep(500);
        const row = await api.must('GET', `${meta.path}/${id}`);
        if (row[meta.titleField] !== edited) throw new Error(`after saving, ${meta.titleField} is "${row[meta.titleField]}"`);
        await page.waitFor(() => document.querySelector('h1')?.innerText.includes('(edited)'));
      });
      await clearScope(page);

      if (!skip.includes('status') && meta.fields.status?.type === 'lookup') {
        await t.step('change the status', async () => {
          const before = (await api.must('GET', `${meta.path}/${id}`)).status;
          await page.reload();
          let s = await openEdit(page);
          let status = s && (await controls(page, s)).find((c) => c.label === meta.fields.status.label && !c.disabled);
          // Look in the other edit sections too.
          const count = await page.fn(() => [...document.querySelectorAll('main button')].filter((x) => x.getClientRects().length && /^Edit\b/.test((x.innerText || x.getAttribute('aria-label') || '').trim())).length);
          for (let i = 1; i < count && !status; i++) {
            await page.reload();
            const bid = await page.fn((n) => { const b = [...document.querySelectorAll('main button')].filter((x) => x.getClientRects().length && /^Edit\b/.test((x.innerText || x.getAttribute('aria-label') || '').trim()))[n]; if (b) b.id ||= `e2e-edit-${n}`; return b?.id; }, i);
            if (!bid) break;
            await clearScope(page);
            await page.click(`#${bid}`);
            s = await formScope(page);
            status = s && (await controls(page, s)).find((c) => c.label === meta.fields.status.label && !c.disabled);
          }
          if (!status) {
            t.log('      (status is changed by the page\'s own action buttons, not an edit form: covered by the API tests)');
            return;
          }
          await page.click(`#${status.id.replace(/([^a-zA-Z0-9_-])/g, '\\$1')}`);
          await sleep(300);
          // Choose an option other than the current one.
          const picked = await page.fn(() => {
            const list = [...document.querySelectorAll('[role=listbox]')].find((l) => l.getClientRects().length);
            const opt = list && [...list.querySelectorAll('[role=option]')].find((o) => o.getAttribute('aria-selected') !== 'true' && o.getAttribute('data-combobox-selected') === null && o.getAttribute('data-combobox-disabled') === null);
            if (!opt) return null;
            opt.id ||= 'e2e-option';
            return opt.id;
          });
          if (!picked) throw new Error('the status list offers no other value');
          await page.click(`#${picked.replace(/([^a-zA-Z0-9_-])/g, '\\$1')}`);
          page.allow({ status: 400 });
          await submit(page, '[data-e2e-scope="1"]');
          await sleep(600);
          const after = (await api.must('GET', `${meta.path}/${id}`)).status;
          page.clearAllowed();
          if (after === before) {
            const bad = await invalidControls(page, '[data-e2e-scope="1"]').catch(() => []);
            const msg = await page.eval(`[...document.querySelectorAll('[data-e2e-scope="1"] [role=alert]')].map((e) => e.innerText).join(' ')`).catch(() => '');
            if (bad.length || msg) { t.log(`      (that status change was refused with a message shown: ${bad.map((b) => b.message).join(' ') || msg})`); await page.key('Escape'); return; }
            throw new Error(`status still "${before}" and no message was shown`);
          }
          t.log(`      status: ${before} -> ${after}`);
        });
        await clearScope(page);
      }

      if (!skip.includes('comment')) await guarded('comment', 'comment on the Activity tab', async () => {
        await page.goto(`${meta.route}/${id}?tab=activity`);
        const text = `Browser test comment ${stamp}`;
        if (comment) {
          await page.click({ text: comment.tab, tag: '[role=tab]' });
          await page.waitFor({ label: comment.label });
          await page.fill({ label: comment.label }, text);
        } else {
          if (!(await page.exists('textarea[aria-label="Add a comment"]'))) {
            if (await page.exists({ text: 'Activity', tag: '[role=tab]' })) await page.click({ text: 'Activity', tag: '[role=tab]' });
          }
          await page.waitFor('textarea[aria-label="Add a comment"]');
          await page.fill('textarea[aria-label="Add a comment"]', text);
        }
        await page.key('Enter', ['Control']);
        await page.waitFor(() => [...document.querySelectorAll('main *')].some((e) => e.children.length === 0 && /Browser test comment/.test(e.textContent)));
      });

      if (!skip.includes('attachment')) await guarded('attachment', 'attach a file on the Attachments tab', async () => {
        // Outside the repository: the files are invented and only need to exist while uploaded.
        const dir = join(t.app.dir ?? join(tmpdir(), 'sandpiper-e2e'), 'uploads');
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `e2e-${stamp}.txt`);
        writeFileSync(file, `Invented attachment for ${title}\n`);
        // The attachments panel sits on the Attachments tab, or on the record's own Files or Evidence tab.
        // Tabs that do not fit the width are in the strip's More menu (E18-63).
        const findIn = (role) => page.fn((sel) => {
          const tabs = [...document.querySelectorAll(sel)].map((x) => x.innerText.replace(/\s*\d+$/, '').trim());
          return ['Attachments', 'Evidence files', 'Files', 'Evidence', 'Documents'].find((name) => tabs.includes(name));
        }, `[role=${role}]`);
        // The shared Attachments tab is preferred to a record's own Evidence or Documents tab, wherever it is.
        let tab = await findIn('tab');
        if (tab !== 'Attachments' && await page.fn(() => Boolean(document.querySelector('.ui-tabs-more')))) {
          await page.click('.ui-tabs-more');
          await page.waitFor('[role=menuitem]');
          const inMenu = await findIn('menuitem');
          if (inMenu && (inMenu === 'Attachments' || !tab)) {
            tab = inMenu;
            await page.click({ text: tab, tag: '[role=menuitem]' });
          } else {
            await page.key('Escape');
          }
        }
        if (tab && await page.fn((name) => [...document.querySelectorAll('[role=tab]')].some((x) => x.innerText.replace(/\s*\d+$/, '').trim() === name && x.getAttribute('aria-selected') !== 'true'), tab)) {
          await page.click({ text: tab, tag: '[role=tab]' });
        }
        if (!tab) throw new Error('no Attachments, Evidence files, Files or Evidence tab');
        await page.waitFor('section[aria-label="Attach files"] input[type=file]');
        await page.upload('section[aria-label="Attach files"] input[type=file]', [file]);
        await page.waitFor(() => /e2e-.*\.txt/.test(document.querySelector('ul[aria-label="Attached files"]')?.innerText ?? ''), { timeout: 15000 });
      });
    },
  };
}

export const tests = TYPES.map(journey);
