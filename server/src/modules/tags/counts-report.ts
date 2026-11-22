import type { TaggableDef } from '../../core/asset-tags.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

// The inventory count report (E37-09, spec §4.5 step 4): counts by status, coverage by site (how many
// of the records kept at each site were verified in a count within the chosen time) and the records
// not verified for longer than that. Owned by TAGS-COUNTS.
//
// Coverage is a figure, the same for everyone (docs/security.md): it counts every record. The list of
// records not verified is a list: it shows only records the person may see.

export interface CountReport {
  days: number;
  counts: { open: number; finished: number; canceled: number };
  sites: {
    siteId: string; siteLabel: string; records: number; verified: number; coverage: number;
    lastCountAt: string | null; lastCountId: string | null; lastCountRef: string | null; openCounts: number;
  }[];
  stale: {
    rows: { recordType: string; typeLabel: string; recordId: string; label: string; ref: string | null; route: string; siteId: string | null; siteLabel: string | null; lastVerifiedAt: string | null }[];
    total: number;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_LIMIT = 200;

interface Deps {
  countableTypes: () => TaggableDef[];
  goneStatuses: (t: TaggableDef) => Promise<string[]>;
}

/** One `select site_id, record_type, record_id from …` per countable type (records in the register, at a site). */
async function registerSql(ctx: ModuleContext, deps: Deps, extra: (t: TaggableDef) => string = () => 'true'): Promise<string | null> {
  const parts: string[] = [];
  for (const t of deps.countableTypes()) {
    const def = ctx.resources.get(t.type);
    if (!def || !t.siteField) continue;
    const site = t.siteField === 'id' ? 'x.id' : `x.${t.siteField}`;
    const gone = await deps.goneStatuses(t);
    const notGone = gone.length && t.statusField
      ? `coalesce(x.${t.statusField}, '') not in (${gone.map((g) => `'${g.replace(/'/g, "''")}'`).join(', ')})` : 'true';
    parts.push(`select ${site} as site_id, '${t.type}'::text as record_type, x.id as record_id from ${def.table} x
      where x.deleted_at is null and ${site} is not null and ${notGone} and (${extra(t)})`);
  }
  return parts.length ? parts.join('\nunion all\n') : null;
}

