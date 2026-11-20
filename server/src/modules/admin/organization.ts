// Administration > Organization (E14-35): the organization's details, the application name, the
// logos and the brand colors. The text settings are saved through PATCH /api/admin/settings like
// every other setting (`ORGANIZATION_SETTINGS` in core/organization.ts); the logos have routes of
// their own because they are files. Every change is audited.
import { deriveBrandColors } from '../../core/branding-colors.ts';
import {
  checkLogo, decodeUpload, LOGO_MAX_BYTES, LOGO_MAX_PIXELS, LOGO_MIN_PIXELS, LOGO_VARIANTS, logoMeta, ORGANIZATION_KEYS,
  publicBranding, saveLogo, type LogoVariant,
} from '../../core/organization.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { adminRoute, body, invalid } from './shared.ts';
import { SETTINGS } from './settings.ts';

export function registerOrganization(ctx: ModuleContext) {
  const variantOf = (req: { params: unknown }): LogoVariant => {
    const v = String((req.params as Record<string, string>).variant);
    if (!LOGO_VARIANTS.includes(v as LogoVariant)) ctx.fail(404, 'not_found', 'Use "light" or "dark".');
    return v as LogoVariant;
  };

  const read = async () => {
    const values: Row = {};
    for (const key of ['app.name', ...ORGANIZATION_KEYS]) values[key] = await ctx.settings.get(key, SETTINGS[key].fallback);
    const [light, dark] = await Promise.all([logoMeta(ctx.db, 'light'), logoMeta(ctx.db, 'dark')]);
    return {
      values,
      logos: { light, dark },
      limits: { maxBytes: LOGO_MAX_BYTES, maxPixels: LOGO_MAX_PIXELS, minPixels: LOGO_MIN_PIXELS, types: ['image/png', 'image/jpeg', 'image/webp'] },
      colors: deriveBrandColors(values['branding.primary_color'] as string, values['branding.accent_color'] as string),
      branding: await publicBranding(ctx.db),
    };
  };

  adminRoute(ctx, 'GET', '/api/admin/organization', read);

  // What the chosen colors become in each theme, with the contrast checks, before they are saved.
  adminRoute(ctx, 'POST', '/api/admin/organization/colors', async (req) => {
    const b = body(req);
    const fields: Record<string, string> = {};
    const primary = SETTINGS['branding.primary_color'].check(b.primary ?? '');
    const accent = SETTINGS['branding.accent_color'].check(b.accent ?? '');
    if (typeof primary === 'string') fields.primary = primary;
    if (typeof accent === 'string') fields.accent = accent;
    if (Object.keys(fields).length) invalid(fields);
    return deriveBrandColors((primary as { value: string }).value, (accent as { value: string }).value);
  });

  adminRoute(ctx, 'POST', '/api/admin/organization/logo/:variant', async (req) => {
    const variant = variantOf(req);
    const b = body(req);
    const data = decodeUpload(b.data);
    if (!data) invalid({ data: 'Choose a PNG, JPEG or WebP picture.' });
    const meta = checkLogo(data!, typeof b.filename === 'string' ? b.filename : '');
    if (typeof meta === 'string') invalid({ data: meta });
    await saveLogo(ctx.db, ctx.audit, req, variant, { meta: meta as Exclude<typeof meta, string>, data: data! });
    return read();
  });

  adminRoute(ctx, 'DELETE', '/api/admin/organization/logo/:variant', async (req) => {
    const variant = variantOf(req);
    if (await logoMeta(ctx.db, variant)) await saveLogo(ctx.db, ctx.audit, req, variant, null);
    return read();
  });
}
