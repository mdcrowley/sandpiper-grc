// Administration > Organization (E14-35): validation, logos, colors, what is public, the profile
// import, and where the organization appears (email, PDF). Every name and value here is invented.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { contrast, deriveBrandColors, normalizeHex } from './branding-colors.ts';
import { PdfBuilder } from './export/pdf.ts';
import { pdfText } from './export/testing.ts';
import { imageInfo } from './image-info.ts';
import { render } from './mail/templates.ts';
import { applyOrganizationProfile, checkLogo, mailBranding, printBranding, profileSettings, readOrganization } from './organization.ts';
import { DEV_ORGANIZATION } from './profile.ts';

// ---------- small pictures made here ----------

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A real PNG (solid color, RGB) that a PDF can embed. */
function png(w: number, h: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** A JPEG header with a baseline frame (enough to read its size). */
function jpeg(w: number, h: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
function webpX(w: number, h: number) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}
function webpL(w: number, h: number) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8L', 12, 'latin1');
  b.writeUInt32LE(5, 16);
  b[20] = 0x2f;
  b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
}
const b64 = (b: Buffer) => b.toString('base64');

describe('pictures are recognized by their content', () => {
  it('reads the type and size of PNG, JPEG and WebP', () => {
    expect(imageInfo(png(120, 40))).toEqual({ type: 'image/png', width: 120, height: 40 });
    expect(imageInfo(jpeg(300, 90))).toEqual({ type: 'image/jpeg', width: 300, height: 90 });
    expect(imageInfo(webpX(640, 200))).toEqual({ type: 'image/webp', width: 640, height: 200 });
    expect(imageInfo(webpL(64, 32))).toEqual({ type: 'image/webp', width: 64, height: 32 });
  });

  it('knows nothing else, whatever the name says', () => {
    expect(imageInfo(Buffer.from('GIF89a\x10\x00\x10\x00', 'latin1'))).toBeNull();
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(imageInfo(png(10, 10).subarray(0, 20))).toBeNull(); // cut short
    expect(checkLogo(Buffer.from('<?xml version="1.0"?><svg/>'), 'logo.png')).toMatch(/SVG/);
    expect(checkLogo(Buffer.from('MZ\x90\x00 not a picture', 'latin1'), 'logo.png')).toMatch(/not a PNG, JPEG or WebP/);
  });

  it('limits the size of the file and of the picture', () => {
    expect(checkLogo(Buffer.alloc(0))).toMatch(/empty/);
    expect(checkLogo(Buffer.concat([png(20, 20), Buffer.alloc(600 * 1024)]))).toMatch(/up to 512 KB/);
    expect(checkLogo(png(8, 40))).toMatch(/at least 16 pixels/);
    expect(checkLogo(webpX(4000, 100))).toMatch(/up to 2048 pixels/);
    const ok = checkLogo(png(200, 50), '../../etc/my logo<script>.png');
    expect(ok).toMatchObject({ type: 'image/png', width: 200, height: 50 });
    expect((ok as { filename: string }).filename).toBe('my logoscript.png');
  });
});

