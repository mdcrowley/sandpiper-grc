// Asset condition (E32): an asset manager puts a vehicle in a class, records a condition assessment
// from the vehicle's Condition tab and sees it on the page and in the class's members; the
// dashboard shows the class against its target. Everything is invented.
// Run alone with: npm run test:e2e -- --only condition (or --grep condition).
import { fillRequired, submit } from '../lib/forms.mjs';

const conditionTest = (theme, width) => ({
  name: `condition: a vehicle is rated and counted against its class target (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const year = new Date().getFullYear();
    const { cls, vehicle } = await t.step('set up a class with a target and a vehicle in it', async () => {
      const c = await api.must('POST', '/api/asset-classes', { name: `E2E bus class ${tag}`, applies_to: 'vehicle', useful_life_years: 12 });
      await api.must('PUT', `/api/asset-classes/${c.id}/targets/${year}`, { target_pct: 10 });
      const v = await api.must('POST', '/api/vehicles', { fleet_number: `E2E-${tag}`, mode: 'bus', in_service_date: '2010-03-01', asset_class_id: c.id });
      return { cls: c, vehicle: v };
    });
    t.soft(vehicle.useful_life_end === '2022-03-01', `the end of useful life is ${vehicle.useful_life_end}, not 2022-03-01`);

    await t.step('record an assessment from the vehicle page', async () => {
      await page.goto(`/vehicles/${vehicle.id}?tab=condition`);
      await page.waitFor({ text: 'Record assessment' });
      t.soft((await page.text('main')).includes('Past useful life'), 'the vehicle is not shown as past its useful life');
      await page.click({ text: 'Record assessment' });
      await page.waitFor({ css: '[role="dialog"] form' });
      await fillRequired(page, '[role="dialog"] form', tag);
      await submit(page, '[role="dialog"] form');
      await page.waitFor({ css: '[role="dialog"]' }, { gone: true });
      await page.waitFor({ text: 'CND-', tag: 'a' });
    });
    const saved = await api.must('GET', `/api/vehicles/${vehicle.id}`);
    t.soft(!!saved.condition_rating && !!saved.condition_assessed_on, 'the vehicle does not carry the new rating');

    await t.step('the class lists the vehicle among its members', async () => {
      await page.goto(`/condition/classes/${cls.id}?tab=members`);
      await page.waitFor({ text: `E2E-${tag}`, tag: 'a' });
    });

    await t.step('the dashboard counts the class against its target', async () => {
      await page.goto('/condition');
      await page.waitFor({ text: `E2E bus class ${tag}`, tag: 'a' });
      const d = await api.must('GET', '/api/condition/dashboard');
      const mine = d.classes.find((c) => c.id === cls.id);
      t.soft(mine && mine.total === 1 && mine.past_ulb === 1 && mine.over_target === true, 'the dashboard figures for the class are wrong');
    });
  },
});

export const tests = [conditionTest('light', 1440), conditionTest('dark', 820)];
