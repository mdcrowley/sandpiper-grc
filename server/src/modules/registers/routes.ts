// The records of every register (E41-06), served through routes with the register as a parameter:
// routes cannot be added once the server listens, and a register can be defined at any time. Each
// route hands the request to the resource engine's own handler for the register's record type
// (core/resource.ts), so lists, filters, exports, figures, validation, lifecycles, audit and
// If-Match behave exactly as on a built-in type.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveRecordRoutes, type RecordRouteKind } from '../../core/api/conventions.ts';
import { fail } from '../../core/errors.ts';
import { SWITCHED_OFF } from '../../core/features.ts';
import { holdsOn } from '../../core/holds.ts';
import type { ModuleContext, RecordRouteHandlers, ResourceDef, Row } from '../../core/module.ts';
import { typeOf, type Registers } from './definitions.ts';

export function registerRecordRoutes(ctx: ModuleContext, regs: Registers) {
  const { app } = ctx;

  /** The register's record type, if it is in the running application and switched on. */
  function lookup(req: FastifyRequest): { def: ResourceDef; h: RecordRouteHandlers } | null {
    const key = String((req.params as Row).register ?? '');
    const def = ctx.resources.get(typeOf(key)); // undefined while its area is switched off
    const h = def && def.partition?.value === key ? app.runtimeResources.handlers(def.type) : undefined;
    return def && h ? { def, h } : null;
  }

  async function need(req: FastifyRequest) {
    await regs.sync();
    const found = lookup(req);
    if (found) return found;
    const key = String((req.params as Row).register ?? '');
    // A register that exists but is switched off answers like every switched-off area.
    if (regs.active.has(key)) fail(404, 'switched_off', SWITCHED_OFF);
    return fail(404, 'not_found', 'Register not found.');
  }

  // ETags, If-Match and Idempotency-Key as on the generated routes (core/api/conventions.ts).
  const KINDS: Record<string, RecordRouteKind> = {
    'GET /api/registers/:register': 'list', 'POST /api/registers/:register': 'create',
    'GET /api/registers/:register/:id': 'get', 'PATCH /api/registers/:register/:id': 'update', 'DELETE /api/registers/:register/:id': 'delete',
  };
  resolveRecordRoutes(app, (req) => {
    const kind = KINDS[`${req.method} ${(req.routeOptions?.url ?? '').replace(/^\/api\/v1\//, '/api/')}`];
    if (!kind) return undefined;
    const found = lookup(req);
    return found ? { def: found.def, kind } : undefined;
  });

  const describe = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, summary: string, action: string, extra: Record<string, unknown> = {}) =>
    ctx.describeRoute({
      method, path, tag: 'Registers', summary,
      description: `Needs \`<register>.${action}\`, where <register> is the register's name (its permission module). Behaves exactly like the generated route of a built-in record type: see the record type \`reg_<register>\` in this document for its fields.`,
      ...extra,
    });

  app.get('/api/registers/:register', async (req: FastifyRequest, reply: FastifyReply) => (await need(req)).h.list(req, reply));
  describe('GET', '/api/registers/:register', 'List the records of one register (filters, search, sorting, paging and exports as on every list)', 'view', {
    query: { q: 'Search text', sort: 'Field to sort by', dir: 'asc or desc', page: 'Page number', pageSize: 'Rows per page (at most 500)', format: 'csv, xlsx or pdf to export (needs <register>.export)' },
    response: '{ rows, total, page, pageSize }',
  });

  app.get('/api/registers/:register/stats', async (req: FastifyRequest, reply: FastifyReply) => (await need(req)).h.stats(req, reply));
  describe('GET', '/api/registers/:register/stats', 'Count the records of one register by a field (the same figures for everyone)', 'view', {
    query: { group: 'Field to group by' }, response: '{ groups: [{ value, label, color, count }], total }',
  });

  app.get('/api/registers/:register/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { def, h } = await need(req);
    const row = (await h.get(req, reply)) as Row;
    // Legal holds on the record, as the holds module adds them to built-in record pages.
    if (row?.id && req.user && ctx.can(req.user, 'legal.view')) {
      const holds = await holdsOn(ctx.db, def.type, String(row.id));
      if (holds.length) return { ...row, _holds: holds.map((x) => ({ id: x.holdId, ref: x.ref })) };
    }
    return row;
  });
  describe('GET', '/api/registers/:register/:id', 'One record of a register', 'view', { response: 'The record, with `_display` labels' });

  app.post('/api/registers/:register', async (req: FastifyRequest, reply: FastifyReply) => (await need(req)).h.create(req, reply));
  describe('POST', '/api/registers/:register', 'Add a record to a register', 'create', { body: 'The record\'s fields, custom fields as cf_<key>', response: 'The record' });

  app.patch('/api/registers/:register/:id', async (req: FastifyRequest, reply: FastifyReply) => (await need(req)).h.update(req, reply));
  describe('PATCH', '/api/registers/:register/:id', 'Change a record of a register (If-Match accepted)', 'edit', { body: 'The fields to change', response: 'The record' });

  app.delete('/api/registers/:register/:id', async (req: FastifyRequest, reply: FastifyReply) => (await need(req)).h.remove(req, reply));
  describe('DELETE', '/api/registers/:register/:id', 'Delete a record of a register (refused while it is under a legal hold)', 'delete', { response: '{ ok: true }' });

  // The registers this person may open, for the menu and the Create menu.
  app.get('/api/registers', async (req) => {
    await regs.sync();
    const out: Row[] = [];
    for (const [key, r] of [...regs.rows.entries()].sort(([, a], [, b]) => a.plural.localeCompare(b.plural))) {
      const def = ctx.resources.get(typeOf(key));
      if (!def || regs.state.get(key) !== 'ready' || !ctx.can(req.user, `${key}.view`)) continue;
      out.push({
        key, type: def.type, label: r.label, plural: r.plural, description: r.description, navGroup: r.nav_group, icon: r.icon,
        route: def.route, canCreate: ctx.can(req.user, `${key}.create`),
      });
    }
    return out;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/registers', tag: 'Registers',
    summary: 'The registers the caller may open (switched-off registers left out)',
    response: '[{ key, type, label, plural, description, navGroup, icon, route, canCreate }]',
  });
}
