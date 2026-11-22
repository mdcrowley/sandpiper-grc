// Wave 13 asset tags (E37): finding a record by its tag number on the web, typed or with a handheld
// scanner, the tag card page and its actions (E37-04, E37-05, E37-06). Values are invented.
// Run alone with: npm run test:e2e -- --only tags (or --grep tags).
//
// Other wave 13 parts add their own tests to this file in separate test functions (see the end).

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A keyboard-mode handheld scanner: the characters arrive a few milliseconds apart, then Enter. */
async function scan(page, text) {
  for (const ch of text) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
  await page.key('Enter');
}

/** A wait condition: the page's text contains `text` (any element, not only buttons and links). */
const mainHas = (text) => new Function(`return (document.querySelector('main')?.innerText ?? '').includes(${JSON.stringify(text)});`);

/** No sideways scrolling of the page (the tag card works from 390 px up). */
const noSideScroll = () => document.documentElement.scrollWidth <= window.innerWidth + 1;

/** A sample asset with a tag value, made fresh for the test so its card is predictable. */
async function freshAsset(t, label) {
  const api = t.api();
  const site = (await api.must('GET', '/api/sites?pageSize=1')).rows[0];
  const tag = `E2E-${Date.now().toString(36).toUpperCase()}`;
  const asset = await api.must('POST', '/api/assets', { name: `E2E ${label} tablet`, tag, serial: `SN-${tag}`, site_id: site?.id ?? null, location: 'Dispatch desk 1' });
  return { asset, tag, site };
}

