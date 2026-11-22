import type { FastifyRequest } from 'fastify';
import { allTaggables, taggable } from '../../core/asset-tags.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { onAnonymize } from '../../core/retention.ts';
import { TAG_SETTINGS, type LastSeen, type LookupLogSource, type LookupOutcome } from '../../../../shared/asset-tags-api.ts';
import { MOBILE_ACCESS_PREFIX } from '../../../../shared/mobile-api.ts';
import type { TagSource } from '../../../../shared/tag-format.ts';

// The lookup log and "Last seen" (E37-10): table tag_lookups, kept retention.tag_lookups_days
// (default 90), off with tags.log_lookups; never the phone's location. Owned by TAGS-COUNTS.
//
// - A lookup that found nothing the person may see is logged without a record, so the log never ties
//   a restricted or hidden record to a person's search.
// - "Last seen" (when, by whom, how) is shown to people who may edit the record.
// - Retention: a daily job removes rows older than the setting; anonymizing a taggable record removes
//   its rows (they say who looked at it), and removing a record for good does the same.

const DAY = 24 * 60 * 60_000;
const SOURCES: LookupLogSource[] = ['app_code', 'app_text', 'app_typed', 'web'];

export interface LookupLogEntry {
  key: string;
  personId: string | null;
  source: LookupLogSource;
  outcome: LookupOutcome;
  /** Only when the person may see the record (a restricted or hidden record is never tied to a lookup). */
  recordType?: string | null;
  recordId?: string | null;
  action?: string | null;
}

/**
 * How a value reached the server, as the log records it: the app's camera (`code`, `text`), typed in
 * the app (a request made with a mobile app access token), or the web (typed or a handheld scanner).
 */
export function logSourceOf(source: TagSource | string | null | undefined, req: FastifyRequest | null): LookupLogSource {
  if (source === 'code') return 'app_code';
  if (source === 'text') return 'app_text';
  const auth = req?.headers?.authorization;
  const fromApp = typeof auth === 'string' && auth.startsWith(`Bearer ${MOBILE_ACCESS_PREFIX}`);
  return fromApp ? 'app_typed' : 'web';
}

/** Whether lookups are logged now (setting `tags.log_lookups`, default on). */
export async function loggingOn(ctx: ModuleContext): Promise<boolean> {
  return (await ctx.settings.get<boolean>(TAG_SETTINGS.logLookups.key, TAG_SETTINGS.logLookups.fallback)) !== false;
}

/** Days the lookup log is kept (setting `retention.tag_lookups_days`, 1 to 3650, default 90). */
export async function lookupDays(ctx: ModuleContext): Promise<number> {
  const v = Number(await ctx.settings.get<number>(TAG_SETTINGS.lookupDays.key, TAG_SETTINGS.lookupDays.fallback));
  return Number.isInteger(v) && v >= 1 && v <= 3650 ? v : TAG_SETTINGS.lookupDays.fallback;
}

/** Writes one lookup to the log when `tags.log_lookups` is on. Never fails the lookup. Called by lookup.ts and counts. */
export async function logLookup(ctx: ModuleContext, entry: LookupLogEntry): Promise<void> {
  try {
    if (!entry.key || !SOURCES.includes(entry.source) || !(await loggingOn(ctx))) return;
    const tied = entry.recordType && entry.recordId ? [entry.recordType, entry.recordId] : [null, null];
    await ctx.db.query(
      `insert into tag_lookups (value_key, person_id, source, outcome, record_type, record_id, action) values ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.key.slice(0, 200), entry.personId, entry.source, entry.outcome, tied[0], tied[1], entry.action ? String(entry.action).slice(0, 40) : null]);
  } catch (err) {
    ctx.app.log.warn({ err }, 'A tag lookup could not be logged.');
  }
}

/**
 * When a record was last seen (its newest logged lookup), for the tag card and the Tags panel; null
 * when nothing is logged. The caller shows it only to people who may edit the record (spec §4.6).
 */
export async function lastSeen(ctx: ModuleContext, recordType: string, recordId: string): Promise<LastSeen | null> {
  const row = await ctx.db.one<Row>(
    `select l.at, l.source, u.display_name from tag_lookups l left join users u on u.id = l.person_id
      where l.record_type = $1 and l.record_id = $2 order by l.at desc limit 1`, [recordType, recordId]);
  if (!row) return null;
  return { at: new Date(row.at).toISOString(), byName: row.display_name ?? null, source: row.source };
}

/** Removes log rows past the retention period. */
export async function lookupHousekeeping(ctx: ModuleContext): Promise<{ removed: number }> {
  const days = await lookupDays(ctx);
  const removed = (await ctx.db.query(
    'delete from tag_lookups where at < now() - make_interval(days => $1::int) returning 1', [days])).length;
  if (removed) await ctx.audit(null, { action: 'retention.housekeeping', summary: `Asset tag lookup log past its retention period removed: ${removed} row(s)` });
  return { removed };
}

/** Registers the "Last seen" route, the log's daily clean-up and its anonymization (TAGS-COUNTS). */
export async function registerHistory(ctx: ModuleContext): Promise<void> {
  ctx.app.get('/api/asset-tags/last-seen', async (req) => {
    const q = req.query as { type?: string; id?: string };
    const type = String(q.type ?? '');
    const id = String(q.id ?? '');
    const def = taggable(ctx.app, ctx.resources, type);
    if (!def || !/^[0-9a-f-]{36}$/i.test(id)) ctx.fail(404, 'not_found', 'Record not found.');
    const res = ctx.resources.get(type)!;
    if (!(await ctx.resources.find(type, id, req.user))) ctx.fail(404, 'not_found', 'Record not found.');
    // Visible to people who may edit the record (spec §4.6); others get null, not a refusal.
    if (!ctx.can(req.user!, `${res.module}.edit`)) return { lastSeen: null };
    return { lastSeen: await lastSeen(ctx, type, id) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/last-seen', tag: 'Asset tags',
    summary: 'When a tagged record was last seen (its newest logged tag lookup)',
    description: 'For people who may see the record; `lastSeen` is null unless they may also edit it, or when nothing is logged (logging off, or older than `retention.tag_lookups_days`). Never holds a location.',
    query: { type: 'Taggable record type (asset, vehicle, site, system)', id: 'Record id' },
    response: '{ lastSeen: { at, byName, source: app_code | app_text | app_typed | web } | null }',
  });

  // The log is kept retention.tag_lookups_days (default 90).
  await scheduleWork(ctx, 'tags.lookup_housekeeping', () => lookupHousekeeping(ctx), { every: DAY, firstRunInMs: 20 * 60_000 });

  // Anonymizing a taggable record removes who looked it up and who verified it; removing it for good
  // removes its log rows and its last verification. Registered once every module has defined its
  // types, so types added by modules that load later are covered too.
  ctx.app.addHook('onReady', async () => {
    for (const t of allTaggables(ctx.app)) {
      onAnonymize(t.type, async (tx, id) => {
        await tx.query('delete from tag_lookups where record_type = $1 and record_id = $2', [t.type, id]);
        await tx.query('update tag_verifications set verified_by = null where record_type = $1 and record_id = $2', [t.type, id]);
      }, 'tags.history');
    }
  });
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (action !== 'purge' || !allTaggables(ctx.app).some((t) => t.type === def.type)) return;
    await ctx.db.query('delete from tag_lookups where record_type = $1 and record_id = $2', [def.type, row.id]);
    await ctx.db.query('delete from tag_verifications where record_type = $1 and record_id = $2', [def.type, row.id]);
  });
}
