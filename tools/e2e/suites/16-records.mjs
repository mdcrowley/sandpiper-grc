// Legal holds, records requests and privacy (E34): a held record is listed on its hold and refuses
// deletion, and the release is asked for from the Release tab; a records request shows its clock and
// is closed with a response summary; the privacy coverage lists a system holding personal data.
// Run alone with: npm run test:e2e -- --only records (or --grep records).

const holdTest = (theme, width) => ({
  name: `records: a legal hold lists its record, refuses deletion and asks for release (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const { hold, system } = await t.step('place a system under a new hold', async () => {
      const h = await api.must('POST', '/api/legal-holds', { matter: `E2E matter ${tag}` });
      const s = await api.must('POST', '/api/systems', { name: `E2E held system ${tag}` });
      await api.must('POST', `/api/legal-holds/${h.id}/records`, { records: [{ type: 'system', id: s.id }] });
      return { hold: h, system: s };
    });

    await t.step('the Records tab lists it', async () => {
      await page.goto(`/admin/legal-holds/${hold.id}?tab=records`);
      await page.waitFor({ text: `E2E held system ${tag}`, tag: 'a' });
      t.soft((await page.text('main')).includes('1 record held'), 'the count line is missing');
    });

    const refused = await api.call('DELETE', `/api/systems/${system.id}`);
    t.soft(refused.status === 409 && refused.body?.error?.code === 'on_hold', `deleting a held system answered ${refused.status}`);

    await t.step('ask for the release', async () => {
      await page.goto(`/admin/legal-holds/${hold.id}?tab=release`);
      await page.click({ text: 'Release the hold…' });
      await page.fill({ label: 'Why can it be released?', within: '[role="dialog"]' }, 'E2E: the invented matter is settled');
      await page.click({ text: 'Ask for release', within: '[role="dialog"]' });
      await page.waitFor({ text: 'it waits for approval', tag: 'p' });
    });
    const release = await api.must('GET', `/api/legal-holds/${hold.id}/release`);
    t.soft(release.request?.status === 'running', 'no release request is waiting');
  },
});

const requestTest = (theme, width) => ({
  name: `records: a request shows its clock and closes with a response summary (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const today = new Date();
    const ymd = (d) => d.toISOString().slice(0, 10);
    const received = ymd(new Date(today.getTime() - 30 * 86_400_000));
    const request = await t.step('log an overdue request', async () =>
      api.must('POST', '/api/records-requests', { subject: `E2E request ${tag}`, kind: 'records', received_on: received }));

    await t.step('the Clock tab says it is overdue', async () => {
      await page.goto(`/records-requests/${request.id}?tab=clock`);
      await page.waitFor({ text: 'Overdue', tag: 'span' });
    });

    await t.step('close it with a response summary', async () => {
      await page.goto(`/records-requests/${request.id}?tab=response`);
      await page.click({ text: 'Close the request…' });
      await page.fill({ label: 'Response summary', within: '[role="dialog"]' }, 'E2E: released in full');
      await page.click({ text: 'Close request', within: '[role="dialog"]' });
      await page.waitFor({ text: 'Close the request…' }, { gone: true });
    });
    const now = await api.must('GET', `/api/records-requests/${request.id}`);
    t.soft(now.status === 'closed' && now.response_summary === 'E2E: released in full', `the request is ${now.status}`);

    await t.step('the privacy coverage lists a system holding personal data', async () => {
      const sys = await api.must('POST', '/api/systems', { name: `E2E rider app ${tag}` });
      const cat = await api.must('POST', '/api/data-categories', { name: `E2E rider contacts ${tag}`, personal_data: true });
      await api.must('POST', `/api/systems/${sys.id}/data-categories`, { data_category_id: cat.id });
      await page.goto('/privacy');
      await page.waitFor({ text: `E2E rider app ${tag}`, tag: 'a' });
      t.soft((await page.text('main')).includes('No current assessment'), 'the system is not marked as missing an assessment');
    });
  },
});

export const tests = [holdTest('light', 1440), requestTest('dark', 820)];
