// Who may see and change a saved report, dashboard, pack or schedule.
//
//   private   the owner only
//   roles     the owner and people holding one of the named roles
//   everyone  everyone with view permission on reports (or dashboards)
//
// Standard items shipped by the seed have no owner: anyone with edit permission may change them.
// Administrators see everything so that an item whose owner has left can be looked after.
// Sharing decides who sees the *definition*; the figures are always worked out with the
// viewer's own permissions, so sharing a report never shares records.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, RowRule, SessionUser } from '../../core/module.ts';

const literal = (value: string) => `'${String(value).replace(/'/g, "''")}'`;

export const SHARED_TABLES: Record<string, { table: string; module: string; path: string; label: string; ownerOnly?: boolean }> = {
  report_definition: { table: 'report_definitions', module: 'reports', path: '/api/reports', label: 'Report' },
  dashboard: { table: 'dashboards', module: 'dashboards', path: '/api/dashboards', label: 'Dashboard' },
  report_pack: { table: 'report_packs', module: 'reports', path: '/api/report-packs', label: 'Report pack' },
  report_schedule: { table: 'report_schedules', module: 'reports', path: '/api/report-schedules', label: 'Schedule', ownerOnly: true },
};

const NIL = '00000000-0000-0000-0000-000000000000';

export function makeSharing(ctx: ModuleContext) {
  const isAdmin = (user: SessionUser | null) => !user || ctx.can(user, 'admin.administer');

  function canSee(user: SessionUser | null, type: string, row: Row): boolean {
    if (isAdmin(user) || row.owner_id === user!.id) return true;
    if (SHARED_TABLES[type].ownerOnly) return false;
    if (row.sharing === 'everyone') return true;
    const roles: unknown[] = Array.isArray(row.shared_roles) ? row.shared_roles : [];
    return row.sharing === 'roles' && roles.some((r) => user!.roles.includes(String(r)));
  }

  function canChange(user: SessionUser | null, type: string, row: Row): boolean {
    if (isAdmin(user) || row.owner_id === user!.id) return true;
    // Standard items belong to nobody: they are looked after by whoever may edit.
    return row.owner_id === null && !SHARED_TABLES[type].ownerOnly && canSee(user, type, row);
  }

  async function visibleIds(user: SessionUser, type: string): Promise<string[]> {
    const t = SHARED_TABLES[type];
    if (isAdmin(user)) return (await ctx.db.query<{ id: string }>(`select id from ${t.table} where deleted_at is null`)).map((r) => r.id);
    const rows = t.ownerOnly
      ? await ctx.db.query<{ id: string }>(`select id from ${t.table} where deleted_at is null and owner_id = $1`, [user.id])
      : await ctx.db.query<{ id: string }>(
        `select id from ${t.table} where deleted_at is null and (owner_id = $1 or sharing = 'everyone'
           or (sharing = 'roles' and exists (select 1 from jsonb_array_elements_text(shared_roles) r where r = any($2::text[]))))`,
        [user.id, user.roles],
      );
    return rows.map((r) => r.id);
  }

  /**
   * The same rule as `canSee`, as the type's row rule (ResourceDef.rowRule): core applies it to
   * every reader whatever the route (the generated routes and their /api/v1 aliases, search, record
   * pickers and labels, history, comments, links, tags, watchers, fact sheets). Figures follow the
   * caller's rule too: these are personal items, not records.
   */
  function rowRule(type: string): RowRule {
    const t = SHARED_TABLES[type];
    return {
      figures: 'filter',
      where: (user, col) => {
        if (isAdmin(user)) return 'true';
        const owner = UUID_RE.test(user.id) ? `${col('owner_id')} = ${literal(user.id)}::uuid` : 'false';
        if (t.ownerOnly) return owner;
        const roles = `array[${user.roles.map(literal).join(', ')}]::text[]`;
        return `(${owner} or ${col('sharing')} = 'everyone' or (${col('sharing')} = 'roles'
          and exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(${col('shared_roles')}) = 'array' then ${col('shared_roles')} else '[]'::jsonb end) sr_(r) where sr_.r = any(${roles}))))`;
      },
    };
  }

  /** The row when it exists and `user` may see it. */
  async function load(user: SessionUser | null, type: string, id: string): Promise<Row | undefined> {
    if (!UUID_RE.test(String(id))) return undefined;
    const row = await ctx.db.one<Row>(`select * from ${SHARED_TABLES[type].table} where id = $1 and deleted_at is null`, [id]);
    return row && canSee(user, type, row) ? row : undefined;
  }

  /**
   * The generated resource routes know nothing of sharing, so this hook narrows them: lists, stats
   * and CSV exports are limited to the ids the caller may see (through the engine's own `f.id`
   * filter, so totals and paging stay right), and single-record routes answer "not found" or "forbidden".
   */
  async function guard(req: FastifyRequest): Promise<void> {
    const url = req.routeOptions?.url;
    if (!url || !req.user) return;
    const hit = Object.entries(SHARED_TABLES).find(([, t]) => url === t.path || url === `${t.path}/stats` || url === `${t.path}/:id`);
    if (!hit) return;
    const [type, t] = hit;
    if (url === `${t.path}/:id`) {
      const row = await load(req.user, type, (req.params as { id: string }).id);
      if (!row) ctx.fail(404, 'not_found', `${t.label} not found.`);
      if (req.method !== 'GET' && !canChange(req.user, type, row!)) {
        ctx.fail(403, 'forbidden', `Only the owner of this ${t.label.toLowerCase()} can change it. Save a copy to make your own.`);
      }
      return;
    }
    if (req.method !== 'GET') return;
    const mine = new Set(await visibleIds(req.user, type));
    const q = req.query as Record<string, string>;
    const asked = typeof q['f.id'] === 'string' ? q['f.id'].split(',').filter((id) => mine.has(id)) : [...mine];
    q['f.id'] = asked.length ? asked.join(',') : NIL;
  }

  /** Normalizes the sharing fields on a create or update and refuses unknown roles. */
  async function cleanSharing(data: Row): Promise<void> {
    if (data.shared_roles !== undefined && data.shared_roles !== null) {
      if (!Array.isArray(data.shared_roles)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { shared_roles: 'Choose roles from the list.' });
      const keys = [...new Set((data.shared_roles as unknown[]).map(String))];
      const known = keys.length ? await ctx.db.query<{ key: string }>('select key from roles where key = any($1::text[])', [keys]) : [];
      if (known.length !== keys.length) ctx.fail(400, 'validation', 'Check the highlighted fields.', { shared_roles: 'One of the roles does not exist.' });
      data.shared_roles = keys;
    }
  }

  return { canSee, canChange, visibleIds, load, guard, cleanSharing, isAdmin, rowRule };
}

export type Sharing = ReturnType<typeof makeSharing>;
