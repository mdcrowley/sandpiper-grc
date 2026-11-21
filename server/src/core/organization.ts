// The organization's details and branding (Administration > Organization, E14-35): its names,
// address and contacts, the application name, logos for the light and dark themes, and the brand
// colors. All of it is stored as settings (rows of `settings`), so it is in every backup and
// survives an upgrade. The organization profile (`seed/organization.json`) is only a one-time
// import into these settings (`applyOrganizationProfile`).
//
// What anyone may see before signing in is `publicBranding`: the application name, the
// organization's display and short names, the colors and the logos. Everything else (address,
// phones, emails, the security contact) is for administrators, and is printed only where the
// application itself puts it: the footer of emails and PDF exports, and the incident kit.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { deriveBrandColors, normalizeHex, type ThemeTokens } from './branding-colors.ts';
import { DEFAULT_APP_NAME } from './config.ts';
import type { Db, Queryable } from './db.ts';
import { fail } from './errors.ts';
import { imageInfo, type ImageType } from './image-info.ts';
import type { AuditInput } from './module.ts';

type Check = (v: unknown) => { value: unknown } | string;

/** Largest logo file, and the largest and smallest picture in pixels. */
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MAX_PIXELS = 2048;
export const LOGO_MIN_PIXELS = 16;
export const LOGO_VARIANTS = ['light', 'dark'] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];
export const logoKey = (variant: LogoVariant) => `branding.logo_${variant}`;
/**
 * A PDF holds PNG or JPEG only, and many mail programs show no WebP. For a WebP logo the browser
 * that uploads it also makes a PNG copy (drawn on a canvas, so the server needs no image decoder,
 * E14-36); that copy is checked here and stored beside the logo. At most this large.
 */
export const PRINT_COPY_MAX_BYTES = 1024 * 1024;
/** An email carries the logo inline only up to this size, so every message stays light. */
export const MAIL_LOGO_MAX_BYTES = 200 * 1024;
/** The Content-ID of the logo in an email's HTML part (`<img src="cid:...">`). */
export const MAIL_LOGO_CID = 'organization-logo@branding.local';

const text = (max: number, what: string): Check => (v) => {
  if (v === null || v === undefined) return { value: '' };
  if (typeof v !== 'string') return `${what} must be text.`;
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length > max) return `${what} can be up to ${max} characters.`;
  // Control characters never belong in a name or an address (they would break a mail header or a PDF line).
  if (/[\u0000-\u001f\u007f]/.test(s)) return `${what} has a character that cannot be used.`;
  return { value: s };
};

const PHONE_RE = /^\+?[0-9 ().\-/]{3,30}(\s*(ext\.?|x)\s*[0-9]{1,6})?$/i;
const phone = (what: string): Check => (v) => {
  const t = text(40, what)(v);
  if (typeof t === 'string' || t.value === '') return t;
  return PHONE_RE.test(String(t.value)) && /[0-9]{3}/.test(String(t.value).replace(/\D/g, ''))
    ? t : `${what}: use digits, spaces, + ( ) - and an optional extension, such as +1 555 0100 ext 12.`;
};
const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;
const email = (what: string): Check => (v) => {
  const t = text(254, what)(v);
  if (typeof t === 'string' || t.value === '') return t;
  return EMAIL_RE.test(String(t.value)) ? t : `${what}: enter an address such as info@example.org.`;
};
const website: Check = (v) => {
  const t = text(200, 'Website')(v);
  if (typeof t === 'string' || t.value === '') return t;
  let s = String(t.value);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') && !u.username && !u.password) return { value: u.href.replace(/\/$/, '') };
  } catch { /* below */ }
  return 'Website: enter an address such as https://www.example.org.';
};
/** Street lines: up to three, each up to 120 characters, stored one to a line. */
const street: Check = (v) => {
  if (v === null || v === undefined || v === '') return { value: '' };
  const raw = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/\r?\n/) : null;
  if (!raw) return 'Street must be text.';
  const lines = raw.map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (lines.length > 3) return 'Street can have up to three lines.';
  if (lines.some((l) => l.length > 120)) return 'Each street line can be up to 120 characters.';
  if (lines.some((l) => /[\u0000-\u001f\u007f]/.test(l))) return 'Street has a character that cannot be used.';
  return { value: lines.join('\n') };
};
const color = (what: string): Check => (v) => {
  if (v === null || v === undefined || v === '') return { value: '' };
  const hex = normalizeHex(v);
  return hex ? { value: hex } : `${what}: enter a color as six hexadecimal digits, such as #17656f.`;
};

