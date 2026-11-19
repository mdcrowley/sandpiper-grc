// Changes seen from the things they touch (E05-08): the changes that affect one system or
// asset (its main system or asset, or an "affects" link), for the panel on the system and
// asset pages, and the systems and assets one change affects, for the relationship map.
import type { ModuleContext, Row } from '../../core/module.ts';
import { AFFECTS, type Base } from './base.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Statuses of changes that will not happen or are over: listed under "Earlier", never as planned. */
const ENDED = ['completed', 'reviewed', 'closed', 'rejected', 'cancelled'];

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export function registerAffecting(ctx: ModuleContext, base: Base): void {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('changes.view') };

  app.get('/api/changes/affecting', view, async (req) => {
    const q = req.query as Record<string, string>;
    const type = q.type === 'asset' ? 'asset' : q.type === 'system' ? 'system' : null;
    if (!type) ctx.fail(400, 'validation', 'Give the type: "system" or "asset".');
    if (!UUID.test(String(q.id ?? ''))) ctx.fail(400, 'validation', `Give the ${type} as "id".`);
    // The record itself must be one the caller may see, when its module is loaded.
    if (ctx.resources.get(type!) && !(await ctx.resources.find(type!, q.id, req.user))) {
      ctx.fail(404, 'not_found', `${type === 'system' ? 'System' : 'Asset'} not found.`);
    }
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    const field = type === 'system' ? 'system_id' : 'asset_id';
    const where = `c.deleted_at is null and ${ctx.resources.visibleWhere('change', req.user, 'c')}
      and (c.${field} = $1::uuid or exists (
        select 1 from record_links l where l.from_type = 'change' and l.from_id = c.id
          and l.to_type = $2 and l.to_id = $1::uuid and l.relation = $3))`;
    const total = (await db.one<{ c: number; open: number }>(
      `select count(*)::int as c, count(*) filter (where c.status <> all($4::text[]))::int as open from changes c where ${where}`,
      [q.id, type, AFFECTS, ENDED]))!;
    const rows = await db.query<Row>(
      `select c.id, c.ref, c.title, c.status, c.change_type, c.risk_level, c.outcome, c.planned_start, c.planned_end,
              c.actual_start, c.actual_end, c.${field} = $1::uuid as main, u.display_name as owner_name
       from changes c left join users u on u.id = c.owner_id
       where ${where}
       order by coalesce(c.planned_start, c.created_at) desc, c.ref desc limit $4`,
      [q.id, type, AFFECTS, limit]);
    const [statuses, types] = [await ctx.lookups.values('change_status'), await ctx.lookups.values('change_type')];
    const now = Date.now();
    return {
      total: total.c,
      open: total.open,
      rows: rows.map((r) => {
        const status = statuses.find((s) => s.value === r.status);
        const ended = ENDED.includes(r.status);
        const start = iso(r.planned_start);
        const end = iso(r.planned_end);
        return {
          id: r.id, ref: r.ref, title: r.title, main: Boolean(r.main), owner_name: r.owner_name ?? null,
          status: r.status, status_label: status?.label ?? r.status, status_color: status?.color ?? 'gray',
          change_type: r.change_type, change_type_label: types.find((t) => t.value === r.change_type)?.label ?? r.change_type,
          risk_level: r.risk_level, outcome: r.outcome ?? null,
          planned_start: start, planned_end: end, actual_start: iso(r.actual_start), actual_end: iso(r.actual_end),
          // Where the change sits in time, for grouping: still to come, under way, or done with.
          when: ended ? 'earlier' : start && Date.parse(start) > now ? 'planned' : r.status === 'in_progress' || (start && end && Date.parse(start) <= now && Date.parse(end) >= now) ? 'now' : 'planned',
        };
      }),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/changes/affecting', tag: 'Changes', permission: 'changes.view',
    summary: 'Changes that affect one system or asset, newest first',
    description: 'A change affects a system or asset when it is its main system or asset, or is linked to it with the relation "affects". Each row carries `when`: `planned`, `now` or `earlier`.',
    query: {
      type: 'system or asset',
      id: 'The system or asset',
      limit: 'How many changes to return (1 to 100, default 20); `total` and `open` count them all',
    },
  });

  app.get('/api/changes/:id/affected', view, async (req) => {
    const change = await base.needChange((req.params as Row).id, req);
    const links = await db.query<{ to_type: string; to_id: string }>(
      `select to_type, to_id from record_links where from_type = 'change' and from_id = $1 and relation = $2 and to_type in ('system', 'asset')`,
      [change.id, AFFECTS]);
    const pick = async (type: 'system' | 'asset', main: string | null) => {
      const ids = [...new Set([...(main ? [main] : []), ...links.filter((l) => l.to_type === type).map((l) => l.to_id)])];
      if (!ctx.resources.get(type)) return [];
      const out: { id: string; label: string; main: boolean }[] = [];
      for (const id of ids) {
        // Only what the caller may see is named.
        if (!(await ctx.resources.find(type, id, req.user))) continue;
        out.push({ id, label: (await ctx.resources.labelFor(type, id)) ?? (type === 'system' ? 'System' : 'Asset'), main: id === main });
      }
      return out;
    };
    return {
      change: { id: change.id, ref: change.ref, title: change.title, status: change.status, planned_start: iso(change.planned_start), planned_end: iso(change.planned_end) },
      systems: await pick('system', change.system_id ?? null),
      assets: await pick('asset', change.asset_id ?? null),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/changes/:id/affected', tag: 'Changes', permission: 'changes.view',
    summary: 'The systems and assets one change affects (main ones marked), for the relationship map',
  });
}
