// Calendar feeds and evidence links (E36-03, E36-05): a person makes a calendar feed and copies its
// address once, and the address answers with a calendar; an editor links a document kept elsewhere to
// an action and marks it checked. Run alone with: npm run test:e2e -- --only feeds (or --grep feeds).

/** Switches calendar feeds on as the administrator (needs a fresh password confirmation). */
async function feedsOn(t) {
  const api = t.api();
  await api.must('POST', '/api/auth/confirm', { password: t.users.administrator.password });
  await api.must('PUT', '/api/admin/feeds/settings', { calendarEnabled: true });
}

const feedTest = (theme, width) => ({
  name: `feeds: a calendar feed is made, its address shown once and answering (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const tag = Date.now().toString(36);
    await t.step('switch calendar feeds on', () => feedsOn(t));
    await t.step('make a feed', async () => {
      await page.goto('/account/calendar-feeds');
      await page.click({ text: 'New feed' });
      await page.fill({ label: 'Name', within: '[role="dialog"]' }, `E2E feed ${tag}`);
      await page.click({ text: 'Make feed', within: '[role="dialog"]' });
      await page.waitFor({ text: 'Copy address' });
    });
    const address = await page.eval(`document.querySelector('[data-testid="feed-address"]')?.getAttribute('data-value') ?? ''`);
    t.soft(/\/api\/calendar\/grc_cal_[A-Za-z0-9_-]{43}\.ics$/.test(address), `the address looks wrong: ${address}`);
    await t.step('the address answers with a calendar', async () => {
      const r = await fetch(address.replace(/^https?:\/\/[^/]+/, t.app.base));
      const text = await r.text();
      t.soft(r.status === 200 && text.startsWith('BEGIN:VCALENDAR'), `the feed did not answer with a calendar (${r.status})`);
    });
    await t.step('the address is not shown again after a reload', async () => {
      await page.click({ text: 'Done' });
      await page.goto('/account/calendar-feeds');
      await page.waitFor({ text: `E2E feed ${tag}`, tag: "strong" });
      t.soft(!(await page.text('main')).includes('grc_cal_'), 'the secret address is still on the page');
    });
    await t.step('revoke it', async () => {
      const feeds = (await t.api().must('GET', '/api/me/calendar-feeds')).feeds;
      for (const f of feeds.filter((x) => x.name === `E2E feed ${tag}`)) await t.api().must('DELETE', `/api/me/calendar-feeds/${f.id}`);
      const r = await fetch(address.replace(/^https?:\/\/[^/]+/, t.app.base));
      t.soft(r.status === 404, 'a revoked feed still answers');
    });
  },
});

const linkTest = (theme, width) => ({
  name: `feeds: an evidence link is added to an action and marked checked (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const tag = Date.now().toString(36);
    const action = await t.api().must('POST', '/api/actions', { title: `E2E linked action ${tag}`, status: 'open' });
    await t.step('add a link', async () => {
      await page.goto(`/actions/${action.id}?tab=attachments`);
      await page.click({ text: 'Add link' });
      await page.fill({ label: 'Address', within: '[role="dialog"]' }, `https://documents.example.test/e2e/${tag}/report.pdf`);
      await page.fill({ label: 'Title', within: '[role="dialog"]' }, `E2E report ${tag}`);
      await page.click({ text: 'Add link', within: '[role="dialog"] .form-actions' });
      await page.waitFor({ text: `E2E report ${tag}`, tag: 'a' });
    });
    const files = (await t.api().must('GET', `/api/attachments?record_type=action&record_id=${action.id}`)).rows;
    t.soft(files.length === 1 && files[0].is_link && files[0].link_url.endsWith('/report.pdf'), 'the link was not stored');
    await t.step('mark it checked', async () => {
      await page.click({ role: 'button', name: `Mark E2E report ${tag} as checked today` });
      await page.waitFor({ text: 'Recorded as checked today.', tag: 'div, p, span' });
    });
  },
});

const trackerTest = (theme, width) => ({
  name: `feeds: a work-tracker connection is added and edited, offering only the kinds that are on (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const tag = Date.now().toString(36);
    const api = t.api();
    await api.must('POST', '/api/auth/confirm', { password: t.users.administrator.password });
    const list = await api.must('GET', '/api/admin/tracker-connectors');
    t.soft(list.kinds.some((k) => k.type === 'action'), 'actions are not offered');
    const made = await api.must('POST', '/api/admin/tracker-connectors', { name: `E2E tracker ${tag}`, url: 'https://tracker.example.test/e2e', record_types: ['action'] });
    await t.step('the connection is listed with its kinds', async () => {
      await page.goto('/admin/calendar-and-work-trackers');
      await page.waitFor({ text: 'Work-tracker connections', tag: 'h2' });
      await page.waitFor({ text: `E2E tracker ${tag}`, tag: 'strong' });
      const main = await page.text('main');
      t.soft(main.includes('tracker.example.test · Actions'), 'the host and kinds are not shown');
      t.soft(!/\btickets?\b/i.test(main), 'the page still speaks of tickets');
    });
    await t.step('Edit opens the connection with the kinds that are on', async () => {
      await page.fn((name) => {
        const item = [...document.querySelectorAll('li.feeds-item')].find((l) => l.querySelector('strong')?.innerText === name);
        [...(item?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Edit')?.setAttribute('data-e2e-edit', '1');
      }, `E2E tracker ${tag}`);
      await page.click('[data-e2e-edit]');
      await page.waitFor({ text: 'Sends', tag: 'legend' });
      const dialog = await page.text('[role="dialog"]');
      for (const k of list.kinds) t.soft(dialog.includes(k.label), `the kind ${k.label} is not offered`);
      await page.key('Escape');
    });
    await api.must('DELETE', `/api/admin/tracker-connectors/${made.id}`);
  },
});

// The compliance calendar (E41-03): the person's own due work appears in the list, the month grid and
// "My due work", and choosing an area leaves the others out.
const calendarTest = (theme, width) => ({
  name: `feeds: the compliance calendar shows due work in its list, month and my due work views (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const tag = Date.now().toString(36);
    const me = (await t.api().must('GET', '/api/auth/state')).user;
    const today = await page.eval(`new Intl.DateTimeFormat('en-CA').format(new Date())`);
    const title = `E2E due action ${tag}`;
    await t.api().must('POST', '/api/actions', { title, status: 'open', owner_id: me.id, due_on: today });
    await t.step('the list view shows it', async () => {
      await page.goto('/calendar?view=list');
      await page.waitFor({ text: title });
    });
    await t.step('the month view shows it', async () => {
      await page.goto('/calendar?view=month');
      await page.waitFor({ text: 'Compliance calendar', tag: 'h1' });
      await page.waitFor('.cc-month');
      t.soft((await page.text('.cc-month')).includes('Action due'), 'the month grid does not show the action');
    });
    await t.step('my due work shows it', async () => {
      await page.goto('/calendar?view=mine');
      await page.waitFor({ text: title });
    });
    await t.step('another area leaves it out', async () => {
      await page.goto('/calendar?view=list&area=vendors');
      await page.waitFor({ text: 'Compliance calendar', tag: 'h1' });
      await page.settled();
      t.soft(!(await page.text('main')).includes(title), 'an action shows under the vendors area');
    });
  },
});

export const tests = [
  feedTest('light', 1440), feedTest('dark', 820), linkTest('light', 1440), linkTest('dark', 820),
  calendarTest('light', 1440), calendarTest('dark', 820),
  trackerTest('light', 1440), trackerTest('dark', 820),
];
