import type { ModuleContext } from '../../core/module.ts';
import { TAG_SETTINGS, type TagSettingsView } from '../../../../shared/asset-tags-api.ts';
import { registerAssignments } from './assignments.ts';
import { invalid } from './common.ts';
import { registerFormats } from './formats.ts';
import { registerStock } from './stock.ts';

// Formats, stock, series, assignments and settings (E37-01, E37-02, E37-03, E37-07). Owned by TAGS-CORE.
// The work is in common.ts (read helpers), formats.ts, stock.ts and assignments.ts; this file keeps the
// exports the wave 13 contracts fixed, so the other parts import from here.

export { activeByKey, assignmentsOf, formatFromRow, historyByKey, loadFormats, type AssignmentRow } from './common.ts';
export { stockStatus, takeFromSeries } from './stock.ts';
export { onTaggableAnonymize, taggableTables } from './assignments.ts';

/** Where a value key stands in the stock (not counting assignments). */
export interface StockStatus {
  inStock: boolean;
  rangeId: string | null;
  formatId: string | null;
  /** A void or lost mark on a value that was never attached. */
  mark: 'void' | 'lost' | null;
}

/** The area's settings as the API gives them. */
export async function tagSettings(ctx: ModuleContext): Promise<TagSettingsView> {
  const get = <T>(s: { key: string; fallback: T }) => ctx.settings.get<T>(s.key, s.fallback);
  return {
    severalPerRecord: (await get<boolean>(TAG_SETTINGS.severalPerRecord)) === true,
    logLookups: (await get<boolean>(TAG_SETTINGS.logLookups)) !== false,
    lookupDays: Number(await get<number>(TAG_SETTINGS.lookupDays)),
    printLimit: Number(await get<number>(TAG_SETTINGS.printLimit)),
  };
}

/** Registers the formats, stock, series, assignment and settings routes. */
export async function registerStore(ctx: ModuleContext): Promise<void> {
  registerFormats(ctx);
  registerStock(ctx);
  await registerAssignments(ctx);

  ctx.app.get('/api/asset-tags/settings', { preHandler: ctx.requirePerm('tags.view') }, async () => tagSettings(ctx));
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/settings', summary: 'Asset tag settings', permission: 'tags.view',
    response: { type: 'object', properties: { severalPerRecord: { type: 'boolean' }, logLookups: { type: 'boolean' }, lookupDays: { type: 'integer' }, printLimit: { type: 'integer' } } },
  });

  ctx.app.put('/api/asset-tags/settings', { preHandler: ctx.requirePerm('tags.manage') }, async (req) => {
    const b = (req.body ?? {}) as Partial<TagSettingsView>;
    const before = await tagSettings(ctx);
    const f: Record<string, string> = {};
    for (const k of ['severalPerRecord', 'logLookups'] as const) if (k in b && typeof b[k] !== 'boolean') f[k] = 'Choose on or off.';
    const whole = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
    if ('lookupDays' in b && !whole(b.lookupDays, 1, 3650)) f.lookupDays = 'Enter a whole number of days from 1 to 3,650.';
    if ('printLimit' in b && !whole(b.printLimit, 1, 10_000)) f.printLimit = 'Enter a whole number from 1 to 10,000.';
    if (Object.keys(f).length) invalid(ctx, f);
    if (b.severalPerRecord === false && before.severalPerRecord) {
      const several = await ctx.db.one<{ n: number }>(
        `select count(*)::int as n from (select 1 from tag_assignments where status = 'active' group by record_type, record_id having count(*) > 1) x`);
      if (several && several.n > 0) {
        invalid(ctx, { severalPerRecord: `${several.n} ${several.n === 1 ? 'record has' : 'records have'} more than one tag. End the extra tags first.` });
      }
    }
    const keys = { severalPerRecord: TAG_SETTINGS.severalPerRecord.key, logLookups: TAG_SETTINGS.logLookups.key, lookupDays: TAG_SETTINGS.lookupDays.key, printLimit: TAG_SETTINGS.printLimit.key };
    for (const k of Object.keys(keys) as (keyof typeof keys)[]) {
      if (k in b && b[k] !== before[k]) await ctx.settings.set(keys[k], b[k], req);
    }
    return tagSettings(ctx);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/asset-tags/settings', summary: 'Change the asset tag settings', permission: 'tags.manage',
    description: 'Any of: several tags per record, the lookup log, days the lookup log is kept (1 to 3,650), most labels one print run makes (1 to 10,000). Switching several tags off is refused while a record has more than one.',
    body: { type: 'object', properties: { severalPerRecord: { type: 'boolean' }, logLookups: { type: 'boolean' }, lookupDays: { type: 'integer' }, printLimit: { type: 'integer' } } },
  });
}
