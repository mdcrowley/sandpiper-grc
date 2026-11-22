// Vendor risk lifecycle (E35): an exclusion-list check recorded on the vendor's Lifecycle tab, a
// contract ending starts an offboarding whose checklist is worked through and signed off, and a
// sub-recipient's monitoring history. Run alone with: npm run test:e2e -- --only vendor-lifecycle.

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

export const tests = [lifecycleTest('light', 1440), lifecycleTest('dark', 820)];
