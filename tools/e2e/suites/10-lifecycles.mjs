// Administration > Lifecycles (E14-31): an administrator turns off one status change in the table,
// saves, the server then refuses that change on a record, and "Restore defaults" brings it back.
// Run alone with: npm run test:e2e -- --only lifecycles (or --grep lifecycle).

const TYPE = 'problem';

const lifecycleTest = (theme, width) => ({
  name: `lifecycle page: turn off a change, enforce it, restore defaults (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    await api.call('DELETE', `/api/admin/lifecycles/${TYPE}`); // start from the defaults
    const detail = await t.step('read the statuses', () => api.must('GET', `/api/admin/lifecycles/${TYPE}`));
    const [from, to] = detail.statuses;
    if (!from || !to) throw new Error('the problem status list needs two values');

    await t.step('open the page', async () => {
      await page.goto(`/admin/lifecycles?type=${TYPE}`);
      await page.waitFor({ text: 'Allowed changes', tag: 'h2, h3, div, span' });
    });
    await t.step(`turn off ${from.label} to ${to.label} and save`, async () => {
      await page.click({ label: `Allow ${from.label} to ${to.label}` });
      await page.click({ text: 'Save lifecycle' });
      await page.waitFor({ text: 'Restore defaults' });
    });
    const saved = await api.must('GET', `/api/admin/lifecycles/${TYPE}`);
    t.soft(saved.customized && saved.rules.blocked.some(([a, b]) => a === from.value && b === to.value), 'the change was not stored');
    t.soft((await page.text('main')).includes(`May change to`), 'the diagram is not shown');

    await t.step('the server refuses that change on a record', async () => {
      const made = await api.must('POST', '/api/problems', { title: `Lifecycle check ${Date.now().toString(36)}`, status: from.value });
      const refused = await api.patch(`/api/problems/${made.id}`, { status: to.value });
      t.soft(refused.status === 400 && /cannot move/.test(refused.body?.error?.fields?.status ?? ''), `PATCH answered ${refused.status}`);
      await api.must('DELETE', `/api/problems/${made.id}`);
    });

    await t.step('restore the defaults', async () => {
      await page.click({ text: 'Restore defaults' });
      await page.click({ text: 'Restore defaults', within: '[role="dialog"]' });
      await page.waitFor({ text: 'Defaults: every change allowed', tag: 'span, div' });
    });
    t.soft(!(await api.must('GET', `/api/admin/lifecycles/${TYPE}`)).customized, 'the defaults were not restored');
  },
});

export const tests = [lifecycleTest('light', 1440), lifecycleTest('dark', 820)];
