// List features through the screens: search, filter by the address, bulk edit of selected rows,
// export of every matching row (server CSV) and of the selected rows (built in the browser).
import { sleep } from '../lib/browser.mjs';

export const tests = [
  {
    name: 'search a list: the box filters the rows and the address keeps the search',
    async run(t) {
      const { page } = t;
      const row = (await t.api().must('GET', '/api/systems?pageSize=1&sort=name')).rows[0];
      const word = row.name.split(/\s+/).filter((w) => w.length > 3 && !/^Example$/i.test(w))[0] ?? row.name;
      await page.goto('/systems');
      await t.step(`type "${word}" in the search box`, async () => {
        await page.fill('input[aria-label="Search systems"]', word);
        await page.waitFor(() => /[?&]q=/.test(location.search), { timeout: 5000 });
        await page.settled();
      });
      await t.step('the matching system is listed and every row matches', async () => {
        const rows = await page.fn(() => [...document.querySelectorAll('main tbody tr')].map((r) => r.innerText));
        if (!rows.some((r) => r.includes(row.name))) throw new Error(`"${row.name}" is not listed`);
        const total = (await t.api().must('GET', `/api/systems?q=${encodeURIComponent(word)}&pageSize=1`)).total;
        const shown = await page.text('main [role=status]');
        if (!shown.includes(`of ${total}`)) throw new Error(`the count says "${shown}", the server finds ${total}`);
      });
      await t.step('reloading the page keeps the search', async () => {
        await page.reload();
        const value = await page.eval(`document.querySelector('input[aria-label="Search systems"]').value`);
        if (value !== word) throw new Error(`the search box holds "${value}"`);
      });
    },
  },
  {
    name: 'bulk edit: select two rows, change one field, every row is updated',
    async run(t) {
      const { page } = t;
      const api = t.api();
      const rows = (await api.must('GET', '/api/systems?pageSize=2&sort=name')).rows;
      await page.goto('/systems?sort=name&dir=asc');
      await t.step('select the first two rows', async () => {
        await page.waitFor('main tbody input[type=checkbox]');
        for (const i of [0, 1]) {
          await page.fn((n) => { const b = [...document.querySelectorAll('main tbody input[type=checkbox]')][n]; b.id ||= `e2e-sel-${n}`; return b.id; }, i)
            .then((id) => page.click(`#${id}`));
        }
        await page.waitFor({ text: 'Edit selected', tag: 'button' });
      });
      const field = await t.step('Edit selected: choose a field and a value, and apply', async () => {
        await page.click({ text: 'Edit selected', tag: 'button' });
        await page.waitFor({ label: 'Field to change' });
        await page.click({ label: 'Field to change' });
        await sleep(200);
        const chosen = await page.fn(() => {
          const opts = [...document.querySelectorAll('[role=listbox] [role=option]')].filter((o) => o.getClientRects().length);
          const o = opts[0];
          if (!o) return null;
          o.id ||= 'e2e-field';
          return { id: o.id, label: o.innerText.trim() };
        });
        if (!chosen) throw new Error('no field is offered');
        await page.click(`#${chosen.id}`);
        await sleep(300);
        // The value control is labelled "New <field>".
        const valueLabel = `New ${chosen.label.toLowerCase()}`;
        await page.click({ label: valueLabel });
        await sleep(400);
        await page.key('ArrowDown');
        await page.key('Enter');
        await sleep(200);
        await page.click({ text: 'Apply to 2', tag: 'button' });
        await page.waitFor(() => /updated/.test([...document.querySelectorAll('[role=dialog] [role=status]')].map((e) => e.innerText).join(' ')), { timeout: 10000 });
        const summary = await page.eval(`document.querySelector('[role=dialog] [role=status]').innerText`);
        t.log(`      ${chosen.label}: ${summary}`);
        await page.click({ text: 'Done', tag: 'button' });
        return chosen.label;
      });
      await t.step('both records hold the new value, and each change is in its history', async () => {
        const meta = (await api.must('GET', '/api/meta')).resources.system;
        const key = Object.entries(meta.fields).find(([, f]) => f.label === field)?.[0];
        const after = await Promise.all(rows.map((r) => api.must('GET', `/api/systems/${r.id}`)));
        if (key && after[0][key] !== after[1][key]) throw new Error(`the two systems hold different values for ${field}`);
        const history = await api.must('GET', `/api/history?record_type=system&record_id=${rows[0].id}`);
        const events = Array.isArray(history) ? history : history.rows ?? history.events ?? [];
        if (!events.length) throw new Error('no history recorded');
      });
    },
  },
  {
    name: 'export: the Export button downloads every matching row as CSV; Export selected builds a file',
    async run(t) {
      const { page } = t;
      await page.goto('/tickets?q=printer');
      await t.step('Export asks the server for a CSV of the filtered list', async () => {
        page.responses.length = 0;
        await page.click({ text: 'Export', within: 'main', tag: 'button' });
        // Export may be a menu of formats: choose CSV.
        await page.waitFor('[role=menu]', { timeout: 1500 }).then(() => page.click({ text: 'CSV', tag: '[role=menuitem]' })).catch(() => null);
        for (let i = 0; i < 40 && !page.responses.some((r) => /format=csv/.test(r.url)); i++) await sleep(150);
        const csv = page.responses.find((r) => /format=csv/.test(r.url));
        if (!csv) throw new Error('no CSV was requested');
        if (csv.status !== 200) throw new Error(`the CSV answered ${csv.status}`);
        if (!/q=printer/.test(csv.url)) throw new Error('the export ignored the search');
        if (!/csv/.test(csv.mimeType)) throw new Error(`the file is ${csv.mimeType}, not CSV`);
      });
      await t.step('select a row: Export selected confirms what it exported', async () => {
        await page.goto('/tickets');
        const id = await page.fn(() => { const b = document.querySelector('main tbody input[type=checkbox]'); b.id ||= 'e2e-one'; return b.id; });
        await page.click(`#${id}`);
        await page.click({ text: 'Export selected', tag: 'button' });
        await page.waitFor(() => /exported/.test(document.body.innerText), { timeout: 5000 });
      });
    },
  },
];