describe('brand colors', () => {
  it('reads hex colors in the usual spellings', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('1a2b3c')).toBe('#1a2b3c');
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
  });

  it.each(['#17656f', '#ffff00', '#ffffff', '#000000', '#808080', '#ff00ff', '#00a0e0', '#c00000'])(
    'derives shades of %s that pass WCAG 2.2 AA in both themes', (color) => {
      const c = deriveBrandColors(color, color);
      const failing = c.checks.filter((k) => !k.pass);
      expect(failing).toEqual([]);
      expect(c.checks.length).toBeGreaterThan(15);
      expect(contrast(c.light['--brand-contrast'], c.light['--brand'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.dark['--brand-contrast'], c.dark['--brand'])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('says when a chosen color had to change for a theme', () => {
    expect(deriveBrandColors('#ffff00', null).notes.join(' ')).toMatch(/light theme the brand color is darkened/);
    expect(deriveBrandColors('#0a1a40', null).notes.join(' ')).toMatch(/dark theme the brand color is lightened/);
  });
});

describe('email and PDF', () => {
  it('puts the organization above and under an email, but not around a text message', () => {
    const t = { subject: 'Hello', text_body: 'Body {{organizationPhone}}', html_body: '' };
    const framed = render(t, { organizationPhone: '+1 555 0100' }, {}, { name: 'Example Transit Authority', footer: ['100 Depot Street, Example City', 'Phone +1 555 0100'], color: '#123456' });
    expect(framed.text).toBe('Body +1 555 0100\n\n-- \n100 Depot Street, Example City\nPhone +1 555 0100');
    expect(framed.html).toContain('color: #123456;">Example Transit Authority</p>');
    expect(framed.html).toContain('100 Depot Street, Example City<br>Phone +1 555 0100');
    const bare = render(t, {}, {}, null);
    expect(bare.text).toBe('Body');
    expect(bare.html).not.toContain('<hr');
  });

  it('escapes the organization in the HTML', () => {
    const r = render({ subject: 's', text_body: 'x', html_body: '' }, {}, {}, { name: '<b>Example</b>', footer: ['A & B'] });
    expect(r.html).toContain('&lt;b&gt;Example&lt;/b&gt;');
    expect(r.html).toContain('A &amp; B');
  });

  it('prints the name, address and logo in a PDF', async () => {
    const pdf = await new PdfBuilder({
      title: 'Open tickets', appName: 'Example GRC',
      branding: { name: 'Example Transit Authority', lines: ['100 Depot Street, Example City', 'Phone +1 555 0100'], logo: png(60, 20), color: '#123456' },
    }).finish();
    const text = pdfText(pdf);
    expect(text).toContain('Example Transit Authority · Example GRC');
    expect(text).toContain('100 Depot Street, Example City · Phone +1 555 0100');
    expect(pdf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
  });
});

describe('Administration > Organization', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it('saves the details through the settings, audited', async () => {
    const res = await t.api.patch('/api/admin/settings', {
      'organization.name': '  Example Transit Authority ',
      'organization.legal_name': 'Example Transit Authority Board',
      'organization.short_name': 'ETA',
      'organization.street': '100 Depot Street\n\nSuite 200',
      'organization.city': 'Example City', 'organization.region': 'Example Region', 'organization.postal_code': '00000', 'organization.country': 'Example Country',
      'organization.phone': '+1 (555) 0100 ext 12', 'organization.email': 'info@example.org', 'organization.website': 'www.example.org',
      'organization.security_phone': '+1 555 0199', 'organization.security_email': 'security@example.org',
      'branding.primary_color': '#C00000', 'branding.accent_color': 'fa0',
    });
    expect(res.status).toBe(200);
    expect(res.body.values['organization.name']).toBe('Example Transit Authority');
    expect(res.body.values['organization.street']).toBe('100 Depot Street\nSuite 200');
    expect(res.body.values['organization.website']).toBe('https://www.example.org');
    expect(res.body.values['branding.accent_color']).toBe('#ffaa00');
    const ev = await t.db.one<{ before: unknown; after: unknown }>(
      `select before, after from audit_events where action = 'setting.change' and record_id = 'organization.phone' order by id desc limit 1`);
    expect(ev?.after).toBe('+1 (555) 0100 ext 12');
    const org = await t.api.get('/api/admin/organization');
    expect(org.status).toBe(200);
    expect(org.body.values['organization.city']).toBe('Example City');
    expect(org.body.colors.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
  });

  it('refuses values that do not fit, field by field, and saves none of them', async () => {
    const res = await t.api.patch('/api/admin/settings', {
      'organization.name': 'x'.repeat(121),
      'organization.street': 'a\nb\nc\nd',
      'organization.postal_code': '1'.repeat(21),
      'organization.phone': 'call us',
      'organization.email': 'not an address',
      'organization.website': 'javascript:alert(1)',
      'branding.primary_color': 'teal',
      'organization.city': 'Line one\u0007',
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual([
      'branding.primary_color', 'organization.city', 'organization.email', 'organization.name', 'organization.phone',
      'organization.postal_code', 'organization.street', 'organization.website',
    ]);
    expect(res.body.error.fields['organization.street']).toMatch(/three lines/);
    expect((await readOrganization(t.db)).name).toBe('Example Transit Authority');
    const long = await t.api.patch('/api/admin/settings', { 'organization.street': 'y'.repeat(121) });
    expect(long.body.error.fields['organization.street']).toMatch(/120 characters/);
  });

  it('is for administrators only', async () => {
    expect((await t.anon.get('/api/admin/organization')).status).toBe(401);
    const agent = await t.as('agent');
    expect((await agent.get('/api/admin/organization')).status).toBe(403);
    expect((await agent.post('/api/admin/organization/logo/light', { data: b64(png(32, 32)) })).status).toBe(403);
  });

  it('shows visitors the name, colors and logo, and nothing else', async () => {
    for (const res of [await t.anon.get('/api/branding'), await t.anon.get('/api/auth/state')]) {
      expect(res.status).toBe(200);
      const b = res.body.branding ?? res.body;
      expect(b.name).toBe('Example Transit Authority');
      expect(b.shortName).toBe('ETA');
      expect(b.colors.light['--brand']).toMatch(/^#[0-9a-f]{6}$/);
      const text = JSON.stringify(res.body);
      for (const secret of ['0199', 'security@example.org', 'Depot Street', 'info@example.org', '0100', 'Board']) expect(text).not.toContain(secret);
    }
  });

  it('previews colors without saving them', async () => {
    const res = await t.api.post('/api/admin/organization/colors', { primary: '#ffff00', accent: '' });
    expect(res.status).toBe(200);
    expect(res.body.primary).toBe('#ffff00');
    expect(res.body.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
    expect(res.body.notes.length).toBeGreaterThan(0);
    expect((await t.api.post('/api/admin/organization/colors', { primary: 'yellow' })).body.error.fields.primary).toMatch(/hexadecimal/);
    expect((await readOrganization(t.db)).primaryColor).toBe('#c00000');
  });

  it('takes a logo, serves it publicly and cacheably, falls back for the dark theme, and removes it', async () => {
    const pic = png(120, 40);
    const up = await t.api.post('/api/admin/organization/logo/light', { data: `data:image/png;base64,${b64(pic)}`, filename: 'logo.png' });
    expect(up.status).toBe(200);
    expect(up.body.logos.light).toMatchObject({ type: 'image/png', width: 120, height: 40, bytes: pic.length, filename: 'logo.png' });
    expect(up.body.logos.light.data).toBeUndefined();
    const ev = await t.db.one<{ summary: string; after: Record<string, unknown> }>(
      `select summary, after from audit_events where record_id = 'branding.logo_light' order by id desc limit 1`);
    expect(ev?.summary).toBe('Logo for the light theme added');
    expect(ev?.after.data).toBeUndefined();

    const state = (await t.anon.get('/api/branding')).body;
    expect(state.logo.light).toMatch(/^\/api\/branding\/logo\/light\?v=[0-9a-f]{16}$/);
    expect(state.logo.dark).toBe(state.logo.light);
    const res = await t.app.inject({ method: 'GET', url: state.logo.light });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.equals(pic)).toBe(true);
    const again = await t.app.inject({ method: 'GET', url: '/api/branding/logo/dark', headers: { 'if-none-match': String(res.headers.etag) } });
    expect(again.statusCode).toBe(304);

    const dark = await t.api.post('/api/admin/organization/logo/dark', { data: b64(webpX(300, 100)), filename: 'dark.webp' });
    expect(dark.status).toBe(200);
    const darkRes = await t.app.inject({ method: 'GET', url: '/api/branding/logo/dark' });
    expect(darkRes.headers['content-type']).toBe('image/webp');
    expect(darkRes.headers['cache-control']).toBe('public, max-age=300');

    expect((await t.api.post('/api/admin/organization/logo/light', { data: b64(Buffer.from('<svg onload="alert(1)"/>')) })).body.error.fields.data).toMatch(/SVG/);
    expect((await t.api.post('/api/admin/organization/logo/light', { data: b64(Buffer.concat([pic, Buffer.alloc(520 * 1024)])) })).body.error.fields.data).toMatch(/512 KB/);
    expect((await t.api.post('/api/admin/organization/logo/light', { data: 'not base64 !' })).status).toBe(400);
    expect((await t.api.post('/api/admin/organization/logo/side', { data: b64(pic) })).status).toBe(404);

    // The PDF and email branding read the stored values.
    const print = await printBranding(t.db);
    expect(print.name).toBe('Example Transit Authority');
    expect(print.logo?.equals(pic)).toBe(true);
    expect(print.lines.join(' | ')).toContain('100 Depot Street, Suite 200, Example City, Example Region 00000, Example Country');
    const mail = await mailBranding(t.db);
    expect(mail.values.organizationPhone).toBe('+1 (555) 0100 ext 12');

    await t.api.del('/api/admin/organization/logo/dark');
    const gone = await t.api.del('/api/admin/organization/logo/light');
    expect(gone.body.logos).toEqual({ light: null, dark: null });
    expect((await t.app.inject({ method: 'GET', url: '/api/branding/logo/light' })).statusCode).toBe(404);
    expect((await t.anon.get('/api/branding')).body.logo).toMatchObject({ light: null, dark: null });
  });
});

describe('the organization profile is a one-time import', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let dir = '';
  beforeAll(async () => { t = await testApp(); dir = mkdtempSync(join(tmpdir(), 'grc-org-')); });
  afterAll(async () => { await t.close(); rmSync(dir, { recursive: true, force: true }); });

  it('maps the profile onto settings', () => {
    expect(profileSettings({ name: 'N', address: { street: ['a', 'b'], postalCode: '1' }, securityContact: { email: 'e@example.org' }, branding: { primaryColor: '#000' } })).toEqual({
      'organization.name': 'N', 'organization.street': 'a\nb', 'organization.postal_code': '1',
      'organization.security_email': 'e@example.org', 'branding.primary_color': '#000',
    });
    expect(Object.keys(profileSettings(DEV_ORGANIZATION))).toContain('organization.security_phone');
  });

  it('writes only what is not yet set, reports bad values and reads logos from the seed folder only', async () => {
    writeFileSync(join(dir, 'harbor-logo.png'), png(64, 64));
    await t.api.patch('/api/admin/settings', { 'organization.phone': '+1 555 0111' });
    const deps = { db: t.db, audit: t.ctx.audit, settings: t.ctx.settings };
    const profile = {
      appName: 'Harbor Line GRC', name: 'Harbor Line Transit', phone: '+1 555 0122', email: 'not an email',
      address: { city: 'Example City' }, branding: { accentColor: '#2a78d6', logo: 'harbor-logo.png', logoDark: '../outside.png' },
    };
    const first = await applyOrganizationProfile(deps, profile, dir);
    expect(first.set.sort()).toEqual(['app.name', 'branding.accent_color', 'branding.logo_light', 'organization.city', 'organization.name']);
    expect(first.kept).toEqual(['organization.phone']);
    expect(first.problems.join('\n')).toMatch(/organization\.email: General email/);
    expect(first.problems.join('\n')).toMatch(/branding\.logo_dark: the file "\.\.\/outside\.png" is not in the seed folder/);
    const org = await readOrganization(t.db);
    expect(org).toMatchObject({ appName: 'Harbor Line GRC', name: 'Harbor Line Transit', phone: '+1 555 0111', city: 'Example City', accentColor: '#2a78d6' });

    // A second run changes nothing an administrator has since set.
    await t.api.patch('/api/admin/settings', { 'organization.name': 'Changed in the application' });
    const second = await applyOrganizationProfile(deps, profile, dir);
    expect(second.set).toEqual([]);
    expect((await readOrganization(t.db)).name).toBe('Changed in the application');
  });
});
