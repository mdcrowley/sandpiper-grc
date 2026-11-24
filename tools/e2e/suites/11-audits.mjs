// Audits and inspections (E24): an inspector works through an inspection on a phone, one item at a
// time, completes it and sees the result and the finding raised; the audit dashboard shows coverage.
// Run alone with: npm run test:e2e -- --only audits (or --grep audits).

const runTest = (theme, width) => ({
  name: `audits: an inspection is run on a phone and completed with a finding (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const inspection = await t.step('set up a checklist and an inspection', async () => {
      const tpl = await api.must('POST', '/api/checklist-templates', { name: `E2E walk-down ${tag}`, kind: 'inspection', target_type: 'none' });
      await api.must('PUT', `/api/checklist-templates/${tpl.id}/items`, {
        items: [{ section: 'Platforms', prompt: `E2E lights working ${tag}` }, { section: 'Fire', prompt: `E2E exits clear ${tag}`, critical: true }],
      });
      return api.must('POST', '/api/inspections', { template_id: tpl.id, target_type: 'none' });
    });

    await t.step('answer the first item: yes moves on', async () => {
      await page.goto(`/inspections/${inspection.id}/run`);
      await page.waitFor({ text: `E2E lights working ${tag}`, tag: 'h2' });
      await page.click({ text: 'Yes', tag: 'button' });
      await page.waitFor({ text: `E2E exits clear ${tag}`, tag: 'h2' });
    });

    await t.step('answer the critical item no, with a note', async () => {
      await page.click({ text: 'No', tag: 'button' });
      await page.waitFor({ text: 'What was found' });
      await page.fill({ label: 'What was found' }, 'E2E exit blocked by carts.');
      await page.click({ text: 'Save note', tag: 'button' });
      await page.waitFor(() => document.querySelector('main')?.innerText.includes('2 of 2 answered'));
    });

    await t.step('complete the inspection', async () => {
      await page.click({ text: 'Complete inspection', tag: 'button' });
      await page.click({ text: 'Complete', within: '[role="dialog"]', tag: 'button' });
      await page.waitFor({ text: 'Inspection complete', tag: 'h2' });
      await page.waitFor(() => document.querySelector('main')?.innerText.includes('One finding was raised'));
    });
    const done = await api.must('GET', `/api/inspections/${inspection.id}`);
    t.soft(done.status === 'complete' && done.result === 'fail' && Number(done.score_pct) === 50, `unexpected result ${done.status} ${done.result} ${done.score_pct}`);
    const findings = await api.must('GET', `/api/audit-findings?f.source_id=${inspection.id}`);
    t.soft(findings.rows.length === 1 && findings.rows[0].condition === 'E2E exit blocked by carts.', 'the finding was not raised with the note');
  },
});

const dashboardTest = {
  name: 'audits: the plan and coverage page lists an audit area with its state (light, 1440)',
  theme: 'light', width: 1440,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    await api.must('POST', '/api/audit-areas', { name: `E2E area ${tag}`, category: 'process', cycle_months: 12 });
    await page.goto('/audits');
    await page.waitFor(() => document.querySelector('main')?.innerText.includes('Coverage of the audit universe'));
    await page.waitFor({ text: `E2E area ${tag}`, tag: 'a' });
    t.soft((await page.text('main')).includes('Never audited'), 'the new area is not shown as never audited');
  },
};

// E41-09: an audit's Outside reviewers tab, and the administrators' list. (Sending an invitation needs
// email set up, which the throw-away instance has not: the tab says so and offers no invitation.)
const reviewersTest = {
  name: 'audits: the outside reviewers tab and the list of invitations for administrators (light, 1440)',
  theme: 'light', width: 1440,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const audit = await api.must('POST', '/api/audits', { title: `E2E audit for an outside reviewer ${tag}`, audit_type: 'internal_audit' });
    await page.goto(`/audits/engagements/${audit.id}?tab=reviewers`);
    await page.waitFor(() => document.querySelector('main')?.innerText.includes('No outside reviewers'));
    t.soft((await page.text('main')).includes('Email is not set up'), 'the tab does not say that invitations need email');
    await page.goto('/admin/outside-reviewers');
    await page.waitFor({ text: 'Outside reviewers', tag: 'h1' });
  },
};

export const tests = [runTest('light', 390), runTest('dark', 820), dashboardTest, reviewersTest];
