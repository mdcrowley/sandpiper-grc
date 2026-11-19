import type { FastifyRequest } from 'fastify';
import { todayInZone } from '../../core/config.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { registerAdmin } from './admin.ts';
import { registerExtras } from './extras.ts';
import { DEFAULT_NAMES, NAMES_LIST, mappingProblem, rowsFromText, textFromRows } from './mappings.ts';
import { seedFrameworks } from './seed.ts';
import { COLORS, DEFAULT_STATUS, saveStructure } from './structure.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Earliest date an assessment snapshot may carry. */
export const EARLIEST_SNAPSHOT = '2000-01-01';

/** Setting: the status every priority outcome is expected to reach (the "target profile" line on charts). */
export const TARGET_SETTING = 'frameworks.target_status';

// ---------- status scale and tallies ----------

export interface ScaleValue { value: string; label: string; color: string; weight: number }
export interface Scale { values: ScaleValue[]; weightOf(status: string): number; target: { status: string; weight: number; score: number } }
export interface Tally { total: number; counts: Record<string, number>; score: number; atTarget: number; atTargetPct: number }
interface StatusRow { status: string; priority: boolean; function_code: string | null }

/** The configurable status scale: lookup `outcome_status`, numeric weight (0 to 1) in `meta.weight`. */
export async function loadScale(ctx: ModuleContext): Promise<Scale> {
  const values = (await ctx.lookups.values('outcome_status')).map((v) => ({
    value: v.value, label: v.label, color: v.color ?? 'gray',
    weight: Math.min(1, Math.max(0, Number(v.meta?.weight) || 0)),
  }));
  const weights = new Map(values.map((v) => [v.value, v.weight]));
  const weightOf = (s: string) => weights.get(s) ?? 0;
  const wanted = await ctx.settings.get<string>(TARGET_SETTING, 'largely_met');
  const status = weights.has(wanted) ? wanted : values[values.length - 1]?.value ?? wanted;
  return { values, weightOf, target: { status, weight: weightOf(status), score: Math.round(weightOf(status) * 100) } };
}

/** Counts by status, a weighted score out of 100, and how many are at or above the target status. */
export function tally(rows: StatusRow[], scale: Scale): Tally {
  const counts: Record<string, number> = Object.fromEntries(scale.values.map((v) => [v.value, 0]));
  let weight = 0;
  let atTarget = 0;
  for (const r of rows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    const w = scale.weightOf(r.status);
    weight += w;
    if (w >= scale.target.weight && scale.target.weight > 0) atTarget += 1;
  }
  const total = rows.length;
  return {
    total, counts,
    score: total ? Math.round((weight / total) * 100) : 0,
    atTarget,
    atTargetPct: total ? Math.round((atTarget / total) * 100) : 0,
  };
}

const both = (rows: StatusRow[], scale: Scale) => ({
  all: tally(rows, scale),
  priority: tally(rows.filter((r) => r.priority), scale),
});

const titleOf = (description: unknown, official: unknown): string | null => {
  const text = String(description || official || '').replace(/\s+/g, ' ').trim();
  return text ? (text.length > 200 ? `${text.slice(0, 197)}...` : text) : null;
};

