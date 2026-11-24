// User access reviews (E41-02): the figures flag an account whose holder has left, the reviewer keeps
// and removes accounts on their system's page (a leaver's account needs a reason to stay) and signs it
// off, the removal appears on the campaign and is recorded as done, and a system's page lists its
// accounts. Run alone with: npm run test:e2e -- --only access-reviews (or --grep access-reviews:).

const reviewTest = (theme, width) => ({
  name: `access-reviews: flags, deciding, signing off and a removal recorded as done (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const setup = await t.step('set up a system, a roster person who has left, two accounts and a launched campaign', async () => {
      const me = (await api.must('GET', '/api/auth/state')).user.id;
      const system = await api.must('POST', '/api/systems', { name: `E2E access system ${tag}`, business_owner_id: me, technical_owner_id: me });
      const person = await api.must('POST', '/api/people', { full_name: `E2E leaver ${tag}`, employee_number: `E2E-${tag}` });
      await api.must('PATCH', `/api/people/${person.id}`, { status: 'left' });
      const leaver = await api.must('POST', '/api/system-accounts', { system_id: system.id, account_name: `e2e-leaver-${tag}`, employee_number: `E2E-${tag}`, role_on_system: 'Operator' });
      const other = await api.must('POST', '/api/system-accounts', { system_id: system.id, account_name: `e2e-shared-${tag}`, account_kind: 'shared', role_on_system: 'Viewer' });
      const review = await api.must('POST', '/api/access-reviews', { title: `E2E access review ${tag}`, due_on: '2099-12-31', owner_id: me });
      await api.must('POST', `/api/access-reviews/${review.id}/systems`, { system_id: system.id });
      await api.must('POST', `/api/access-reviews/${review.id}/launch`, {});
      return { system, leaver, other, review };
    });

    await t.step('the account register flags the leaver', async () => {
      await page.goto(`/access-reviews/accounts?f.attention=leaver`);
      await page.waitFor({ text: `e2e-leaver-${tag}` });
      t.soft((await page.text('main')).includes('Holder has left'), 'the leaver flag is not shown');
    });

    await t.step('the reviewer keeps one account and removes the leaver, then signs off', async () => {
      await page.goto(`/access-reviews/${setup.review.id}/systems/${setup.system.id}`);
      await page.waitFor({ text: `Accounts on E2E access system ${tag}`, tag: 'h1' });
      await page.click({ text: `Keep e2e-shared-${tag}`, tag: 'button' });
      await page.waitFor(new Function(`return [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.getAttribute('aria-label') === ${JSON.stringify(`Keep e2e-shared-${tag}`)});`));
      await page.click({ text: `Remove e2e-leaver-${tag}`, tag: 'button' });
      await page.waitFor({ text: 'Comment (optional)', tag: 'label' });
      await page.click({ text: 'Remove', tag: '[role=dialog] button' });
      await page.waitFor(new Function(`return [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.getAttribute('aria-label') === ${JSON.stringify(`Remove e2e-leaver-${tag}`)});`));
      await page.click({ text: 'Sign off', tag: 'button' });
      await page.click({ text: 'Sign off', tag: '[role=dialog] button' });
      await page.waitFor({ text: 'Signed off', tag: 'main *' });
    });

    await t.step('the removal is listed on the campaign and recorded as done', async () => {
      await page.goto(`/access-reviews/${setup.review.id}?tab=removals`);
      await page.waitFor({ text: `e2e-leaver-${tag}`, tag: 'a' });
      await page.click({ text: 'Record as removed', tag: 'button' });
      await page.waitFor({ text: 'Record as removed', tag: 'button' }, { gone: true });
      const account = await api.must('GET', `/api/system-accounts/${setup.leaver.id}`);
      t.soft(account.status === 'removed', 'the account is not marked removed');
    });

    await t.step('the system page lists its accounts', async () => {
      await page.goto(`/systems/${setup.system.id}?tab=ext-accounts`);
      await page.waitFor({ text: `e2e-shared-${tag}` });
    });
  },
});

export const tests = [reviewTest('light', 1440), reviewTest('dark', 820)];
