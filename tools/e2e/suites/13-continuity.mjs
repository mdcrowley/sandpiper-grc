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

// E31-10: submitting an impact analysis asks the process owner through the approval workflow; the
// owner's approval signs it off.
const biaSignOffTest = {
  name: 'continuity: the process owner signs off an impact analysis through the approval workflow',
  theme: 'light', width: 1440,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const owner = await t.step('make a process owner who may only read continuity records', () => t.app.newUser(`e2e.bia-owner-${tag}`, ['safety_manager']));
    const p = await api.must('POST', '/api/business-processes', { name: `E2E owned process ${tag}`, status: 'active', criticality: 'vital', owner_id: owner.id });
    const bia = await api.must('POST', '/api/bias', { process_id: p.id, mtd_hours: 6, rto_target_hours: 3 });

    await t.step('submit it for sign-off', async () => {
      await page.goto(`/continuity/impact-analyses/${bia.id}`);
      await page.click({ text: 'Submit for sign-off', tag: 'button' });
      await page.waitFor({ text: 'Sign off directly', tag: 'button' });
      const main = await page.text('main');
      t.soft(main.includes('Impact analysis sign-off'), 'the approval panel is missing');
      t.soft(main.includes(`Test e2e.bia-owner-${tag}`), 'the process owner is not named');
    });
    await t.step('the owner approves', async () => {
      const ownerApi = t.app.api(owner.token);
      const flows = await ownerApi.must('GET', `/api/workflows/records/bia/${bia.id}`);
      const step = flows.instances.flatMap((i) => i.steps).find((s) => s.can_decide);
      t.soft(Boolean(step), 'the owner is not asked to decide');
      if (step) await ownerApi.must('POST', `/api/workflows/steps/${step.id}/decision`, { decision: 'approved' });
    });
    await t.step('the analysis is signed off and the process carries its targets', async () => {
      await page.goto(`/continuity/impact-analyses/${bia.id}`);
      await page.waitFor({ text: `Signed off by Test e2e.bia-owner-${tag}`, tag: 'p' });
      const proc = await api.must('GET', `/api/business-processes/${p.id}`);
      t.soft(Number(proc.mtd_hours) === 6, 'the tolerable downtime was not copied onto the process');
    });
  },
};

export const tests = [continuityTest('light', 1440), continuityTest('dark', 820), biaSignOffTest];
