// Routes beyond the board and assessments: removing parts of a framework's structure, loading
// a framework from a reference file, coverage of other frameworks, an outcome's status
// timeline, editing evidence and mappings, and review-date reminders.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { applyReference, exportReference, validateReference } from './importer.ts';
import { mappingProblem, textFromRows } from './mappings.ts';
import { sendReviewReminders } from './reminders.ts';
import type { Scale } from './index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = 3_600_000;

/** One requirement of another framework as written in a mapping: "12.1 (note)" -> key "12.1". */
const requirementKey = (part: string) => part.replace(/\s*\([^()]*\)\s*$/, '').trim();

export function registerExtras(ctx: ModuleContext, loadScale: (ctx: ModuleContext) => Promise<Scale>) {
  const { db } = ctx;
  const view = { preHandler: ctx.requirePerm('frameworks.view') };
  const edit = { preHandler: ctx.requirePerm('frameworks.edit') };
  const param = (req: FastifyRequest, name = 'id') => String((req.params as Row)[name] ?? '');

  async function needFramework(id: string): Promise<Row> {
    const row = UUID.test(id) ? await db.one<Row>('select id, key, name, version, description from frameworks where id = $1 and deleted_at is null', [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Framework not found.');
  }
  async function needOutcome(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('framework_outcome', param(req), req.user)) ?? ctx.fail(404, 'not_found', 'Framework outcome not found.');
  }

  // ---------- structure: removing a category or a function ----------

  ctx.app.delete('/api/frameworks/:id/categories/:code', edit, async (req) => {
    const fw = await needFramework(param(req));
    const code = param(req, 'code');
    const cat = await db.one<Row>('select id, code, name, function_code from framework_categories where framework_id = $1 and code = $2', [fw.id, code]);
    if (!cat) ctx.fail(404, 'not_found', 'Category not found.');
    const used = (await db.one<{ c: number }>(
      'select count(*)::int as c from framework_outcomes where framework_id = $1 and category_code = $2 and deleted_at is null', [fw.id, code]))!.c;
    if (used) ctx.fail(409, 'in_use', `${cat!.name} still has ${used} outcome${used === 1 ? '' : 's'}. Move or delete them first.`);
    await db.query('delete from framework_categories where id = $1', [cat!.id]);
    await ctx.audit(req, {
      action: 'framework.category_remove', recordType: 'framework', recordId: fw.id,
      summary: `Category ${cat!.code} ${cat!.name} removed from ${fw.name}`,
      before: { code: cat!.code, name: cat!.name, function_code: cat!.function_code },
    });
    return { ok: true };
  });

  ctx.app.delete('/api/frameworks/:id/functions/:code', edit, async (req) => {
    const fw = await needFramework(param(req));
    const code = param(req, 'code');
    const fn = await db.one<Row>('select id, code, name from framework_functions where framework_id = $1 and code = $2', [fw.id, code]);
    if (!fn) ctx.fail(404, 'not_found', 'Function not found.');
    const cats = (await db.one<{ c: number }>('select count(*)::int as c from framework_categories where framework_id = $1 and function_code = $2', [fw.id, code]))!.c;
    const used = (await db.one<{ c: number }>(
      'select count(*)::int as c from framework_outcomes where framework_id = $1 and function_code = $2 and deleted_at is null', [fw.id, code]))!.c;
    if (cats || used) {
      ctx.fail(409, 'in_use', `${fn!.name} still has ${cats ? `${cats} categor${cats === 1 ? 'y' : 'ies'}` : `${used} outcome${used === 1 ? '' : 's'}`}. Remove them first.`);
    }
    await db.query('delete from framework_functions where id = $1', [fn!.id]);
    await ctx.audit(req, {
      action: 'framework.function_remove', recordType: 'framework', recordId: fw.id,
      summary: `Function ${fn!.code} ${fn!.name} removed from ${fw.name}`, before: { code: fn!.code, name: fn!.name },
    });
    return { ok: true };
  });

  // ---------- loading a framework from a reference file ----------

  // Body: the reference file itself, or { file: <reference>, dryRun: true } to check it first.
  ctx.app.post('/api/frameworks/import', view, async (req, reply) => {
    const body = (req.body ?? {}) as Row;
    const wrapped = body && typeof body === 'object' && 'file' in body;
    const dryRun = wrapped && (body.dryRun === true || body.dry_run === true);
    const { ref, errors } = validateReference(wrapped ? body.file : body);
    if (!ref) {
      return reply.code(400).send({ error: { code: 'validation', message: 'The file cannot be loaded as it stands.', fields: { file: errors.join('\n') }, problems: errors } });
    }
    const exists = await db.one('select 1 from frameworks where lower(key) = lower($1) and deleted_at is null', [ref.key]);
    // A new framework needs Create; reloading one that is there changes outcome wording, so it needs Edit.
    const needed = exists ? 'frameworks.edit' : 'frameworks.create';
    if (!ctx.can(req.user, needed)) ctx.fail(403, 'forbidden', exists ? 'Reloading a framework needs the Edit permission.' : 'Adding a framework needs the Create permission.');
    const result = await applyReference(ctx, ref, req, dryRun);
    reply.code(dryRun || !result.created ? 200 : 201);
    return result;
  });

  ctx.app.get('/api/frameworks/:id/reference', view, async (req) => exportReference(ctx, await needFramework(param(req))));

  // ---------- coverage of other frameworks ----------

  // Without `name`: every other framework that outcomes are mapped to, with totals.
  // With `name`: its requirements, each with the outcomes that satisfy it and their status.
  ctx.app.get('/api/frameworks/:id/coverage', view, async (req) => {
    const fw = await needFramework(param(req));
    const scale = await loadScale(ctx);
    const wanted = String((req.query as Row).name ?? '').trim();
    const rows = await db.query<Row>(
      `select m.framework_name, m.reference, o.id, o.code, o.title, o.status, o.priority, o.function_code
       from outcome_mappings m join framework_outcomes o on o.id = m.outcome_id
       where o.framework_id = $1 and o.deleted_at is null and ${ctx.resources.visibleWhere('framework_outcome', req.user, 'o')}
       order by lower(m.framework_name), o.code`, [fw.id]);
    const atTarget = (status: string) => scale.target.weight > 0 && scale.weightOf(status) >= scale.target.weight;

    const names = new Map<string, { name: string; outcomes: Set<string>; requirements: Set<string>; atTarget: Set<string> }>();
    for (const r of rows) {
      const key = String(r.framework_name).toLowerCase();
      const n = names.get(key) ?? { name: r.framework_name, outcomes: new Set(), requirements: new Set(), atTarget: new Set() };
      names.set(key, n);
      n.outcomes.add(r.id);
      if (atTarget(r.status)) n.atTarget.add(r.id);
      for (const part of String(r.reference).split(',')) if (requirementKey(part)) n.requirements.add(requirementKey(part).toLowerCase());
    }
    const result: Row = {
      framework: fw, statuses: scale.values, target: scale.target,
      names: [...names.values()].map((n) => ({ name: n.name, outcomes: n.outcomes.size, at_target: n.atTarget.size, requirements: n.requirements.size })),
    };
    if (!wanted) return result;

    const groups = new Map<string, { reference: string; outcomes: Row[] }>();
    for (const r of rows.filter((x) => String(x.framework_name).toLowerCase() === wanted.toLowerCase())) {
      const parts = String(r.reference).split(',').map((p) => p.trim()).filter(Boolean);
      for (const part of parts.length ? parts : ['']) {
        const reference = requirementKey(part);
        const g = groups.get(reference.toLowerCase()) ?? { reference, outcomes: [] };
        groups.set(reference.toLowerCase(), g);
        if (g.outcomes.some((o) => o.id === r.id)) continue;
        const note = part.match(/\(([^()]*)\)\s*$/)?.[1] ?? null;
        g.outcomes.push({ id: r.id, code: r.code, title: r.title, status: r.status, priority: r.priority, function_code: r.function_code, at_target: atTarget(r.status), note });
      }
    }
    result.name = names.get(wanted.toLowerCase())?.name ?? wanted;
    result.requirements = [...groups.values()]
      .sort((a, b) => (a.reference === '' ? 1 : b.reference === '' ? -1 : a.reference.localeCompare(b.reference, undefined, { numeric: true })))
      .map((g) => ({ ...g, at_target: g.outcomes.filter((o) => o.at_target).length }));
    return result;
  });

  // ---------- an outcome's status over time ----------

  // Every change of status from the history, and the status held in each assessment snapshot.
  ctx.app.get('/api/framework-outcomes/:id/timeline', view, async (req) => {
    const o = await needOutcome(req);
    const changes = await db.query<Row>(
      `select at, actor_name, action, before->>'status' as from_status, after->>'status' as to_status
       from audit_events
       where record_type = 'framework_outcome' and record_id = $1 and after ? 'status'
         and action in ('framework_outcome.create', 'framework_outcome.update')
       order by at, id`, [o.id]);
    const snapshots = await db.query<Row>(
      `select s.id, s.name, s.taken_on::text as taken_on, s.created_at, t.status
       from snapshot_statuses t join assessment_snapshots s on s.id = t.snapshot_id
       where t.outcome_id = $1 and s.deleted_at is null order by s.taken_on, s.created_at`, [o.id]);
    // A snapshot holds the statuses at the moment it was taken. When it was taken on the day it is
    // dated, that moment orders it among the day's changes; a back-dated one sorts at the end of its
    // day. "End of the day" allows for any time zone (UTC-12 to UTC+14), so the rule needs no zone.
    const snapshotKey = (s: Row) => Math.min(new Date(s.created_at).getTime(), Date.parse(`${s.taken_on}T00:00:00Z`) + 36 * HOUR);
    const events = [
      ...changes
        .filter((c) => c.action === 'framework_outcome.create' || c.from_status !== c.to_status)
        .map((c) => ({ kind: c.action === 'framework_outcome.create' ? 'created' : 'change', at: c.at, by: c.actor_name ?? null, from: c.from_status ?? null, to: c.to_status, snapshot_id: null, name: null, key: new Date(c.at).getTime() })),
      ...snapshots.map((s) => ({ kind: 'snapshot', at: s.taken_on, by: null, from: null, to: s.status, snapshot_id: s.id, name: s.name, key: snapshotKey(s) })),
    ].sort((a, b) => a.key - b.key).map(({ key: _key, ...e }) => e);
    return { status: o.status, review_on: o.review_on ?? null, events };
  });

  // ---------- editing an evidence entry or a mapping ----------

  ctx.app.patch('/api/framework-outcomes/:id/evidence/:evidenceId', edit, async (req) => {
    const o = await needOutcome(req);
    const eid = param(req, 'evidenceId');
    const before = UUID.test(eid)
      ? await db.one<Row>('select id, title, description, location, collected_on::text as collected_on, expires_on::text as expires_on from outcome_evidence where id = $1 and outcome_id = $2', [eid, o.id])
      : undefined;
    if (!before) ctx.fail(404, 'not_found', 'Evidence item not found.');
    const b = (req.body ?? {}) as Row;
    const clean = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
    const next: Row = { ...before };
    for (const k of ['title', 'description', 'location', 'collected_on', 'expires_on']) if (k in b) next[k] = clean(b[k]);
    const errors: Record<string, string> = {};
    if (!next.title) errors.title = 'Title is required.';
    for (const k of ['collected_on', 'expires_on']) {
      if (next[k] && !(DATE.test(next[k]) && !Number.isNaN(Date.parse(next[k])))) errors[k] = 'Must be a date (YYYY-MM-DD).';
    }
    if (!errors.collected_on && !errors.expires_on && next.collected_on && next.expires_on && next.expires_on < next.collected_on) {
      errors.expires_on = 'Expiry cannot be before the date collected.';
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const changed = ['title', 'description', 'location', 'collected_on', 'expires_on'].filter((k) => (before![k] ?? null) !== (next[k] ?? null));
    if (changed.length) {
      await db.query(
        `update outcome_evidence set title = $2, description = $3, location = $4, collected_on = $5, expires_on = $6, updated_at = now(), updated_by = $7 where id = $1`,
        [eid, next.title, next.description, next.location, next.collected_on, next.expires_on, req.user!.id]);
      await ctx.audit(req, {
        action: 'framework_outcome.evidence_edit', recordType: 'framework_outcome', recordId: o.id,
        summary: `Evidence changed on ${o.code}: ${next.title}`,
        before: Object.fromEntries(changed.map((k) => [k, before![k] ?? null])),
        after: Object.fromEntries(changed.map((k) => [k, next[k] ?? null])),
      });
    }
    return { ...next, outcome_id: o.id };
  });

  ctx.app.patch('/api/framework-outcomes/:id/mappings/:mappingId', edit, async (req) => {
    const o = await needOutcome(req);
    const mid = param(req, 'mappingId');
    const before = UUID.test(mid) ? await db.one<Row>('select id, framework_name, reference from outcome_mappings where id = $1 and outcome_id = $2', [mid, o.id]) : undefined;
    if (!before) ctx.fail(404, 'not_found', 'Mapping not found.');
    const b = (req.body ?? {}) as Row;
    const next = {
      framework_name: 'framework_name' in b ? String(b.framework_name ?? '').replace(/\s+/g, ' ').trim() : before!.framework_name as string,
      reference: 'reference' in b ? String(b.reference ?? '').replace(/\s+/g, ' ').trim() : before!.reference as string,
    };
    const problem = mappingProblem(next);
    if (problem) ctx.fail(400, 'validation', 'Check the highlighted fields.', problem);
    if (next.framework_name === before!.framework_name && next.reference === before!.reference) return before;
    const clash = await db.one(
      'select 1 from outcome_mappings where outcome_id = $1 and lower(framework_name) = lower($2) and lower(reference) = lower($3) and id <> $4',
      [o.id, next.framework_name, next.reference, mid]);
    if (clash) ctx.fail(400, 'validation', 'Check the highlighted fields.', { reference: 'This outcome is already mapped to that reference.' });
    await db.query('update outcome_mappings set framework_name = $2, reference = $3 where id = $1', [mid, next.framework_name, next.reference]);
    const text = await textFromRows(ctx, o.id, req.user!.id);
    await ctx.audit(req, {
      action: 'framework_outcome.mapping_edit', recordType: 'framework_outcome', recordId: o.id,
      summary: `${o.code} mapping changed to ${[next.framework_name, next.reference].filter(Boolean).join(' ')}`,
      before: { framework_name: before!.framework_name, reference: before!.reference, also_satisfies: text.before },
      after: { ...next, also_satisfies: text.after },
    });
    return { id: mid, outcome_id: o.id, ...next };
  });

  // ---------- review-date reminders ----------

  ctx.app.post('/api/frameworks/review-reminders/run', { preHandler: ctx.requirePerm('admin.administer') }, async () => sendReviewReminders(ctx));

  // No timers under the test runner or with a throwaway in-memory database.
  if (!process.env.VITEST && process.env.GRC_DATA_DIR !== 'memory') {
    const safeRun = () => { sendReviewReminders(ctx).catch((err) => console.error('[frameworks] review reminders failed:', err)); };
    const first = setTimeout(safeRun, 90_000);
    const timer = setInterval(safeRun, HOUR);
    first.unref();
    timer.unref();
    ctx.app.addHook('onClose', async () => { clearTimeout(first); clearInterval(timer); });
  }
}