/**
 * The organization's settings, with defaults and validation. Changed through
 * `PATCH /api/admin/settings` like every other setting (each change is audited).
 */
export const ORGANIZATION_SETTINGS: Record<string, { fallback: unknown; check: Check }> = {
  'organization.name': { fallback: '', check: text(120, 'Organization name') },
  'organization.legal_name': { fallback: '', check: text(200, 'Legal name') },
  'organization.short_name': { fallback: '', check: text(20, 'Short name') },
  'organization.street': { fallback: '', check: street },
  'organization.city': { fallback: '', check: text(80, 'City') },
  'organization.region': { fallback: '', check: text(80, 'State or region') },
  'organization.postal_code': { fallback: '', check: text(20, 'Postal code') },
  'organization.country': { fallback: '', check: text(80, 'Country') },
  'organization.phone': { fallback: '', check: phone('Main phone') },
  'organization.email': { fallback: '', check: email('General email') },
  'organization.website': { fallback: '', check: website },
  'organization.security_phone': { fallback: '', check: phone('Security contact phone') },
  'organization.security_email': { fallback: '', check: email('Security contact email') },
  'branding.primary_color': { fallback: '', check: color('Brand color') },
  'branding.accent_color': { fallback: '', check: color('Accent color') },
  // E14-36: emails carry the logo above the message unless this is switched off.
  'branding.email_logo': { fallback: true, check: (v) => (typeof v === 'boolean' ? { value: v } : 'Choose on or off.') },
};
export const ORGANIZATION_KEYS = Object.keys(ORGANIZATION_SETTINGS);

export interface Organization {
  appName: string;
  name: string; legalName: string; shortName: string;
  street: string; city: string; region: string; postalCode: string; country: string;
  phone: string; email: string; website: string;
  securityPhone: string; securityEmail: string;
  primaryColor: string; accentColor: string;
  /** Whether emails show the logo (true unless switched off). */
  emailLogo: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Every organization setting in one read, with its fallback. */
export async function readOrganization(db: Queryable): Promise<Organization> {
  const rows = await db.query<{ key: string; value: unknown }>(
    'select key, value from settings where key = any($1::text[])', [['app.name', ...ORGANIZATION_KEYS]],
  );
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    appName: str(v['app.name']).trim() || DEFAULT_APP_NAME,
    name: str(v['organization.name']), legalName: str(v['organization.legal_name']), shortName: str(v['organization.short_name']),
    street: str(v['organization.street']), city: str(v['organization.city']), region: str(v['organization.region']),
    postalCode: str(v['organization.postal_code']), country: str(v['organization.country']),
    phone: str(v['organization.phone']), email: str(v['organization.email']), website: str(v['organization.website']),
    securityPhone: str(v['organization.security_phone']), securityEmail: str(v['organization.security_email']),
    primaryColor: str(v['branding.primary_color']), accentColor: str(v['branding.accent_color']),
    emailLogo: v['branding.email_logo'] !== false,
  };
}

/** The name to print for the organization: its display name, else the application name. */
export const organizationName = (o: Organization) => o.name || o.appName;

/** The address on one line: "100 Depot Street, Example City, Example Region 00000, Example Country". */
export function addressLine(o: Organization): string {
  const place = [o.region, o.postalCode].filter(Boolean).join(' ');
  return [...o.street.split('\n'), o.city, place, o.country].map((s) => s.trim()).filter(Boolean).join(', ');
}

/** "Phone +1 555 0100 · info@example.org · https://www.example.org" (whatever is set). */
export function contactLine(o: Organization): string {
  return [o.phone && `Phone ${o.phone}`, o.email, o.website].filter(Boolean).join(' · ');
}

// ---------- logos ----------

/** The PNG copy of a WebP logo, for PDFs and emails (E14-36). */
export interface PrintCopyMeta { width: number; height: number; bytes: number; hash: string }
export interface LogoMeta {
  type: ImageType; width: number; height: number; bytes: number; hash: string; filename: string; updatedAt: string;
  /** Only for a WebP logo: its PNG copy, or null while none has been made. */
  print?: PrintCopyMeta | null;
}
type StoredCopy = PrintCopyMeta & { data: string };
interface StoredLogo extends Omit<LogoMeta, 'print'> { data: string; print?: StoredCopy }