const findTest = (theme, width) => ({
  name: `tags: the Find by tag number box, a handheld scanner and the global search open the tag card (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const { asset, tag } = await t.step('make an asset with a tag', () => freshAsset(t, 'find'));

    await t.step('typed into the box on the assets list, Enter opens the tag card', async () => {
      await page.goto('/assets');
      await page.fill({ label: 'Find by tag number' }, tag.toLowerCase());
      await page.key('Enter');
      await page.waitFor({ css: '.tag-card' }, { timeout: 10000 });
      const path = await page.path;
      t.soft(path.startsWith('/asset-tags/find?value='), `went to ${path}`);
      t.soft(!path.includes('source=handheld'), 'typing was taken for a scanner');
      const title = await page.text('.tag-card-title');
      t.soft(title.includes(`E2E find tablet`), `the card is about "${title}"`);
      t.soft(await page.exists({ text: 'Open full record' }), 'no Open full record action');
      t.soft(await page.fn(noSideScroll), 'the page scrolls sideways');
      t.clean('tag card');
    });

    await t.step('a handheld scanner on the vehicles list: its value and Enter open the card', async () => {
      await page.goto('/vehicles');
      await page.click({ label: 'Find by tag number' });
      await scan(page, tag);
      await page.waitFor({ css: '.tag-card' }, { timeout: 10000 });
      const path = await page.path;
      t.soft(path.includes('source=handheld'), `a scanner was not recognized (${path})`);
    });

    await t.step('the tag card page keeps a box for the next scan, focused on an empty page', async () => {
      await page.goto('/asset-tags/find');
      const focused = await page.fn(() => document.activeElement?.classList.contains('tag-find-input') ?? false);
      t.soft(focused, 'the box is not focused');
      await scan(page, `SN-${tag}`);
      await page.waitFor(() => /No tag has the number/.test(document.querySelector('main')?.innerText ?? ''), { timeout: 10000 });
      const text = await page.text('main');
      t.soft(/No tag has the number/.test(text), 'a serial number was not found as another identifier');
      t.soft(text.includes('E2E find tablet'), 'the asset of the serial number is not shown');
    });

    await t.step('the global search offers "Find tag number" first and Enter opens it', async () => {
      await page.goto('/');
      await page.key('k', ['Control']);
      await page.waitFor('[role=dialog]');
      await page.type(tag);
      await page.waitFor({ text: `Find tag number ${tag}`, within: '[role=dialog]', tag: '[role=option]' }, { timeout: 6000 });
      await sleep(300);
      await page.key('Enter');
      await page.waitFor({ css: '.tag-card' }, { timeout: 10000 });
      t.soft((await page.path).includes(encodeURIComponent(tag)), 'the global search did not open the tag card');
    });

    await t.step('a value nobody has answers "Nothing found"', async () => {
      await page.goto('/asset-tags/find?value=QQ-404404');
      await page.waitFor({ text: 'Nothing found for QQ-404404.', tag: 'h2,h3,p,div' }, { timeout: 10000 });
      t.soft(!(await page.exists({ css: '.tag-card' })), 'a card was shown');
    });
    void asset;
  },
});

const actionsTest = (theme, width) => ({
  name: `tags: actions on the tag card: quick update with If-Match, a note, a photo and a problem report (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const { asset, tag } = await t.step('make an asset with a tag', () => freshAsset(t, `actions ${theme}`));
    const open = async () => {
      await page.goto(`/asset-tags/find?value=${encodeURIComponent(tag)}`);
      await page.waitFor({ css: '.tag-card' }, { timeout: 10000 });
    };

    await t.step('Quick update changes the location through the normal update path', async () => {
      await open();
      await page.click({ text: 'Quick update', within: '.tag-card-actions' });
      await page.waitFor({ label: 'Location', within: '[role=dialog]' });
      await page.fill({ label: 'Location', within: '[role=dialog]' }, 'Workshop bench 4');
      await page.click({ text: 'Save', within: '[role=dialog]' });
      await page.waitFor('[role=dialog]', { gone: true, timeout: 8000 });
      await page.waitFor({ text: 'Workshop bench 4', tag: 'dd' }, { timeout: 8000 });
      const row = await api.must('GET', `/api/assets/${asset.id}`);
      t.soft(row.location === 'Workshop bench 4', `the asset's location is "${row.location}"`);
    });

    await t.step('a stale card is refused (If-Match) and says why', async () => {
      await open();
      await api.must('PATCH', `/api/assets/${asset.id}`, { location: 'Changed elsewhere' });
      await page.click({ text: 'Quick update', within: '.tag-card-actions' });
      await page.fill({ label: 'Location', within: '[role=dialog]' }, 'Workshop bench 5');
      await page.click({ text: 'Save', within: '[role=dialog]' });
      await page.waitFor({ text: 'Someone changed this record', tag: 'p' }, { timeout: 8000 });
      const row = await api.must('GET', `/api/assets/${asset.id}`);
      t.soft(row.location === 'Changed elsewhere', `the stale change was saved ("${row.location}")`);
      await page.click({ text: 'Cancel', within: '[role=dialog]' });
      await page.click({ text: 'Discard', within: '[role=dialog]' }, { timeout: 1500 }).catch(() => null);
      await page.waitFor('[role=dialog]', { gone: true, timeout: 8000 }).catch(() => null);
      // The page's own question about unsaved work, if any, is answered by leaving.
      t.page.takeProblems?.();
    });

    await t.step('Add photo uploads a picture and shows it on the card as the record\'s photo', async () => {
      await open();
      const file = join(tmpdir(), `e2e-tag-photo-${process.pid}.png`);
      // A PNG signature and filler: enough for the server's content check, invented bytes.
      writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]));
      await page.click({ text: 'Add photo', within: '.tag-card-actions' });
      await page.waitFor('[role=dialog] input[type=file]');
      await page.upload('[role=dialog] input[type=file]', [file]);
      await page.fill({ label: 'Description', within: '[role=dialog]' }, 'Front of the tablet');
      await page.click({ text: 'Save', within: '[role=dialog]' });
      await page.waitFor('[role=dialog]', { gone: true, timeout: 10000 });
      await page.waitFor({ css: 'img.tag-card-photo' }, { timeout: 8000 });
      const alt = await page.fn(() => document.querySelector('img.tag-card-photo')?.getAttribute('alt') ?? '');
      t.soft(alt === 'Front of the tablet', `the photo's text alternative is "${alt}"`);
    });

    await t.step('Add note writes a comment on the record', async () => {
      await open();
      await page.click({ text: 'Add note', within: '.tag-card-actions' });
      await page.fill({ label: 'Note', within: '[role=dialog]' }, 'E2E: screen cracked at the corner.');
      await page.click({ text: 'Add note', within: '[role=dialog]' });
      await page.waitFor('[role=dialog]', { gone: true, timeout: 8000 });
      const comments = await api.must('GET', `/api/comments?record_type=asset&record_id=${asset.id}`);
      t.soft(comments.some((c) => c.body.includes('screen cracked')), 'the note was not saved');
    });

    await t.step('Report a problem opens the service desk form with the asset filled in', async () => {
      await open();
      await page.click({ text: 'Report a problem', within: '.tag-card-actions' });
      await page.waitFor({ label: 'Title', within: '[role=dialog]' });
      const prefilled = await page.fn(() => document.querySelector('[role=dialog]')?.innerText ?? '');
      t.soft(prefilled.includes('Affected asset'), 'the affected asset is not on the form');
      await page.fill({ label: 'Title', within: '[role=dialog]' }, 'E2E tablet will not start');
      await page.click({ text: 'Send report', within: '[role=dialog]' });
      await page.waitFor(() => /^\/tickets\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 10000 });
      const id = (await page.path).split('/')[2].split('?')[0];
      const ticket = await api.must('GET', `/api/tickets/${id}`);
      t.soft(ticket.asset_id === asset.id, 'the ticket does not name the asset as affected');
    });

    await t.step('the card lists the open ticket', async () => {
      await open();
      t.soft((await page.text('.tag-card')).includes('E2E tablet will not start'), 'the open ticket is not on the card');
    });
  },
});

