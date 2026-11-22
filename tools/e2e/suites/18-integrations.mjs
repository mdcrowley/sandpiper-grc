// User provisioning, log forwarding and webhook addresses (E36-01, E36-02, E22-45): an administrator
// makes a provisioning token, sees it once, and the identity provider can then provision an account
// that a group mapping gives a role; a forwarder is added switched off; a webhook's address is listed
// by host only and shown in full after a password confirmation.
// Run alone with: npm run test:e2e -- --only integrations (or --grep integrations).

const confirm = (t) => t.api().must('POST', '/api/auth/confirm', { password: t.users.administrator.password });

/** A SCIM call with the provisioning token (no session). */
async function scim(t, token, method, path, body) {
  const r = await fetch(`${t.app.base}/api/scim/v2${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/scim+json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: r.status, body: json };
}

const provisioningTest = (theme, width) => ({
  name: `integrations: a provisioning token is shown once and provisions an account with a mapped role (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    await t.step('confirm the password', () => confirm(t));
    await t.step('make a token on the page', async () => {
      await page.goto('/admin/provisioning');
      await page.waitFor({ text: 'Provisioning tokens', tag: 'h2' });
      await page.click({ text: 'Make token' });
      await page.fill({ label: 'Name', within: '[role="dialog"]' }, `E2E directory ${tag}`);
      await page.click({ text: 'Make token', within: '[role="dialog"] .form-actions' });
      await page.waitFor({ text: 'Copy token' });
    });
    const token = await page.eval(`document.querySelector('[data-testid="scim-token"]')?.getAttribute('data-value') ?? ''`);
    t.soft(/^grc_scim_[A-Za-z0-9_-]{43}$/.test(token), `the token looks wrong: ${token.slice(0, 12)}`);
    await t.step('the token is not shown again after a reload', async () => {
      await page.click({ text: 'Done' });
      await page.goto('/admin/provisioning');
      await page.waitFor({ text: `E2E directory ${tag}`, tag: 'strong' });
      t.soft(!(await page.text('main')).includes(token), 'the token is still on the page');
    });
    await t.step('off until switched on; then the identity provider provisions an account and a group', async () => {
      t.soft((await scim(t, token, 'GET', '/Users')).status === 401, 'provisioning answered while switched off');
      await api.must('PUT', '/api/admin/scim/settings', { enabled: true });
      const user = await scim(t, token, 'POST', '/Users', { userName: `e2e.${tag}@example.test`, displayName: `E2E person ${tag}`, emails: [{ value: `e2e.${tag}@example.test`, primary: true }] });
      t.soft(user.status === 201, `the account was not created (${user.status})`);
      const group = await scim(t, token, 'POST', '/Groups', { displayName: `E2E group ${tag}`, members: [{ value: user.body?.id }] });
      t.soft(group.status === 201, `the group was not created (${group.status})`);
      await api.must('PUT', `/api/admin/scim/groups/${group.body.id}/roles`, { roleKeys: ['agent'] });
      const made = await api.must('GET', `/api/admin/users/${user.body.id}`);
      t.soft(made.roles.some((r) => r.key === 'agent') && !made.has_password, 'the account has the wrong roles or a password');
    });
    await t.step('the group shows its role, and the activity lists provisioning', async () => {
      await page.goto('/admin/provisioning');
      await page.waitFor({ text: `E2E group ${tag}`, tag: 'strong' });
      const main = await page.text('main');
      t.soft(main.includes('Agent'), 'the mapped role is not shown');
      t.soft(main.includes(`Provisioning`) || main.includes('created by provisioning'), 'recent activity is missing');
    });
    await t.step('revoke the token and switch provisioning off', async () => {
      const list = (await api.must('GET', '/api/admin/scim/tokens')).tokens;
      for (const tk of list.filter((x) => x.name === `E2E directory ${tag}`)) await api.must('DELETE', `/api/admin/scim/tokens/${tk.id}`);
      t.soft((await scim(t, token, 'GET', '/Users')).status === 401, 'a revoked token still works');
      await confirm(t);
      await api.must('PUT', '/api/admin/scim/settings', { enabled: false });
    });
  },
});

const forwardingTest = (theme, width) => ({
  name: `integrations: an audit-log forwarder is added switched off (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const tag = Date.now().toString(36);
    await t.step('confirm the password', () => confirm(t));
    await t.step('add a forwarder', async () => {
      await page.goto('/admin/log-forwarding');
      await page.waitFor({ text: 'How forwarding works', tag: 'h2' });
      t.soft((await page.text('main')).includes('outbound connections are switched off'), 'the outbound notice is missing');
      await page.click({ text: 'Add forwarder' });
      await page.fill({ label: 'Name', within: '[role="dialog"]' }, `E2E collector ${tag}`);
      await page.fill({ label: 'Host', within: '[role="dialog"]' }, 'collector.example.test');
      await page.click({ text: 'Add forwarder', within: '[role="dialog"] .form-actions' });
      await page.waitFor({ text: `E2E collector ${tag}`, tag: 'button' });
    });
    const list = (await t.api().must('GET', '/api/admin/audit-forwarders')).forwarders;
    const f = list.find((x) => x.name === `E2E collector ${tag}`);
    t.soft(f && f.active === false && f.kind === 'syslog_tls' && f.port === 6514, 'the forwarder was not stored switched off over TLS');
    await t.step('open its delivery log, then remove it', async () => {
      await page.click({ text: `Actions for E2E collector ${tag}` });
      await page.click({ text: 'Delivery log' });
      await page.waitFor({ text: 'Nothing sent yet', tag: 'p' });
      if (f) await t.api().must('DELETE', `/api/admin/audit-forwarders/${f.id}`);
    });
  },
});

const webhookTest = (theme, width) => ({
  name: `integrations: a webhook address is listed by host and shown after a confirmation (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const tag = Date.now().toString(36);
    await confirm(t);
    const hook = await t.api().must('POST', '/api/admin/webhooks', { name: `E2E chat ${tag}`, url: `https://chat.example.test/hooks/${tag}-s3cr3t`, events: ['*'], preset: 'chat_text', active: false });
    await t.step('the list shows the host and fingerprint only', async () => {
      await page.goto('/admin/webhooks');
      await page.waitFor({ text: `E2E chat ${tag}`, tag: 'button' });
      const main = await page.text('main');
      t.soft(!main.includes(`${tag}-s3cr3t`), 'the full address is on the list');
      t.soft(main.includes('Chat text'), 'the preset is not shown');
    });
    await t.step('show the current address in the form', async () => {
      await page.click({ text: `E2E chat ${tag}`, tag: 'button' });
      await page.click({ text: 'Show current address', within: '[role="dialog"]' });
      await page.waitFor(() => [...document.querySelectorAll('[role="dialog"] input')].some((i) => i.value.includes('s3cr3t')));
    });
    await t.api().must('DELETE', `/api/admin/webhooks/${hook.id}`);
  },
});

export const tests = [
  provisioningTest('light', 1440), provisioningTest('dark', 820),
  forwardingTest('light', 1440), forwardingTest('dark', 820),
  webhookTest('light', 1440),
];
