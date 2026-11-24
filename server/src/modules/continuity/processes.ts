// Business processes (E31-01) and what each depends on: systems, services, sites, vendors, other
// processes and positions. `process_dependencies` is the source; every change is mirrored into the
// record links (relation `depends_on`, contract C7) so the Related panel shows it on both records.
// Dependencies of a type that is switched off or not loaded are kept but neither shown nor changed.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { departmentPrepare } from '../../core/scope.ts';
import { checkHours, DEP_TYPES, DEPENDS_ON, invalid, liveDepKinds, text } from './shared.ts';

export const PROCESS_HOURS = ['mtd_hours', 'rto_target_hours', 'rpo_target_hours'];

export async function processFor(ctx: ModuleContext, req: FastifyRequest): Promise<Row> {
  return (await ctx.resources.find('business_process', (req.params as { id: string }).id, req.user))
    ?? ctx.fail(404, 'not_found', 'Business process not found.');
}

/** A dependency as shown: the record named when the reader may see it, `hidden` otherwise. */
export interface DependencyView {
  id: string; dep_type: string; dep_id: string; critical: boolean; notes: string | null; sort: number;
  record_type: string; type_label: string; label: string | null; ref: string | null; route: string | null; hidden: boolean;
  rto_hours?: number | null;
}

/**
 * The dependencies of a process that `user` may know about: of a type that is loaded and switched on.
 * A record the user may not see (restricted, deleted) is listed as hidden, without its name.
 */
export async function dependenciesOf(ctx: ModuleContext, processId: string, user: SessionUser | null): Promise<DependencyView[]> {
  const kinds = liveDepKinds(ctx);
  if (!kinds.length) return [];
  const rows = await ctx.db.query<Row>(
    `select id, dep_type, dep_id::text as dep_id, critical, notes, sort from process_dependencies
     where process_id = $1 and dep_type = any($2::text[]) order by sort, created_at`, [processId, kinds]);
  // The records depended on, read once per record type rather than once per dependency (E40-09).
  const seen = new Map<string, Row>();
  for (const kind of [...new Set(rows.map((r) => String(r.dep_type)))]) {
    const def = ctx.resources.get(DEP_TYPES[kind]);
    const ids = [...new Set(rows.filter((r) => r.dep_type === kind).map((r) => String(r.dep_id)))];
    if (!def || !ids.length) continue;
    const found = await ctx.db.query<Row>(
      `select * from ${def.table} where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(def.type, user)}`, [ids]);
    for (const x of found) seen.set(`${def.type}:${x.id}`, x);
  }
  const out: DependencyView[] = [];
  for (const r of rows) {
    const def = ctx.resources.get(DEP_TYPES[r.dep_type])!;
    const found = seen.get(`${def.type}:${r.dep_id}`);
    out.push({
      id: r.id, dep_type: r.dep_type, dep_id: r.dep_id, critical: r.critical, notes: r.notes, sort: r.sort,
      record_type: def.type, type_label: def.label, hidden: !found,
      label: found ? String(found[def.titleField] ?? '') : null,
      ref: found && def.ref ? (found[def.ref.field] ?? null) : null,
      route: found ? `${def.route}/${r.dep_id}` : null,
      ...(r.dep_type === 'system' ? { rto_hours: found ? (found.rto_hours === null || found.rto_hours === undefined ? null : Number(found.rto_hours)) : null } : {}),
    });
  }
  return out;
}