export async function registerCountReport(ctx: ModuleContext, deps: Deps): Promise<void> {
  ctx.app.get('/api/inventory-counts/report', { preHandler: ctx.requirePerm('tags.view') }, async (req): Promise<CountReport> => {
    const q = req.query as { days?: string; site?: string };
    const n = Number(q.days ?? 365);
    const days = Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 365;
    const siteFilter = typeof q.site === 'string' && UUID_RE.test(q.site) ? q.site : null;

    const c = await ctx.db.one<Row>(
      `select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'finished')::int as finished,
              count(*) filter (where status = 'canceled')::int as canceled from inventory_counts where deleted_at is null`);
    const counts = { open: c?.open ?? 0, finished: c?.finished ?? 0, canceled: c?.canceled ?? 0 };

    const all = await registerSql(ctx, deps);
    if (!all || !ctx.resources.get('site')) return { days, counts, sites: [], stale: { rows: [], total: 0 } };

    // Coverage by site: every record, whoever asks (a figure).
    const bySite = await ctx.db.query<Row>(
      `with reg as (${all})
       select s.id as site_id, s.name as site_label, count(reg.record_id)::int as records,
              count(v.record_id) filter (where v.verified_at >= now() - make_interval(days => $1::int))::int as verified,
              (select max(ic.finished_at) from inventory_counts ic where ic.site_id = s.id and ic.status = 'finished' and ic.deleted_at is null) as last_count_at,
              (select ic.id from inventory_counts ic where ic.site_id = s.id and ic.status = 'finished' and ic.deleted_at is null order by ic.finished_at desc limit 1) as last_count_id,
              (select ic.ref from inventory_counts ic where ic.site_id = s.id and ic.status = 'finished' and ic.deleted_at is null order by ic.finished_at desc limit 1) as last_count_ref,
              (select count(*)::int from inventory_counts ic where ic.site_id = s.id and ic.status = 'open' and ic.deleted_at is null) as open_counts
         from sites s
         left join reg on reg.site_id = s.id
         left join tag_verifications v on v.record_type = reg.record_type and v.record_id = reg.record_id
        where s.deleted_at is null
        group by s.id, s.name
       having count(reg.record_id) > 0
        order by lower(s.name)`, [days]);
    const sites = bySite.map((r) => ({
      siteId: r.site_id, siteLabel: r.site_label, records: r.records, verified: r.verified,
      coverage: r.records ? Math.round((r.verified / r.records) * 100) : 0,
      lastCountAt: r.last_count_at ? new Date(r.last_count_at).toISOString() : null,
      lastCountId: r.last_count_id ?? null, lastCountRef: r.last_count_ref ?? null, openCounts: r.open_counts,
    }));

    // Records not verified within the time: a list, so only what the person may see.
    const visible = await registerSql(ctx, deps, (t) => {
      const def = ctx.resources.get(t.type)!;
      return ctx.can(req.user!, `${def.module}.view`) ? ctx.resources.visibleWhere(t.type, req.user, 'x') : 'false';
    });
    const params: unknown[] = [days];
    const siteCond = siteFilter ? (params.push(siteFilter), `and reg.site_id = $${params.length}::uuid`) : '';
    const from = `from (${visible}) reg left join tag_verifications v on v.record_type = reg.record_type and v.record_id = reg.record_id
      where (v.verified_at is null or v.verified_at < now() - make_interval(days => $1::int)) ${siteCond}`;
    const total = (await ctx.db.one<{ n: number }>(`select count(*)::int as n ${from}`, params))?.n ?? 0;
    const rows = await ctx.db.query<Row>(
      `select reg.site_id, reg.record_type, reg.record_id, v.verified_at ${from} order by v.verified_at asc nulls first, reg.record_type, reg.record_id limit ${STALE_LIMIT}`, params);
    const labels = new Map<string, Row>();
    for (const type of [...new Set(rows.map((r) => r.record_type))]) {
      const def = ctx.resources.get(type)!;
      const refCol = def.ref?.field ? `x.${def.ref.field}` : 'null';
      const ids = rows.filter((r) => r.record_type === type).map((r) => r.record_id);
      for (const x of await ctx.db.query<Row>(`select x.id, x.${def.titleField} as label, ${refCol} as ref from ${def.table} x where x.id = any($1::uuid[])`, [ids])) {
        labels.set(`${type}:${x.id}`, x);
      }
    }
    const siteNames = new Map(bySite.map((s) => [s.site_id, s.site_label]));
    return {
      days, counts, sites,
      stale: {
        total,
        rows: rows.map((r) => {
          const def = ctx.resources.get(r.record_type)!;
          const l = labels.get(`${r.record_type}:${r.record_id}`);
          return {
            recordType: r.record_type, typeLabel: def.label, recordId: r.record_id, label: String(l?.label ?? l?.ref ?? def.label), ref: l?.ref ?? null,
            route: `${def.route}/${r.record_id}`, siteId: r.site_id ?? null, siteLabel: siteNames.get(r.site_id) ?? null,
            lastVerifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
          };
        }),
      },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/inventory-counts/report', tag: 'Inventory counts', permission: 'tags.view',
    summary: 'Inventory counts, coverage by site and records not verified for a while',
    description: 'Coverage counts every record kept at each site (assets, vehicles, the site itself; retired and disposed records left out) and how many were verified in a count within `days`; it is the same for everyone. `stale` lists, never verified first and then the longest ago, at most 200 records the caller may see that were never verified or not within `days`, with the total.',
    query: { days: 'Verified within this many days (1 to 3650, default 365)', site: 'Only records at this site (stale list)' },
    response: '{ days, counts: { open, finished, canceled }, sites: [{ siteId, siteLabel, records, verified, coverage, lastCountAt, lastCountId, lastCountRef, openCounts }], stale: { rows: [...], total } }',
  });
}
