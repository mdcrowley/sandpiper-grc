// Vehicle and asset models (E39): a vehicle model is given to vehicles from the list's bulk bar
// (keeping one difference as an override), a change to the model reaches its vehicles after a
// preview while the override is kept, equipment coverage counts what the model adds, and an asset
// model is created and an asset made from it. Everything is invented.
// Run alone with: npm run test:e2e -- --only 22-models (or --grep models).
import { fillRequired, submit } from '../lib/forms.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noSideScroll = () => document.documentElement.scrollWidth <= window.innerWidth + 1;
const mainHas = (text) => new Function(`return (document.querySelector('main')?.innerText ?? '').includes(${JSON.stringify(text)});`);

const vehicleTest = (theme, width) => ({
  name: `models: a vehicle model is given to vehicles, changed after a preview, and its equipment counted (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36).slice(-6).toUpperCase();
    const name = `E2E Coach ${tag}`;
    const { model, v1, v2 } = await t.step('set up a vehicle model with equipment and two vehicles without a model', async () => {
      const m = await api.must('POST', '/api/vehicle-models', { name, mode: 'bus', make: 'E2E Works', model: `M-${tag}`, capacity: 70, funding_source: 'grant' });
      await api.must('PUT', `/api/vehicle-models/${m.id}/equipment`, { items: [{ asset_type: 'camera', count: 2 }] });
      const a = await api.must('POST', '/api/vehicles', { fleet_number: `E2E-${tag}-1`, mode: 'bus', make: 'E2E Works', model: `M-${tag}`, capacity: 70 });
      const b = await api.must('POST', '/api/vehicles', { fleet_number: `E2E-${tag}-2`, mode: 'bus', make: 'E2E Works', model: `M-${tag}`, capacity: 66 });
      return { model: m, v1: a, v2: b };
    });

    await t.step('select both vehicles on the list and set their model, keeping the second one\'s capacity', async () => {
      await page.goto(`/vehicles?q=E2E-${tag}`);
      await page.waitFor({ text: `E2E-${tag}-2`, tag: 'a' });
      await page.click({ label: 'Select all rows on this page' }).catch(() => page.click('[aria-label="Select all rows on this page"]'));
      await page.click({ text: 'Set model' });
      await page.waitFor({ css: '[role="dialog"]' });
      await page.fill({ label: 'Vehicle model' }, name);
      await sleep(600);
      await page.click({ text: name, tag: '[role=option]' });
      await page.waitFor(mainHasDialog('Keep their own passenger capacity'), { timeout: 10000 });
      await page.click({ text: 'Keep their own passenger capacity' });
      await page.click({ text: 'Give the model to 2 vehicles' });
      await page.waitFor({ css: '[role="dialog"]' }, { gone: true });
    });
    const a1 = await api.must('GET', `/api/vehicles/${v1.id}`);
    const a2 = await api.must('GET', `/api/vehicles/${v2.id}`);
    t.soft(a1.model_id === model.id && a2.model_id === model.id, 'the vehicles did not get the model');
    t.soft(JSON.stringify(a2.model_overrides) === '["capacity"]' && a2.capacity === 66, `the second vehicle did not keep its capacity (${JSON.stringify(a2.model_overrides)}, ${a2.capacity})`);
    t.soft(a1.funding_source === 'grant', 'the first vehicle did not take the model\'s funding source');

    await t.step('change the model: the preview counts the vehicles, and they follow except the override', async () => {
      await page.goto(`/vehicle-models/${model.id}`);
      await page.click({ text: 'Edit' });
      await page.waitFor({ css: 'main form' });
      await page.fill({ label: 'Make' }, 'E2E Works Two');
      await page.fill({ label: 'Passenger capacity' }, '72');
      await submit(page, 'main form');
      await page.waitFor({ text: 'Save and apply' });
      const dialog = await page.text('[role="dialog"]');
      t.soft(/2 vehicles of 2 vehicles/.test(dialog), `the preview does not say both vehicles change: ${dialog.slice(0, 200)}`);
      t.soft(/1 vehicle keep/.test(dialog), 'the preview does not mention the vehicle that keeps its own value');
      await page.click({ text: 'Save and apply' });
      await page.waitFor({ css: '[role="dialog"]' }, { gone: true });
      await page.idle();
    });
    const b1 = await api.must('GET', `/api/vehicles/${v1.id}`);
    const b2 = await api.must('GET', `/api/vehicles/${v2.id}`);
    t.soft(b1.make === 'E2E Works Two' && b1.capacity === 72, `the first vehicle did not follow the model (${b1.make}, ${b1.capacity})`);
    t.soft(b2.make === 'E2E Works Two' && b2.capacity === 66, `the override was not kept (${b2.make}, ${b2.capacity})`);

    await t.step('the vehicle shows where each value comes from', async () => {
      await page.goto(`/vehicles/${v2.id}`);
      await page.waitFor(mainHas('Overridden'), { timeout: 10000 });
      await page.waitFor(mainHas("From model"), { timeout: 10000 });
      t.soft(await page.exists({ text: "Use the model's value" }), 'no "Use the model\'s value" button');
      t.soft(await page.fn(noSideScroll), 'the vehicle page scrolls sideways');
    });

    await t.step('equipment coverage counts the two cameras the model asks for', async () => {
      await page.goto(`/vehicles/${v1.id}?tab=equipment`);
      await page.waitFor(mainHas('2 x Camera'), { timeout: 10000 });
      t.soft((await page.text('main')).includes('count set by the vehicle model'), 'the requirement does not say the model set its count');
      await page.goto('/fleet/coverage?mode=bus');
      await page.waitFor({ text: `E2E-${tag}-1`, tag: 'a' });
      const row = await page.fn((fleet) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(fleet))?.innerText ?? '', `E2E-${tag}-1`);
      t.soft(row.includes('0/2'), `the coverage row does not show 0/2 cameras: ${row.replace(/\s+/g, ' ').slice(0, 160)}`);
    });

    await t.step('the model lists its vehicles and the change', async () => {
      await page.goto(`/vehicle-models/${model.id}?tab=members`);
      await page.waitFor({ text: `E2E-${tag}-1`, tag: 'a' });
      await page.goto(`/vehicle-models/${model.id}?tab=changes`);
      await page.waitFor(mainHas('Passenger capacity'), { timeout: 10000 });
      t.soft(await page.fn(noSideScroll), 'the model page scrolls sideways');
    });
  },
});

/** A wait condition: an open dialog's text contains `text`. */
const mainHasDialog = (text) => new Function(`return [...document.querySelectorAll('[role="dialog"]')].some((d) => d.innerText.includes(${JSON.stringify(text)}));`);

const assetTest = (theme, width) => ({
  name: `models: an asset model is created and an asset made from it (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36).slice(-6).toUpperCase();
    const name = `E2E Validator ${tag}`;
    await t.step('create the asset model from its list', async () => {
      await page.goto('/asset-models?new=1');
      await page.waitFor({ css: '[role="dialog"] form' });
      await page.fill({ label: 'Name', within: '[role="dialog"]' }, name);
      await page.fill({ label: 'Make', within: '[role="dialog"]' }, 'E2E Tapworks');
      await page.fill({ label: 'Model', within: '[role="dialog"]' }, `T-${tag}`);
      await submit(page, '[role="dialog"] form');
      await page.waitFor(mainHas('New asset from this model'), { timeout: 10000 });
    });
    const model = (await api.must('GET', `/api/asset-models?q=${encodeURIComponent(name)}`)).rows[0];
    t.soft(!!model, 'the asset model was not saved');

    await t.step('make an asset from the model: the form is filled in', async () => {
      await page.click({ text: 'New asset from this model' });
      await page.waitFor({ css: '[role="dialog"] form' });
      const make = await page.fn(() => [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.innerText.trim().startsWith('Make'))?.control?.value ?? '');
      t.soft(make === 'E2E Tapworks', `the form's make is "${make}"`);
      await page.fill({ label: 'Name', within: '[role="dialog"]' }, `E2E door validator ${tag}`);
      await fillRequired(page, '[role="dialog"] form', tag);
      await submit(page, '[role="dialog"] form');
      await page.waitFor(mainHas("From model"), { timeout: 10000 });
      t.soft(await page.fn(noSideScroll), 'the asset page scrolls sideways');
    });
    if (model) {
      const members = await api.must('GET', `/api/assets?f.model_id=${model.id}`);
      t.soft(members.total === 1 && members.rows[0].make === 'E2E Tapworks', 'the asset did not take the model');
    }
  },
});

export const tests = [vehicleTest('light', 1440), assetTest('dark', 820)];
