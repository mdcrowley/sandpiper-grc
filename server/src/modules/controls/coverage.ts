import type { FastifyRequest } from 'fastify';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { meanings } from './lists.ts';
import { COVER_TYPES, COVERS, coverDef, coverDefs, isClosed, recordName, REVIEW_FIELDS, UUID_RE } from './shared.ts';

/**
 * What each control covers (E26-03): risks, hazards, framework outcomes, obligations, policies and
 * OT security zones (wave 11), kept as generic record links from the control with relation `covers`
 * (contract C7), so they show on both records' Related tabs too.
 *
 * Restricted records stay hidden. Every list here is built from the records the caller may see:
 * a covered record whose module the caller cannot view, or that is restricted from them (risks need
 * `security.view`), is left out of the coverage tab, the "covering" list and the coverage view, and
 * cannot be added or removed by them. Adding or removing coverage of a restricted record is recorded
 * in that record's history, not the control's, so the control's history never names it.
 */

/** A control's state in the coverage view, worst first. */
export const STATES = ['ineffective', 'overdue', 'untested', 'partly_effective', 'effective'] as const;
export type CoverState = (typeof STATES)[number];

export function controlState(c: Row, today: string, m: { failed: string[]; partial: string[] }): CoverState {
  if (m.failed.includes(c.operating_rating) || m.failed.includes(c.design_rating)) return 'ineffective';
  if (c.next_test_due && String(c.next_test_due) < today) return 'overdue';
  if (!c.operating_rating) return 'untested';
  if (m.partial.includes(c.operating_rating) || m.partial.includes(c.design_rating)) return 'partly_effective';
  return 'effective';
}

const worst = (states: CoverState[]): CoverState | null =>
  states.length ? STATES[Math.min(...states.map((s) => STATES.indexOf(s)))] : null;

/**
 * After an ineffective result: every open risk and hazard the control covers gets today as its next
 * review date (unless it is already due) and its owner is told, as system work. Returns how many of
 * them `req`'s person may see, so the answer reveals nothing about records hidden from them.
 */
export async function flagCoverage(ctx: ModuleContext, test: Row, control: Row, req: FastifyRequest): Promise<number> {
  const today = dayInZone();
  const links = await ctx.db.query<Row>(
    `select to_type, to_id from record_links where from_type = 'control' and from_id = $1 and relation = $2 and to_type = any($3::text[])`,
    [control.id, COVERS, Object.keys(REVIEW_FIELDS)],
  );
  let visible = 0;
  for (const l of links) {
    const def = ctx.resources.get(l.to_type);
    const field = def && REVIEW_FIELDS[l.to_type].find((f) => f in def.fields);
    if (!def || !field) continue;
    const row = await ctx.resources.find(l.to_type, l.to_id);
    if (!row || await isClosed(ctx, def, row)) continue;
    if (!row[field] || String(row[field]).slice(0, 10) > today) {
      await ctx.resources.update(l.to_type, row.id, { [field]: today }, null);
    }
    if (ctx.app.hasDecorator('notify')) {
      await ctx.app.notify({
        ...(row.owner_id ? { userIds: [row.owner_id] } : { permission: `${def.module}.edit` }),
        kind: 'controls',
        title: `Review ${def.label.toLowerCase()} ${recordName(def, row)}: a control it relies on failed its test`,
        body: `Control ${control.ref} ${control.title} was rated ineffective by test ${test.ref}. The ${def.label.toLowerCase()}'s review date is now today.`,
        recordType: l.to_type, recordId: row.id,
        once: `control.failed:${test.id}:${l.to_type}:${row.id}`,
      });
    }
    if (ctx.can(req.user, `${def.module}.view`) && await ctx.resources.find(l.to_type, row.id, req.user)) visible += 1;
  }
  await ctx.db.query('update control_tests set flagged_on = $2 where id = $1', [test.id, today]);
  await ctx.audit(req, {
    action: 'control_test.flag', recordType: 'control_test', recordId: test.id,
    summary: 'Ineffective result: the risks and hazards this control covers are due for review',
  });
  return visible;
}

