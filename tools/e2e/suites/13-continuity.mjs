// Business continuity (E31): a process whose tolerable downtime is shorter than a system's recovery
// time shows on the gap report; an emergency activation is logged and stood down in its workspace.
// Run alone with: npm run test:e2e -- --only continuity (or --grep continuity).

const continuityTest = (theme, width) => ({
  name: `continuity: the gap report lists a gap, an activation is logged and stood down (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const process = await t.step('set up a process that depends on a slow system', async () => {
      const system = await api.must('POST', '/api/systems', { name: `E2E slow system ${tag}`, rto_hours: 48 });
      const p = await api.must('POST', '/api/business-processes', { name: `E2E process ${tag}`, status: 'active', criticality: 'vital', mtd_hours: 4 });
      await api.must('PUT', `/api/business-processes/${p.id}/dependencies`, { dependencies: [{ dep_type: 'system', dep_id: system.id }] });
      return p;
    });

    await t.step('the gap report names the process', async () => {
      await page.goto('/continuity/gaps');
      await page.waitFor({ text: `E2E slow system ${tag}`, tag: 'a' });
      t.soft((await page.text('main')).includes(`E2E process ${tag}`), 'the process is not named');
      t.soft((await page.text('main')).includes('Longer than tolerated'), 'the finding is missing');
    });
    await t.step('the process lists its dependency', async () => {
      await page.goto(`/continuity/processes/${process.id}?tab=dependencies`);
      await page.waitFor({ text: `E2E slow system ${tag}`, tag: 'a' });
    });

    const plan = await api.must('POST', '/api/continuity-plans', { title: `E2E plan ${tag}` });
    await api.must('PUT', `/api/continuity-plans/${plan.id}/checklist`, { items: [{ phase: 'activate', item: `E2E open the room ${tag}` }] });
    const activation = await api.must('POST', '/api/emergency-activations', { title: `E2E storm ${tag}`, event_type: 'severe_weather', plan_ids: [plan.id] });

    await t.step('add a log entry', async () => {
      await page.goto(`/continuity/activations/${activation.id}?tab=log`);
      await page.fill({ label: 'Add a log entry' }, `E2E water over the road ${tag}`);
      await page.click({ text: 'Add to log' });
      await page.waitFor({ text: `E2E water over the road ${tag}`, tag: 'p' });
    });
    await t.step('the plan checklist was copied', async () => {
      await page.goto(`/continuity/activations/${activation.id}?tab=checklist`);
      await page.waitFor({ text: `E2E open the room ${tag}` });
    });
    await t.step('stand down with a summary', async () => {
      await page.goto(`/continuity/activations/${activation.id}?tab=summary`);
      await page.fill({ label: 'Stand-down summary' }, `E2E all clear ${tag}`);
      await page.click({ text: 'Stand down', tag: 'button' });
      await page.waitFor({ text: 'Close the activation', tag: 'button' });
    });
    t.soft((await api.must('GET', `/api/emergency-activations/${activation.id}`)).status === 'stood_down', 'the activation was not stood down');
  },
});

export const tests = [continuityTest('light', 1440), continuityTest('dark', 820)];
