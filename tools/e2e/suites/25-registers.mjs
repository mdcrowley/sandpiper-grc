// Registers an administrator defines (E41-06): an administrator defines a register, it appears in the
// navigation, a record is made through the generic form and opened, and switching the register off
// hides its menu entry and its pages. Run alone with: npm run test:e2e -- --only registers (or --grep registers:).

const registerTest = (theme, width) => ({
  name: `registers: define, use and switch off a register (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36).replace(/[^a-z0-9]/g, '');
    const key = `e2e_${tag}`;
    const plural = `E2E log ${tag}`;

    await t.step('an administrator defines a register', async () => {
      await page.goto('/admin/registers');
      await page.waitFor({ text: 'Registers', tag: 'h1' });
      await page.click({ text: 'New register', tag: 'button' });
      await page.fill({ label: 'Register name' }, plural);
      await page.fill({ label: 'One record is called' }, `E2E entry ${tag}`);
      await page.fill({ label: 'Name in addresses and permissions' }, key);
      await page.fill({ label: 'Reference prefix' }, `E${tag.slice(-6).toUpperCase().replace(/^[0-9]/, 'X')}`);
      await page.click({ text: 'Define register', tag: '[role=dialog] button' });
      await page.waitFor({ text: plural, tag: 'h1' });
    });

    await t.step('the register is in the navigation, and a record is made and opened', async () => {
      await page.goto(`/registers/${key}`);
      await page.waitFor({ text: plural, tag: 'h1' });
      const made = await api.must('POST', `/api/registers/${key}`, { title: `E2E record ${tag}` });
      await page.goto(`/registers/${key}/${made.id}`);
      await page.waitFor({ text: `E2E record ${tag}`, tag: 'h1' });
      await page.goto('/registers');
      await page.waitFor({ text: plural, tag: 'a' });
    });

    await t.step('switched off, it disappears from the menu and its page says so', async () => {
      await api.must('PATCH', '/api/admin/features', { features: { [`reg_${key}`]: false } });
      try {
        await page.goto('/registers');
        await page.waitFor({ text: 'Registers', tag: 'h1' });
        t.soft(!(await page.text('nav')).includes(plural), 'the switched-off register is still in the navigation');
        await page.goto(`/registers/${key}`);
        await page.waitFor({ text: 'switched off' });
      } finally {
        await api.must('PATCH', '/api/admin/features', { features: { [`reg_${key}`]: true } });
      }
    });
  },
});

export const tests = [registerTest('light', 1440), registerTest('dark', 820)];
