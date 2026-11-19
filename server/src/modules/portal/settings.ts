// Portal settings: the switch (the `portal` feature switch, shared with Administration >
// Settings), the title and welcome line, the service status banner and the reopen window.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';

export const SETTINGS_KEY = 'portal.settings';
export const BANNER_TONES = ['info', 'warning', 'outage', 'resolved'] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

export interface PortalSettings {
  title: string;
  intro: string;
  banner: { message: string; tone: BannerTone; updated_at: string | null } | null;
  /** Days after resolution in which the requester may reopen a request. 0 = never. */
  reopen_days: number;
}

export const DEFAULTS: PortalSettings = {
  title: 'Help and requests',
  intro: 'Report a problem, ask for something you need, or check on something you asked for.',
  banner: null,
  reopen_days: 7,
};

export async function readSettings(ctx: ModuleContext): Promise<PortalSettings> {
  const raw = await ctx.settings.get<Row>(SETTINGS_KEY, {});
  const days = Number(raw.reopen_days);
  const banner = raw.banner && typeof raw.banner === 'object' && String(raw.banner.message ?? '').trim()
    ? {
        message: String(raw.banner.message).trim(),
        tone: (BANNER_TONES as readonly string[]).includes(raw.banner.tone) ? raw.banner.tone as BannerTone : 'info',
        updated_at: raw.banner.updated_at ?? null,
      }
    : null;
  return {
    title: String(raw.title ?? '').trim() || DEFAULTS.title,
    intro: typeof raw.intro === 'string' ? raw.intro.trim() : DEFAULTS.intro,
    banner,
    reopen_days: Number.isInteger(days) && days >= 0 && days <= 90 ? days : DEFAULTS.reopen_days,
  };
}

export async function isEnabled(ctx: ModuleContext): Promise<boolean> {
  const features = await ctx.settings.get<Row>('features', { portal: false });
  return features?.portal === true;
}

/**
 * Applies a change from the settings page. `enabled` writes the shared feature switch and needs
 * `admin.administer`; everything else needs `tickets.administer` (checked by the route).
 */
export async function saveSettings(ctx: ModuleContext, req: FastifyRequest, body: Row): Promise<void> {
  const fields: Record<string, string> = {};
  const current = await readSettings(ctx);
  const next: PortalSettings = { ...current };
  if (body.title !== undefined) {
    const title = String(body.title ?? '').trim();
    if (!title) fields.title = 'Give the portal a title.';
    else if (title.length > 80) fields.title = 'Keep the title under 80 characters.';
    else next.title = title;
  }
  if (body.intro !== undefined) {
    const intro = String(body.intro ?? '').trim();
    if (intro.length > 300) fields.intro = 'Keep the welcome line under 300 characters.';
    else next.intro = intro;
  }
  if (body.reopen_days !== undefined) {
    const d = Number(body.reopen_days);
    if (!Number.isInteger(d) || d < 0 || d > 90) fields.reopen_days = 'Enter a whole number of days from 0 to 90.';
    else next.reopen_days = d;
  }
  if (body.banner !== undefined) {
    const b = body.banner as Row | null;
    const message = String(b?.message ?? '').trim();
    const tone = String(b?.tone ?? 'info');
    if (message.length > 500) fields['banner.message'] = 'Keep the message under 500 characters.';
    else if (!(BANNER_TONES as readonly string[]).includes(tone)) fields['banner.tone'] = 'Choose how serious the message is.';
    else next.banner = message ? { message, tone: tone as BannerTone, updated_at: new Date().toISOString() } : null;
    // Saving the same message again keeps its time.
    if (next.banner && current.banner && next.banner.message === current.banner.message && next.banner.tone === current.banner.tone) {
      next.banner.updated_at = current.banner.updated_at;
    }
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') fields.enabled = 'Choose on or off.';
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  if (body.enabled !== undefined && body.enabled !== (await isEnabled(ctx))) {
    if (!ctx.can(req.user, 'admin.administer')) ctx.fail(403, 'forbidden', 'Only an administrator can switch the portal on or off.');
    const features = await ctx.settings.get<Row>('features', { portal: false });
    await ctx.settings.set('features', { ...features, portal: body.enabled }, req);
  }
  if (JSON.stringify(next) !== JSON.stringify(current)) await ctx.settings.set(SETTINGS_KEY, next, req);
}
