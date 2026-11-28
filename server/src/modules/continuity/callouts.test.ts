import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import type { Row } from '../../core/module.ts';
import { ANONYMIZED_TEXT } from '../../core/retention.ts';
import { testApp } from '../../test/helpers.ts';
import { NOT_VALID } from './callouts.ts';

// E41-14: a call tree is sent a message by email and text message (an email-to-text address, through
// a stand-in mail server), each person acknowledges through their own link, and the activation shows
// who has not. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
type Client = Awaited<ReturnType<typeof t.as>>;
let manager: Client; // continuity_manager: continuity.*
let viewer: Client;  // safety_manager: continuity.view only
let lead: Client;    // on the call tree, with an account
let planId: string;
let activationId: string;
let calloutId: string;
const tokens: Record<string, string> = {};

const ok = <T = Row>(res: { status: number; body: T }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

async function runMail() {
  await t.db.query(`update jobs set run_at = now() - interval '1 second' where type in ('mail.send', 'text.webhook') and status = 'queued'`);
  await t.app.jobs.runDue({ types: ['mail.send', 'text.webhook'] });
}
/** Wrong-link hits recorded against addresses (the 20-in-15-minutes limit of the public routes). */
const wrongHits = async () => (await t.db.one<{ n: number }>(`select count(*)::int as n from rate_limit_hits where bucket = 'callout_ack_bad'`))!.n;
const tokenIn = (body: string) => /\/call-out\/([A-Za-z0-9_-]{43})/.exec(body.replace(/=\r?\n/g, ''))?.[1];

beforeAll(async () => {
  t = await testApp();
  sink = await startSmtpSink();
  manager = await t.as('continuity_manager');
  // Wave 26: the Safety manager may now run an emergency activation; this test needs a continuity viewer only.
  await t.db.query("delete from role_permissions where role_id = (select id from roles where key = 'safety_manager') and permission in ('continuity.create', 'continuity.edit')");
  viewer = await t.as('safety_manager');
  lead = await t.as('security_lead');
  await t.db.query(`update users set email = 'invented.lead@example.test' where id = $1`, [lead.userId]);
  await lead.put('/api/me/alert-contact', { smsAddress: '5550100777@text.example.net' });
  planId = ok(await manager.post('/api/continuity-plans', { title: 'Invented flood plan' }), 201).id;
  const top = ok(await manager.post(`/api/continuity-plans/${planId}/call-tree`, { role: 'Emergency manager', user_id: lead.userId }), 201);
  const person = t.ctx.resources.get('person') ? ok(await t.api.post('/api/people', { full_name: 'Invented Roster Driver', email: 'roster.driver@example.test' }), 201) : null;
  if (person) ok(await manager.post(`/api/continuity-plans/${planId}/call-tree`, { role: 'Depot lead', person_id: person.id, parent_id: top.id }), 201);
  ok(await manager.post(`/api/continuity-plans/${planId}/call-tree`, { role: 'Yard', name: 'Invented Yard Hand', phone: '+1 555 010 0199', parent_id: top.id }), 201);
  ok(await manager.post(`/api/continuity-plans/${planId}/call-tree`, { role: 'Deputy', user_id: lead.userId, parent_id: top.id }), 201); // the same person again
  activationId = ok(await manager.post('/api/emergency-activations', { title: 'Invented flooding at the north depot', event_type: 'severe_weather', plan_ids: [planId] }), 201).id;
});
afterAll(async () => { await t.close(); await sink.close(); });

describe('sending a call tree a message', () => {
  it('refuses while neither email nor text messages are set up, and checks what is sent', async () => {
    const off = await manager.post(`/api/emergency-activations/${activationId}/call-outs`, { plan_id: planId, message: 'Report to the depot.' });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('no_channels');
    ok(await t.api.put('/api/admin/mail/settings', { enabled: true, host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test' }));
    ok(await t.api.put('/api/admin/text/settings', { gateway: true }));
    const bad = await manager.post(`/api/emergency-activations/${activationId}/call-outs`, { plan_id: '00000000-0000-0000-0000-000000000000', message: '', hours: 500 });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['hours', 'message', 'plan_id']);
    expect((await viewer.post(`/api/emergency-activations/${activationId}/call-outs`, { plan_id: planId, message: 'x' })).status).toBe(403);
  });

  it('emails and texts each person once, with a link of their own; a typed name is listed to call', async () => {
    const before = sink.messages.length;
    const sent = ok(await manager.post(`/api/emergency-activations/${activationId}/call-outs`, { plan_id: planId, message: 'Flooding at the north depot. Report to the south depot by 06:00.' }), 201);
    calloutId = sent.id;
    const roster = t.ctx.resources.get('person') ? 1 : 0;
    expect(sent).toMatchObject({ people: 2 + roster, email: 1 + roster, text: 1, none: 1, text_links: true });
    await runMail();
    await sink.waitFor(before + 2 + roster);
    const mine = sink.messages.slice(before);
    const leadMail = mine.find((m) => m.to.includes('invented.lead@example.test'))!;
    expect(leadMail.subject).toContain('Invented flooding at the north depot');
    expect(leadMail.body).toContain('Report to the south depot');
    tokens.lead = tokenIn(leadMail.body)!;
    expect(tokens.lead).toBeTruthy();
    const text = mine.find((m) => m.to.includes('5550100777@text.example.net'))!;
    expect(text.body).toContain(`https://grc.example.test/call-out/`);
    expect(tokenIn(text.body)).toBe(tokens.lead); // the same link by text and email
    if (roster) {
      const driver = mine.find((m) => m.to.includes('roster.driver@example.test'))!;
      tokens.driver = tokenIn(driver.body)!;
      expect(tokens.driver).not.toBe(tokens.lead);
    }
    // Only hashes are kept; the email's link is sealed in the queued job, never in the delivery log.
    const stored = await t.db.query<Row>('select token_hash from activation_callout_recipients where callout_id = $1', [calloutId]);
    expect(stored.every((r) => !r.token_hash || !Object.values(tokens).includes(r.token_hash))).toBe(true);
    const logs = await t.db.query<Row>(`select subject from mail_log where purpose = 'continuity' and template = 'message'`);
    expect(logs.every((l) => !String(l.subject).includes(tokens.lead))).toBe(true);
    const log = ok<Row[]>(await viewer.get(`/api/emergency-activations/${activationId}/log`));
    expect(log[0].entry).toMatch(/Call-out sent to the call tree/);
    expect(log[0].entry).toMatch(/1 not reachable this way \(call them\)/);
  });

  it('opens the link without signing in, acknowledges once, and shows the activation who has not', async () => {
    const view = ok(await t.anon.get(`/api/call-out/${tokens.lead}`));
    expect(view).toMatchObject({ title: 'Invented flooding at the north depot', role: 'Emergency manager', acknowledged_at: null });
    expect(view.message).toContain('Report to the south depot');
    // Opening it acknowledges nothing (mail scanners open links).
    let list = ok(await viewer.get(`/api/emergency-activations/${activationId}/call-outs`));
    expect(list.rows[0].acknowledged).toBe(0);
    const acked = ok(await t.anon.post(`/api/call-out/${tokens.lead}`, { note: 'On my way' }));
    expect(acked.acknowledged_at).toBeTruthy();
    const again = ok(await t.anon.post(`/api/call-out/${tokens.lead}`, {}));
    expect(again.acknowledged_at).toBe(acked.acknowledged_at);
    list = ok(await viewer.get(`/api/emergency-activations/${activationId}/call-outs`));
    const c = list.rows[0];
    expect(c).toMatchObject({ total: c.recipients.length, acknowledged: 1, waiting: c.recipients.length - 1, unreachable: 1 });
    expect(c.recipients[0]).toMatchObject({ role: 'Emergency manager', reach: 'both', ack_via: 'link', ack_note: 'On my way', email_status: 'sent', text_status: 'sent' });
    expect(c.recipients.find((r: Row) => r.name === 'Invented Yard Hand')).toMatchObject({ reach: 'none', acknowledged_at: null });
    const log = ok<Row[]>(await viewer.get(`/api/emergency-activations/${activationId}/log`));
    expect(log[0].entry).toMatch(/acknowledged the call-out through their link: On my way/);
  });

  it('answers the same "not valid" for a wrong or malformed link', async () => {
    const hits = await wrongHits();
    const wrong = await t.anon.get(`/api/call-out/${'x'.repeat(43)}`);
    expect(wrong.status).toBe(404);
    expect(wrong.body.error.message).toBe(NOT_VALID);
    expect((await t.anon.get('/api/call-out/short')).body.error.message).toBe(NOT_VALID);
    // A link that matches nothing ever sent counts toward the address's wrong-link limit.
    expect(await wrongHits()).toBe(hits + 2);
  });

  it('lets staff record an acknowledgment by phone, and reminds those who have not acknowledged with a new link', async () => {
    const c = ok(await viewer.get(`/api/emergency-activations/${activationId}/call-outs`)).rows[0];
    const yard = c.recipients.find((r: Row) => r.name === 'Invented Yard Hand');
    const url = `/api/emergency-activations/${activationId}/call-outs/${calloutId}/recipients/${yard.id}/acknowledge`;
    expect((await viewer.post(url, {})).status).toBe(403);
    ok(await manager.post(url, { note: 'Called at 05:10' }));
    expect((await manager.post(url, {})).status).toBe(409);
    const before = sink.messages.length;
    const reminded = ok(await manager.post(`/api/emergency-activations/${activationId}/call-outs/${calloutId}/remind`, {}));
    const roster = tokens.driver ? 1 : 0;
    expect(reminded).toEqual({ reached: roster, waiting: roster });
    if (roster) {
      await runMail();
      await sink.waitFor(before + 1);
      const fresh = tokenIn(sink.messages.at(-1)!.body)!;
      expect(sink.messages.at(-1)!.subject).toMatch(/^Reminder: /);
      // The replaced link: the same "not valid", but not counted as a wrong link (wave 23 review, S5),
      // so people at one shared address opening the earlier message do not lock each other out.
      const hits = await wrongHits();
      const replaced = await t.anon.get(`/api/call-out/${tokens.driver}`);
      expect([replaced.status, replaced.body.error.message]).toEqual([404, NOT_VALID]);
      expect((await t.anon.post(`/api/call-out/${tokens.driver}`, {})).status).toBe(404);
      expect(await wrongHits()).toBe(hits);
      ok(await t.anon.get(`/api/call-out/${fresh}`));
      tokens.driver = fresh;
    }
    const after = ok(await viewer.get(`/api/emergency-activations/${activationId}/call-outs`)).rows[0];
    expect(after.recipients.find((r: Row) => r.name === 'Invented Yard Hand')).toMatchObject({ ack_via: 'staff', ack_note: 'Called at 05:10' });
  });

  it('stops working when the message expires, when the activation closes, and while the area is switched off', async () => {
    if (tokens.driver) {
      await t.db.query(`update activation_callouts set expires_at = now() - interval '1 minute' where id = $1`, [calloutId]);
      const hits = await wrongHits();
      expect((await t.anon.get(`/api/call-out/${tokens.driver}`)).status).toBe(404);
      expect(await wrongHits()).toBe(hits); // expired, not wrong
      expect((await manager.post(`/api/emergency-activations/${activationId}/call-outs/${calloutId}/remind`, {})).body.error.code).toBe('expired');
      await t.db.query(`update activation_callouts set expires_at = now() + interval '1 hour' where id = $1`, [calloutId]);
      ok(await t.anon.get(`/api/call-out/${tokens.driver}`));
      ok(await t.api.patch('/api/admin/features', { features: { continuity: false } }));
      const off = await t.anon.get(`/api/call-out/${tokens.driver}`);
      expect(off.status).toBe(404);
      ok(await t.api.patch('/api/admin/features', { features: { continuity: true } }));
      ok(await t.anon.get(`/api/call-out/${tokens.driver}`));
    }
    ok(await manager.post(`/api/emergency-activations/${activationId}/stand-down`, { summary: 'Water down' }));
    expect((await manager.post(`/api/emergency-activations/${activationId}/call-outs`, { plan_id: planId, message: 'x' })).body.error.code).toBe('not_active');
    ok(await manager.post(`/api/emergency-activations/${activationId}/close`, { after_action_summary: 'Drains to clear.' }));
    if (tokens.driver) {
      const hits = await wrongHits();
      expect((await t.anon.get(`/api/call-out/${tokens.driver}`)).status).toBe(404);
      expect(await wrongHits()).toBe(hits); // closed, not wrong
    }
  });

  it('anonymizing the activation clears the names and notes', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    ok(await t.api.put('/api/admin/retention/emergency_activation', { periodMonths: 12, disposal: 'anonymize' }));
    await t.db.query(`update emergency_activations set updated_at = now() - interval '30 months', created_at = now() - interval '30 months' where id = $1`, [activationId]);
    await t.core.retention.sweep();
    const review = (await t.api.get('/api/admin/retention/reviews?record_type=emergency_activation')).body.rows.find((r: Row) => r.record_id === activationId);
    ok(await t.api.post(`/api/admin/retention/reviews/${review.id}/anonymize`, { reason: 'End of the schedule.', confirm: true }));
    const rows = await t.db.query<Row>('select name, ack_note from activation_callout_recipients where activation_id = $1', [activationId]);
    expect(rows.every((r) => r.name === ANONYMIZED_TEXT)).toBe(true);
    expect(rows.filter((r) => r.ack_note).every((r) => r.ack_note === ANONYMIZED_TEXT)).toBe(true);
  });
});
