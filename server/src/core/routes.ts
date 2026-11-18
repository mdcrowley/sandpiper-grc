import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { ResourceDef, Row } from './module.ts';
import type { makeResources } from './resource.ts';
import { requirePerm, type makeAudit, type makeLookups } from './services.ts';

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  lookups: ReturnType<typeof makeLookups>;
  res: ReturnType<typeof makeResources>;
}

/** Cross-cutting routes: metadata, search, pickers, comments, links, history, audit, lookups. */
export function registerCoreRoutes({ app, db, audit, lookups, res }: Deps) {
  const { registry, labelsFor, mayAccess, visibilitySql } = res;

  /** The record, if the caller may see it; otherwise a 404 that does not reveal whether it exists. */
  async function visibleRecord(req: FastifyRequest, type: string, id: string, action = 'view'): Promise<{ def: ResourceDef; row: Row }> {
    const def = registry.get(type);
    if (!def || !mayAccess(req.user, def, action)) fail(404, 'not_found', 'Record not found.');
    const row = await registry.find(type, id, req.user);
    if (!row) fail(404, 'not_found', 'Record not found.');
    return { def: def!, row: row! };
  }

  app.get('/api/meta', async (req) => {
    const resources: Record<string, unknown> = {};
    for (const d of registry.all()) {
      if (!mayAccess(req.user, d, 'view')) continue;
      resources[d.type] = {
        type: d.type, label: d.label, plural: d.plural, module: d.module, path: d.path, route: d.route,
        titleField: d.titleField, refField: d.ref?.field, restricted: d.restricted ?? false, fields: d.fields,
      };
    }
    return { resources, lookups: await lookups.all() };
  });

  app.get('/api/records/lookup', async (req) => {
    const { type, q = '' } = req.query as Record<string, string>;
    const def = registry.get(type);
    if (!def || !mayAccess(req.user, def, 'view')) return [];
    const cols = [def.titleField, ...(def.ref ? [def.ref.field] : [])];
    return db.query(
      `select id, ${def.titleField}::text as label, ${def.ref ? def.ref.field : 'null'} as ref from ${def.table}
       where deleted_at is null and ${visibilitySql(def, req.user)} and (${cols.map((c) => `${c}::text ilike $1`).join(' or ')})
       order by ${def.titleField} limit 25`,
      [`%${q.trim()}%`],
    );
  });

  app.get('/api/search', async (req) => {
    const q = String((req.query as any).q ?? '').trim();
    if (q.length < 2) return [];
    const out: unknown[] = [];
    for (const def of registry.all()) {
      if (!mayAccess(req.user, def, 'view')) continue;
      const cols = [...(def.searchable ?? [def.titleField]), ...(def.ref ? [def.ref.field] : [])];
      const rows = await db.query<Row>(
        `select id, ${def.titleField}::text as label, ${def.ref ? def.ref.field : 'null'} as ref from ${def.table}
         where deleted_at is null and ${visibilitySql(def, req.user)} and (${cols.map((c) => `${c}::text ilike $1`).join(' or ')})
         order by updated_at desc limit 6`,
        [`%${q}%`],
      );
      for (const r of rows) out.push({ type: def.type, typeLabel: def.label, id: r.id, label: r.label, ref: r.ref, route: def.route });
    }
    return out;
  });

  // ---------- comments ----------

  app.get('/api/comments', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    return db.query(
      'select id, body, internal, author_id, author_name, created_at from comments where record_type = $1 and record_id = $2 order by created_at',
      [record_type, record_id],
    );
  });

  app.post('/api/comments', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const body = String(b.body ?? '').trim();
    if (!body) fail(400, 'validation', 'Check the highlighted fields.', { body: 'Write a comment first.' });
    const { def } = await visibleRecord(req, b.record_type, b.record_id);
    const row = await db.one<Row>(
      `insert into comments (record_type, record_id, body, internal, author_id, author_name)
       values ($1,$2,$3,$4,$5,$6) returning id, body, internal, author_id, author_name, created_at`,
      [b.record_type, b.record_id, body, b.internal !== false, req.user!.id, req.user!.displayName],
    );
    await audit(req, {
      action: 'comment.add', recordType: b.record_type, recordId: b.record_id,
      summary: `${b.internal !== false ? 'Internal' : 'Public'} comment added to ${def.label.toLowerCase()}`,
    });
    reply.code(201);
    return row;
  });

  // ---------- links ----------

  app.get('/api/links', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    const rows = await db.query<Row>(
      `select id, relation, 'out' as direction, to_type as type, to_id as record_id from record_links where from_type = $1 and from_id = $2
       union all
       select id, relation, 'in' as direction, from_type as type, from_id as record_id from record_links where to_type = $1 and to_id = $2`,
      [record_type, record_id],
    );
    const out: unknown[] = [];
    for (const type of new Set(rows.map((r) => r.type))) {
      const def = registry.get(type);
      if (!def || !mayAccess(req.user, def, 'view')) continue;
      const labels = await labelsFor(type, rows.filter((r) => r.type === type).map((r) => r.record_id), req.user);
      for (const r of rows.filter((x) => x.type === type)) {
        const l = labels.get(r.record_id);
        if (!l || l.hidden) continue;
        out.push({
          id: r.id, relation: r.relation, direction: r.direction, type, typeLabel: def.label,
          recordId: r.record_id, label: l.label, ref: l.ref, route: def.route,
        });
      }
    }
    return out;
  });

  app.post('/api/links', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    await visibleRecord(req, b.from_type, b.from_id, 'edit');
    await visibleRecord(req, b.to_type, b.to_id);
    if (b.from_type === b.to_type && b.from_id === b.to_id) fail(400, 'validation', 'A record cannot be linked to itself.');
    const relation = String(b.relation ?? 'related').trim().slice(0, 60) || 'related';
    const row = await db.one<Row>(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (from_type, from_id, to_type, to_id, relation) do update set relation = excluded.relation returning *`,
      [b.from_type, b.from_id, b.to_type, b.to_id, relation, req.user!.id],
    );
    await audit(req, {
      action: 'link.add', recordType: b.from_type, recordId: b.from_id,
      summary: `Linked to ${b.to_type} (${relation})`, after: { to_type: b.to_type, to_id: b.to_id, relation },
    });
    reply.code(201);
    return row;
  });

  app.delete('/api/links/:id', async (req) => {
    const id = (req.params as any).id;
    const link = UUID_RE.test(id) ? await db.one<Row>('select * from record_links where id = $1', [id]) : undefined;
    if (!link) fail(404, 'not_found', 'Link not found.');
    await visibleRecord(req, link!.from_type, link!.from_id, 'edit');
    await db.query('delete from record_links where id = $1', [id]);
    await audit(req, {
      action: 'link.remove', recordType: link!.from_type, recordId: link!.from_id,
      summary: `Link to ${link!.to_type} removed`, before: { to_type: link!.to_type, to_id: link!.to_id, relation: link!.relation },
    });
    return { ok: true };
  });

  // ---------- history and audit ----------

  app.get('/api/history', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    return db.query(
      `select id, at, actor_name, action, summary, before, after from audit_events
       where record_type = $1 and record_id = $2 order by at desc, id desc limit 500`,
      [record_type, record_id],
    );
  });

  app.get('/api/audit', { preHandler: requirePerm('audit.view') }, async (req, reply) => {
    const query = req.query as Record<string, string>;
    const where: string[] = ['true'];
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (query.q) where.push(`(summary ilike ${add(`%${query.q}%`)} or actor_name ilike $${params.length} or action ilike $${params.length})`);
    if (query.action) where.push(`action = ${add(query.action)}`);
    if (query.record_type) where.push(`record_type = ${add(query.record_type)}`);
    if (query.record_id) where.push(`record_id = ${add(query.record_id)}`);
    if (query.actor_id) where.push(`actor_id::text = ${add(query.actor_id)}`);
    if (query.from) where.push(`at >= ${add(query.from)}::timestamptz`);
    if (query.to) where.push(`at <= ${add(query.to)}::timestamptz`);
    // Events about restricted record types stay hidden without security.view.
    const hiddenTypes = registry.all().filter((d) => d.restricted === true && !mayAccess(req.user, d, 'view')).map((d) => d.type);
    if (hiddenTypes.length) where.push(`(record_type is null or record_type <> all(${add(hiddenTypes)}::text[]))`);
    const w = where.join(' and ');

    if (query.format === 'csv') {
      const rows = await db.query<Row>(`select * from audit_events where ${w} order by id desc limit 50000`, params);
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      await audit(req, { action: 'audit.export', summary: `Exported ${rows.length} audit events to CSV` });
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="audit-export.csv"');
      const cols = ['id', 'at', 'actor_name', 'ip', 'action', 'record_type', 'record_id', 'summary', 'before', 'after'];
      return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    }
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 50));
    const page = Math.max(1, Number(query.page) || 1);
    const total = (await db.one<{ c: number }>(`select count(*)::int c from audit_events where ${w}`, params))!.c;
    const rows = await db.query(
      `select * from audit_events where ${w} order by id desc limit ${pageSize} offset ${(page - 1) * pageSize}`, params,
    );
    return { rows, total, page, pageSize };
  });

  // ---------- lookups (configurable lists) ----------

  app.get('/api/lookups', { preHandler: requirePerm('admin.administer') }, async () =>
    db.query('select list_key, count(*)::int as count from lookups group by 1 order by 1'));

  app.get('/api/lookups/:list', async (req) =>
    db.query('select id, list_key, value, label, color, sort, active, meta from lookups where list_key = $1 order by sort, label',
      [(req.params as any).list]));

  app.post('/api/lookups', { preHandler: requirePerm('admin.administer') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    if (!/^[a-z][a-z0-9_]*$/.test(String(b.list_key ?? ''))) fields.list_key = 'Choose a list.';
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(String(b.value ?? ''))) fields.value = 'Use lower-case letters, numbers, dashes or underscores.';
    if (!String(b.label ?? '').trim()) fields.label = 'Label is required.';
    if (Object.keys(fields).length) fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (await db.one('select 1 from lookups where list_key = $1 and value = $2', [b.list_key, b.value])) {
      fail(400, 'validation', 'Check the highlighted fields.', { value: 'That value already exists in this list.' });
    }
    const row = await db.one<Row>(
      `insert into lookups (list_key, value, label, color, sort, meta) values ($1,$2,$3,$4,$5,$6::jsonb) returning *`,
      [b.list_key, b.value, String(b.label).trim(), b.color ?? 'gray', Number(b.sort) || 0, JSON.stringify(b.meta ?? {})],
    );
    await audit(req, { action: 'lookup.create', recordType: 'lookup', recordId: row!.id, summary: `Added "${row!.label}" to ${b.list_key}`, after: row });
    reply.code(201);
    return row;
  });

  app.patch('/api/lookups/:id', { preHandler: requirePerm('admin.administer') }, async (req) => {
    const id = (req.params as any).id;
    const before = UUID_RE.test(id) ? await db.one<Row>('select * from lookups where id = $1', [id]) : undefined;
    if (!before) fail(404, 'not_found', 'Value not found.');
    const b = (req.body ?? {}) as Row;
    const row = await db.one<Row>(
      `update lookups set label = $2, color = $3, sort = $4, active = $5, meta = $6::jsonb where id = $1 returning *`,
      [id, String(b.label ?? before!.label).trim() || before!.label, b.color ?? before!.color,
        b.sort === undefined ? before!.sort : Number(b.sort) || 0, b.active ?? before!.active, JSON.stringify(b.meta ?? before!.meta)],
    );
    await audit(req, { action: 'lookup.update', recordType: 'lookup', recordId: id, summary: `Changed "${row!.label}" in ${row!.list_key}`, before, after: row });
    return row;
  });

  // Values are retired (active = false), never removed, so existing records keep their meaning.
  app.delete('/api/lookups/:id', { preHandler: requirePerm('admin.administer') }, async (req) => {
    const id = (req.params as any).id;
    const row = UUID_RE.test(id) ? await db.one<Row>('update lookups set active = false where id = $1 returning *', [id]) : undefined;
    if (!row) fail(404, 'not_found', 'Value not found.');
    await audit(req, { action: 'lookup.retire', recordType: 'lookup', recordId: id, summary: `Retired "${row!.label}" in ${row!.list_key}` });
    return { ok: true };
  });
}