/** A logo's description without its content (cheap: neither picture is read). */
export async function logoMeta(db: Queryable, variant: LogoVariant): Promise<LogoMeta | null> {
  const row = await db.one<{ value: LogoMeta | null; print: PrintCopyMeta | null }>(
    `select value - 'data' - 'print' as value, (value -> 'print') - 'data' as print from settings where key = $1`, [logoKey(variant)]);
  if (!row?.value || typeof row.value !== 'object' || !row.value.hash) return null;
  if (row.value.type !== 'image/webp') return row.value;
  return { ...row.value, print: row.print && typeof row.print === 'object' && row.print.hash ? row.print : null };
}

/** A logo's picture and description (with the PNG copy of a WebP logo, if any), or null when none is stored. */
export async function logoFile(db: Queryable, variant: LogoVariant): Promise<{ meta: LogoMeta; data: Buffer; print: Buffer | null } | null> {
  const row = await db.one<{ value: StoredLogo | null }>('select value from settings where key = $1', [logoKey(variant)]);
  const v = row?.value;
  if (!v || typeof v !== 'object' || typeof v.data !== 'string') return null;
  const { data, print, ...rest } = v;
  const copy = rest.type === 'image/webp' && print && typeof print.data === 'string' ? print : null;
  const meta: LogoMeta = rest.type === 'image/webp'
    ? { ...rest, print: copy ? { width: copy.width, height: copy.height, bytes: copy.bytes, hash: copy.hash } : null }
    : rest;
  return { meta, data: Buffer.from(data, 'base64'), print: copy ? Buffer.from(copy.data, 'base64') : null };
}

/**
 * The logo as a PDF or an email can hold it: the picture itself when it is PNG or JPEG, the PNG
 * copy of a WebP logo, or null (no logo, or a WebP logo without a copy).
 */
export async function printableLogo(db: Queryable, variant: LogoVariant = 'light'): Promise<{ data: Buffer; type: 'image/png' | 'image/jpeg'; width: number; height: number } | null> {
  const file = await logoFile(db, variant);
  if (!file) return null;
  if (file.meta.type === 'image/png' || file.meta.type === 'image/jpeg') return { data: file.data, type: file.meta.type, width: file.meta.width, height: file.meta.height };
  if (file.print && file.meta.print) return { data: file.print, type: 'image/png', width: file.meta.print.width, height: file.meta.print.height };
  return null;
}

/**
 * Checks the PNG copy of a WebP logo, made by the browser: a PNG, at most 1 MB, and the shape of
 * the logo (within 3 percent; the browser may make it smaller). Its description, or what is wrong.
 */
export function checkPrintCopy(data: Buffer, logo: Pick<LogoMeta, 'width' | 'height'>): PrintCopyMeta | string {
  if (data.length === 0) return 'The printable copy is empty.';
  if (data.length > PRINT_COPY_MAX_BYTES) return `The printable copy is ${Math.ceil(data.length / 1024)} KB; it can be up to ${PRINT_COPY_MAX_BYTES / 1024} KB.`;
  const info = imageInfo(data);
  if (!info || info.type !== 'image/png') return 'The printable copy must be a PNG picture.';
  const { width, height } = info;
  if (width < LOGO_MIN_PIXELS || height < LOGO_MIN_PIXELS || width > LOGO_MAX_PIXELS || height > LOGO_MAX_PIXELS) return `The printable copy is ${width} × ${height} pixels, which cannot be used.`;
  const ratio = logo.width / logo.height;
  if (Math.abs(width / height - ratio) > 0.03 * ratio) return 'The printable copy does not have the shape of the logo.';
  return { width, height, bytes: data.length, hash: createHash('sha256').update(data).digest('hex').slice(0, 16) };
}

/**
 * Checks a logo file: PNG, JPEG or WebP by its content (not its name), at most 512 KB, from 16 to
 * 2048 pixels each way. Returns its description, or a sentence saying what is wrong.
 */
