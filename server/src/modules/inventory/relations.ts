import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

/**
 * Relationships around systems: integrations, data categories held and sites served,
 * plus the relationship graph and the "what is affected if this fails" impact list.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NodeType = 'system' | 'vendor' | 'site' | 'asset' | 'data_category';
/** `attrs` carries what the map groups and colours by: criticality, hosting and status of a system; sensitivity of a data category. */
export interface GraphNode { id: string; type: NodeType; label: string; group: string; route: string | null; ref?: string | null; attrs?: Record<string, string | null> }
export interface GraphEdge { from: string; to: string; kind: string; label: string; direction?: string }

/** Vendor text that says nobody is named; such systems get no vendor node. */
const NO_VENDOR = /^(not (known|named|stated|confirmed|applicable)|unknown|none|n\/?a|internal|in[- ]house|tbc|tbd|-+)$/i;

export function registerRelations(ctx: ModuleContext) {
  const { app, db } = ctx;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  async function systemFor(req: FastifyRequest): Promise<Row> {
    const id = (req.params as { id: string }).id;
    return (await ctx.resources.find('system', id, req.user)) ?? ctx.fail(404, 'not_found', 'System not found.');
  }
  const needUuid = (v: unknown, field: string, label: string): string => {
    if (typeof v !== 'string' || !UUID.test(v)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: `${label} is required.` });
    return v as string;
  };
  const lookupLabel = async (list: string, value: string | null) =>
    value === null ? null : (await ctx.lookups.values(list)).find((x) => x.value === value)?.label ?? value;

  // ---------- integrations ----------

  async function integrationsOf(systemId: string): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select i.*, f.name as from_name, f.ref as from_ref, t.name as to_name, t.ref as to_ref
       from system_integrations i
       join systems f on f.id = i.from_system_id and f.deleted_at is null
       join systems t on t.id = i.to_system_id and t.deleted_at is null
       where i.from_system_id = $1 or i.to_system_id = $1
       order by i.created_at`,
      [systemId],
    );
    const methods = await ctx.lookups.values('integration_method');
    return rows.map((r) => {
      const outgoing = r.from_system_id === systemId;
      return {
        ...r,
        other_system_id: outgoing ? r.to_system_id : r.from_system_id,
        other_name: outgoing ? r.to_name : r.from_name,
        other_ref: outgoing ? r.to_ref : r.from_ref,
        // How data moves as seen from this system.
        flow: r.direction === 'two_way' ? 'both' : outgoing ? 'out' : 'in',
        method_label: methods.find((m) => m.value === r.method)?.label ?? r.method,
      };
    });
  }

  app.get('/api/systems/:id/integrations', { preHandler: ctx.requirePerm('systems.view') }, async (req) =>
    integrationsOf((await systemFor(req)).id));

  /**
   * Body: { to_system_id, direction, method, notes }. `direction` is one_way (this system
   * sends to the other), inbound (the other sends to this one) or two_way.
   */
  app.post('/api/systems/:id/integrations', { preHandler: ctx.requirePerm('systems.edit') }, async (req, reply) => {
    const system = await systemFor(req);
    const body = (req.body ?? {}) as Row;
    const otherId = needUuid(body.to_system_id ?? body.other_system_id, 'to_system_id', 'The other system');
    if (otherId === system.id) ctx.fail(400, 'validation', 'Check the highlighted fields.', { to_system_id: 'A system cannot integrate with itself.' });
    const other = (await ctx.resources.find('system', otherId, req.user))
      ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { to_system_id: 'That system does not exist.' });

    const asked = text(body.direction) ?? 'one_way';
    const allowed = (await ctx.lookups.values('integration_direction')).map((d) => d.value);
    const inbound = asked === 'inbound';
    const direction = inbound ? 'one_way' : asked;
    if (!allowed.includes(direction)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { direction: `"${asked}" is not an allowed direction.` });
    const method = text(body.method);
    if (method && !(await ctx.lookups.values('integration_method')).some((m) => m.value === method)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { method: `"${method}" is not an allowed method.` });
    }
    const [fromId, toId] = inbound ? [other.id, system.id] : [system.id, other.id];
    const dup = await db.one(
      `select 1 from system_integrations
       where ((from_system_id = $1 and to_system_id = $2) or (direction = 'two_way' and from_system_id = $2 and to_system_id = $1))
         and coalesce(method, '') = coalesce($3, '')`,
      [fromId, toId, method],
    );
    if (dup) ctx.fail(409, 'duplicate', 'That integration is already recorded.');

    const row = (await db.one<Row>(
      `insert into system_integrations (from_system_id, to_system_id, direction, method, notes, created_by)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [fromId, toId, direction, method, text(body.notes), req.user!.id],
    ))!;
    const arrow = direction === 'two_way' ? 'both ways with' : inbound ? 'from' : 'to';
    for (const [id, name] of [[system.id, other.name], [other.id, system.name]] as const) {
      await ctx.audit(req, {
        action: 'system.integration_add', recordType: 'system', recordId: id,
        summary: `Integration added: ${system.name} ${arrow} ${other.name}` + (id === system.id ? '' : ` (recorded on ${system.name})`),
        after: { integration_id: row.id, from_system_id: fromId, to_system_id: toId, direction, method, other: name },
      });
    }
    reply.code(201);
    return (await integrationsOf(system.id)).find((r) => r.id === row.id);
  });

  app.delete('/api/systems/:id/integrations/:integrationId', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const system = await systemFor(req);
    const integrationId = (req.params as { integrationId: string }).integrationId;
    const row = UUID.test(integrationId)
      ? await db.one<Row>('select * from system_integrations where id = $1 and (from_system_id = $2 or to_system_id = $2)', [integrationId, system.id])
      : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Integration not found.');
    await db.query('delete from system_integrations where id = $1', [row.id]);
    for (const id of [row.from_system_id, row.to_system_id]) {
      await ctx.audit(req, {
        action: 'system.integration_remove', recordType: 'system', recordId: id,
        summary: 'Integration removed',
        before: { integration_id: row.id, from_system_id: row.from_system_id, to_system_id: row.to_system_id, direction: row.direction, method: row.method, notes: row.notes },
      });
    }
    return { ok: true };
  });

  // ---------- data categories held ----------

  app.get('/api/systems/:id/data-categories', { preHandler: ctx.requirePerm('systems.view') }, async (req) => {
    const system = await systemFor(req);
    if (!ctx.can(req.user, 'data.view')) ctx.fail(403, 'forbidden', 'You do not have permission to see data categories.');
    const rows = await db.query<Row>(
      `select d.id, d.name, d.sensitivity_level, d.custodian, d.retention_period, l.created_at as linked_at
       from system_data_categories l join data_categories d on d.id = l.data_category_id and d.deleted_at is null
       where l.system_id = $1 order by d.name`,
      [system.id],
    );
    const levels = await ctx.lookups.values('sensitivity_level');
    return rows.map((r) => ({
      ...r,
      sensitivity_label: levels.find((x) => x.value === r.sensitivity_level)?.label ?? null,
      sensitivity_color: levels.find((x) => x.value === r.sensitivity_level)?.color ?? 'gray',
    }));
  });

  app.post('/api/systems/:id/data-categories', { preHandler: ctx.requirePerm('systems.edit') }, async (req, reply) => {
    const system = await systemFor(req);
    if (!ctx.can(req.user, 'data.view')) ctx.fail(403, 'forbidden', 'You do not have permission to see data categories.');
    const categoryId = needUuid((req.body as Row | undefined)?.data_category_id, 'data_category_id', 'Data category');
    const category = (await ctx.resources.find('data_category', categoryId, req.user))
      ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { data_category_id: 'That data category does not exist.' });
    const made = await db.one(
      `insert into system_data_categories (system_id, data_category_id, created_by) values ($1,$2,$3)
       on conflict do nothing returning system_id`,
      [system.id, category.id, req.user!.id],
    );
    if (!made) ctx.fail(409, 'duplicate', 'That data category is already recorded for this system.');
    await ctx.audit(req, {
      action: 'system.data_category_add', recordType: 'system', recordId: system.id,
      summary: `Data category added to ${system.name}: ${category.name}`, after: { data_category_id: category.id },
    });
    await ctx.audit(req, {
      action: 'data_category.system_add', recordType: 'data_category', recordId: category.id,
      summary: `Recorded as held in ${system.name}`, after: { system_id: system.id },
    });
    reply.code(201);
    return { system_id: system.id, data_category_id: category.id, name: category.name };
  });

  app.delete('/api/systems/:id/data-categories/:categoryId', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const system = await systemFor(req);
    const categoryId = (req.params as { categoryId: string }).categoryId;
    const gone = UUID.test(categoryId)
      ? await db.one('delete from system_data_categories where system_id = $1 and data_category_id = $2 returning system_id', [system.id, categoryId])
      : undefined;
    if (!gone) ctx.fail(404, 'not_found', 'That data category is not recorded for this system.');
    const name = await ctx.resources.labelFor('data_category', categoryId);
    await ctx.audit(req, {
      action: 'system.data_category_remove', recordType: 'system', recordId: system.id,
      summary: `Data category removed from ${system.name}: ${name ?? categoryId}`, before: { data_category_id: categoryId },
    });
    await ctx.audit(req, {
      action: 'data_category.system_remove', recordType: 'data_category', recordId: categoryId,
      summary: `No longer recorded as held in ${system.name}`, before: { system_id: system.id },
    });
    return { ok: true };
  });

  /** Systems that hold one data category. */
  app.get('/api/data-categories/:id/systems', { preHandler: ctx.requirePerm('data.view') }, async (req) => {
    const id = (req.params as { id: string }).id;
    const category = (await ctx.resources.find('data_category', id, req.user)) ?? ctx.fail(404, 'not_found', 'Data category not found.');
    if (!ctx.can(req.user, 'systems.view')) return [];
    const rows = await db.query<Row>(
      `select s.id, s.ref, s.name, s.system_group, s.vendor_name, s.mfa_status, s.hosting_type
       from system_data_categories l join systems s on s.id = l.system_id and s.deleted_at is null
       where l.data_category_id = $1 order by s.name`,
      [category.id],
    );
    for (const r of rows) r.mfa_label = await lookupLabel('mfa_status', r.mfa_status);
    return rows;
  });

  // ---------- sites served ----------

  app.get('/api/systems/:id/sites', { preHandler: ctx.requirePerm('systems.view') }, async (req) => {
    const system = await systemFor(req);
    if (!ctx.can(req.user, 'sites.view')) ctx.fail(403, 'forbidden', 'You do not have permission to see sites.');
    return db.query(
      `select s.id, s.name, s.address, s.function from system_sites l
       join sites s on s.id = l.site_id and s.deleted_at is null where l.system_id = $1 order by s.name`,
      [system.id],
    );
  });

  app.post('/api/systems/:id/sites', { preHandler: ctx.requirePerm('systems.edit') }, async (req, reply) => {
    const system = await systemFor(req);
    if (!ctx.can(req.user, 'sites.view')) ctx.fail(403, 'forbidden', 'You do not have permission to see sites.');
    const siteId = needUuid((req.body as Row | undefined)?.site_id, 'site_id', 'Site');
    const site = (await ctx.resources.find('site', siteId, req.user))
      ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { site_id: 'That site does not exist.' });
    const made = await db.one(
      'insert into system_sites (system_id, site_id, created_by) values ($1,$2,$3) on conflict do nothing returning system_id',
      [system.id, site.id, req.user!.id],
    );
    if (!made) ctx.fail(409, 'duplicate', 'That site is already recorded for this system.');
    await ctx.audit(req, {
      action: 'system.site_add', recordType: 'system', recordId: system.id,
      summary: `Site served added to ${system.name}: ${site.name}`, after: { site_id: site.id },
    });
    reply.code(201);
    return { system_id: system.id, site_id: site.id, name: site.name };
  });

  app.delete('/api/systems/:id/sites/:siteId', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const system = await systemFor(req);
    const siteId = (req.params as { siteId: string }).siteId;
    const gone = UUID.test(siteId)
      ? await db.one('delete from system_sites where system_id = $1 and site_id = $2 returning system_id', [system.id, siteId])
      : undefined;
    if (!gone) ctx.fail(404, 'not_found', 'That site is not recorded for this system.');
    const name = await ctx.resources.labelFor('site', siteId);
    await ctx.audit(req, {
      action: 'system.site_remove', recordType: 'system', recordId: system.id,
      summary: `Site served removed from ${system.name}: ${name ?? siteId}`, before: { site_id: siteId },
    });
    return { ok: true };
  });

  /** Systems that serve one site. */
  app.get('/api/sites/:id/systems', { preHandler: ctx.requirePerm('sites.view') }, async (req) => {
    const id = (req.params as { id: string }).id;
    const site = (await ctx.resources.find('site', id, req.user)) ?? ctx.fail(404, 'not_found', 'Site not found.');
    if (!ctx.can(req.user, 'systems.view')) return [];
    return db.query(
      `select s.id, s.ref, s.name, s.system_group, s.vendor_name, s.criticality_tier from system_sites l
       join systems s on s.id = l.system_id and s.deleted_at is null where l.site_id = $1 order by s.name`,
      [site.id],
    );
  });

  // ---------- relationship graph ----------

  async function buildGraph(user: SessionUser | null): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const systems = await db.query<Row>(
      'select id, ref, name, system_group, vendor_name, vendor_id, criticality_tier, hosting_type, status from systems where deleted_at is null order by name',
    );
    for (const s of systems) {
      nodes.set(s.id, { id: s.id, type: 'system', label: s.name, group: s.system_group || 'Ungrouped', route: `/systems/${s.id}`, ref: s.ref,
        attrs: { criticality: s.criticality_tier ?? null, hosting: s.hosting_type ?? null, status: s.status ?? null },
      });
    }

    // Vendors: one node per vendor record when linked, otherwise one per distinct recorded name.
    const vendorDef = ctx.resources.get('vendor');
    const vendorRoute = vendorDef && ctx.can(user, 'vendors.view') ? vendorDef.route : null;
    for (const s of systems) {
      const name = String(s.vendor_name ?? '').trim();
      let key: string | null = null;
      if (s.vendor_id) {
        key = s.vendor_id;
        if (!nodes.has(key!)) {
          // The vendor record's own name needs vendors.view; otherwise the name recorded on the system is shown.
          const label = (vendorRoute ? await ctx.resources.labelFor('vendor', s.vendor_id) : null) ?? (name || 'Vendor');
          nodes.set(key!, { id: key!, type: 'vendor', label, group: 'Vendors', route: vendorRoute ? `${vendorRoute}/${s.vendor_id}` : null });
        }
      } else if (name && !NO_VENDOR.test(name)) {
        key = `vendor:${name.toLowerCase()}`;
        if (!nodes.has(key)) nodes.set(key, { id: key, type: 'vendor', label: name, group: 'Vendors', route: null });
      }
      if (key) edges.push({ from: s.id, to: key, kind: 'vendor', label: 'supplied by' });
    }

    const methods = await ctx.lookups.values('integration_method');
    const integrations = await db.query<Row>('select * from system_integrations order by created_at');
    for (const i of integrations) {
      if (!nodes.has(i.from_system_id) || !nodes.has(i.to_system_id)) continue;
      edges.push({
        from: i.from_system_id, to: i.to_system_id, kind: 'integration', direction: i.direction,
        label: methods.find((m) => m.value === i.method)?.label ?? i.method ?? 'Integration',
      });
    }

    if (ctx.can(user, 'sites.view')) {
      const rows = await db.query<Row>(
        `select l.system_id, s.id, s.name from system_sites l join sites s on s.id = l.site_id and s.deleted_at is null`,
      );
      for (const r of rows) {
        if (!nodes.has(r.system_id)) continue;
        if (!nodes.has(r.id)) nodes.set(r.id, { id: r.id, type: 'site', label: r.name, group: 'Sites', route: `/sites/${r.id}` });
        edges.push({ from: r.system_id, to: r.id, kind: 'site', label: 'serves' });
      }
    }
    if (ctx.can(user, 'data.view')) {
      const rows = await db.query<Row>(
        `select l.system_id, d.id, d.name, d.sensitivity_level from system_data_categories l
         join data_categories d on d.id = l.data_category_id and d.deleted_at is null`,
      );
      for (const r of rows) {
        if (!nodes.has(r.system_id)) continue;
        if (!nodes.has(r.id)) nodes.set(r.id, { id: r.id, type: 'data_category', label: r.name, group: 'Data categories', route: `/data-categories/${r.id}`, attrs: { sensitivity: r.sensitivity_level ?? null } });
        edges.push({ from: r.system_id, to: r.id, kind: 'data', label: 'holds' });
      }
    }
    if (ctx.can(user, 'assets.view')) {
      // Only assets linked to a system appear, so the map stays readable with thousands of assets.
      const rows = await db.query<Row>(
        `select id, tag, name, system_id, site_id from assets
         where deleted_at is null and system_id is not null and coalesce(status, '') <> 'disposed' order by tag`,
      );
      for (const r of rows) {
        if (!nodes.has(r.system_id)) continue;
        nodes.set(r.id, { id: r.id, type: 'asset', label: r.name, group: 'Assets', route: `/assets/${r.id}`, ref: r.tag });
        edges.push({ from: r.system_id, to: r.id, kind: 'asset', label: 'runs on' });
        if (r.site_id && nodes.get(r.site_id)?.type === 'site') edges.push({ from: r.id, to: r.site_id, kind: 'location', label: 'located at' });
      }
    }
    return { nodes: [...nodes.values()], edges };
  }

  /** `focus=<system id>` narrows the graph to that system's neighbourhood (`depth` hops, default 1). */
  app.get('/api/systems/graph', { preHandler: ctx.requirePerm('systems.view') }, async (req) => {
    const query = req.query as Record<string, string>;
    const graph = await buildGraph(req.user);
    if (!query.focus) return graph;
    if (!graph.nodes.some((n) => n.id === query.focus && n.type === 'system')) ctx.fail(404, 'not_found', 'System not found.');
    const depth = Math.min(4, Math.max(1, Number(query.depth) || 1));
    const keep = new Set<string>([query.focus]);
    let frontier = [query.focus];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: string[] = [];
      for (const e of graph.edges) {
        for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
          if (frontier.includes(a) && !keep.has(b)) { keep.add(b); next.push(b); }
        }
      }
      frontier = next;
    }
    return {
      focus: query.focus,
      nodes: graph.nodes.filter((n) => keep.has(n.id)),
      edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  });

  // ---------- impact ----------

  /**
   * What is affected if this system fails: every system downstream of it through
   * integrations (data flows from -> to; both ways for two-way links), then the sites,
   * data categories and assets of the failing system and of those downstream systems.
   */
  app.get('/api/systems/:id/impact', { preHandler: ctx.requirePerm('systems.view') }, async (req) => {
    const system = await systemFor(req);
    const all = await db.query<Row>('select id, ref, name, system_group, criticality_tier from systems where deleted_at is null');
    const byId = new Map(all.map((s) => [s.id, s]));
    const integrations = await db.query<Row>('select from_system_id, to_system_id, direction, method from system_integrations');
    const methods = await ctx.lookups.values('integration_method');
    const tiers = await ctx.lookups.values('criticality_tier');
    const feeds = new Map<string, { to: string; method: string | null }[]>();
    const addFeed = (from: string, to: string, method: string | null) => {
      if (!feeds.has(from)) feeds.set(from, []);
      feeds.get(from)!.push({ to, method });
    };
    for (const i of integrations) {
      addFeed(i.from_system_id, i.to_system_id, i.method);
      if (i.direction === 'two_way') addFeed(i.to_system_id, i.from_system_id, i.method);
    }

    const downstream: Row[] = [];
    const seen = new Set<string>([system.id]);
    let frontier = [system.id];
    for (let depth = 1; frontier.length; depth++) {
      const next: string[] = [];
      for (const from of frontier) {
        for (const { to, method } of feeds.get(from) ?? []) {
          const target = byId.get(to);
          if (seen.has(to) || !target) continue;
          seen.add(to);
          next.push(to);
          downstream.push({
            id: to, ref: target.ref, label: target.name, group: target.system_group, route: `/systems/${to}`, depth,
            via: { id: from, label: byId.get(from)?.name ?? '' },
            method: methods.find((m) => m.value === method)?.label ?? method,
            criticality_tier: target.criticality_tier,
            criticality_label: tiers.find((t) => t.value === target.criticality_tier)?.label ?? null,
          });
        }
      }
      frontier = next;
    }

    const ids = [...seen];
    const via = (systemId: string) => ({ id: systemId, label: byId.get(systemId)?.name ?? system.name, direct: systemId === system.id });
    // One entry per record: the failing system first, then the nearest downstream system.
    const order = new Map(ids.map((id, i) => [id, i]));
    const firstPer = (rows: Row[]) => {
      const out = new Map<string, Row>();
      for (const r of rows.sort((a, b) => order.get(a.system_id)! - order.get(b.system_id)!)) if (!out.has(r.id)) out.set(r.id, r);
      return [...out.values()];
    };

    const sites = ctx.can(req.user, 'sites.view')
      ? firstPer(await db.query<Row>(
          `select l.system_id, s.id, s.name from system_sites l join sites s on s.id = l.site_id and s.deleted_at is null
           where l.system_id = any($1::uuid[]) order by s.name`, [ids],
        )).map((r) => ({ id: r.id, label: r.name, route: `/sites/${r.id}`, via: via(r.system_id) }))
      : [];
    const levels = await ctx.lookups.values('sensitivity_level');
    const dataCategories = ctx.can(req.user, 'data.view')
      ? firstPer(await db.query<Row>(
          `select l.system_id, d.id, d.name, d.sensitivity_level from system_data_categories l
           join data_categories d on d.id = l.data_category_id and d.deleted_at is null
           where l.system_id = any($1::uuid[]) order by d.name`, [ids],
        )).map((r) => ({
          id: r.id, label: r.name, route: `/data-categories/${r.id}`, via: via(r.system_id),
          sensitivity_level: r.sensitivity_level,
          sensitivity_label: levels.find((x) => x.value === r.sensitivity_level)?.label ?? null,
        }))
      : [];
    const assets = ctx.can(req.user, 'assets.view')
      ? (await db.query<Row>(
          `select id, tag, name, system_id, status from assets
           where deleted_at is null and system_id = any($1::uuid[]) and coalesce(status, '') not in ('retired', 'disposed')
           order by tag`, [ids],
        )).map((r) => ({ id: r.id, ref: r.tag, label: r.name, route: `/assets/${r.id}`, via: via(r.system_id) }))
      : [];

    return {
      system: { id: system.id, ref: system.ref, label: system.name },
      downstream,
      sites,
      data_categories: dataCategories,
      assets,
      counts: { systems: downstream.length, sites: sites.length, data_categories: dataCategories.length, assets: assets.length },
    };
  });
}