const mod: ModuleDef = {
  key: 'frameworks',

  async seedDefaults(ctx) {
    await ctx.lookups.ensure('outcome_status', [
      { value: 'not_evidenced', label: 'Not evidenced', color: 'red', sort: 10, meta: { weight: 0 } },
      { value: 'partial', label: 'Partial', color: 'amber', sort: 20, meta: { weight: 0.33 } },
      { value: 'largely_met', label: 'Largely met', color: 'blue', sort: 30, meta: { weight: 0.67 } },
      { value: 'met', label: 'Met', color: 'green', sort: 40, meta: { weight: 1 } },
    ], { module: 'frameworks' });
    await ctx.lookups.ensure('outcome_phase', [
      { value: 'now', label: 'Now', color: 'purple', sort: 10 },
      { value: 'next', label: 'Next', color: 'blue', sort: 20 },
      { value: 'later', label: 'Later', color: 'gray', sort: 30 },
    ], { module: 'frameworks' });
    // Other frameworks' names offered when mapping an outcome, and recognized by the "also satisfies" parser.
    await ctx.lookups.ensure(NAMES_LIST, DEFAULT_NAMES.map((label, i) => ({
      value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label, color: 'gray', sort: (i + 1) * 10,
    })), { module: 'frameworks' });
  },

  async register(ctx) {
    const { db } = ctx;
    const view = { preHandler: ctx.requirePerm('frameworks.view') };
    const edit = { preHandler: ctx.requirePerm('frameworks.edit') };
    const idOf = (req: FastifyRequest, name = 'id') => String((req.params as Row)[name] ?? '');

    // ---------- resources ----------

    ctx.defineResource({
      type: 'framework', table: 'frameworks', module: 'frameworks',
      label: 'Framework', plural: 'Frameworks',
      path: '/api/frameworks', route: '/frameworks/board',
      titleField: 'name', searchable: ['name', 'key', 'description'],
      defaultSort: { field: 'name', dir: 'asc' },
      fields: {
        key: { label: 'Key', type: 'text', required: true },
        name: { label: 'Name', type: 'text', required: true },
        version: { label: 'Version', type: 'text' },
        description: { label: 'Description', type: 'longtext' },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          if (await db.one('select 1 from frameworks where lower(key) = lower($1) and deleted_at is null', [data.key])) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { key: 'A framework with this key already exists.' });
          }
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          if (patch.key && String(patch.key).toLowerCase() !== String(existing.key).toLowerCase()
            && await db.one('select 1 from frameworks where lower(key) = lower($1) and deleted_at is null and id <> $2', [patch.key, existing.id])) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { key: 'A framework with this key already exists.' });
          }
          return patch;
        },
      },
    });

    /** Fills function and category from the outcome code when they were not given. */
    async function placeOutcome(frameworkId: string, data: Row, code: string): Promise<void> {
      if (!data.category_code && code.includes('-')) {
        const guess = code.slice(0, code.lastIndexOf('-'));
        const cat = await db.one<Row>('select code, function_code from framework_categories where framework_id = $1 and code = $2', [frameworkId, guess]);
        if (cat) data.category_code = cat.code;
      }
      if (data.category_code && !data.function_code) {
        const cat = await db.one<Row>('select function_code from framework_categories where framework_id = $1 and code = $2', [frameworkId, data.category_code]);
        if (cat) data.function_code = cat.function_code;
      }
    }

    ctx.defineResource({
      type: 'framework_outcome', table: 'framework_outcomes', module: 'frameworks',
      label: 'Framework outcome', plural: 'Framework outcomes',
      path: '/api/framework-outcomes', route: '/frameworks/outcomes',
      titleField: 'title',
      // The reference is the outcome's own code (for example GV.OC-01). `code` is required,
      // so the auto-number prefix is never used.
      ref: { field: 'code', prefix: 'OUT-' },
      searchable: ['code', 'title', 'official_text', 'description', 'target', 'first_action', 'evidence_summary', 'also_satisfies'],
      defaultSort: { field: 'code', dir: 'asc' },
      fields: {
        code: { label: 'Code', type: 'text', required: true },
        title: { label: 'Outcome', type: 'text', readOnly: true },
        framework_id: { label: 'Framework', type: 'ref', to: 'framework', required: true },
        function_code: { label: 'Function', type: 'text' },
        category_code: { label: 'Category', type: 'text' },
        official_text: { label: 'Official text', type: 'longtext' },
        description: { label: 'Plain-language description', type: 'longtext' },
        priority: { label: 'Priority outcome', type: 'boolean', default: false },
        designation: { label: 'Designation', type: 'text' },
        status: { label: 'Status', type: 'lookup', list: 'outcome_status', default: DEFAULT_STATUS },
        target: { label: 'Target', type: 'longtext' },
        owner_id: { label: 'Owner', type: 'user' },
        phase: { label: 'Phase', type: 'lookup', list: 'outcome_phase' },
        first_action: { label: 'First action', type: 'longtext' },
        evidence_summary: { label: 'Evidence summary', type: 'longtext' },
        also_satisfies: { label: 'Also satisfies', type: 'text' },
        review_on: { label: 'Review date', type: 'date' },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          if (!(await db.one('select 1 from frameworks where id = $1 and deleted_at is null', [data.framework_id]))) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { framework_id: 'Choose a framework.' });
          }
          if (await db.one('select 1 from framework_outcomes where framework_id = $1 and code = $2 and deleted_at is null', [data.framework_id, data.code])) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { code: 'This framework already has an outcome with that code.' });
          }
          await placeOutcome(data.framework_id, data, data.code);
          data.title = titleOf(data.description, data.official_text);
          return data;
        },
        // "Also satisfies" typed as text becomes mapping rows (a person's edit only: the seed adds its own rows).
        afterCreate: async (req, row) => {
          if (req && row.also_satisfies) await syncMappingsFromText(req, row);
        },
        afterUpdate: async (req, before, after) => {
          if (req && (before.also_satisfies ?? null) !== (after.also_satisfies ?? null)) await syncMappingsFromText(req, after);
        },
        beforeUpdate: async (_req, existing, patch) => {
          const frameworkId = patch.framework_id ?? existing.framework_id;
          const code = patch.code ?? existing.code;
          if ((code !== existing.code || frameworkId !== existing.framework_id)
            && await db.one('select 1 from framework_outcomes where framework_id = $1 and code = $2 and deleted_at is null and id <> $3', [frameworkId, code, existing.id])) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { code: 'This framework already has an outcome with that code.' });
          }
          if ('description' in patch || 'official_text' in patch) {
            patch.title = titleOf(
              'description' in patch ? patch.description : existing.description,
              'official_text' in patch ? patch.official_text : existing.official_text,
            );
          }
          return patch;
        },
      },
    });

    ctx.defineResource({
      type: 'assessment_snapshot', table: 'assessment_snapshots', module: 'frameworks',
      label: 'Assessment snapshot', plural: 'Assessment snapshots',
      path: '/api/assessment-snapshots', route: '/assessments',
      titleField: 'name', searchable: ['name', 'notes'],
      defaultSort: { field: 'taken_on', dir: 'desc' },
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        framework_id: { label: 'Framework', type: 'ref', to: 'framework' },
        taken_on: { label: 'Date', type: 'date' },
        notes: { label: 'Notes', type: 'longtext' },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          if (!data.framework_id) {
            const all = await db.query<{ id: string }>('select id from frameworks where deleted_at is null order by created_at limit 2');
            if (all.length !== 1) {
              ctx.fail(400, 'validation', 'Check the highlighted fields.', {
                framework_id: all.length ? 'Choose which framework to snapshot.' : 'There is no framework to snapshot yet.',
              });
            }
            data.framework_id = all[0].id;
          } else if (!(await db.one('select 1 from frameworks where id = $1 and deleted_at is null', [data.framework_id]))) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { framework_id: 'Choose a framework.' });
          }
          if (!data.taken_on) data.taken_on = todayInZone();
          checkSnapshotDate(data.taken_on);
          return data;
        },
        // A snapshot is the status of every outcome at the moment it is taken.
        afterCreate: async (req, row) => {
          const captured = await db.query(
            `insert into snapshot_statuses (snapshot_id, outcome_id, code, title, function_code, category_code, priority, status)
             select $1, id, code, title, function_code, category_code, priority, status
             from framework_outcomes where framework_id = $2 and deleted_at is null returning 1`,
            [row.id, row.framework_id],
          );
          await ctx.audit(req, {
            action: 'assessment_snapshot.capture', recordType: 'assessment_snapshot', recordId: row.id,
            summary: `Status of ${captured.length} outcome(s) captured in snapshot "${row.name}"`,
          });
        },
        // The framework and the captured statuses never change after the snapshot is taken.
        beforeUpdate: async (_req, _existing, patch) => {
          delete patch.framework_id;
          if (patch.taken_on === null) delete patch.taken_on;
          if (patch.taken_on !== undefined) checkSnapshotDate(patch.taken_on);
          return patch;
        },
      },
    });

    /** Keeps the cross-mapping rows in step with an outcome's "also satisfies" text. */
    async function syncMappingsFromText(req: FastifyRequest, row: Row): Promise<void> {
      const { added, removed } = await rowsFromText(ctx, row.id, row.also_satisfies ?? null, req.user?.id ?? null);
      if (!added.length && !removed.length) return;
      await ctx.audit(req, {
        action: 'framework_outcome.mapping_sync', recordType: 'framework_outcome', recordId: row.id,
        summary: `Mappings of ${row.code} brought in step with its "also satisfies" text: ${added.length} added, ${removed.length} removed`,
        before: removed.length ? removed : undefined, after: added.length ? added : undefined,
      });
    }

    /** A snapshot records what was true on its date: a real calendar day, not in the future and not before 2000. */
    function checkSnapshotDate(value: unknown): void {
      const text = String(value);
      const parsed = new Date(`${text}T00:00:00Z`);
      const real = DATE.test(text) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
      const problem = !real ? 'Date must be a real calendar date (YYYY-MM-DD).'
        : text > todayInZone() ? 'Date cannot be in the future.'
        : text < EARLIEST_SNAPSHOT ? `Date cannot be before ${EARLIEST_SNAPSHOT}.` : null;
      if (problem) ctx.fail(400, 'validation', 'Check the highlighted fields.', { taken_on: problem });
    }

    // ---------- shared queries ----------

    async function needFramework(id: string): Promise<Row> {
      const row = UUID.test(id) ? await db.one<Row>('select id, key, name, version, description from frameworks where id = $1 and deleted_at is null', [id]) : undefined;
      return row ?? ctx.fail(404, 'not_found', 'Framework not found.');
    }

    async function needOutcome(req: FastifyRequest): Promise<Row> {
      const row = await ctx.resources.find('framework_outcome', idOf(req), req.user);
      return row ?? ctx.fail(404, 'not_found', 'Framework outcome not found.');
    }

    async function structure(frameworkId: string) {
      const functions = await db.query<Row>(
        'select code, name, description, color, sort from framework_functions where framework_id = $1 order by sort, code', [frameworkId]);
      const categories = await db.query<Row>(
        'select function_code, code, name, description, sort from framework_categories where framework_id = $1 order by sort, code', [frameworkId]);
      return { functions, categories };
    }

    /** Function codes in display order: the defined functions first, then any other code found on outcomes. */
    function functionOrder(functions: Row[], rows: { function_code: string | null }[]) {
      const out = functions.map((f) => ({ code: f.code as string, name: f.name as string, color: f.color as string, description: f.description ?? null }));
      const known = new Set(out.map((f) => f.code));
      for (const r of rows) {
        const code = r.function_code ?? '';
        if (!known.has(code)) {
          known.add(code);
          out.push({ code, name: code || 'No function', color: 'gray', description: null });
        }
      }
      return out;
    }

    const liveStatuses = (frameworkId: string) => db.query<Row>(
      `select id as outcome_id, code, title, function_code, category_code, priority, status
       from framework_outcomes where framework_id = $1 and deleted_at is null order by code`, [frameworkId]);

    const snapshotStatuses = (snapshotId: string) => db.query<Row>(
      `select outcome_id, code, title, function_code, category_code, priority, status
       from snapshot_statuses where snapshot_id = $1 order by code`, [snapshotId]);

    async function needSnapshot(id: string): Promise<Row> {
      const row = UUID.test(id)
        ? await db.one<Row>('select id, framework_id, name, taken_on, notes, created_at, created_by from assessment_snapshots where id = $1 and deleted_at is null', [id])
        : undefined;
      return row ?? ctx.fail(404, 'not_found', 'Assessment snapshot not found.');
    }

    // ---------- framework structure ----------

    ctx.app.get('/api/frameworks/:id/structure', view, async (req) => {
      const fw = await needFramework(idOf(req));
      const { functions, categories } = await structure(fw.id);
      return {
        framework: fw,
        functions: functions.map((f) => ({ ...f, categories: categories.filter((c) => c.function_code === f.code).map(({ function_code: _f, ...c }) => c) })),
      };
    });

    // Adds or updates functions and categories (never removes: outcomes may still point at them).
    ctx.app.post('/api/frameworks/:id/structure', edit, async (req) => {
      const fw = await needFramework(idOf(req));
      const body = (req.body ?? {}) as Row;
      const list: Row[] = Array.isArray(body.functions) ? body.functions : [];
      const errors: Record<string, string> = {};
      if (!list.length) errors.functions = 'Give at least one function.';
      list.forEach((f, i) => {
        if (!String(f?.code ?? '').trim() || !String(f?.name ?? '').trim()) errors[`functions.${i}`] = 'Each function needs a code and a name.';
        if (f?.color && !COLORS.includes(f.color)) errors[`functions.${i}.color`] = `Color must be one of: ${COLORS.join(', ')}.`;
        (Array.isArray(f?.categories) ? f.categories : []).forEach((c: Row, j: number) => {
          if (!String(c?.code ?? '').trim() || !String(c?.name ?? '').trim()) errors[`functions.${i}.categories.${j}`] = 'Each category needs a code and a name.';
        });
      });
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
      const before = await structure(fw.id);
      await saveStructure(ctx, fw.id, list);
      const after = await structure(fw.id);
      await ctx.audit(req, {
        action: 'framework.structure', recordType: 'framework', recordId: fw.id,
        summary: `Functions and categories updated for ${fw.name}`,
        before: { functions: before.functions.length, categories: before.categories.length },
        after: { functions: after.functions.length, categories: after.categories.length },
      });
      return { ok: true, functions: after.functions.length, categories: after.categories.length };
    });

    // ---------- board ----------

    ctx.app.get('/api/frameworks/:id/board', view, async (req) => {
      const fw = await needFramework(idOf(req));
      const scale = await loadScale(ctx);
      const { functions, categories } = await structure(fw.id);
      const outcomes = await db.query<Row>(
        `select o.id, o.code, o.title, o.official_text, o.description, o.function_code, o.category_code, o.priority,
                o.designation, o.status, o.phase, o.owner_id, u.display_name as owner_name, o.review_on, o.target
         from framework_outcomes o left join users u on u.id = o.owner_id
         where o.framework_id = $1 and o.deleted_at is null order by o.code`, [fw.id]);
      const fnList = functionOrder(functions, outcomes as any).filter((f) => f.code !== '' || outcomes.some((o) => !o.function_code));
      return {
        framework: fw,
        statuses: scale.values,
        phases: (await ctx.lookups.values('outcome_phase')).map((p) => ({ value: p.value, label: p.label, color: p.color ?? 'gray' })),
        target: scale.target,
        summary: both(outcomes as any, scale),
        functions: fnList.map((f) => {
          const mine = outcomes.filter((o) => (o.function_code ?? '') === f.code);
          const cats = categories.filter((c) => c.function_code === f.code).map((c) => ({ code: c.code as string, name: c.name as string, description: c.description ?? null }));
          const known = new Set(cats.map((c) => c.code));
          for (const o of mine) {
            const code = o.category_code ?? '';
            if (!known.has(code)) {
              known.add(code);
              cats.push({ code, name: code || 'No category', description: null });
            }
          }
          return {
            ...f,
            ...both(mine as any, scale),
            categories: cats
              .map((c) => ({ ...c, outcomes: mine.filter((o) => (o.category_code ?? '') === c.code) }))
              .filter((c) => c.outcomes.length || c.code !== ''),
          };
        }),
      };
    });

    // ---------- progress over time ----------

    ctx.app.get('/api/frameworks/:id/progress', view, async (req) => {
      const fw = await needFramework(idOf(req));
      const scale = await loadScale(ctx);
      const snapshots = await db.query<Row>(
        `select id, name, taken_on from assessment_snapshots where framework_id = $1 and deleted_at is null
         order by taken_on, created_at`, [fw.id]);
      const rows = snapshots.length
        ? await db.query<Row>(
          'select snapshot_id, status, priority, function_code from snapshot_statuses where snapshot_id = any($1::uuid[])',
          [snapshots.map((s) => s.id)])
        : [];
      const series = snapshots.map((s) => ({
        id: s.id as string | null, name: s.name as string, date: s.taken_on as string, current: false,
        ...both(rows.filter((r) => r.snapshot_id === s.id) as any, scale),
      }));
      const today = (await db.one<{ d: string }>('select current_date::text as d'))!.d;
      series.push({ id: null, name: 'Now', date: today, current: true, ...both((await liveStatuses(fw.id)) as any, scale) });
      return { framework: fw, statuses: scale.values, target: scale.target, series };
    });

    // ---------- assessments (snapshots) ----------

    ctx.app.post('/api/assessments', { preHandler: ctx.requirePerm('frameworks.create') }, async (req, reply) => {
      const b = (req.body ?? {}) as Row;
      // The administrator's custom fields (`cf_<key>`) pass through; the resource engine validates them (E18-34).
      const custom = Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith('cf_')));
      const row = await ctx.resources.create('assessment_snapshot', {
        name: b.name, notes: b.notes, framework_id: b.framework_id, taken_on: b.date ?? b.taken_on, ...custom,
      }, req);
      const scale = await loadScale(ctx);
      reply.code(201);
      return { ...row, ...both((await snapshotStatuses(row.id)) as any, scale) };
    });

    ctx.app.get('/api/assessments/compare', view, async (req) => {
      const q = req.query as Record<string, string>;
      const from = await needSnapshot(String(q.from ?? ''));
      const live = !q.to || q.to === 'now';
      const to = live ? null : await needSnapshot(q.to);
      if (to && to.framework_id !== from.framework_id) ctx.fail(400, 'validation', 'Choose two snapshots of the same framework.');
      const scale = await loadScale(ctx);
      const a = await snapshotStatuses(from.id);
      const b = to ? await snapshotStatuses(to.id) : await liveStatuses(from.framework_id);
      const { functions } = await structure(from.framework_id);
      const today = (await db.one<{ d: string }>('select current_date::text as d'))!.d;

      const before = new Map(a.map((r) => [r.outcome_id as string, r]));
      const after = new Map(b.map((r) => [r.outcome_id as string, r]));
      const changed: Row[] = [];
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const x = before.get(id);
        const y = after.get(id);
        if (x && y && x.status === y.status) continue;
        const ref = y ?? x!;
        const diff = x && y ? scale.weightOf(y.status) - scale.weightOf(x.status) : 0;
        changed.push({
          outcome_id: id, code: ref.code, title: ref.title, function_code: ref.function_code, priority: ref.priority,
          from: x?.status ?? null, to: y?.status ?? null,
          direction: !x ? 'added' : !y ? 'removed' : diff > 0 ? 'improved' : diff < 0 ? 'declined' : 'changed',
        });
      }
      changed.sort((p, r) => String(p.code).localeCompare(String(r.code)));

      return {
        from: { id: from.id, name: from.name, date: from.taken_on },
        to: to ? { id: to.id, name: to.name, date: to.taken_on } : { id: null, name: 'Now', date: today },
        statuses: scale.values,
        target: scale.target,
        overall: { from: both(a as any, scale), to: both(b as any, scale) },
        functions: functionOrder(functions, [...a, ...b] as any).map((f) => ({
          code: f.code, name: f.name, color: f.color,
          from: tally(a.filter((r) => (r.function_code ?? '') === f.code) as any, scale),
          to: tally(b.filter((r) => (r.function_code ?? '') === f.code) as any, scale),
        })),
        changed,
      };
    });

    ctx.app.get('/api/assessments/:id', view, async (req) => {
      const snap = await needSnapshot(idOf(req));
      const scale = await loadScale(ctx);
      const outcomes = await snapshotStatuses(snap.id);
      const { functions, categories } = await structure(snap.framework_id);
      // The snapshot before this one, so a report can say what moved since.
      const previous = await db.one<Row>(
        `select id, name, taken_on from assessment_snapshots
         where framework_id = $1 and deleted_at is null and id <> $2 and (taken_on, created_at) < ($3::date, $4::timestamptz)
         order by taken_on desc, created_at desc limit 1`, [snap.framework_id, snap.id, snap.taken_on, snap.created_at]);
      return {
        ...snap,
        previous: previous ?? null,
        categories: categories.map((c) => ({ code: c.code, name: c.name, function_code: c.function_code })),
        framework_name: await ctx.resources.labelFor('framework', snap.framework_id),
        statuses: scale.values,
        target: scale.target,
        ...both(outcomes as any, scale),
        functions: functionOrder(functions, outcomes as any).map((f) => ({
          code: f.code, name: f.name, color: f.color,
          ...tally(outcomes.filter((r) => (r.function_code ?? '') === f.code) as any, scale),
        })),
        outcomes,
      };
    });

    // ---------- outcome context, evidence and cross-mappings ----------

    ctx.app.get('/api/framework-outcomes/:id/context', view, async (req) => {
      const o = await needOutcome(req);
      return {
        framework: await db.one('select id, key, name, version from frameworks where id = $1', [o.framework_id]),
        function: (await db.one('select code, name, description, color from framework_functions where framework_id = $1 and code = $2', [o.framework_id, o.function_code])) ?? null,
        category: (await db.one('select code, name, description from framework_categories where framework_id = $1 and code = $2', [o.framework_id, o.category_code])) ?? null,
      };
    });

    ctx.app.get('/api/framework-outcomes/:id/evidence', view, async (req) => {
      const o = await needOutcome(req);
      return db.query(
        `select e.id, e.outcome_id, e.title, e.description, e.location, e.collected_on, e.expires_on, e.created_at,
                u.display_name as created_by_name,
                case when e.expires_on is null then 'current'
                     when e.expires_on < current_date then 'expired'
                     when e.expires_on <= current_date + 30 then 'expiring' else 'current' end as state
         from outcome_evidence e left join users u on u.id = e.created_by
         where e.outcome_id = $1 order by e.collected_on desc nulls last, e.created_at desc`, [o.id]);
    });

    ctx.app.post('/api/framework-outcomes/:id/evidence', edit, async (req, reply) => {
      const o = await needOutcome(req);
      const b = (req.body ?? {}) as Row;
      const text = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
      const errors: Record<string, string> = {};
      if (!text(b.title)) errors.title = 'Title is required.';
      for (const k of ['collected_on', 'expires_on']) {
        if (text(b[k]) && !(DATE.test(text(b[k])!) && !Number.isNaN(Date.parse(text(b[k])!)))) errors[k] = 'Must be a date (YYYY-MM-DD).';
      }
      if (!errors.collected_on && !errors.expires_on && text(b.collected_on) && text(b.expires_on) && text(b.expires_on)! < text(b.collected_on)!) {
        errors.expires_on = 'Expiry cannot be before the date collected.';
      }
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
      const row = (await db.one<Row>(
        `insert into outcome_evidence (outcome_id, title, description, location, collected_on, expires_on, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id, outcome_id, title, description, location, collected_on, expires_on, created_at`,
        [o.id, text(b.title), text(b.description), text(b.location), text(b.collected_on), text(b.expires_on), req.user!.id],
      ))!;
      await ctx.audit(req, {
        action: 'framework_outcome.evidence_add', recordType: 'framework_outcome', recordId: o.id,
        summary: `Evidence added to ${o.code}: ${row.title}`,
        after: { title: row.title, location: row.location, collected_on: row.collected_on, expires_on: row.expires_on },
      });
      reply.code(201);
      return row;
    });

    ctx.app.delete('/api/framework-outcomes/:id/evidence/:evidenceId', edit, async (req) => {
      const o = await needOutcome(req);
      const eid = idOf(req, 'evidenceId');
      const row = UUID.test(eid)
        ? await db.one<Row>('delete from outcome_evidence where id = $1 and outcome_id = $2 returning *', [eid, o.id])
        : undefined;
      if (!row) ctx.fail(404, 'not_found', 'Evidence item not found.');
      await ctx.audit(req, {
        action: 'framework_outcome.evidence_remove', recordType: 'framework_outcome', recordId: o.id,
        summary: `Evidence removed from ${o.code}: ${row!.title}`,
        before: { title: row!.title, description: row!.description, location: row!.location, collected_on: row!.collected_on, expires_on: row!.expires_on },
      });
      return { ok: true };
    });

    ctx.app.get('/api/framework-outcomes/:id/mappings', view, async (req) => {
      const o = await needOutcome(req);
      return db.query(
        'select id, outcome_id, framework_name, reference, created_at from outcome_mappings where outcome_id = $1 order by lower(framework_name), reference', [o.id]);
    });

    ctx.app.post('/api/framework-outcomes/:id/mappings', edit, async (req, reply) => {
      const o = await needOutcome(req);
      const b = (req.body ?? {}) as Row;
      const name = String(b.framework_name ?? '').trim();
      const reference = String(b.reference ?? '').trim();
      const problem = mappingProblem({ framework_name: name, reference });
      if (problem) ctx.fail(400, 'validation', 'Check the highlighted fields.', problem);
      const row = await db.one<Row>(
        `insert into outcome_mappings (outcome_id, framework_name, reference, created_by) values ($1,$2,$3,$4)
         on conflict do nothing returning id, outcome_id, framework_name, reference, created_at`,
        [o.id, name, reference, req.user!.id],
      );
      if (!row) ctx.fail(400, 'validation', 'Check the highlighted fields.', { reference: 'This outcome is already mapped to that reference.' });
      const text = await textFromRows(ctx, o.id, req.user!.id);
      await ctx.audit(req, {
        action: 'framework_outcome.mapping_add', recordType: 'framework_outcome', recordId: o.id,
        summary: `${o.code} mapped to ${[name, reference].filter(Boolean).join(' ')}`,
        before: { also_satisfies: text.before },
        after: { framework_name: name, reference, also_satisfies: text.after },
      });
      reply.code(201);
      return row;
    });

    ctx.app.delete('/api/framework-outcomes/:id/mappings/:mappingId', edit, async (req) => {
      const o = await needOutcome(req);
      const mid = idOf(req, 'mappingId');
      const row = UUID.test(mid)
        ? await db.one<Row>('delete from outcome_mappings where id = $1 and outcome_id = $2 returning *', [mid, o.id])
        : undefined;
      if (!row) ctx.fail(404, 'not_found', 'Mapping not found.');
      const text = await textFromRows(ctx, o.id, req.user!.id);
      await ctx.audit(req, {
        action: 'framework_outcome.mapping_remove', recordType: 'framework_outcome', recordId: o.id,
        summary: `${o.code} no longer mapped to ${[row!.framework_name, row!.reference].filter(Boolean).join(' ')}`,
        before: { framework_name: row!.framework_name, reference: row!.reference, also_satisfies: text.before },
        after: { also_satisfies: text.after },
      });
      return { ok: true };
    });

    // Every other framework name already in use, for the "also satisfies" picker.
    ctx.app.get('/api/framework-mappings/names', view, async () =>
      (await db.query<{ framework_name: string }>(
        'select framework_name from outcome_mappings group by framework_name order by count(*) desc, framework_name limit 100',
      )).map((r) => r.framework_name));

    await registerExtras(ctx, loadScale);
    registerAdmin(ctx);
  },

  seed: (ctx, opts) => seedFrameworks(ctx, opts),
};

export default mod;
