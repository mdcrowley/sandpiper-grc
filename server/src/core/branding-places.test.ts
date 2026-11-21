// E14-36: the organization's branding in the remaining places: the logo inside emails (every
// provider), the HTML form of report documents, the PNG copy of a WebP logo for PDFs, and the
// email-logo switch. Every name and value here is invented.
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { htmlDocument } from '../modules/reports/render.ts';
import { composeMime, setCloudEndpointsForTests } from './mail/cloud.ts';
import { serviceAccountKeyJson, startFakeCloud, type FakeCloud } from './mail/cloud-fake.ts';
import { ensureMail } from './mail/index.ts';
import { parseMessage } from './mail/mime.ts';
import { startSmtpSink, type SmtpSink } from './mail/smtp-sink.ts';
import { render } from './mail/templates.ts';
import type { ModuleDef } from './module.ts';
import {
  checkPrintCopy, logoMeta, MAIL_LOGO_CID, mailBranding, mailLogoSize, printableLogo, printBranding,
} from './organization.ts';

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A real PNG (solid color, RGB). */
function png(w: number, h: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x40)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** A WebP header (VP8X), enough to be recognized and measured. */
function webp(w: number, h: number) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}
const b64 = (b: Buffer) => b.toString('base64');

describe('the logo inside an email', () => {
  const t = { subject: 'Hello', text_body: 'Body text.\n\n{{link}}', html_body: '' };
  const frame = { name: 'Example Transit Authority', footer: ['100 Depot Street, Example City'], color: '#123456' };

  it('shows the logo by its Content-ID, with the name as its text, and leaves the text body alone', () => {
    const plain = render(t, { link: 'https://grc.example.org/x' }, {}, frame);
    const withLogo = render(t, { link: 'https://grc.example.org/x' }, {}, { ...frame, logo: { cid: MAIL_LOGO_CID, width: 120, height: 40 } });
    expect(withLogo.text).toBe(plain.text);
    expect(withLogo.html).toContain(`<img src="cid:${MAIL_LOGO_CID}" width="120" height="40" alt="Example Transit Authority"`);
    expect(withLogo.html).not.toContain('color: #123456;">Example Transit Authority</p>');
    expect(plain.html).toContain('color: #123456;">Example Transit Authority</p>');
    // Nothing is loaded from outside the message.
    expect(withLogo.html).not.toMatch(/src="https?:/);
  });

  it('refuses a Content-ID that could break out of the attribute', () => {
    const r = render(t, {}, {}, { ...frame, logo: { cid: 'x" onerror="alert(1)', width: 10, height: 10 } });
    expect(r.html).not.toContain('<img');
  });

  it('is shown at most 40 pixels tall and 200 wide, never enlarged', () => {
    expect(mailLogoSize(480, 120)).toEqual({ width: 160, height: 40 });
    expect(mailLogoSize(2000, 100)).toEqual({ width: 200, height: 10 });
    expect(mailLogoSize(30, 20)).toEqual({ width: 30, height: 20 });
  });

  it('travels as an inline part of a multipart/related body, beside the text part', async () => {
    const logo = png(120, 40);
    const html = render(t, {}, {}, { ...frame, logo: { cid: MAIL_LOGO_CID, width: 120, height: 40 } }).html;
    const { raw } = await composeMime({
      to: 'a@example.org', from: 'grc@example.org', subject: 'Hello', text: 'Body text.', html,
      attachments: [{ filename: 'logo.png', contentBase64: b64(logo), contentType: 'image/png', cid: MAIL_LOGO_CID }],
    });
    const mime = raw.toString('latin1');
    expect(mime).toMatch(/multipart\/related/);
    expect(mime).toMatch(new RegExp(`Content-ID: <${MAIL_LOGO_CID}>`));
    expect(mime).toMatch(/Content-Disposition: inline/);
    const parsed = parseMessage(raw);
    expect(parsed.text.trim()).toBe('Body text.');
    expect(parsed.html).toContain(`cid:${MAIL_LOGO_CID}`);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({ contentType: 'image/png', inline: true });
    expect(parsed.attachments[0].content.equals(logo)).toBe(true);
  });
});

describe('the HTML form of report documents', () => {
  const base = { title: 'Open tickets', sections: [], preparedFor: 'Example Analyst', generatedAt: '2026-03-01T09:00:00Z', appName: 'Example GRC' };
  const branding = {
    name: 'Example Transit Authority', lines: ['Example Transit Authority Inc.', '100 Depot Street, Example City', 'Phone +1 555 0100'],
    logo: png(60, 20), color: '#123456', logoDataUri: `data:image/png;base64,${b64(png(60, 20))}`,
  };

  it('carries the name, logo, brand color and address footer, and loads nothing from outside', () => {
    for (const cover of [false, true]) {
      const html = htmlDocument({ ...base, cover, branding });
      expect(html).toContain(`<img src="${branding.logoDataUri}" alt="Example Transit Authority">`);
      expect(html).toContain(':root{--brand:#123456}');
      expect(html).toContain('<footer class="org-foot"><p><strong>Example Transit Authority · Example GRC</strong></p>');
      expect(html).toContain('<p>100 Depot Street, Example City</p><p>Phone +1 555 0100</p>');
      expect(html).not.toMatch(/(src|href)="https?:/);
    }
  });

  it('names the organization in words when there is no logo, and never takes a logo that is not a picture', () => {
    const named = htmlDocument({ ...base, branding: { ...branding, logoDataUri: null } });
    expect(named).toContain('<div class="org"><span>Example Transit Authority</span></div>');
    const bad = htmlDocument({ ...base, branding: { ...branding, logoDataUri: 'data:text/html;base64,PHNjcmlwdD4=', color: 'red;}body{display:none' } });
    expect(bad).not.toContain('data:text/html');
    expect(bad).not.toContain('red;}body');
    const bare = htmlDocument({ ...base, branding: null });
    expect(bare).not.toContain('class="org"');
    expect(bare).toContain('<strong>Example GRC</strong>');
  });
});

describe('the PNG copy of a WebP logo', () => {
  it('must be a PNG of the same shape, within limits', () => {
    expect(checkPrintCopy(png(300, 100), { width: 600, height: 200 })).toMatchObject({ width: 300, height: 100, bytes: expect.any(Number), hash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(checkPrintCopy(png(300, 300), { width: 600, height: 200 })).toMatch(/shape/);
    expect(checkPrintCopy(webp(300, 100), { width: 600, height: 200 })).toMatch(/PNG/);
    expect(checkPrintCopy(Buffer.alloc(0), { width: 600, height: 200 })).toMatch(/empty/);
    expect(checkPrintCopy(Buffer.concat([png(300, 100), Buffer.alloc(1100 * 1024)]), { width: 600, height: 200 })).toMatch(/1024 KB/);
  });
});

// ---------- in the application ----------

const mailOn: ModuleDef = { key: 'test_branding_mail', async seedDefaults(ctx) { await ensureMail(ctx); } };
let app: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
let fake: FakeCloud;
const AUTH = { user: 'mailer', pass: 'sink password 1' };

beforeAll(async () => {
  app = await testApp({ extraModules: [mailOn] });
  sink = await startSmtpSink({ auth: AUTH });
  fake = await startFakeCloud();
  setCloudEndpointsForTests(fake.endpoints);
});
afterAll(async () => {
  setCloudEndpointsForTests(null);
  await app.close();
  await sink.close();
  await fake.close();
});

const base = { fromAddress: 'grc@example.org', fromName: 'Sandpiper', baseUrl: 'https://grc.example.org' };
const put = (patch: Record<string, unknown>) => app.api.put('/api/admin/mail/settings', patch);
const testTo = () => app.api.post('/api/admin/mail/test', { to: 'checker@example.org' });

describe('WebP logos in PDFs and emails', () => {
  it('stores the PNG copy beside a WebP logo, prints from it, and takes one later for a logo without', async () => {
    const copy = png(300, 100);
    const up = await app.api.post('/api/admin/organization/logo/light', { data: b64(webp(600, 200)), filename: 'logo.webp', print: b64(copy) });
    expect(up.status).toBe(200);
    expect(up.body.logos.light).toMatchObject({ type: 'image/webp', width: 600, height: 200, print: { width: 300, height: 100, bytes: copy.length } });
    expect(JSON.stringify(up.body)).not.toContain(b64(copy).slice(0, 40));
    expect((await printBranding(app.db)).logo?.equals(copy)).toBe(true);
    expect((await printableLogo(app.db))).toMatchObject({ type: 'image/png', width: 300, height: 100 });
    // The public logo is still the WebP picture.
    const pub = await app.app.inject({ method: 'GET', url: '/api/branding/logo/light' });
    expect(pub.headers['content-type']).toBe('image/webp');

    // A copy of the wrong shape is refused, and nothing is stored.
    const wrong = await app.api.post('/api/admin/organization/logo/light', { data: b64(webp(600, 200)), print: b64(png(100, 100)) });
    expect(wrong.body.error.fields.data).toMatch(/shape/);

    // Without a copy, PDFs and emails have no logo until one is made.
    await app.api.post('/api/admin/organization/logo/light', { data: b64(webp(600, 200)), filename: 'logo.webp' });
    expect((await logoMeta(app.db, 'light'))?.print).toBeNull();
    expect((await printBranding(app.db)).logo).toBeNull();
    expect((await mailBranding(app.db)).logo).toBeNull();
    const made = await app.api.post('/api/admin/organization/logo/light/print', { data: b64(copy) });
    expect(made.status).toBe(200);
    expect(made.body.logos.light.print).toMatchObject({ width: 300, height: 100 });
    expect((await printBranding(app.db)).logo?.equals(copy)).toBe(true);
    const ev = await app.db.one<{ summary: string; after: Record<string, unknown> }>(
      `select summary, after from audit_events where record_id = 'branding.logo_light' order by id desc limit 1`);
    expect(ev?.summary).toBe('Printable copy of the logo for the light theme made');
    expect(ev?.after.data).toBeUndefined();

    // A PNG logo needs no copy.
    await app.api.post('/api/admin/organization/logo/light', { data: b64(png(120, 40)) });
    expect((await app.api.post('/api/admin/organization/logo/light/print', { data: b64(png(120, 40)) })).body.error.fields.data).toMatch(/Only a WebP/);
    expect((await app.api.post('/api/admin/organization/logo/dark/print', { data: b64(copy) })).status).toBe(404);
  });
});

describe('the logo in emails, through every provider', () => {
  const logo = png(120, 40);
  beforeAll(async () => {
    await app.api.post('/api/admin/organization/logo/light', { data: b64(logo), filename: 'logo.png' });
  });

  it('SMTP: an inline part named by its Content-ID, and a switch to leave it out', async () => {
    await put({ ...base, provider: 'smtp', host: '127.0.0.1', port: sink.port, tlsMode: 'none', username: AUTH.user, password: AUTH.pass });
    const before = sink.messages.length;
    expect((await testTo()).body).toMatchObject({ status: 'sent' });
    const m = parseMessage(sink.messages[before].raw);
    expect(m.html).toContain(`<img src="cid:${MAIL_LOGO_CID}" width="120" height="40"`);
    expect(m.text).not.toContain('cid:');
    expect(m.attachments.map((a) => [a.contentType, a.inline])).toEqual([['image/png', true]]);
    expect(m.attachments[0].content.equals(logo)).toBe(true);

    expect((await app.api.patch('/api/admin/settings', { 'branding.email_logo': false })).status).toBe(200);
    expect((await mailBranding(app.db)).logo).toBeNull();
    await testTo();
    const off = parseMessage(sink.messages.at(-1)!.raw);
    expect(off.html).not.toContain('cid:');
    expect(off.attachments).toHaveLength(0);
    expect((await app.api.patch('/api/admin/settings', { 'branding.email_logo': 'yes' })).status).toBe(400);
    await app.api.patch('/api/admin/settings', { 'branding.email_logo': true });
  });

  it('Microsoft Graph: inside the MIME message, and as an inline attachment of a larger message sent as a draft', async () => {
    const graph = { tenantId: fake.microsoft.tenantId, clientId: fake.microsoft.clientId, authMethod: 'secret', mailbox: '', cloud: 'global' };
    expect((await put({ ...base, provider: 'graph', graph, graphCredential: fake.microsoft.clientSecret, enabled: true })).status).toBe(200);
    expect((await testTo()).body).toMatchObject({ status: 'sent', provider: 'graph' });
    const mime = fake.microsoft.sent.at(-1)!.mime;
    expect(mime).toMatch(new RegExp(`Content-ID: <${MAIL_LOGO_CID}>`));
    expect(parseMessage(mime).attachments.map((a) => a.inline)).toEqual([true]);

    const res = await app.app.sendMail({
      to: 'big@example.org', subject: 'Big', text: 'Files.',
      attachments: [{ filename: 'big.bin', content: Buffer.alloc(5_000_000, 7), contentType: 'application/octet-stream' }],
    });
    await app.app.jobs.runDue({ types: ['mail.send'] });
    expect((await app.db.one<any>('select status from mail_log where id = $1', [res.logIds[0]]))?.status).toBe('sent');
    const d = fake.microsoft.sent.at(-1)!.draft!;
    expect(d.message.body.content).toContain(`cid:${MAIL_LOGO_CID}`);
    const inline = d.attachments.find((a) => a.isInline)!;
    expect(inline).toMatchObject({ name: 'logo.png', contentType: 'image/png', contentId: MAIL_LOGO_CID });
    expect(inline.content.equals(logo)).toBe(true);
    expect(d.attachments.find((a) => a.name === 'big.bin')?.isInline).toBeUndefined();
  });

  it('Gmail API: inside the MIME message', async () => {
    expect((await put({ provider: 'gmail', gmailKey: serviceAccountKeyJson(fake), gmail: { mailbox: '' } })).status).toBe(200);
    expect((await testTo()).body).toMatchObject({ status: 'sent', provider: 'gmail' });
    const parsed = parseMessage(fake.google.sent.at(-1)!.mime);
    expect(parsed.html).toContain(`cid:${MAIL_LOGO_CID}`);
    expect(parsed.attachments.map((a) => [a.contentType, a.inline])).toEqual([['image/png', true]]);
  });
});