const agentTest = {
  name: 'tags: an agent sees only the actions the server lists (no tag management, no safety report)',
  as: 'agent',
  async run(t) {
    const { page } = t;
    const { tag } = await t.step('make an asset with a tag', () => freshAsset(t, 'agent'));
    await t.step('the card offers the agent\'s actions only', async () => {
      await page.goto(`/asset-tags/find?value=${encodeURIComponent(tag)}`);
      await page.waitFor({ css: '.tag-card' }, { timeout: 10000 });
      const labels = await page.fn(() => [...document.querySelectorAll('.tag-card-actions button')].map((b) => b.innerText.trim()));
      t.soft(labels.includes('Report a problem'), `no Report a problem (${labels.join(', ')})`);
      t.soft(!labels.includes('Replace tag'), 'an agent was offered Replace tag');
      t.soft(!labels.includes('Report a hazard or close call'), 'an agent was offered a safety report');
    });
  },
};

const phoneTest = (theme) => ({
  name: `tags: the tag card page at 390 px wide (${theme})`,
  theme, width: 390,
  async run(t) {
    const { page } = t;
    const { tag } = await t.step('make an asset with a tag', () => freshAsset(t, `phone ${theme}`));
    await t.step('one column, no sideways scrolling, actions reachable', async () => {
      await page.goto(`/asset-tags/find?value=${encodeURIComponent(tag)}`);
      await page.waitFor({ css: '.tag-card' }, { timeout: 10000 });
      t.soft(await page.fn(noSideScroll), 'the page scrolls sideways at 390 px');
      t.soft(await page.exists({ text: 'Open full record' }), 'Open full record is not reachable');
      t.clean('tag card at 390 px');
    });
  },
});