export function checkLogo(data: Buffer, filename = ''): LogoMeta | string {
  if (data.length === 0) return 'The file is empty.';
  if (data.length > LOGO_MAX_BYTES) return `The file is ${Math.ceil(data.length / 1024)} KB; a logo can be up to ${LOGO_MAX_BYTES / 1024} KB.`;
  const head = data.subarray(0, 512).toString('latin1').trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')) return 'SVG pictures cannot be used, because they can carry scripts. Save the logo as PNG, JPEG or WebP.';
  const info = imageInfo(data);
  if (!info) return 'This is not a PNG, JPEG or WebP picture. Save the logo in one of those formats.';
  const { width, height } = info;
  if (width < LOGO_MIN_PIXELS || height < LOGO_MIN_PIXELS) return `The picture is ${width} × ${height} pixels; a logo must be at least ${LOGO_MIN_PIXELS} pixels each way.`;
  if (width > LOGO_MAX_PIXELS || height > LOGO_MAX_PIXELS) return `The picture is ${width} × ${height} pixels; a logo can be up to ${LOGO_MAX_PIXELS} pixels each way.`;
  const clean = basename(String(filename)).replace(/[^\w .()-]/g, '').slice(0, 120);
  return {
    type: info.type, width, height, bytes: data.length,
    hash: createHash('sha256').update(data).digest('hex').slice(0, 16),
    filename: clean, updatedAt: new Date().toISOString(),
  };
}

/** Decodes an upload sent as base64 or as a data: address. */
export function decodeUpload(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || !raw) return null;
  const s = raw.replace(/^data:[^;,]*;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  return Buffer.from(s, 'base64');
}

type Audit = (req: FastifyRequest | null, ev: AuditInput) => Promise<void>;
const THEME_WORD = { light: 'light theme', dark: 'dark theme' } as const;

/**
 * Stores (or, with null, removes) a logo, with the PNG copy of a WebP logo when one is given, and
 * audits it without the pictures themselves.
 */
