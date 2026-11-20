// Vendors send files through the response link (E06-22), and the application emails the link
// (E06-23). Every refusal path has a test. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import { testApp } from '../../test/helpers.ts';
import { HOLD_TYPE } from './responseFiles.ts';

let t: Awaited<ReturnType<typeof testApp>>;
// Stands in for the notifications module, which these tests do not load.
const notified: any[] = [];
const notifyStub: ModuleDef = {
  key: 'testnotify',
  async register(ctx) {
    if (!ctx.app.hasDecorator('notify')) (ctx.app as any).decorate('notify', async (input: any) => { notified.push(input); return { sent: 1, skipped: 0 }; });
  },
};
let sink: SmtpSink;
const before = process.env.GRC_MODULES;
beforeAll(async () => {
  process.env.GRC_MODULES = 'vendors,attachments';
  t = await testApp({ extraModules: [notifyStub] });
  sink = await startSmtpSink();
  await t.api.put('/api/vendors/response-links/settings', { enabled: true });
});
afterAll(async () => {
  await t.close();
  await sink.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const memoryFiles = () => (t.app.attachmentStores.local as unknown as { files: Map<string, Buffer> }).files;

let n = 0;
/** A vendor with a draft assessment and an open link. */
async function fresh() {
  n += 1;
  const vendor = (await t.api.post('/api/vendors', { name: `Invented Supplier ${n}` })).body.id as string;
  const assessment = (await t.api.post(`/api/vendors/${vendor}/assessments`, {})).body.id as string;
  const link = (await t.api.post(`/api/vendor-assessments/${assessment}/links`, {})).body;
  return { vendor, assessment, link, token: link.token as string, linkId: link.id as string };
}

/** Sends a file the way the response page does: the raw body, the CSRF header, a name in the query. */
const send = (token: string, name: string, content: Buffer, opts: { headers?: Record<string, string>; ip?: string; description?: string } = {}) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/vendor-response/${token}/files?name=${encodeURIComponent(name)}${opts.description ? `&description=${encodeURIComponent(opts.description)}` : ''}`,
    headers: { 'x-grc-csrf': '1', 'content-type': 'application/octet-stream', 'x-forwarded-for': opts.ip ?? '198.51.100.20', ...(opts.headers ?? {}) },
    payload: content,
  });

const history = async (vendor: string) => (await t.api.get(`/api/history?record_type=vendor&record_id=${vendor}`)).body as { action: string; summary: string; after?: unknown; before?: unknown }[];

describe('files through the response link (E06-22)', () => {
  it('holds a file for review, then staff take it over as evidence of the vendor', async () => {
    const { vendor, assessment, token, linkId } = await fresh();
    const sent = await send(token, 'ISO certificate.pdf', PDF, { description: 'Current certificate' });
    expect(sent.statusCode).toBe(201);
    const file = sent.json();
    expect(file).toMatchObject({ file_name: 'ISO certificate.pdf', size_bytes: PDF.length, description: 'Current certificate' });
    expect(file.sha256).toBeUndefined();

    // The vendor sees it with the questions; staff see it on the link; no record shows it.
    expect((await t.anon.get(`/api/vendor-response/${token}`)).body.files.map((f: any) => f.id)).toEqual([file.id]);
    const links = (await t.api.get(`/api/vendor-assessments/${assessment}/links`)).body.rows;
    expect(links[0].files[0]).toMatchObject({ id: file.id, scan_status: 'not_scanned', file_name: 'ISO certificate.pdf' });
    expect((await t.api.get(`/api/attachments?record_type=vendor&record_id=${vendor}`)).body.rows).toHaveLength(0);
    expect((await t.api.get(`/api/attachments?record_type=${HOLD_TYPE}&record_id=${linkId}`)).status).toBe(404);
    expect((await t.api.get(`/api/attachments/${file.id}/download`)).status).toBe(404);

    // Staff look at it first: an attachment download with the strict headers.
    const got = await t.app.inject({ method: 'GET', url: `/api/vendor-assessments/${assessment}/links/${linkId}/files/${file.id}/download`, headers: { cookie: (await cookieOf()) } });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PDF)).toBe(true);
    expect(got.headers['content-disposition']).toMatch(/^attachment;/);
    expect(got.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(got.headers['x-content-type-options']).toBe('nosniff');

    // An agent may look but not take over.
    const agent = await t.as('agent');
    expect((await agent.post(`/api/vendor-assessments/${assessment}/links/${linkId}/files/${file.id}/accept`, {})).status).toBe(403);
    const taken = await t.api.post(`/api/vendor-assessments/${assessment}/links/${linkId}/files/${file.id}/accept`, { expires_on: '2031-03-31' });
    expect(taken.status).toBe(200);
    const onVendor = (await t.api.get(`/api/attachments?record_type=vendor&record_id=${vendor}`)).body.rows;
    expect(onVendor).toHaveLength(1);
    expect(onVendor[0]).toMatchObject({ id: file.id, kind: 'evidence', expires_on: '2031-03-31', description: 'Current certificate' });
    expect((await t.api.get(`/api/attachments/${file.id}/download`)).status).toBe(200);
    // Taken over once only.
    expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/${linkId}/files/${file.id}/accept`, {})).status).toBe(404);
    expect((await t.anon.get(`/api/vendor-response/${token}`)).body.files).toEqual([]);

    const actions = (await history(vendor)).map((h) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['vendor.response_file_upload', 'vendor.response_file_accept']));
    expect(JSON.stringify(await history(vendor))).not.toContain(token);
  });

  it('lets the vendor withdraw a file and staff discard one; the content goes at once', async () => {
    const { vendor, assessment, token, linkId } = await fresh();
    const a = (await send(token, 'a.pdf', PDF)).json();
    const b = (await send(token, 'b.pdf', PDF)).json();
    const keys = await t.db.query<{ storage_key: string }>('select storage_key from attachments where id = any($1::uuid[])', [[a.id, b.id]]);
    expect(keys.every((k) => memoryFiles().has(k.storage_key))).toBe(true);

    const withdrawn = await t.app.inject({ method: 'DELETE', url: `/api/vendor-response/${token}/files/${a.id}`, headers: { 'x-grc-csrf': '1' } });
    expect(withdrawn.statusCode).toBe(200);
    expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/${linkId}/files/${b.id}/discard`, {})).status).toBe(200);
    expect(keys.some((k) => memoryFiles().has(k.storage_key))).toBe(false);
    const rows = await t.db.query<any>('select removed_reason, purged_at from attachments where id = any($1::uuid[]) order by removed_reason', [[a.id, b.id]]);
    expect(rows.map((r) => r.removed_reason)).toEqual(['rejected', 'withdrawn']);
    expect(rows.every((r) => r.purged_at)).toBe(true);
    // Not offered for restoring among removed files.
    expect((await t.api.get('/api/attachments/admin/removed')).body.rows.some((r: any) => [a.id, b.id].includes(r.id))).toBe(false);
    // A file of another link cannot be reached through this one.
    const other = await fresh();
    const theirs = (await send(other.token, 'theirs.pdf', PDF)).json();
    expect((await t.app.inject({ method: 'DELETE', url: `/api/vendor-response/${token}/files/${theirs.id}`, headers: { 'x-grc-csrf': '1' } })).statusCode).toBe(404);
    expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/${linkId}/files/${theirs.id}/discard`, {})).status).toBe(404);
    expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/${other.linkId}/files/${theirs.id}/accept`, {})).status).toBe(404);
    expect((await history(vendor)).map((h) => h.action)).toEqual(expect.arrayContaining(['vendor.response_file_withdraw', 'vendor.response_file_discard']));
  });

  it('refuses what any upload refuses, and audits it', async () => {
    const { vendor, token } = await fresh();
    const refused = async (name: string, content: Buffer) => {
      const r = await send(token, name, content);
      return { status: r.statusCode, code: r.json().error?.code as string };
    };
    expect(await refused('setup.exe', Buffer.from('MZ\0\0 program'))).toEqual({ status: 415, code: 'type_not_allowed' });
    expect(await refused('notes', Buffer.from('no extension'))).toEqual({ status: 415, code: 'type_not_allowed' });
    // Allowed for attachments, but not in the narrower list for vendors.
    expect(await refused('bundle.zip', Buffer.from('PK\u0003\u0004 archive'))).toEqual({ status: 415, code: 'type_not_allowed' });
    expect(await refused('page.html', Buffer.from('<script>alert(1)</script>'))).toEqual({ status: 415, code: 'type_not_allowed' });
    expect(await refused('report.pdf', Buffer.from('plain text pretending'))).toEqual({ status: 415, code: 'type_mismatch' });
    expect(await refused('readme.txt', Buffer.from('#!/bin/sh\nrm -rf /\n'))).toEqual({ status: 415, code: 'executable' });
    expect(await refused('empty.pdf', Buffer.alloc(0))).toEqual({ status: 400, code: 'empty_file' });
    // Nothing stored for any of them.
    expect((await t.anon.get(`/api/vendor-response/${token}`)).body.files).toEqual([]);
    const audit = (await history(vendor)).filter((h) => h.action === 'vendor.response_file_refused');
    expect(audit.length).toBe(7);
    expect(audit.map((h) => h.summary).join(' ')).toMatch(/type not allowed|content does not match|program or script|empty/);
  });

  it('keeps names harmless: no paths, no control or direction characters', async () => {
    const { token } = await fresh();
    const r = await send(token, '..\\..\\windows/system32/‮fdp.exe.pdf', PDF);
    expect(r.statusCode).toBe(201);
    const row = await t.db.one<any>('select file_name, storage_key from attachments where id = $1', [r.json().id]);
    expect(row.file_name).toBe('fdp.exe.pdf');
    expect(row.storage_key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/);
  });

  it('refuses the malware scanner\'s finds', async () => {
    const { token } = await fresh();
    t.app.fileScanner.use({
      name: 'test-engine',
      async scan(file) {
        const chunks: Buffer[] = [];
        for await (const c of await file.open()) chunks.push(c as Buffer);
        return Buffer.concat(chunks).toString('latin1').includes('TEST-SIGNATURE') ? { verdict: 'infected', detail: 'Test.Signature' } : { verdict: 'clean' };
      },
    });
    try {
      const bad = await send(token, 'notes.txt', Buffer.from('contains TEST-SIGNATURE'));
      expect(bad.statusCode).toBe(422);
      expect(bad.json().error.message).not.toContain('Test.Signature');
      const good = await send(token, 'notes.txt', Buffer.from('ordinary notes'));
      expect(good.statusCode).toBe(201);
      expect((await t.db.one<any>('select scan_status, scan_engine from attachments where id = $1', [good.json().id]))).toEqual({ scan_status: 'clean', scan_engine: 'test-engine' });
    } finally {
      t.app.fileScanner.reset();
    }
  });

  it('keeps to the count and size per link', async () => {
    await t.api.put('/api/vendors/response-links/settings', { max_files: 2, max_mb: 1 });
    try {
      const { token } = await fresh();
      expect((await send(token, 'one.pdf', PDF)).statusCode).toBe(201);
      // Larger than what is left of the link's total: refused by the declared length and while reading.
      const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024, 0x20)]);
      const tooBig = await send(token, 'big.pdf', big);
      expect(tooBig.statusCode).toBe(413);
      expect(tooBig.json().error.code).toBe('too_large');
      const lying = await send(token, 'big.pdf', big, { headers: { 'content-length': String(PDF.length) } });
      expect([400, 413]).toContain(lying.statusCode);
      expect((await send(token, 'two.pdf', PDF)).statusCode).toBe(201);
      const third = await send(token, 'three.pdf', PDF);
      expect(third.statusCode).toBe(409);
      expect(third.json().error.code).toBe('quota');
      expect((await t.anon.get(`/api/vendor-response/${token}`)).body.files).toHaveLength(2);
      // No files at all.
      await t.api.put('/api/vendors/response-links/settings', { max_files: 0 });
      expect((await send(token, 'four.pdf', PDF)).json().error.code).toBe('files_off');
      expect((await t.anon.get(`/api/vendor-response/${token}`)).body.upload.available).toBe(false);
    } finally {
      await t.api.put('/api/vendors/response-links/settings', { max_files: 10, max_mb: 50 });
    }
  });

  it('limits uploads through one link in an hour', async () => {
    const { token, linkId } = await fresh();
    for (let i = 0; i < 30; i++) await t.db.query(`insert into rate_limit_hits (bucket, key) values ('vendor_response_upload', $1)`, [linkId]);
    const r = await send(token, 'late.pdf', PDF);
    expect(r.statusCode).toBe(429);
  });

  it('works only through a working link, with the security header and a file body', async () => {
    const { assessment, token, linkId } = await fresh();
    // Unknown token: the same "not valid" as the page.
    const unknown = await send('z'.repeat(43), 'a.pdf', PDF, { ip: '198.51.100.31' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.message).toMatch(/not valid/);
    // No security header (a form posted from another site).
    const noCsrf = await t.app.inject({ method: 'PUT', url: `/api/vendor-response/${token}/files?name=a.pdf`, headers: { 'content-type': 'application/octet-stream' }, payload: PDF });
    expect(noCsrf.statusCode).toBe(403);
    // A JSON body is not a file.
    const json = await t.app.inject({ method: 'PUT', url: `/api/vendor-response/${token}/files?name=a.pdf`, headers: { 'x-grc-csrf': '1' }, payload: { a: 1 } });
    expect(json.statusCode).toBe(415);

    // After the answers are sent: no more files, and none can be withdrawn.
    const held = (await send(token, 'kept.pdf', PDF)).json();
    await t.db.query('update vendor_assessment_links set submitted_at = now() where id = $1', [linkId]);
    expect((await send(token, 'late.pdf', PDF)).json().error.code).toBe('submitted');
    expect((await t.app.inject({ method: 'DELETE', url: `/api/vendor-response/${token}/files/${held.id}`, headers: { 'x-grc-csrf': '1' } })).statusCode).toBe(409);
    // Staff can still review it after the link has gone.
    await t.api.del(`/api/vendor-assessments/${assessment}/links/${linkId}`);
    expect((await send(token, 'later.pdf', PDF, { ip: '198.51.100.32' })).statusCode).toBe(404);
    expect((await t.api.get(`/api/vendor-assessments/${assessment}/links`)).body.rows[0].files).toHaveLength(1);
    // Staff routes need a session.
    expect((await t.anon.post(`/api/vendor-assessments/${assessment}/links/${linkId}/files/${held.id}/discard`, {})).status).toBe(401);
    // Switched off: the link answers "not valid".
    const other = await fresh();
    await t.api.put('/api/vendors/response-links/settings', { enabled: false });
    expect((await send(other.token, 'off.pdf', PDF, { ip: '198.51.100.33' })).statusCode).toBe(404);
    await t.api.put('/api/vendors/response-links/settings', { enabled: true });
  });

  it('checks the settings', async () => {
    const bad = await t.api.put('/api/vendors/response-links/settings', { max_files: 51, max_mb: 0, file_types: ['p.df'], reminder_days: 31 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['file_types', 'max_files', 'max_mb', 'reminder_days']);
    const agent = await t.as('agent');
    expect((await agent.put('/api/vendors/response-links/settings', { max_files: 5 })).status).toBe(403);
    const ok = await t.api.put('/api/vendors/response-links/settings', { file_types: '.PDF, docx' });
    expect(ok.body.file_types).toEqual(['docx', 'pdf']);
    const { token } = await fresh();
    expect((await send(token, 'sheet.xlsx', Buffer.from('PK\u0003\u0004 sheet'))).json().error.code).toBe('type_not_allowed');
    await t.api.put('/api/vendors/response-links/settings', { file_types: ['csv', 'doc', 'docx', 'jpeg', 'jpg', 'pdf', 'png', 'pptx', 'txt', 'xls', 'xlsx'] });
  });
});

describe('emailing the link (E06-23)', () => {
  it('is offered only when email is on', async () => {
    const { assessment } = await fresh();
    expect((await t.api.get('/api/vendors/response-links/settings')).body.email_available).toBe(false);
    const r = await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'security@vendor.example' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('email_off');
  });

  it('sends a new link in the email only, names the organization and the assessment, and replaces the old link', async () => {
    const on = await t.api.put('/api/admin/mail/settings', {
      enabled: true, host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test',
    });
    expect(on.status).toBe(200);
    const { vendor, assessment, token: first } = await fresh();
    expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'not an address' })).body.error.fields.email).toBeDefined();
    const agent = await t.as('agent');
    expect((await agent.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'security@vendor.example' })).status).toBe(403);

    const before = sink.messages.length;
    const r = await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'Security@Vendor.example', days: 5 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ emailed_to: 'security@vendor.example', state: 'active', recipient: 'security@vendor.example' });
    expect(r.body.token).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/vendor-response\//);
    // The earlier link stops working.
    expect((await t.anon.get(`/api/vendor-response/${first}`)).status).toBe(404);

    // Nowhere in the database in the clear: not the queued job, the delivery log or the audit log.
    const job = await t.db.one<any>(`select j.id, j.payload::text as payload from jobs j join mail_log m on m.job_id = j.id where m.to_address = 'security@vendor.example' order by m.created_at desc limit 1`);
    expect(job.payload).not.toMatch(/vendor-response\//);
    await t.db.query(`update jobs set run_at = now() - interval '1 second' where id = $1`, [job.id]);
    await t.app.jobs.runDue({ types: ['mail.send'] });
    await sink.waitFor(before + 1);
    const m = sink.messages[before];
    expect(m.to).toEqual(['security@vendor.example']);
    expect(m.subject).toContain('Invented Supplier');
    expect(m.body).toContain('Sandpiper GRC');
    expect(m.body).toMatch(/text\/plain/);
    expect(m.body).toMatch(/text\/html/);
    const sent = /https:\/\/grc\.example\.test\/vendor-response\/([A-Za-z0-9_-]{43})/.exec(m.body);
    expect(sent).not.toBeNull();
    const token = sent![1];
    expect((await t.anon.get(`/api/vendor-response/${token}`)).status).toBe(200);
    const log = await t.db.query<any>(`select subject, to_address, error from mail_log where to_address = 'security@vendor.example'`);
    expect(JSON.stringify(log)).not.toContain(token);
    const events = await history(vendor);
    expect(events.map((e) => e.action)).toContain('vendor.response_link_email');
    expect(JSON.stringify(events)).not.toContain(token);
    const audit = await t.db.query<any>('select * from audit_events');
    expect(JSON.stringify(audit)).not.toContain(token);

    // Sending again makes a new link; the one in the first email stops working.
    expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'security@vendor.example' })).status).toBe(201);
    expect((await t.anon.get(`/api/vendor-response/${token}`, )).status).toBe(404);
  });

  it('is limited per assessment', async () => {
    const { assessment } = await fresh();
    for (let i = 0; i < 5; i++) expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'desk@vendor.example' })).status).toBe(201);
    const sixth = await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'desk@vendor.example' });
    expect(sixth.status).toBe(429);
  });

  it('uses its own templates, which administrators can word (E06-25)', async () => {
    const keys = (await t.api.get('/api/admin/mail/templates')).body.map((x: any) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['vendor_response_link', 'vendor_response_reminder']));
    const edited = await t.api.put('/api/admin/mail/templates/vendor_response_link', {
      subject: 'Questions from {{organization}} for {{vendorName}}',
      text: 'Please answer "{{assessmentTitle}}" by {{expiresAt}}:\n\n{{link}}', html: '',
    });
    expect(edited.status).toBe(200);
    expect((await t.api.put('/api/admin/mail/templates/vendor_response_link', { subject: '{{title}}', text: 'x', html: '' })).body.error.fields.subject).toMatch(/Unknown placeholder/);
    const { assessment } = await fresh();
    const before = sink.messages.length;
    expect((await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'worded@vendor.example' })).status).toBe(201);
    const log = await t.db.one<any>(`select template, job_id from mail_log where to_address = 'worded@vendor.example'`);
    expect(log.template).toBe('vendor_response_link');
    await t.db.query(`update jobs set run_at = now() - interval '1 second' where id = $1`, [log.job_id]);
    await t.app.jobs.runDue({ types: ['mail.send'] });
    await sink.waitFor(before + 1);
    const m = sink.messages[before];
    expect(m.subject).toMatch(/^Questions from .+ for Invented Supplier/);
    expect(m.body).toMatch(/Please answer "/);
    expect(m.body).toMatch(/https:\/\/grc\.example\.test\/vendor-response\/[A-Za-z0-9_-]{43}/);
    await t.api.post('/api/admin/mail/templates/vendor_response_link/reset');
  });

  it('reminds the recipient once before the link expires, without the link', async () => {
    const { vendor, assessment } = await fresh();
    const made = (await t.api.post(`/api/vendor-assessments/${assessment}/links/email`, { email: 'remind@vendor.example', days: 10 })).body;
    await t.db.query(`update vendor_assessment_links set expires_at = now() + interval '1 day', emailed_at = now() - interval '9 days' where id = $1`, [made.id]);
    const run = async () => {
      await t.app.jobs.enqueue('vendors.response_link_reminders', {}, {});
      await t.app.jobs.runDue({ types: ['vendors.response_link_reminders'] });
    };
    await run();
    await run();
    const reminders = await t.db.query<any>(`select m.id, j.payload::text as payload from mail_log m join jobs j on j.id = m.job_id where m.to_address = 'remind@vendor.example' and m.subject like 'Reminder:%'`);
    expect(reminders).toHaveLength(1);
    expect((await t.db.one<any>('select template from mail_log where id = $1', [reminders[0].id])).template).toBe('vendor_response_reminder');
    expect(reminders[0].payload).not.toMatch(/vendor-response\//);
    expect((await t.api.get(`/api/vendor-assessments/${assessment}/links`)).body.rows[0].reminded_at).toBeTruthy();
    expect((await history(vendor)).map((h) => h.action)).toContain('vendor.response_link_remind');
  });
});

let adminCookie: string | undefined;
async function cookieOf(): Promise<string> {
  if (adminCookie) return adminCookie;
  const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'admin', password: 'a long test passphrase 1' } });
  const c = login.cookies.find((x) => x.name === 'grc_session')!;
  adminCookie = `grc_session=${c.value}`;
  return adminCookie;
}

describe('files nobody reviews (E06-24)', () => {
  it('discards files still waiting a set time after the link closed, telling the link creator beforehand', async () => {
    expect((await t.api.get('/api/vendors/response-links/settings')).body.discard_days).toBe(30);
    expect((await t.api.put('/api/vendors/response-links/settings', { discard_days: 400 })).body.error.fields.discard_days).toBeTruthy();
    expect((await t.api.put('/api/vendors/response-links/settings', { discard_days: 10 })).body.discard_days).toBe(10);

    const { vendor, token, linkId } = await fresh();
    const open = await fresh();
    const sent = (await send(token, 'Old report.pdf', PDF)).json();
    const kept = (await send(open.token, 'New report.pdf', PDF)).json();
    const stored = await t.db.one<any>('select storage_key from attachments where id = $1', [sent.id]);
    expect(memoryFiles().has(stored.storage_key)).toBe(true);
    const run = async () => {
      await t.app.jobs.enqueue('vendors.response_files_discard', {}, {});
      await t.app.jobs.runDue({ types: ['vendors.response_files_discard'] });
    };

    // Closed 8 days ago: within the notice period, not yet discarded.
    await t.db.query(`update vendor_assessment_links set revoked_at = now() - interval '8 days' where id = $1`, [linkId]);
    await run();
    const notice = notified.filter((x) => x.once === `vendors.response_files_discard:${linkId}`);
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({ kind: 'reminder', recordType: 'vendor', recordId: vendor });
    expect(notice[0].title).toMatch(/1 file sent by Invented Supplier .* will be discarded/);
    expect((await t.db.one<any>('select deleted_at from attachments where id = $1', [sent.id])).deleted_at).toBeNull();

    // Closed 11 days ago: discarded, audited; the open link's file stays.
    await t.db.query(`update vendor_assessment_links set revoked_at = now() - interval '11 days' where id = $1`, [linkId]);
    await run();
    const row = await t.db.one<any>('select deleted_at, purged_at, removed_reason from attachments where id = $1', [sent.id]);
    expect(row).toMatchObject({ removed_reason: 'unreviewed' });
    expect(row.purged_at).toBeTruthy();
    expect(memoryFiles().has(stored.storage_key)).toBe(false);
    const ev = (await history(vendor)).find((h) => h.action === 'vendor.response_file_expire');
    expect(ev?.summary).toMatch(/Old report\.pdf/);
    expect((await t.db.one<any>('select deleted_at from attachments where id = $1', [kept.id])).deleted_at).toBeNull();

    // 0 = never.
    await t.api.put('/api/vendors/response-links/settings', { discard_days: 0 });
    await t.db.query(`update vendor_assessment_links set revoked_at = now() - interval '400 days' where id = $1`, [open.linkId]);
    await run();
    expect((await t.db.one<any>('select deleted_at from attachments where id = $1', [kept.id])).deleted_at).toBeNull();
    await t.api.put('/api/vendors/response-links/settings', { discard_days: 30 });
  });
});
