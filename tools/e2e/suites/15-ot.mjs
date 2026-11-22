// OT and rail-systems security (E33): the overview names a zone below target, a zone page lists its
// systems and conduits, a system shows its OT details, the relationship map arranges systems by zone,
// and Frameworks and structure offers the starter structure file.
// Run alone with: npm run test:e2e -- --only ot (or --grep ot:).

const zoneTest = (theme, width) => ({
  name: `ot: a zone below target, its members and conduits, the system's OT tab and the map by zone (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const setup = await t.step('set up two zones, a conduit with remote access and an OT system', async () => {
      const a = await api.must('POST', '/api/ot-zones', { name: `E2E zone A ${tag}`, target_level: 'level_3', achieved_level: 'level_1' });
      const b = await api.must('POST', '/api/ot-zones', { name: `E2E zone B ${tag}`, target_level: 'level_2', achieved_level: 'level_2' });
      const conduit = await api.must('POST', '/api/ot-conduits', { name: `E2E conduit ${tag}`, from_zone_id: a.id, to_zone_id: b.id, remote_access: true });
      const system = await api.must('POST', '/api/systems', {
        name: `E2E OT system ${tag}`, ot_system: true, control_level: 'level_2', patchability: 'cannot_patch', zone_id: a.id,
      });
      return { a, b, conduit, system };
    });

    await t.step('the overview lists the zone below target and flags the conduit', async () => {
      await page.goto('/ot');
      await page.waitFor({ text: 'Zones below target', tag: 'h2,h3' });
      await page.waitFor({ text: `E2E zone A ${tag}`, tag: 'a' });
      await page.waitFor({ text: `E2E conduit ${tag}`, tag: 'a' });
      // Zone B is at target: it is named in the flagged conduit's row, but not listed as a zone below target.
      t.soft(!(await page.exists({ text: `E2E zone B ${tag}`, tag: 'a' })), 'a zone at target is listed as below target');
    });

    await t.step('the zone page lists its system and its conduit', async () => {
      await page.goto(`/ot/zones/${setup.a.id}?tab=members`);
      await page.waitFor({ text: `E2E OT system ${tag}`, tag: 'a' });
      t.soft((await page.text('main')).includes('Below target'), 'the zone is not marked below target');
      await page.goto(`/ot/zones/${setup.a.id}?tab=conduits`);
      await page.waitFor({ text: `E2E conduit ${tag}`, tag: 'a' });
      await page.waitFor({ text: `E2E zone B ${tag}`, tag: 'a' });
    });

    await t.step('the system shows its OT details with a link to the zone', async () => {
      await page.goto(`/systems/${setup.system.id}?tab=ext-ot`);
      await page.waitFor({ text: 'Operational technology (OT)', tag: 'h2,h3' });
      await page.waitFor({ text: `E2E zone A ${tag}`, tag: 'a' });
      t.soft((await page.text('main')).includes('Cannot be patched'), 'the patching value is not shown');
    });

    await t.step('the relationship map arranges systems by zone', async () => {
      await page.goto('/systems/map');
      await page.waitFor({ text: 'Zone', tag: 'label' });
      await page.click({ text: 'Zone', tag: 'label' });
      // A function the browser runs: the zone's name is written into it, since it cannot see this scope.
      await page.waitFor(new Function(`return [...document.querySelectorAll('main svg title')].some((x) => (x.textContent || '').startsWith(${JSON.stringify(`E2E zone A ${tag}`)}));`));
      t.soft(await page.eval(`[...document.querySelectorAll('main svg [role="button"]')].some((n) => /E2E OT system ${tag} \\(system, operational technology\\)/.test(n.getAttribute('aria-label') || ''))`),
        'the OT system has no OT mark on the map');
    });
  },
});

const starterTest = {
  name: 'ot: Frameworks and structure offers the starter structure file (light, 1440)',
  theme: 'light', width: 1440,
  async run(t) {
    const { page } = t;
    await page.goto('/frameworks/manage?new=1');
    await page.waitFor({ text: 'Download the OT starter structure', tag: 'button' });
    const file = await t.api().must('GET', '/api/frameworks/starters/ot-control-structure');
    t.soft(Array.isArray(file.functions) && file.functions.length > 0 && Array.isArray(file.mappings), 'the starter file is not a reference file with mappings');
  },
};

export const tests = [zoneTest('light', 1440), zoneTest('dark', 820), starterTest];
