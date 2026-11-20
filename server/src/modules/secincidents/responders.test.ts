import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import { testApp } from '../../test/helpers.ts';
import { loadOrganizationRules } from './defaults.ts';

// E09-25: alerts to named responders by email and text message (here through an email-to-text
// address, to a stand-in SMTP server). Invented data only. Run alone with GRC_MODULES=secincidents.
let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
const HOUR = 3_600_000;
const TITLE = 'Test incident: invented depot badge reader compromise';

beforeAll(async () => {
  t = await testApp();
  sink = await startSmtpSink();
  await t.api.put('/api/admin/mail/settings', {
    host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test', enabled: true,
  });
  await t.api.put('/api/admin/text/settings', { gateway: true });
  // An invented rule whose deadline has passed at once, and one with a long deadline.
  await loadOrganizationRules(t.ctx, [
    { key: 'test_now', trigger: 'is_cyber_incident', party: 'Invented Party Now', hours: 1, required: true, active: true, guidance: 'Invented.' },
    { key: 'test_later', trigger: 'is_cyber_incident', party: 'Invented Party Later', hours: 720, required: true, active: true, guidance: 'Invented.' },
  ]);
});
afterAll(async () => {
  await t.close();
  await sink.close();
});

const run = () => t.app.jobs.runDue({ types: ['mail.send', 'text.webhook'] });
const securityMail = () => t.db.query<any>(`select * from mail_log where purpose = 'security' order by created_at`);

async function declare() {
  const made = await t.api.post('/api/security-incidents', {
    title: TITLE, scenario: 'ransomware', severity: 'high', discovered_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  });
  const declared = await t.api.patch(`/api/security-incidents/${made.body.id}`, { status: 'declared' });
  expect(declared.status).toBe(200);
  return declared.body;
}

describe('alerts by email and text message', () => {
  let lead: Awaited<ReturnType<typeof t.as>>;

  it('names responders who hold security.view, with a password confirmation, audited', async () => {
    const state = await t.api.get('/api/security-incidents/alerts/settings');
    expect(state.body).toMatchObject({ responders: [], includeLead: false, email: true, text: true, declared: true, amber: true, red: true, mail_on: true, text_on: true });
    lead = await t.as('security_lead');
    const agent = await t.as('agent');
    expect((await t.api.patch('/api/security-incidents/alerts/settings', { responders: [agent.userId] })).body.error.fields.responders).toMatch(/security\.view/);
    expect((await agent.get('/api/security-incidents/alerts/settings')).status).toBe(403);
    await lead.put('/api/me/alert-contact', { smsAddress: '5550100444@text.example.net' });
    const saved = await t.api.patch('/api/security-incidents/alerts/settings', { responders: [lead.userId] });
    expect(saved.status).toBe(200);
    expect(saved.body.responders).toEqual([{ id: lead.userId, label: expect.any(String), eligible: true, hasEmail: true, hasText: true }]);
    expect(saved.body.eligible.some((p: any) => p.id === lead.userId)).toBe(true);
    const audit = await t.db.query<any>(`select after from audit_events where action = 'security_incident.alert_settings'`);
    expect(audit.at(-1).after.responders).toEqual([lead.userId]);
  });

  it('alerts once when an incident is declared and once when its clock turns red, without restricted detail', async () => {
    const before = sink.messages.length;
    const incident = await declare();
    await run();
    const rows = await securityMail();
    // Declared and red: each by email and by text message.
    expect(rows.map((r) => [r.template, r.status])).toEqual([
      ['message', 'sent'], ['text_message', 'sent'], ['message', 'sent'], ['text_message', 'sent'],
    ]);
    const got = sink.messages.slice(before);
    expect(got.length).toBe(4);
    const all = got.map((m) => `${m.subject}\n${m.body}`).join('\n');
    expect(all).toContain(`Security incident ${incident.ref} declared`);
    expect(all).toContain('a notification deadline has passed');
    expect(all).toContain(`https://grc.example.test/security-incidents/${incident.id}`);
    // Never the title, the party or anything else about the incident.
    expect(all).not.toContain('badge reader');
    expect(all).not.toContain('Invented Party');
    const text = got.find((m) => m.to.includes('5550100444@text.example.net'))!;
    expect(text.body.length).toBeLessThan(2000);

    // The sweep runs again: nothing new.
    await t.api.post('/api/security-incidents/clocks/sweep');
    await t.app.jobs.runDue({ types: ['secincidents.clock_sweep'] });
    await run();
    expect((await securityMail()).length).toBe(4);
    const audits = await t.db.query<any>(`select summary from audit_events where action = 'security_incident.alert_sent' and record_id = $1`, [incident.id]);
    expect(audits.map((a) => a.summary)).toEqual([
      expect.stringMatching(/declared.*1 by email, 1 by text message/), expect.stringMatching(/clock red.*1 by email, 1 by text message/),
    ]);
  });

  it('skips events switched off and people who lost security.view, and sends a test alert', async () => {
    await t.api.patch('/api/security-incidents/alerts/settings', { red: false, text: false });
    await declare();
    await run();
    const rows = await securityMail();
    expect(rows.slice(4).map((r) => r.template)).toEqual(['message']); // declared, by email only

    const test = await t.api.post('/api/security-incidents/alerts/test');
    expect(test.body).toEqual({ people: 1, email: 1, text: 0 });
    await run();
    expect((await securityMail()).at(-1)).toMatchObject({ status: 'sent', subject: expect.stringMatching(/^Test: security incident alerts/) });

    await t.db.query('delete from user_roles where user_id = $1', [lead.userId]);
    expect((await t.api.post('/api/security-incidents/alerts/test')).body).toEqual({ people: 0, email: 0, text: 0 });
    expect((await t.api.get('/api/security-incidents/alerts/settings')).body.responders[0].eligible).toBe(false);
  });
});
