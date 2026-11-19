import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

/**
 * The systems each service depends on, and the read API other modules use to name the vehicles
 * and services a system failure reaches:
 *
 *   if (ctx.app.hasDecorator('fleet')) {
 *     const { vehicles, services } = await ctx.app.fleet.affected([systemId], req.user);
 *   }
 *
 * HTTP: `GET /api/fleet/affected?system_ids=` and `GET /api/systems/:id/services`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AffectedVehicle {
  id: string; fleet_number: string; mode: string | null; mode_label: string | null; status: string | null; status_label: string | null;
  depot_id: string | null; depot_name: string | null; route: string;
  equipment: { asset_id: string; tag: string | null; name: string; system_id: string }[];
}
export interface AffectedService {
  id: string; route_code: string; name: string; mode: string | null; mode_label: string | null; status: string | null; route: string;
  dependencies: { system_id: string; dependency: string | null; dependency_label: string | null }[];
}
export interface FleetApi {
  /** Vehicles carrying equipment of these systems, and services depending on them. Empty when the caller lacks `fleet.view`. */
  affected(systemIds: string[], user: SessionUser | null): Promise<{ vehicles: AffectedVehicle[]; services: AffectedService[] }>;
  /**
   * Every service that is not discontinued and depends on at least one system, with those
   * systems: what the relationship map draws. Empty when the caller lacks `fleet.view`.
   */
  serviceDependencies(user: SessionUser | null): Promise<AffectedService[]>;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the fleet module is loaded: guard with `app.hasDecorator('fleet')`. */
    fleet: FleetApi;
  }
}

