// The offline package (wave 14, E38-10; spec §5.6): GET /api/mobile/package.
//
// What a person needs to keep working without signal for the next days: My work, the choices the
// app's forms offer (lists, sites, the portal's words, the attachment limits), the tag formats and
// the tag values of the records the package covers, and the parts of field work (fieldwork.ts, wave 15:
// inspections with their checklists, condition assessments due, open inventory counts). It expires after
// `mobile.offline_days` (Administration > Mobile app, default 7); the app deletes it then.
//
// Like My work, every part is read through the application's own routes in-process with the caller's
// token, so the package holds only what the person may see, exactly as the web shows it; a part of a
// switched-off area, or one the person may not read, is left out.
//
// Extension point: `definePackagePart(app, { key, build })`: a part returns its data and the records it
// covers (whose tag values join the offline lookup table); see docs/mobile.md.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { featureState } from '../../core/features.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import type { MobileHome, MobilePackage, PackageOption, PackageTag } from '../../../../shared/mobile-api.ts';
import { valueKey, type TagFormat } from '../../../../shared/tag-format.ts';
import { readMobileSettings, viaMobileToken } from './state.ts';
import type { SyncEnv } from './sync.ts';

/** Sites in a package at most (the "where" of a report). */
export const MAX_SITES = 2000;
/** Records whose tag values a package carries at most. */
export const MAX_TAGGED_RECORDS = 5000;
/** Lists the app's report forms need. */
export const PACKAGE_LISTS = ['safety_event_type', 'safety_event_severity', 'condition_rating', 'condition_method'];

type Call = SyncEnv['call'];

export interface PackageEnv {
  ctx: ModuleContext;
  user: NonNullable<import('fastify').FastifyRequest['user']>;
  call: Call;
  /** The package's last day (YYYY-MM-DD, organization time). */
  until: string;
  days: number;
}

export interface PackagePartDef {
  key: string;
  /** The part's data (null leaves it out) and the records it covers. */
  build(env: PackageEnv): Promise<{ data: unknown; records?: { type: string; id: string }[] } | null>;
}

const parts = new WeakMap<FastifyInstance, Map<string, PackagePartDef>>();

/** Adds a part to every offline package (in `register`). */
export function definePackagePart(app: FastifyInstance, def: PackagePartDef): void {
  let map = parts.get(app);
  if (!map) parts.set(app, (map = new Map()));
  if (map.has(def.key)) throw new Error(`Package part defined twice: ${def.key}`);
  map.set(def.key, def);
}

const options = (rows: Row[] | null | undefined): PackageOption[] =>
  (rows ?? []).filter((r) => r.active !== false).map((r) => ({ value: String(r.value), label: String(r.label ?? r.value) }));

