// Wave 11 follow-ups: the controls covering a record show on that record's own page (E26-11), and a
// dialog with a draft asks before it is discarded (E22-14).
// Run alone with: npm run test:e2e -- --only followups (or --grep followups).

/** The covered record types, where their page shows the panel, and how to find one in the sample data. */
const HOSTS = [
  { type: 'risk', path: '/api/risks', route: '/risks', tab: '' },
  { type: 'hazard', path: '/api/hazards', route: '/safety/hazards', tab: '' },
  { type: 'framework_outcome', path: '/api/framework-outcomes', route: '/frameworks/outcomes', tab: '' },
  { type: 'obligation', path: '/api/obligations', route: '/obligations', tab: '?tab=periods' },
  { type: 'policy', path: '/api/policies', route: '/policies', tab: '?tab=policy' },
];

const controlsPanelTest = (theme, width) => ({
  name: `followups: the controls covering a risk, hazard, outcome, obligation and policy show on each page (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const control = await t.step('make a control covering one record of each kind', async () => {
      const c = await api.must('POST', '/api/controls', { title: `E2E covering control ${tag}` });
      for (const h of HOSTS) {
        const list = await api.must('GET', `${h.path}?pageSize=1`);
        if (!list.rows?.length) throw new Error(`no sample ${h.type} to cover`);
        h.id = list.rows[0].id;
        await api.must('POST', `/api/controls/${c.id}/coverage`, { type: h.type, id: h.id });
      }
      return c;
    });
    for (const h of HOSTS) {
      await t.step(`the ${h.type.replace('_', ' ')} page lists the control`, async () => {
        await page.goto(`${h.route}/${h.id}${h.tab}`);
        await page.waitFor({ text: `E2E covering control ${tag}`, tag: 'a' }, { timeout: 15000 });
        const href = await page.eval(`[...document.querySelectorAll('a')].find((a) => a.innerText.includes(${JSON.stringify(`E2E covering control ${tag}`)}))?.getAttribute('href') ?? ''`);
        t.soft(href === `/controls/${control.id}`, `the control links to "${href}"`);
      });
    }
  },
});

const dialogGuardTest = (theme, width) => ({
  name: `followups: a dialog with a draft asks before Escape discards it (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const question = () => [...document.querySelectorAll('[role=dialog]')].some((d) => /Discard this draft\?/.test(d.innerText));
    await t.step('open the acknowledgment reminder settings and change the interval', async () => {
      await page.goto('/policies');
      await page.click({ text: 'Reminder settings' });
      await page.waitFor({ label: 'Days between reminders' });
      await page.fill({ label: 'Days between reminders' }, '17');
    });
    await t.step('Escape asks first; Keep editing keeps the draft', async () => {
      await page.key('Escape');
      await page.waitFor(question, { timeout: 4000 });
      await page.click({ text: 'Keep editing' });
      await page.waitFor(question, { gone: true, timeout: 4000 });
      const value = await page.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => /Days between reminders/.test(x.innerText)); return l?.control?.value ?? ''; })()`);
      t.soft(value === '17', `the draft was not kept (it reads "${value}")`);
    });
    await t.step('Escape again, then Discard closes the dialog', async () => {
      await page.key('Escape');
      await page.waitFor(question, { timeout: 4000 });
      await page.click({ text: 'Discard' });
      await page.waitFor({ label: 'Days between reminders' }, { gone: true, timeout: 4000 });
    });
    await t.step('an untouched dialog closes on Escape without asking', async () => {
      await page.click({ text: 'Reminder settings' });
      await page.waitFor({ label: 'Days between reminders' });
      await page.key('Escape');
      await page.waitFor({ label: 'Days between reminders' }, { gone: true, timeout: 4000 });
      t.soft(!(await page.fn(question).catch(() => false)), 'it asked although nothing was changed');
    });
  },
});

export const tests = [controlsPanelTest('light', 1440), controlsPanelTest('dark', 820), dialogGuardTest('light', 1440), dialogGuardTest('dark', 820)];
