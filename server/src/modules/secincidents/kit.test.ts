import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import { pdfPageCount, pdfText } from '../../core/export/testing.ts';
import type { ModuleDef } from '../../core/module.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { makeKitCopies } from './kit.ts';

// Stored PDF copies of the offline incident kit (E09-16): made on request, after a change and on
// a schedule; the date on every page; who may see, download and receive them. Invented data only.
// Runs alone (GRC_MODULES=secincidents) and with every module.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let viewer: Client;
let agent: Client;
let copies: ReturnType<typeof makeKitCopies>;

// Stand-in for the email service: what would be sent, and whether email is on.
const sent: any[] = [];
let mailOn = true;
const mailModule: ModuleDef = {
  key: 'testmail',
  async register(ctx) {
    const stub: any = async (mail: any) => { sent.push(mail); return { queued: mailOn ? (mail.userIds ?? []).length : 0, skipped: 0, enabled: mailOn, logIds: [] }; };
    if (ctx.app.hasDecorator('sendMail')) (ctx.app as any).sendMail = stub;
    else ctx.app.decorate('sendMail', stub);
  },
};

async function raw(client: Client | null, url: string) {
  const cookie = await createSession(t.db, client ? client.userId : (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id);
  const res = await t.app.inject({ method: 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
  return { status: res.statusCode, body: res.rawPayload, type: String(res.headers['content-type'] ?? ''), disposition: String(res.headers['content-disposition'] ?? '') };
}

beforeAll(async () => {
  t = await testApp({ extraModules: [mailModule] });
  copies = makeKitCopies(t.ctx);
  lead = await t.as('security_lead');
  agent = await t.as('agent');
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('kit_viewer', 'Kit viewer', true) returning id`))!.id;
  await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'security.view')`, [role]);
  viewer = await t.as('kit_viewer');
  await t.api.post('/api/security-incident-contacts', { role: 'Invented duty officer', person_name: 'Duty Officer Example', contact: '555-0100' });
});
afterAll(async () => { await t?.close(); });

describe('PDF copies of the offline kit (E09-16)', () => {
  let first: any;

  it('makes a copy on request, with the time it was made on every page', async () => {
    const res = await lead.post('/api/security-incidents/kit/copies');
    expect(res.status).toBe(201);
    first = res.body;
    expect(first).toMatchObject({ reason: 'on_demand', reason_label: 'Made on request', delivery: null });
    expect(first.pages).toBeGreaterThan(8);

    const file = await raw(lead, `/api/security-incidents/kit/copies/${first.id}/pdf`);
    expect(file.status).toBe(200);
    expect(file.type).toBe('application/pdf');
    expect(file.disposition).toMatch(/security-incident-kit-\d{4}-\d{2}-\d{2}\.pdf/);
    const pages = pdfPageCount(file.body);
    expect(pages).toBe(first.pages);
    const text = pdfText(file.body);
    // E41-13: the kit is tagged for PDF/UA like every server PDF.
    expect((await checkPdfUa(file.body)).failures).toEqual([]);
    for (const words of ['Security incident kit', 'First hour', 'Incident roles and contacts', 'Invented duty officer', '555-0100',
      'Who must be told, and by when', 'Severity guide and ransom rule', 'Notification record sheet', 'Incident log sheet 2']) {
      expect(text).toContain(words);
    }
    // The restricted marking with the time it was made is at the top of every page, cover included.
    // (The cover also says it in its text, ending with a full stop: that line is not counted.)
    const marks = text.split('\n').filter((l) => l.startsWith('Restricted security record · Produced ') && l.endsWith('Reprint after any change'));
    expect(marks).toHaveLength(pages);
    expect(new Set(marks).size).toBe(1);
    expect(marks[0]).toMatch(/Produced [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2} \(/);
    // Opening and downloading are audited.
    const audit = await t.db.query<any>(`select action from audit_events where action like 'security_incident.kit_%'`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['security_incident.kit_pdf', 'security_incident.kit_download']));
  });

  it('says whether the latest copy is current, and makes a new one after a change', async () => {
    let state = (await lead.get('/api/security-incidents/kit/copies')).body;
    expect(state).toMatchObject({ latest_is_current: true, every_days: 7, check_minutes: 15, can_export: true, can_administer: true });
    expect(state.copies[0]).toMatchObject({ id: first.id, current: true });
    expect(state.current_since).toBe(state.copies[0].created_at);
    // Nothing changed: the scheduled check does nothing.
    expect(await copies.check()).toEqual({ made: null });

    await t.api.post('/api/security-incident-contacts', { role: 'Invented backup lead', contact: '555-0101' });
    state = (await lead.get('/api/security-incidents/kit/copies')).body;
    expect(state.latest_is_current).toBe(false);
    expect(state.current_since).toBeNull();
    expect(await copies.check()).toEqual({ made: 'change' });
    state = (await lead.get('/api/security-incidents/kit/copies')).body;
    expect(state.latest_is_current).toBe(true);
    expect(state.copies.map((c: any) => [c.reason, c.current])).toEqual([['change', true], ['on_demand', false]]);
    expect(await copies.check()).toEqual({ made: null });
  });

  it('makes a fresh copy once the last one is as old as the schedule says, and never with 0 days', async () => {
    await t.db.query(`update incident_kit_copies set created_at = created_at - interval '8 days'`);
    expect(await copies.check()).toEqual({ made: 'schedule' });
    expect(await copies.check()).toEqual({ made: null });
    await t.db.query(`update incident_kit_copies set created_at = created_at - interval '30 days'`);
    expect((await t.api.patch('/api/security-incidents/kit/settings', { every_days: 0 })).status).toBe(200);
    expect(await copies.check()).toEqual({ made: null });
    expect((await t.api.patch('/api/security-incidents/kit/settings', { every_days: 7 })).body.every_days).toBe(7);
  });

  it('keeps only the newest copies', async () => {
    expect((await t.api.patch('/api/security-incidents/kit/settings', { keep: 2 })).body.keep).toBe(2);
    await lead.post('/api/security-incidents/kit/copies');
    expect((await t.db.query('select id from incident_kit_copies')).length).toBe(2);
    expect((await raw(lead, `/api/security-incidents/kit/copies/${first.id}/pdf`)).status).toBe(404);
    expect((await t.api.patch('/api/security-incidents/kit/settings', { keep: 0, every_days: 91 })).body.error.fields).toMatchObject({ keep: expect.any(String), every_days: expect.any(String) });
    await t.api.patch('/api/security-incidents/kit/settings', { keep: 12 });
  });

  it('needs security.view to see the copies, security.export to make or download one, and security.administer for the schedule', async () => {
    expect((await agent.get('/api/security-incidents/kit/copies')).status).toBe(403);
    expect((await agent.post('/api/security-incidents/kit/copies')).status).toBe(403);
    const state = (await viewer.get('/api/security-incidents/kit/copies')).body;
    expect(state).toMatchObject({ can_export: false, can_administer: false });
    expect(state.recipients).toBeUndefined();
    expect(state.eligible).toBeUndefined();
    expect((await viewer.post('/api/security-incidents/kit/copies')).status).toBe(403);
    expect((await raw(viewer, `/api/security-incidents/kit/copies/${state.copies[0].id}/pdf`)).status).toBe(403);
    expect((await raw(agent, `/api/security-incidents/kit/copies/${state.copies[0].id}/pdf`)).status).toBe(403);
    expect((await lead.patch('/api/security-incidents/kit/settings', { every_days: 3 })).status).toBe(200);
    expect((await viewer.patch('/api/security-incidents/kit/settings', { every_days: 3 })).status).toBe(403);
    await t.api.patch('/api/security-incidents/kit/settings', { every_days: 7 });
  });
});

describe('emailing automatic copies to named people', () => {
  it('accepts only people who may receive the kit, and asks to confirm identity first', async () => {
    const eligible = (await t.api.get('/api/security-incidents/kit/copies')).body.eligible.map((p: any) => p.id);
    expect(eligible).toContain(lead.userId);
    expect(eligible).not.toContain(viewer.userId);
    expect(eligible).not.toContain(agent.userId);
    const bad = await t.api.patch('/api/security-incidents/kit/settings', { recipients: [lead.userId, viewer.userId] });
    expect(bad.body.error.fields.recipients).toMatch(/security.view and security.export/);

    await t.db.query(`update sessions set confirmed_at = now() - interval '1 day'`);
    const refused = await t.api.patch('/api/security-incidents/kit/settings', { recipients: [lead.userId] });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'reauth_required']);
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    const ok = await t.api.patch('/api/security-incidents/kit/settings', { recipients: [lead.userId] });
    expect(ok.status).toBe(200);
    expect(ok.body.recipients).toEqual([{ id: lead.userId, label: expect.any(String), eligible: true }]);
  });

  it('emails an automatic copy with the PDF attached, but not one made on request', async () => {
    sent.length = 0;
    await lead.post('/api/security-incidents/kit/copies');
    expect(sent).toHaveLength(0);

    await t.api.post('/api/security-incident-contacts', { role: 'Invented press desk', contact: '555-0102' });
    expect(await copies.check()).toEqual({ made: 'change' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userIds: [lead.userId], purpose: 'security', template: 'message' });
    expect(sent[0].data.subject).toMatch(/^Security incident kit, produced /);
    expect(sent[0].data.message).toMatch(/do not forward/);
    expect(sent[0].record).toBeUndefined();
    const file = sent[0].attachments[0];
    expect(file).toMatchObject({ contentType: 'application/pdf', filename: expect.stringMatching(/^security-incident-kit-\d{4}-\d{2}-\d{2}\.pdf$/) });
    expect(pdfText(file.content)).toContain('Invented press desk');
    const latest = (await lead.get('/api/security-incidents/kit/copies')).body.copies[0];
    expect(latest.delivery).toBe('Emailed to 1 person.');
  });

  it('skips a named person who no longer holds the permissions, and says so when email is off', async () => {
    const leadRole = (await t.db.one<{ id: string }>(`select id from roles where key = 'security_lead'`))!.id;
    await t.db.query('delete from user_roles where user_id = $1 and role_id = $2', [lead.userId, leadRole]);
    sent.length = 0;
    await t.api.post('/api/security-incident-contacts', { role: 'Invented legal adviser', contact: '555-0103' });
    expect(await copies.check()).toEqual({ made: 'change' });
    expect(sent).toHaveLength(0);
    let latest = (await t.api.get('/api/security-incidents/kit/copies')).body;
    expect(latest.copies[0].delivery).toMatch(/^Not emailed\. 1 named person was skipped/);
    expect(latest.recipients[0].eligible).toBe(false);
    await t.db.query('insert into user_roles (user_id, role_id) values ($1, $2)', [lead.userId, leadRole]);

    mailOn = false;
    await t.api.post('/api/security-incident-contacts', { role: 'Invented insurer contact', contact: '555-0104' });
    expect(await copies.check()).toEqual({ made: 'change' });
    latest = (await t.api.get('/api/security-incidents/kit/copies')).body;
    expect(latest.copies[0].delivery).toBe('Not emailed: email is switched off.');
    mailOn = true;
  });
});

describe('the security incidents feature switch', () => {
  it('hides the copies and skips the scheduled job while the area is off', async () => {
    const before = (await t.db.query('select id from incident_kit_copies')).length;
    await t.api.post('/api/security-incident-contacts', { role: 'Invented after-hours desk', contact: '555-0105' });
    await t.ctx.settings.set('features', { secincidents: false });
    try {
      const res = await t.api.get('/api/security-incidents/kit/copies');
      expect([res.status, res.body.error.code]).toEqual([404, 'switched_off']);
      await t.app.jobs.enqueue('secincidents.kit_pdf', {});
      await t.app.jobs.runDue({ types: ['secincidents.kit_pdf'] });
      expect((await t.db.query('select id from incident_kit_copies')).length).toBe(before);
    } finally {
      await t.ctx.settings.set('features', { secincidents: true });
    }
    await t.app.jobs.enqueue('secincidents.kit_pdf', {});
    await t.app.jobs.runDue({ types: ['secincidents.kit_pdf'] });
    expect((await t.db.query<any>('select reason from incident_kit_copies order by created_at desc limit 1'))[0].reason).toBe('change');
  });
});