export function registerCoverage(ctx: ModuleContext) {
  const { app, db } = ctx;

  const needControl = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id);
    return (UUID_RE.test(id) ? await ctx.resources.find('control', id, req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Control not found.');
  };

  /** A covered record the caller may see: its type must be coverable, loaded and viewable, and the row visible. */
  async function visibleTarget(req: FastifyRequest, type: unknown, id: unknown): Promise<{ def: ResourceDef; row: Row } | undefined> {
    const def = coverDef(ctx, req, String(type ?? ''));
    if (!def || !UUID_RE.test(String(id ?? ''))) return undefined;
    const row = await ctx.resources.find(def.type, String(id), req.user);
    return row ? { def, row } : undefined;
  }

  const targetOut = (def: ResourceDef, row: Row, extra: Row = {}) => {
    const review = (REVIEW_FIELDS[def.type] ?? []).find((f) => f in def.fields);
    return {
      type: def.type, typeLabel: def.label, id: row.id, ref: def.ref ? row[def.ref.field] ?? null : null,
      title: row[def.titleField] ?? '', route: def.route, status: row.status ?? null, status_list: def.fields.status?.list ?? null,
      review_on: review ? row[review] ?? null : null, ...extra,
    };
  };

  /** Writes the coverage change to the audit log: on the control, or on the covered record when that one is restricted. */
  async function auditLink(req: FastifyRequest, control: Row, def: ResourceDef, row: Row, added: boolean) {
    const hidden = def.restricted === true || row.restricted === true;
    const name = recordName(def, row);
    await ctx.audit(req, hidden
      ? {
        action: added ? 'control.coverage_add' : 'control.coverage_remove', recordType: def.type, recordId: row.id,
        summary: added ? `Now covered by control ${control.ref} ${control.title}` : `No longer covered by control ${control.ref} ${control.title}`,
        [added ? 'after' : 'before']: { from_type: 'control', from_id: control.id, relation: COVERS },
      }
      : {
        action: added ? 'control.coverage_add' : 'control.coverage_remove', recordType: 'control', recordId: control.id,
        summary: added ? `Covers ${def.label.toLowerCase()} ${name}` : `No longer covers ${def.label.toLowerCase()} ${name}`,
        [added ? 'after' : 'before']: { to_type: def.type, to_id: row.id, relation: COVERS },
      });
  }

  app.get('/api/controls/:id/coverage', { preHandler: ctx.requirePerm('controls.view') }, async (req) => {
    const control = await needControl(req);
    const defs = coverDefs(ctx, req);
    const links = await db.query<Row>(
      `select id, to_type, to_id, created_at from record_links where from_type = 'control' and from_id = $1 and relation = $2`,
      [control.id, COVERS],
    );
    const rows: Row[] = [];
    for (const l of links) {
      const def = defs.find((d) => d.type === l.to_type);
      const row = def && await ctx.resources.find(def.type, l.to_id, req.user);
      if (def && row) rows.push(targetOut(def, row, { link_id: l.id, linked_at: l.created_at }));
    }
    rows.sort((a, b) => COVER_TYPES.indexOf(a.type) - COVER_TYPES.indexOf(b.type) || String(a.ref ?? a.title).localeCompare(String(b.ref ?? b.title), undefined, { numeric: true }));
    return { types: defs.map((d) => ({ type: d.type, label: d.label, plural: d.plural })), rows };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/controls/:id/coverage', permission: 'controls.view',
    summary: 'The records a control covers that the caller may see',
    response: '{ types: [{ type, label, plural }], rows: [{ link_id, type, typeLabel, id, ref, title, route, status, status_list, review_on }] }',
  });

  app.post('/api/controls/:id/coverage', { preHandler: ctx.requirePerm('controls.edit') }, async (req, reply) => {
    const control = await needControl(req);
    const body = (req.body ?? {}) as Row;
    if (!coverDef(ctx, req, String(body.type ?? ''))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { type: 'Choose what kind of record the control covers.' });
    }
    const target = (await visibleTarget(req, body.type, body.id))
      ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { id: 'Choose the record the control covers.' });
    const made = await db.one<Row>(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('control', $1, $2, $3, $4, $5)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing returning id`,
      [control.id, target.def.type, target.row.id, COVERS, req.user!.id],
    );
    if (made) await auditLink(req, control, target.def, target.row, true);
    reply.code(made ? 201 : 200);
    return { ok: true, added: !!made };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/controls/:id/coverage', permission: 'controls.edit',
    summary: 'Record that a control covers another record (only kinds of record a control can cover)',
    description: 'The covered record must be one the caller may see. Adding it again changes nothing.',
    body: { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string', enum: [...COVER_TYPES] }, id: { type: 'string', format: 'uuid' } } },
    response: '{ ok, added }',
  });

  app.delete('/api/controls/:id/coverage/:linkId', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const control = await needControl(req);
    const linkId = String((req.params as Row).linkId);
    const link = UUID_RE.test(linkId)
      ? await db.one<Row>(`select * from record_links where id = $1 and from_type = 'control' and from_id = $2 and relation = $3`, [linkId, control.id, COVERS])
      : undefined;
    const target = link && await visibleTarget(req, link.to_type, link.to_id);
    if (!link || !target) ctx.fail(404, 'not_found', 'This control does not cover that record.');
    await db.query('delete from record_links where id = $1', [link!.id]);
    await auditLink(req, control, target!.def, target!.row, false);
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/controls/:id/coverage/:linkId', permission: 'controls.edit',
    summary: 'Stop a control covering a record (the link id from the coverage list; the record must be one the caller may see)',
  });

  app.get('/api/controls/covering', { preHandler: ctx.requirePerm('controls.view') }, async (req) => {
    const q = (req.query ?? {}) as Row;
    const target = (await visibleTarget(req, q.type, q.id)) ?? ctx.fail(404, 'not_found', 'Record not found.');
    const m = await meanings(ctx);
    const today = dayInZone();
    const rows = await db.query<Row>(
      `select l.id as link_id, c.id, c.ref, c.title, c.status, c.key_control, c.control_type, c.design_rating, c.operating_rating,
              c.last_tested_on::text as last_tested_on, c.next_test_due::text as next_test_due
       from record_links l join controls c on c.id = l.from_id and c.deleted_at is null
       where l.from_type = 'control' and l.relation = $1 and l.to_type = $2 and l.to_id = $3
       order by c.ref`,
      [COVERS, target.def.type, target.row.id],
    );
    const live = rows.filter((c) => !m.retired.includes(c.status));
    const out = rows.map((c) => ({ ...c, state: m.retired.includes(c.status) ? null : controlState(c, today, m) }));
    return { record: targetOut(target.def, target.row), state: worst(live.map((c) => controlState(c, today, m))), rows: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/controls/covering', permission: 'controls.view',
    summary: 'The controls covering one record, with their ratings and test dates (for a panel on that record\'s page)',
    query: { type: 'Record type: risk, hazard, framework_outcome, obligation or policy', id: 'Record id (404 when the caller may not see it)' },
    response: '{ record, state, rows: [{ link_id, id, ref, title, status, key_control, design_rating, operating_rating, last_tested_on, next_test_due, state }] }',
  });

  /**
   * The coverage view (E26-07): every covered record the caller may see, with the controls it relies
   * on and its worst state (ineffective, test overdue, untested, partly effective, effective).
   */
  app.get('/api/controls/coverage-matrix', { preHandler: ctx.requirePerm('controls.view') }, async (req) => {
    const m = await meanings(ctx);
    const today = dayInZone();
    const defs = coverDefs(ctx, req);
    const controls = await db.query<Row>(
      `select id, ref, title, status, key_control, design_rating, operating_rating, next_test_due::text as next_test_due
       from controls where deleted_at is null and not (coalesce(status, '') = any($1::text[]))`, [m.retired],
    );
    const byId = new Map(controls.map((c) => [c.id, { ...c, state: controlState(c, today, m) }]));
    const out: Row[] = [];
    for (const def of defs) {
      const links = await db.query<Row>(
        `select l.from_id, l.to_id from record_links l join ${def.table} t on t.id = l.to_id and t.deleted_at is null
         where l.from_type = 'control' and l.relation = $1 and l.to_type = $2 and ${ctx.resources.visibleWhere(def.type, req.user, 't')}`,
        [COVERS, def.type],
      );
      const grouped = new Map<string, Row[]>();
      for (const l of links) {
        const c = byId.get(l.from_id);
        if (!c) continue;
        grouped.set(l.to_id, [...(grouped.get(l.to_id) ?? []), c]);
      }
      if (!grouped.size) continue;
      const cols = ['id', def.titleField, ...(def.ref ? [def.ref.field] : []), ...('status' in def.fields ? ['status'] : []),
        ...(REVIEW_FIELDS[def.type] ?? []).filter((f) => f in def.fields)];
      const records = await db.query<Row>(
        `select ${[...new Set(cols)].join(', ')} from ${def.table} t where t.id = any($1::uuid[])`, [[...grouped.keys()]],
      );
      for (const r of records) {
        const cs = grouped.get(r.id)!.sort((a, b) => String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }));
        out.push(targetOut(def, r, {
          state: worst(cs.map((c) => c.state)),
          controls: cs.map((c) => ({ id: c.id, ref: c.ref, title: c.title, key_control: c.key_control, operating_rating: c.operating_rating, design_rating: c.design_rating, next_test_due: c.next_test_due, state: c.state })),
        }));
      }
    }
    out.sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || COVER_TYPES.indexOf(a.type) - COVER_TYPES.indexOf(b.type)
      || String(a.ref ?? a.title).localeCompare(String(b.ref ?? b.title), undefined, { numeric: true }));
    const counts = Object.fromEntries(STATES.map((s) => [s, out.filter((r) => r.state === s).length]));
    return { types: defs.map((d) => ({ type: d.type, label: d.label, plural: d.plural })), counts, rows: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/controls/coverage-matrix', permission: 'controls.view',
    summary: 'Which covered records rely on ineffective, overdue, untested or partly effective controls (only records the caller may see)',
    response: '{ types, counts: { ineffective, overdue, untested, partly_effective, effective }, rows: [{ type, typeLabel, id, ref, title, route, status, state, controls: [...] }] }',
  });
}
