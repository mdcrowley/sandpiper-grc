// Wave 11 follow-ups: the controls covering a record show on that record's own page (E26-11), and a
// dialog with a draft asks before it is discarded (E22-14); written test steps on a control (E41-12).
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
    // A new distribution group (Documents > Groups, E43-03) is a dialog with a draft.
    await t.step('open a new distribution group and type a name', async () => {
      await page.goto('/documents/groups');
      await page.click({ text: 'New group' });
      await page.waitFor({ label: 'Name' });
      await page.fill({ label: 'Name' }, 'Invented depot supervisors');
    });
    await t.step('Escape asks first; Keep editing keeps the draft', async () => {
      await page.key('Escape');
      await page.waitFor(question, { timeout: 4000 });
      await page.click({ text: 'Keep editing' });
      await page.waitFor(question, { gone: true, timeout: 4000 });
      const value = await page.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => /^Name/.test(x.innerText)); return l?.control?.value ?? ''; })()`);
      t.soft(value === 'Invented depot supervisors', `the draft was not kept (it reads "${value}")`);
    });
    await t.step('Escape again, then Discard closes the dialog', async () => {
      await page.key('Escape');
      await page.waitFor(question, { timeout: 4000 });
      await page.click({ text: 'Discard' });
      await page.waitFor({ label: 'Name' }, { gone: true, timeout: 4000 });
    });
    await t.step('an untouched dialog closes on Escape without asking', async () => {
      await page.click({ text: 'New group' });
      await page.waitFor({ label: 'Name' });
      await page.key('Escape');
      await page.waitFor({ label: 'Name' }, { gone: true, timeout: 4000 });
      t.soft(!(await page.fn(question).catch(() => false)), 'it asked although nothing was changed');
    });
  },
});

// E41-12: written test steps on a control are copied into a new test, where each gets a result.
const testStepsTest = (theme, width) => ({
  name: `followups: a control's written test steps are added and given results in a test (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const control = await api.must('POST', '/api/controls', { title: `E2E stepped control ${tag}`, status: 'active' });
    await t.step('add a step on the control\'s Test steps tab', async () => {
      await page.goto(`/controls/${control.id}?tab=steps`);
      await page.click({ text: 'Add a step', tag: 'button' });
      await page.fill({ label: 'What the tester does' }, `E2E check the gate log ${tag}`);
      await page.fill({ label: 'What they should find' }, 'Every entry is signed');
      await page.click({ text: 'Save', tag: 'button' });
      await page.waitFor({ text: `E2E check the gate log ${tag}`, tag: 'p' });
    });
    const test = await api.must('POST', '/api/control-tests', { control_id: control.id, test_type: 'operating', status: 'in_progress' });
    await t.step('the new test has the step, and takes a note', async () => {
      await page.goto(`/controls/tests/${test.id}?tab=steps`);
      await page.waitFor({ text: `E2E check the gate log ${tag}`, tag: 'p' });
      t.soft((await page.text('main')).includes('0 of 1 done'), 'the progress is missing');
      await page.fill({ label: 'Note on step 1' }, 'Two entries unsigned');
      await page.click({ text: 'Test steps', tag: 'h2,h3' }).catch(() => {}); // leave the box, which saves the note
    });
    await t.step('the note is saved', async () => {
      const deadline = Date.now() + 8000;
      let note = null;
      while (Date.now() < deadline && note !== 'Two entries unsigned') {
        note = (await api.must('GET', `/api/control-tests/${test.id}/steps`)).rows[0]?.note ?? null;
        if (note !== 'Two entries unsigned') await new Promise((r) => setTimeout(r, 300));
      }
      t.soft(note === 'Two entries unsigned', `the note was not saved (${note})`);
    });
  },
});

export const tests = [controlsPanelTest('light', 1440), controlsPanelTest('dark', 820), dialogGuardTest('light', 1440), dialogGuardTest('dark', 820), testStepsTest('light', 1440), testStepsTest('dark', 820)];