export function registerPackage(ctx: ModuleContext, call: (req: import('fastify').FastifyRequest) => Call) {
  const { app, db } = ctx;

  app.get('/api/mobile/package', async (req): Promise<MobilePackage> => {
    if (!viaMobileToken(req)) ctx.fail(403, 'mobile_app_only', 'Only the mobile app downloads offline packages.');
    const me = req.user!;
    const c = call(req);
    const get = async <T>(url: string): Promise<T | null> => {
      const r = await c('GET', url);
      return r.status === 200 ? (r.body as T) : null;
    };
    const s = await readMobileSettings(ctx);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + s.offlineDays * 24 * 60 * 60_000);
    const env: PackageEnv = { ctx, user: me, call: c, until: dayInZone(s.offlineDays), days: s.offlineDays };

    const work = (await get<MobileHome>('/api/mobile/home')) ?? { sections: [], unreadNotifications: 0, generatedAt: now.toISOString() };

    const lookups: Record<string, PackageOption[]> = {};
    for (const list of PACKAGE_LISTS) {
      const rows = await get<Row[]>(`/api/lookups/${list}`);
      if (rows && rows.length) lookups[list] = options(rows);
    }

    const sites: PackageOption[] = [];
    const siteDef = ctx.resources.get('site');
    if (siteDef) {
      for (let page = 1; sites.length < MAX_SITES; page++) {
        const res = await get<{ rows: Row[]; total: number }>(`${siteDef.path}?sort=${siteDef.titleField}&dir=asc&pageSize=500&page=${page}`);
        if (!res) break;
        for (const r of res.rows) sites.push({ value: r.id, label: String(r[siteDef.titleField] ?? r.ref ?? r.id), ref: r.ref ?? null });
        if (res.rows.length < 500 || sites.length >= res.total) break;
      }
    }

    const portalOptions = await get<{ types: Row[]; harm: Row[] }>('/api/portal/safety/options');
    const limits = await get<{ maxBytes: number; allowedExtensions: string[] }>('/api/attachments/config');

    // Parts (inspections with checklists, condition assessments due, open counts), and the records they cover.
    const built: Record<string, unknown> = {};
    const records = new Map<string, { type: string; id: string }>();
    for (const sec of work.sections) {
      if (sec.key !== 'condition') continue;
      for (const it of sec.items) records.set(`${it.type}:${it.id}`, { type: it.type, id: it.id });
    }
    for (const part of [...(parts.get(app)?.values() ?? [])]) {
      const res = await part.build(env).catch((e) => { console.error(`[mobile.package] part ${part.key}:`, e); return null; });
      if (!res) continue;
      built[part.key] = res.data;
      for (const r of res.records ?? []) if (records.size < MAX_TAGGED_RECORDS) records.set(`${r.type}:${r.id}`, r);
    }

    // Tag formats and the tag values of those records (only the ones the person may see).
    let tags: MobilePackage['tags'] = null;
    const settings = await get<{ tags: { formats: TagFormat[] } | null; server?: { timeZone?: string } }>('/api/mobile/settings');
    if (settings?.tags && (await featureState(db)).on.tags) {
      const values: PackageTag[] = [];
      const has = (await db.one<{ t: string | null }>(`select to_regclass('public.tag_assignments')::text as t`))?.t;
      if (has && records.size) {
        const byType = new Map<string, string[]>();
        for (const r of records.values()) byType.set(r.type, [...(byType.get(r.type) ?? []), r.id]);
        for (const [type, ids] of byType) {
          if (!ctx.resources.get(type)) continue;
          const rows = await db.query<Row>(
            `select value, value_key, record_id::text as record_id from tag_assignments
             where status = 'active' and record_type = $1 and record_id::text = any($2::text[])`, [type, ids]);
          for (const r of rows) {
            const found = await ctx.resources.find(type, r.record_id, me).catch(() => undefined);
            if (!found) continue;
            values.push({ value: r.value, valueKey: r.value_key || valueKey(r.value), recordType: type, recordId: r.record_id, label: (await ctx.resources.labelFor(type, r.record_id)) ?? r.value });
          }
        }
      }
      tags = { formats: settings.tags.formats, values };
    }

    return {
      id: randomUUID(), generatedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
      user: { id: me.id, displayName: me.displayName },
      timeZone: settings?.server?.timeZone ?? null,
      work, lookups, sites,
      portal: portalOptions ? { safetyTypes: options(portalOptions.types), harm: options(portalOptions.harm) } : null,
      attachments: limits ? { maxBytes: limits.maxBytes, allowedExtensions: limits.allowedExtensions } : null,
      tags, parts: built,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/mobile/package', tag: 'Mobile app',
    summary: 'Your offline package for the mobile app: My work, the choices the app\'s forms need, tag values of the records it covers, your upcoming inspections with their checklists, condition assessments due and open inventory counts',
    description: 'The app\'s token only (403 `mobile_app_only` otherwise). Read through the application\'s own routes as you, so it holds only what you may see; parts of switched-off areas are left out. Expires after the Mobile app setting "Days offline work is kept" (default 7).',
    response: 'MobilePackage: { id, generatedAt, expiresAt, user, work, lookups, sites, portal, attachments, tags: { formats, values } | null, parts: { inspections?: PackageInspection[], condition?: PackageCondition, counts?: PackageCount[] } }',
  });
}
