// Vendor risk lifecycle (E35): an exclusion-list check recorded on the vendor's Lifecycle tab, a
// contract ending starts an offboarding whose checklist is worked through and signed off, and a
// sub-recipient's monitoring history; an intake that sets a risk tier, required checks holding up a contract,
// and a contractor performance score (E41-10, E41-11). Run alone with: npm run test:e2e -- --only vendor-lifecycle.

const lifecycleTest = (theme, width) => ({
  name: `vendor-lifecycle: an exclusion check, an offboarding signed off, sub-recipient monitoring (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const vendor = await api.must('POST', '/api/vendors', { name: `E2E vendor ${tag}`, criticality: 'critical', remote_access_method: 'Support tool (test)' });

    await t.step('the lifecycle tab shows the reassessment and records an exclusion check', async () => {
      await page.goto(`/vendors/${vendor.id}?tab=lifecycle`);
      await page.click({ text: 'Record a check', tag: 'button' });
      await page.waitFor({ label: 'List checked' });
      await api.must('POST', `/api/vendors/${vendor.id}/exclusion-checks`, { list_key: 'government_exclusion_list', result: 'clear', reference: `E2E-REF-${tag}` });
      await page.goto(`/vendors/${vendor.id}?tab=lifecycle`);
      await page.waitFor({ text: `E2E-REF-${tag}`, tag: 'td' });
    });

    const contract = await api.must('POST', '/api/contracts', { title: `E2E contract ${tag}`, vendor_id: vendor.id });
    await api.must('PATCH', `/api/contracts/${contract.id}`, { status: 'terminated' });
    const list = await api.must('GET', `/api/vendor-offboardings?f.contract_id=${contract.id}`);
    t.soft(list.total === 1, 'ending the contract started no offboarding');
    const ob = list.rows[0];

    await t.step('the contract page links to its offboarding', async () => {
      await page.goto(`/contracts/${contract.id}`);
      await page.waitFor({ text: `Open offboarding ${ob.ref}` });
    });
    await t.step('the checklist lists the remote access and signs off once every item is finished', async () => {
      const items = await api.must('GET', `/api/vendor-offboardings/${ob.id}/items`);
      for (const item of items.items) await api.must('POST', `/api/vendor-offboardings/${ob.id}/items/${item.id}`, { status: 'done', evidence_note: 'E2E done' });
      await page.goto(`/vendors/offboardings/${ob.id}?tab=checklist`);
      await page.waitFor({ text: 'Add new items from the inventory' });
      await page.click({ text: 'Sign off', tag: 'button' });
      await page.waitFor({ text: 'Signed off', tag: 'span' });
    });
    t.soft((await api.must('GET', `/api/vendor-offboardings/${ob.id}`)).status === 'signed_off', 'the offboarding was not signed off');

    await t.step('the reassessments page lists the vendor', async () => {
      await page.goto('/vendors/reassessments');
      await page.waitFor({ text: `E2E vendor ${tag}`, tag: 'a' });
    });

    const award = await api.must('POST', '/api/funding-awards', { title: `E2E award ${tag}`, status: 'active' });
    const sub = await api.must('POST', '/api/subrecipients', { name: `E2E partner ${tag}`, award_id: award.id, monitoring_frequency: 'quarterly' });
    await api.must('POST', `/api/subrecipients/${sub.id}/monitoring`, { method: 'site_visit', result: 'findings', findings: `E2E findings ${tag}` });
    await t.step('a sub-recipient shows its monitoring history', async () => {
      await page.goto(`/funding/subrecipients/${sub.id}?tab=monitoring`);
      await page.waitFor({ text: `E2E findings ${tag}`, tag: 'td' });
    });
  },
});

// Intake with risk tiers and required checks (E41-10) and contractor performance (E41-11).
const intakeTest = (theme, width) => ({
  name: `vendor-lifecycle: an intake sets the risk tier, checks hold up a contract, a score is recorded (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const vendor = await api.must('POST', '/api/vendors', { name: `E2E intake vendor ${tag}` });
    const settings = await api.must('GET', '/api/vendors/intake-settings');

    await t.step('the intake questionnaire sets the risk tier', async () => {
      await page.goto(`/vendors/${vendor.id}?tab=intake`);
      await page.click({ text: 'Fill in the intake', tag: 'button' });
      for (const q of settings.config.questions) {
        // The last answer of each starter question is the riskiest.
        await page.click({ css: `input[name="intake-${q.key}"][value="${q.options[q.options.length - 1].value}"]` });
      }
      await page.waitFor({ text: 'Risk tier from these answers:', tag: '[role=dialog] *' });
      await page.click({ text: 'Save the intake', tag: 'button' });
      await page.waitFor({ text: 'Why this tier', tag: 'h3' });
    });
    const tiered = await api.must('GET', `/api/vendors/${vendor.id}`);
    t.soft(Boolean(tiered.risk_tier), 'the intake set no risk tier');
    const checks = await api.must('GET', `/api/vendors/${vendor.id}/checks`);

    const contract = await api.must('POST', '/api/contracts', { title: `E2E intake contract ${tag}`, vendor_id: vendor.id, status: 'draft' });
    if (checks.outstanding > 0) {
      const refused = await api.call('PATCH', `/api/contracts/${contract.id}`, { status: 'active' });
      t.soft(refused.status === 400, 'a contract became active while required checks were missing');
      await t.step('a draft contract says which checks stand in the way', async () => {
        await page.goto(`/contracts/${contract.id}`);
        await page.waitFor({ text: 'This contract cannot become active yet', tag: 'main *' });
      });
    }

    const measure = await api.must('POST', `/api/contracts/${contract.id}/measures`, { name: `E2E availability ${tag}`, target: 99, unit: '%' });
    await t.step('a score is recorded with a comment on the Performance tab', async () => {
      await page.goto(`/contracts/${contract.id}?tab=performance`);
      await page.click({ text: 'Score', tag: 'button' });
      await page.fill({ label: 'Score (%)' }, '97.5');
      await page.fill({ label: 'Comment' }, `E2E comment ${tag}`);
      await page.waitFor({ text: 'Below the target', tag: 'body *' });
      await page.click({ text: 'Record the score', tag: 'button' });
      await page.waitFor({ text: `E2E comment ${tag}`, tag: 'td' });
    });
    const perf = await api.must('GET', `/api/contracts/${contract.id}/performance`);
    t.soft(perf.measures.find((m) => m.id === measure.id)?.latest?.met === false, 'the score was not recorded as below target');
  },
});

export const tests = [lifecycleTest('light', 1440), lifecycleTest('dark', 820), intakeTest('light', 1440), intakeTest('dark', 820)];