export function registerServices(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const serviceFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('service', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Service not found.');
  const needSystems = (req: FastifyRequest) => {
    if (!ctx.resources.get('system')) ctx.fail(409, 'inventory_missing', 'Service dependencies need the inventory module, which is not loaded.');
    if (!ctx.can(req.user, 'systems.view')) ctx.fail(403, 'forbidden', 'You need permission to see systems to work with service dependencies.');
  };
  const label = (list: { value: string; label: string }[], v: unknown) => list.find((x) => x.value === v)?.label ?? (v as string | null) ?? null;

  async function dependenciesOf(serviceId: string): Promise<Row[]> {
    const deps = await ctx.lookups.values('service_dependency');
    const tiers = await ctx.lookups.values('criticality_tier');
    const rows = await db.query<Row>(
      `select l.system_id, l.dependency, l.notes, l.created_at, s.ref, s.name, s.criticality_tier, s.hosting_type
       from service_systems l join systems s on s.id = l.system_id and s.deleted_at is null
       where l.service_id = $1 order by s.name`, [serviceId]);
    return rows.map((r) => ({
      ...r, dependency_label: label(deps, r.dependency),
      criticality_label: label(tiers, r.criticality_tier), criticality_color: tiers.find((t) => t.value === r.criticality_tier)?.color ?? 'gray',
    }));
  }

  app.get('/api/services/:id/systems', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    const service = await serviceFor(req);
    needSystems(req);
    return dependenciesOf(service.id);
  });
  ctx.describeRoute({ method: 'GET', path: '/api/services/:id/systems', summary: 'Systems one service depends on', permission: 'fleet.view' });

  /** Body: { system_id, dependency?, notes? } */
  app.post('/api/services/:id/systems', { preHandler: ctx.requirePerm('fleet.edit') }, async (req, reply) => {
    const service = await serviceFor(req);
    needSystems(req);
    const body = (req.body ?? {}) as Row;
    const systemId = String(body.system_id ?? '');
    if (!UUID.test(systemId)) invalid({ system_id: 'Choose a system.' });
    const system = (await ctx.resources.find('system', systemId, req.user)) ?? invalid({ system_id: 'That system does not exist.' });
    const dependency = typeof body.dependency === 'string' && body.dependency ? body.dependency : null;
    if (dependency && !(await ctx.lookups.values('service_dependency')).some((d) => d.value === dependency)) {
      invalid({ dependency: `"${dependency}" is not a kind of dependency.` });
    }
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const made = await db.one(
      `insert into service_systems (service_id, system_id, dependency, notes, created_by) values ($1,$2,$3,$4,$5)
       on conflict do nothing returning service_id`, [service.id, system.id, dependency, notes, req.user!.id]);
    if (!made) ctx.fail(409, 'duplicate', 'That system is already recorded for this service.');
    await ctx.audit(req, {
      action: 'service.system_add', recordType: 'service', recordId: service.id,
      summary: `Service ${service.route_code} depends on ${system.name}`, after: { system_id: system.id, dependency, notes },
    });
    await ctx.audit(req, {
      action: 'system.service_add', recordType: 'system', recordId: system.id,
      summary: `Service ${service.route_code} ${service.name} depends on this system`, after: { service_id: service.id, dependency },
    });
    reply.code(201);
    return (await dependenciesOf(service.id)).find((r) => r.system_id === system.id);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/services/:id/systems', summary: 'Record that a service depends on a system', permission: 'fleet.edit', body: '{ system_id, dependency?, notes? }' });

  app.delete('/api/services/:id/systems/:systemId', { preHandler: ctx.requirePerm('fleet.edit') }, async (req) => {
    const service = await serviceFor(req);
    needSystems(req);
    const systemId = (req.params as { systemId: string }).systemId;
    const gone = UUID.test(systemId)
      ? await db.one<Row>('delete from service_systems where service_id = $1 and system_id = $2 returning dependency', [service.id, systemId])
      : undefined;
    if (!gone) ctx.fail(404, 'not_found', 'That system is not recorded for this service.');
    const name = await ctx.resources.labelFor('system', systemId);
    await ctx.audit(req, {
      action: 'service.system_remove', recordType: 'service', recordId: service.id,
      summary: `Service ${service.route_code} no longer depends on ${name ?? 'a system'}`, before: { system_id: systemId, dependency: gone!.dependency },
    });
    await ctx.audit(req, {
      action: 'system.service_remove', recordType: 'system', recordId: systemId,
      summary: `Service ${service.route_code} no longer depends on this system`, before: { service_id: service.id },
    });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/services/:id/systems/:systemId', summary: 'Remove a service dependency', permission: 'fleet.edit' });

  // ---------- read API ----------

  async function affected(systemIds: string[], user: SessionUser | null) {
    const ids = [...new Set(systemIds.filter((s) => UUID.test(s)))];
    if (!ids.length || (user && !ctx.can(user, 'fleet.view'))) return { vehicles: [], services: [] };
    const modes = await ctx.lookups.values('vehicle_mode');
    const statuses = await ctx.lookups.values('vehicle_status');
    const deps = await ctx.lookups.values('service_dependency');
    const retired = statuses.filter((s) => s.meta?.retired === true).map((s) => s.value);

    const vehicles = new Map<string, AffectedVehicle>();
    // Equipment needs the inventory module, and naming an asset needs assets.view.
    if (ctx.resources.get('asset') && (!user || ctx.can(user, 'assets.view'))) {
      const rows = await db.query<Row>(
        `select v.id, v.fleet_number, v.mode, v.status, v.depot_id, st.name as depot_name, a.id as asset_id, a.tag, a.name as asset_name, a.system_id
         from vehicle_equipment e
         join vehicles v on v.id = e.vehicle_id and v.deleted_at is null
         join assets a on a.id = e.asset_id and a.deleted_at is null
         left join sites st on st.id = v.depot_id
         where e.removed_on is null and a.system_id = any($1::uuid[]) and not (coalesce(v.status, '') = any($2::text[]))
         order by v.fleet_number, a.tag`, [ids, retired]);
      for (const r of rows) {
        let v = vehicles.get(r.id);
        if (!v) {
          v = {
            id: r.id, fleet_number: r.fleet_number, mode: r.mode, mode_label: label(modes, r.mode), status: r.status, status_label: label(statuses, r.status),
            depot_id: r.depot_id, depot_name: r.depot_name, route: `/vehicles/${r.id}`, equipment: [],
          };
          vehicles.set(r.id, v);
        }
        v.equipment.push({ asset_id: r.asset_id, tag: r.tag, name: r.asset_name, system_id: r.system_id });
      }
    }
    const services = new Map<string, AffectedService>();
    const rows = await db.query<Row>(
      `select s.id, s.route_code, s.name, s.mode, s.status, l.system_id, l.dependency
       from service_systems l join services s on s.id = l.service_id and s.deleted_at is null
       where l.system_id = any($1::uuid[]) and coalesce(s.status, '') <> 'discontinued'
       order by s.route_code`, [ids]);
    for (const r of rows) {
      let s = services.get(r.id);
      if (!s) {
        s = { id: r.id, route_code: r.route_code, name: r.name, mode: r.mode, mode_label: label(modes, r.mode), status: r.status, route: `/services/${r.id}`, dependencies: [] };
        services.set(r.id, s);
      }
      s.dependencies.push({ system_id: r.system_id, dependency: r.dependency, dependency_label: label(deps, r.dependency) });
    }
    return { vehicles: [...vehicles.values()], services: [...services.values()] };
  }

  async function serviceDependencies(user: SessionUser | null): Promise<AffectedService[]> {
    if (user && !ctx.can(user, 'fleet.view')) return [];
    const modes = await ctx.lookups.values('vehicle_mode');
    const deps = await ctx.lookups.values('service_dependency');
    const rows = await db.query<Row>(
      `select s.id, s.route_code, s.name, s.mode, s.status, l.system_id, l.dependency
       from service_systems l join services s on s.id = l.service_id and s.deleted_at is null
       where coalesce(s.status, '') <> 'discontinued'
       order by s.route_code, l.system_id`);
    const out = new Map<string, AffectedService>();
    for (const r of rows) {
      let s = out.get(r.id);
      if (!s) {
        s = { id: r.id, route_code: r.route_code, name: r.name, mode: r.mode, mode_label: label(modes, r.mode), status: r.status, route: `/services/${r.id}`, dependencies: [] };
        out.set(r.id, s);
      }
      s.dependencies.push({ system_id: r.system_id, dependency: r.dependency, dependency_label: label(deps, r.dependency) });
    }
    return [...out.values()];
  }

  if (!app.hasDecorator('fleet')) app.decorate('fleet', { affected, serviceDependencies } satisfies FleetApi);

  app.get('/api/fleet/affected', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const ids = String(q.system_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length || ids.some((s) => !UUID.test(s))) invalid({ system_ids: 'Give one or more system ids, comma-separated.' });
    return affected(ids, req.user);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/fleet/affected', summary: 'Vehicles and services affected when these systems fail (for the incident workspace and other modules)',
    permission: 'fleet.view', query: { system_ids: 'System ids, comma-separated' }, response: '{ vehicles: [...], services: [...] }',
  });

  app.get('/api/systems/:id/services', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    needSystems(req);
    const system = (await ctx.resources.find('system', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'System not found.');
    return (await affected([system.id], req.user)).services;
  });
  ctx.describeRoute({ method: 'GET', path: '/api/systems/:id/services', summary: 'Services that depend on one system', permission: 'fleet.view' });

  /**
   * "What is affected" for one system: the system itself and, with `downstream=true`, every
   * system its data flows to through recorded integrations; then the vehicles that carry their
   * equipment and the services that depend on them.
   */
  app.get('/api/fleet/impact', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    needSystems(req);
    const q = req.query as Record<string, string>;
    const id = String(q.system_id ?? '');
    if (!UUID.test(id)) invalid({ system_id: 'Choose a system.' });
    const system = (await ctx.resources.find('system', id, req.user)) ?? ctx.fail(404, 'not_found', 'System not found.');
    const reached: Row[] = [{ id: system.id, ref: system.ref, name: system.name, depth: 0 }];
    if (q.downstream === 'true') {
      const links = await db.query<Row>('select from_system_id, to_system_id, direction from system_integrations');
      const names = new Map((await db.query<Row>('select id, ref, name from systems where deleted_at is null')).map((s) => [s.id, s]));
      const seen = new Set([system.id]);
      let frontier = [system.id];
      for (let depth = 1; frontier.length; depth++) {
        const next: string[] = [];
        for (const l of links) {
          for (const [a, b] of l.direction === 'two_way' ? [[l.from_system_id, l.to_system_id], [l.to_system_id, l.from_system_id]] : [[l.from_system_id, l.to_system_id]]) {
            if (frontier.includes(a) && !seen.has(b) && names.has(b)) {
              seen.add(b); next.push(b);
              reached.push({ id: b, ref: names.get(b)!.ref, name: names.get(b)!.name, depth });
            }
          }
        }
        frontier = next;
      }
    }
    const result = await affected(reached.map((s) => s.id), req.user);
    return {
      system: { id: system.id, ref: system.ref, name: system.name, hosting_type: system.hosting_type },
      systems: reached.map((s) => ({ ...s, route: `/systems/${s.id}` })),
      ...result,
      counts: { systems: reached.length, vehicles: result.vehicles.length, services: result.services.length },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/fleet/impact', summary: 'Vehicles and services affected if a system fails', permission: 'fleet.view',
    query: { system_id: 'The failing system', downstream: 'true: include systems fed by it' },
  });
}