/** Keeps the `depends_on` record links of one process in step with its dependency rows. */
export async function mirrorLinks(ctx: ModuleContext, processId: string, userId: string | null): Promise<void> {
  const deps = await ctx.db.query<Row>('select dep_type, dep_id::text as dep_id from process_dependencies where process_id = $1', [processId]);
  const want = new Set(deps.map((d) => `${DEP_TYPES[d.dep_type]}:${d.dep_id}`));
  const have = await ctx.db.query<Row>(
    `select id, to_type, to_id::text as to_id from record_links where from_type = 'business_process' and from_id = $1 and relation = $2`, [processId, DEPENDS_ON]);
  for (const l of have) if (!want.has(`${l.to_type}:${l.to_id}`)) await ctx.db.query('delete from record_links where id = $1', [l.id]);
  const got = new Set(have.map((l) => `${l.to_type}:${l.to_id}`));
  for (const d of deps) {
    const type = DEP_TYPES[d.dep_type];
    if (got.has(`${type}:${d.dep_id}`)) continue;
    await ctx.db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('business_process', $1, $2, $3, $4, $5)
       on conflict do nothing`, [processId, type, d.dep_id, DEPENDS_ON, userId]);
  }
}

export function registerProcesses(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function check(_req: FastifyRequest | null, data: Row, existing: Row | null): Promise<Row> {
    const errors = checkHours(data, PROCESS_HOURS);
    if (data.minimum_staff !== undefined && data.minimum_staff !== null && data.minimum_staff !== '') {
      const n = Number(data.minimum_staff);
      if (!Number.isInteger(n) || n < 0) errors.minimum_staff = 'Give a whole number of people, 0 or more.';
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    // A new due date is reminded about afresh.
    if (existing && 'next_bia_due' in data && String(data.next_bia_due ?? '') !== String(existing.next_bia_due ?? '')) data.bia_reminded_for = null;
    return data;
  }

  ctx.defineResource({
    type: 'business_process', table: 'business_processes', module: 'continuity', label: 'Business process', plural: 'Business processes',
    path: '/api/business-processes', route: '/continuity/processes', titleField: 'name',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { department: 'department_id' },
    ref: { field: 'ref', prefix: 'BPR-' },
    searchable: ['name', 'department', 'description', 'peak_periods'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true },
      // E41-01: a reference to the organization's departments; `department` keeps its name (set by the database).
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      department: { label: 'Department name', type: 'text', readOnly: true },
      owner_id: { label: 'Owner', type: 'user' },
      description: { label: 'Description', type: 'longtext', personal: false },
      criticality: { label: 'Criticality', type: 'lookup', list: 'process_criticality' },
      status: { label: 'Status', type: 'lookup', list: 'process_status', default: 'draft' },
      peak_periods: { label: 'Peak periods', type: 'text' },
      mtd_hours: { label: 'Maximum tolerable downtime (hours)', type: 'number' },
      rto_target_hours: { label: 'Recovery time target (hours)', type: 'number' },
      rpo_target_hours: { label: 'Recovery point target (hours)', type: 'number' },
      minimum_staff: { label: 'Minimum staff to run it', type: 'number' },
      manual_workaround: { label: 'Manual workaround', type: 'longtext', personal: false },
      last_bia_on: { label: 'Last impact analysis', type: 'date', readOnly: true },
      next_bia_due: { label: 'Next impact analysis due', type: 'date' },
    },
    hooks: {
      // A department may still be given by name (`department` or `department_id`), as before E41-01.
      prepare: departmentPrepare(ctx.db),
      beforeCreate: (req, data) => check(req, data, null),
      beforeUpdate: (req, existing, patch) => check(req, patch, existing),
    },
  });

  // ---------- dependencies ----------

  app.get('/api/business-processes/:id/dependencies', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const p = await processFor(ctx, req);
    return { kinds: liveDepKinds(ctx), dependencies: await dependenciesOf(ctx, p.id, req.user) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/business-processes/:id/dependencies', tag: 'Continuity', permission: 'continuity.view',
    summary: 'What a business process depends on (records the reader may not see are listed as hidden, without their names)',
    response: '{ kinds: [system | service | site | vendor | process | position], dependencies: [{ id, dep_type, dep_id, critical, notes, sort, record_type, type_label, label, ref, route, hidden, rto_hours? }] }',
  });

  app.put('/api/business-processes/:id/dependencies', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const p = await processFor(ctx, req);
    const list = (req.body as Row | null)?.dependencies;
    if (!Array.isArray(list) || list.length > 300) invalid(ctx, { dependencies: 'Send the list of dependencies (at most 300).' });
    const kinds = liveDepKinds(ctx);
    const seen = new Set<string>();
    const wanted: Row[] = [];
    for (const [i, d] of (list as Row[]).entries()) {
      const kind = String(d?.dep_type ?? '');
      const id = String(d?.dep_id ?? '');
      if (!kinds.includes(kind) || !UUID_RE.test(id)) invalid(ctx, { dependencies: `Item ${i + 1}: choose what kind of record it is and the record.` });
      if (kind === 'process' && id === p.id) invalid(ctx, { dependencies: 'A process cannot depend on itself.' });
      const def = ctx.resources.get(DEP_TYPES[kind])!;
      if (!ctx.can(req.user, `${def.module}.view`) || !(await ctx.resources.find(def.type, id, req.user))) {
        invalid(ctx, { dependencies: `Item ${i + 1}: that ${def.label.toLowerCase()} was not found.` });
      }
      const key = `${kind}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wanted.push({ dep_type: kind, dep_id: id, critical: d.critical !== false, notes: text(d.notes, 1000), sort: (i + 1) * 10 });
    }
    // Only what the caller can see is replaced: rows of switched-off types and records the caller may
    // not see stay as they are.
    const before = await dependenciesOf(ctx, p.id, req.user);
    const replaceable = before.filter((b) => !b.hidden);
    await db.tx(async (tx) => {
      for (const b of replaceable) {
        if (!seen.has(`${b.dep_type}:${b.dep_id}`)) await tx.query('delete from process_dependencies where id = $1', [b.id]);
      }
      for (const w of wanted) {
        await tx.query(
          `insert into process_dependencies (process_id, dep_type, dep_id, critical, notes, sort, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7)
           on conflict (process_id, dep_type, dep_id) do update set critical = excluded.critical, notes = excluded.notes, sort = excluded.sort,
             updated_at = now(), updated_by = excluded.updated_by`,
          [p.id, w.dep_type, w.dep_id, w.critical, w.notes, w.sort, req.user!.id]);
      }
    });
    await mirrorLinks(ctx, p.id, req.user!.id);
    const after = await dependenciesOf(ctx, p.id, req.user);
    const label = (d: DependencyView) => `${d.type_label} ${d.label ?? '(hidden)'}${d.critical ? '' : ' (not critical)'}`;
    const added = after.filter((a) => !replaceable.some((b) => b.dep_type === a.dep_type && b.dep_id === a.dep_id));
    const removed = replaceable.filter((b) => !after.some((a) => a.dep_type === b.dep_type && a.dep_id === b.dep_id));
    await ctx.audit(req, {
      action: 'business_process.dependencies', recordType: 'business_process', recordId: p.id,
      summary: `Dependencies saved: ${after.length} in all${added.length ? `; added ${added.map(label).join(', ')}` : ''}${removed.length ? `; removed ${removed.map(label).join(', ')}` : ''}`,
      before: replaceable.map((d) => ({ dep_type: d.dep_type, dep_id: d.dep_id, critical: d.critical, notes: d.notes })),
      after: wanted,
    });
    return { kinds, dependencies: after };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/business-processes/:id/dependencies', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Replace what a business process depends on (records of switched-off types, and records the caller may not see, are kept)',
    description: 'Each record must exist and be visible to the caller. Kept in step with the record links (relation `depends_on`), so the Related panel shows them.',
    body: '{ dependencies: [{ dep_type: system | service | site | vendor | process | position, dep_id, critical?: boolean (default true), notes? }] }',
  });

  // ---------- processes that depend on a record (inventory panel) ----------

  app.get('/api/continuity/dependents', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const q = req.query as { type?: string; id?: string };
    const type = String(q.type ?? '');
    const kind = Object.keys(DEP_TYPES).find((k) => DEP_TYPES[k] === type);
    const def = kind ? ctx.resources.get(type) : undefined;
    if (!def || !UUID_RE.test(String(q.id ?? ''))) ctx.fail(400, 'validation', 'Give a record type a process can depend on, and its id.');
    if (!ctx.can(req.user, `${def!.module}.view`) || !(await ctx.resources.find(def!.type, String(q.id), req.user))) {
      ctx.fail(404, 'not_found', 'Record not found.');
    }
    const visible = ctx.resources.visibleWhere('business_process', req.user, 'p');
    const rows = await db.query<Row>(
      `select p.id, p.ref, p.name, p.criticality, p.status, p.mtd_hours, d.critical, null::text as via_id
       from process_dependencies d join business_processes p on p.id = d.process_id
       where d.dep_type = $1 and d.dep_id = $2 and p.deleted_at is null and ${visible}
       order by p.name`, [kind, q.id]);
    // A system also reaches the processes that depend on a service built on it (fleet services).
    if (type === 'system' && ctx.resources.get('service')) {
      const via = await db.query<Row>(
        `select p.id, p.ref, p.name, p.criticality, p.status, p.mtd_hours, d.critical, s.id::text as via_id, s.route_code || ' ' || s.name as via_label
         from service_systems ss join services s on s.id = ss.service_id and s.deleted_at is null
         join process_dependencies d on d.dep_type = 'service' and d.dep_id = s.id
         join business_processes p on p.id = d.process_id
         where ss.system_id = $1 and p.deleted_at is null and ${visible}
         order by p.name`, [q.id]);
      for (const v of via) {
        if (!(await ctx.resources.find('service', v.via_id, req.user))) { v.via_label = null; }
        rows.push(v);
      }
    }
    return rows.map((r) => ({
      id: r.id, ref: r.ref, name: r.name, criticality: r.criticality, status: r.status,
      mtd_hours: r.mtd_hours === null ? null : Number(r.mtd_hours), critical: r.critical,
      via: r.via_id ? { type: 'service', id: r.via_id, label: r.via_label ?? null } : null,
    }));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/continuity/dependents', tag: 'Continuity', permission: 'continuity.view',
    summary: 'Business processes that depend on a record (for a system, also through the services built on it)',
    query: { type: 'system | service | site | vendor | business_process | position', id: 'Record id' },
    response: '[{ id, ref, name, criticality, status, mtd_hours, critical, via: { type: "service", id, label } | null }]',
  });
}