export async function saveLogo(
  db: Queryable, audit: Audit, req: FastifyRequest | null, variant: LogoVariant,
  file: { meta: LogoMeta; data: Buffer; print?: { meta: PrintCopyMeta; data: Buffer } | null } | null,
) {
  const before = await logoMeta(db, variant);
  const key = logoKey(variant);
  if (file) {
    const { print: _none, ...meta } = file.meta;
    const print = file.print && meta.type === 'image/webp' ? { ...file.print.meta, data: file.print.data.toString('base64') } : null;
    await db.query(
      `insert into settings (key, value, updated_by) values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [key, JSON.stringify({ ...meta, data: file.data.toString('base64'), ...(print ? { print } : {}) }), req?.user?.id ?? null],
    );
  } else {
    await db.query('delete from settings where key = $1', [key]);
  }
  await audit(req, {
    action: 'setting.change', recordType: 'setting', recordId: key,
    summary: file ? `Logo for the ${THEME_WORD[variant]} ${before ? 'replaced' : 'added'}` : `Logo for the ${THEME_WORD[variant]} removed`,
    before: before ?? undefined,
    after: file ? { ...file.meta, ...(file.print && file.meta.type === 'image/webp' ? { print: file.print.meta } : {}) } : undefined,
  });
}

/** Adds (or replaces) the PNG copy of a stored WebP logo, audited without the picture. */
export async function savePrintCopy(db: Queryable, audit: Audit, req: FastifyRequest | null, variant: LogoVariant, copy: { meta: PrintCopyMeta; data: Buffer }) {
  const key = logoKey(variant);
  await db.query(
    `update settings set value = jsonb_set(value, '{print}', $2::jsonb), updated_at = now(), updated_by = $3 where key = $1`,
    [key, JSON.stringify({ ...copy.meta, data: copy.data.toString('base64') }), req?.user?.id ?? null],
  );
  await audit(req, {
    action: 'setting.change', recordType: 'setting', recordId: key,
    summary: `Printable copy of the logo for the ${THEME_WORD[variant]} made`, after: copy.meta,
  });
}

// ---------- what is public ----------

export interface PublicBranding {
  appName: string;
  name: string;
  shortName: string;
  /** Design tokens laid over the standard ones, per theme; null for the standard look. */
  colors: { light: ThemeTokens; dark: ThemeTokens } | null;
  /** Addresses of the logos (the dark one falls back to the light one); null for the standard mark. */
  logo: { light: string | null; dark: string | null; lightType: string | null };
}

const logoUrl = (variant: LogoVariant, meta: LogoMeta | null) => (meta ? `/api/branding/logo/${variant}?v=${meta.hash}` : null);

/** What any visitor may see, signed in or not: never the address, phones, emails or security contact. */
export async function publicBranding(db: Queryable): Promise<PublicBranding> {
  const o = await readOrganization(db);
  const [light, dark] = await Promise.all([logoMeta(db, 'light'), logoMeta(db, 'dark')]);
  const custom = o.primaryColor || o.accentColor;
  const derived = custom ? deriveBrandColors(o.primaryColor, o.accentColor) : null;
  return {
    appName: o.appName, name: o.name, shortName: o.shortName,
    colors: derived && { light: derived.light, dark: derived.dark },
    logo: { light: logoUrl('light', light), dark: logoUrl('dark', dark) ?? logoUrl('light', light), lightType: light?.type ?? null },
  };
}

// ---------- printed documents and email ----------

export interface PrintBranding {
  /** The organization's name (the application name when none is set). */
  name: string;
  /** Address and contact lines for a footer or cover; empty when none are set. */
  lines: string[];
  /** The light-theme logo when it is PNG or JPEG, or the PNG copy of a WebP one (what a PDF can hold). */
  logo: Buffer | null;
  /** The light theme's brand color, for rules and accents. */
  color: string | null;
  /**
   * The light-theme logo as a data: address, for HTML documents, which load nothing from outside
   * (a browser shows WebP too, so this is the logo as uploaded).
   */
  logoDataUri?: string | null;
}

/** The organization as PDF exports, report documents and the incident kit print it. */
export async function printBranding(db: Queryable): Promise<PrintBranding> {
  try {
    const o = await readOrganization(db);
    const file = await logoFile(db, 'light');
    const logo = !file ? null
      : file.meta.type === 'image/png' || file.meta.type === 'image/jpeg' ? file.data
      : file.print; // a WebP logo prints from its PNG copy (none until one is made)
    return {
      name: organizationName(o),
      lines: [o.legalName && o.legalName !== o.name ? o.legalName : '', addressLine(o), contactLine(o)].filter(Boolean),
      logo,
      color: o.primaryColor || o.accentColor ? deriveBrandColors(o.primaryColor, o.accentColor).light['--brand'] : null,
      logoDataUri: file ? `data:${file.meta.type};base64,${file.data.toString('base64')}` : null,
    };
  } catch {
    return { name: DEFAULT_APP_NAME, lines: [], logo: null, color: null, logoDataUri: null };
  }
}

/** The logo as an email carries it: inside the message (Content-ID), PNG or JPEG, with the size to show it at. */
export interface MailLogo { data: Buffer; type: 'image/png' | 'image/jpeg'; cid: string; width: number; height: number }

/** The size to show the logo at in an email: 40 pixels tall (never enlarged), at most 200 wide. */
export function mailLogoSize(w: number, h: number): { width: number; height: number } {
  let height = Math.min(40, h);
  let width = Math.max(1, Math.round((w * height) / h));
  if (width > 200) { width = 200; height = Math.max(1, Math.round((h * width) / w)); }
  return { width, height };
}

/** The organization as emails print it: a name above the message and lines under it. */
export async function mailBranding(db: Queryable): Promise<{ name: string; footer: string[]; color: string | null; logo: MailLogo | null; values: Record<string, string> }> {
  const o = await readOrganization(db);
  const name = organizationName(o);
  // The logo travels inside the message (not as a remote address, which mail programs block),
  // when it is switched on, printable (PNG or JPEG, or a WebP logo's PNG copy) and small enough.
  const pic = o.emailLogo ? await printableLogo(db, 'light') : null;
  const logo = pic && pic.data.length <= MAIL_LOGO_MAX_BYTES
    ? { data: pic.data, type: pic.type, cid: MAIL_LOGO_CID, ...mailLogoSize(pic.width, pic.height) } : null;
  return {
    name,
    logo,
    footer: [o.legalName || o.name, addressLine(o), contactLine(o)].filter(Boolean),
    color: o.primaryColor || o.accentColor ? deriveBrandColors(o.primaryColor, o.accentColor).light['--brand'] : null,
    // Placeholders every email template may use.
    values: { organizationName: name, organizationAddress: addressLine(o), organizationPhone: o.phone, organizationEmail: o.email, organizationWebsite: o.website },
  };
}

// ---------- public routes ----------

/**
 * `GET /api/branding` and `GET /api/branding/logo/:variant`: public, so the sign-in page, the
 * portal and the vendor response page can show the organization's look before anyone signs in.
 */
export function registerBranding(app: FastifyInstance, db: Db) {
  app.get('/api/branding', { config: { public: true } }, async () => publicBranding(db));

  app.get('/api/branding/logo/:variant', { config: { public: true } }, async (req, reply) => {
    const variant = String((req.params as Record<string, string>).variant);
    if (!LOGO_VARIANTS.includes(variant as LogoVariant)) fail(404, 'not_found', 'No such logo.');
    // The dark theme's logo falls back to the light theme's.
    const file = (await logoFile(db, variant as LogoVariant)) ?? (variant === 'dark' ? await logoFile(db, 'light') : null);
    if (!file) fail(404, 'not_found', 'No logo has been uploaded.');
    const etag = `"${file!.meta.hash}"`;
    const versioned = (req.query as Record<string, string>).v === file!.meta.hash;
    reply.header('etag', etag);
    // An address carrying the logo's hash never changes its content; a bare one is checked again soon.
    reply.header('cache-control', versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    const ext = file!.meta.type.split('/')[1].replace('jpeg', 'jpg');
    reply.header('content-disposition', `inline; filename="logo-${variant}.${ext}"`);
    return reply.type(file!.meta.type).send(file!.data);
  });
}

// ---------- the organization profile ----------

/** The organization profile's details as settings (key -> raw value); only what the profile gives. */
export function profileSettings(p: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') out[key] = v; };
  put('app.name', p.appName);
  put('organization.name', p.name);
  put('organization.legal_name', p.legalName);
  put('organization.short_name', p.shortName);
  const a = p.address && typeof p.address === 'object' ? p.address : {};
  put('organization.street', Array.isArray(a.street) ? a.street.join('\n') : a.street);
  put('organization.city', a.city);
  put('organization.region', a.region);
  put('organization.postal_code', a.postalCode);
  put('organization.country', a.country);
  put('organization.phone', p.phone);
  put('organization.email', p.email);
  put('organization.website', p.website);
  const sc = p.securityContact && typeof p.securityContact === 'object' ? p.securityContact : {};
  put('organization.security_phone', sc.phone);
  put('organization.security_email', sc.email);
  const b = p.branding && typeof p.branding === 'object' ? p.branding : {};
  put('branding.primary_color', b.primaryColor);
  put('branding.accent_color', b.accentColor);
  return out;
}

const APP_NAME_CHECK: Check = (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 60
  ? { value: v.trim() } : 'Enter a name of 1 to 60 characters.');

/**
 * Writes the profile's organization details into the settings, only where a setting is not yet
 * stored (so a value changed in the application is never overwritten by a later seed). Logos named
 * in `branding.logo` / `branding.logoDark` are read from the seed folder. Returns what it did, one
 * line each, and never throws for a bad value (it is reported and skipped).
 */
export async function applyOrganizationProfile(
  deps: { db: Queryable; audit: Audit; settings: { set(key: string, value: unknown): Promise<void> } },
  profile: Record<string, any>, seedDir: string | null,
): Promise<{ set: string[]; kept: string[]; problems: string[] }> {
  const wanted = profileSettings(profile);
  const stored = new Set((await deps.db.query<{ key: string }>('select key from settings where key = any($1::text[])',
    [[...Object.keys(wanted), ...LOGO_VARIANTS.map(logoKey)]])).map((r) => r.key));
  const set: string[] = [];
  const kept: string[] = [];
  const problems: string[] = [];
  for (const [key, raw] of Object.entries(wanted)) {
    if (stored.has(key)) { kept.push(key); continue; }
    const res = (key === 'app.name' ? APP_NAME_CHECK : ORGANIZATION_SETTINGS[key].check)(raw);
    if (typeof res === 'string') { problems.push(`${key}: ${res}`); continue; }
    await deps.settings.set(key, res.value);
    set.push(key);
  }
  const b = profile.branding && typeof profile.branding === 'object' ? profile.branding : {};
  for (const [variant, file] of [['light', b.logo], ['dark', b.logoDark]] as const) {
    if (typeof file !== 'string' || !file) continue;
    const key = logoKey(variant);
    if (stored.has(key)) { kept.push(key); continue; }
    // Only a file directly in the seed folder: the name may not lead anywhere else.
    const path = seedDir && file === basename(file) ? join(seedDir, file) : null;
    if (!path || !existsSync(path)) { problems.push(`${key}: the file "${file}" is not in the seed folder.`); continue; }
    const data = readFileSync(path);
    const meta = checkLogo(data, file);
    if (typeof meta === 'string') { problems.push(`${key}: ${meta}`); continue; }
    await saveLogo(deps.db, deps.audit, null, variant, { meta, data });
    set.push(key);
  }
  return { set, kept, problems };
}