// Inventory counts (E37-09, from TAGS-COUNTS): a separate test function.
const countTest = (theme, width) => ({
  name: `tags: an inventory count, counted with a handheld scanner, finished with one missing (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const { setup } = await t.step('a fresh site with two tagged assets', async () => {
      const stamp = Date.now().toString(36).toUpperCase();
      const site = await api.must('POST', '/api/sites', { name: `E2E count site ${stamp}` });
      const a = await api.must('POST', '/api/assets', { name: `E2E counted radio ${stamp}`, tag: `E2E-C1-${stamp}`, site_id: site.id, status: 'in_use' });
      const b = await api.must('POST', '/api/assets', { name: `E2E missing radio ${stamp}`, tag: `E2E-C2-${stamp}`, site_id: site.id, status: 'in_use' });
      return { setup: { site, a, b, stamp } };
    });
    const count = await t.step('start a count for the site', () => api.must('POST', '/api/inventory-counts/start', { site_id: setup.site.id }));

    await t.step('scan one tag into the Tag number box: it is found and the box keeps the focus', async () => {
      await page.goto(`/inventory-counts/${count.id}`);
      await page.waitFor({ label: 'Tag number' }, { timeout: 15000 });
      await page.click({ label: 'Tag number' });
      await scan(page, setup.a.tag.toLowerCase());
      await page.waitFor(mainHas(`${setup.a.name} found.`), { timeout: 10000 });
      const focused = await page.fn(() => document.activeElement?.closest('.cnt-box') !== null);
      t.soft(focused, 'the Tag number box lost the focus after a find');
      await scan(page, setup.a.tag);
      await page.waitFor(mainHas('was already found'), { timeout: 10000 });
      t.clean('count page while counting');
    });

    await t.step('finish: the other asset and the untagged site are missing', async () => {
      await page.click({ text: 'Finish', tag: 'button' });
      await page.click({ text: 'Finish the count' });
      // Finishing shows the follow-up buttons (the "Count finished" toast may already be gone).
      await page.waitFor(mainHas('Follow up the differences'), { timeout: 10000 });
      const items = await api.must('GET', `/api/inventory-counts/${count.id}/items`);
      // Expected: the site itself and the two assets; only the first asset was found.
      t.soft(items.totals.missing === 2 && items.totals.found === 1, `totals ${JSON.stringify(items.totals)}`);
      t.soft(await page.exists({ text: 'Raise an action' }), 'no Raise an action after finishing');
    });

    await t.step('the report lists the site and its coverage', async () => {
      await page.goto('/inventory-counts/report');
      await page.waitFor(mainHas(setup.site.name), { timeout: 15000 });
      t.clean('count report');
    });
  },
});

// Printing (E37-08, from TAGS-PRINT): a separate test function.
const printTest = {
  name: 'tags: the Print tags preview is an image named for screen readers, and a list bulk action hands records to it',
  async run(t) {
    const { page } = t;
    const label = () => document.querySelector('svg.tag-print-label')?.getAttribute('aria-label') ?? '';
    await t.step('a series to print from', async () => {
      const api = t.api();
      const list = await api.must('GET', '/api/asset-tags/series');
      if (!list.some((s) => s.active)) await api.must('POST', '/api/asset-tags/series', { name: 'E2E printed series', prefix: 'EP-', digits: 6 });
    });
    await t.step('the preview is an image; choosing a QR code changes its description', async () => {
      await page.goto('/admin/asset-tags/print');
      await page.waitFor({ css: 'svg.tag-print-label' }, { timeout: 15000 });
      const role = await page.fn(() => document.querySelector('svg.tag-print-label')?.getAttribute('role') ?? '');
      t.soft(role === 'img', `the preview's role is "${role}"`);
      await page.click({ label: 'Code' });
      await page.click({ text: 'Text and QR code', tag: '[role=option]' });
      await page.waitFor(() => /QR/i.test(document.querySelector('svg.tag-print-label')?.getAttribute('aria-label') ?? ''), { timeout: 8000 });
      t.soft(/QR/i.test(await page.fn(label)), `the preview says "${await page.fn(label)}"`);
      t.clean('print page');
    });
    await t.step('select an asset, Print tags opens the page with the chosen records', async () => {
      await page.goto('/assets');
      await page.waitFor({ css: 'tbody input[type=checkbox]' }, { timeout: 15000 });
      await page.click({ css: 'tbody input[type=checkbox]' });
      await page.click({ text: 'Print tags', tag: 'button' });
      await page.waitFor(() => location.pathname === '/admin/asset-tags/print', { timeout: 10000 });
      await page.waitFor({ text: 'Chosen records' }, { timeout: 10000 });
      t.clean('print page from the list');
    });
  },
};

export const tests = [
  findTest('light', 1440), findTest('dark', 820),
  actionsTest('light', 1440), actionsTest('dark', 820),
  agentTest,
  phoneTest('light'), phoneTest('dark'),
  countTest('light', 1440), countTest('dark', 820),
  printTest,
];
