import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { text, UUID } from './dates.ts';

/**
 * Exercise steps: an exercise can copy the checklist of a security incident scenario (kept by
 * the security incidents module as templates) and record how each step went, so a tabletop
 * exercise rehearses exactly what the team would do in a real incident. Steps can also be
 * added by hand. The incident module may be absent: then only hand-written steps are offered.
 */
export function registerExerciseSteps(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('exercises.view') };
  const edit = { preHandler: ctx.requirePerm('exercises.edit') };
  const name = (e: Row) => [e.ref, e.title].filter(Boolean).join(' ');

  const needExercise = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('exercise', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Exercise not found.');
  const needStep = async (req: FastifyRequest, ex: Row): Promise<Row> => {
    const id = String((req.params as Row).stepId ?? '');
    const row = UUID.test(id)
      ? await db.one<Row>('select * from exercise_steps where id = $1 and exercise_id = $2 and deleted_at is null', [id, ex.id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Step not found.');
  };

  /** Whether the incident module's checklist templates are there to copy from. */
  async function templatesAvailable(): Promise<boolean> {
    if (!ctx.resources.get('security_incident')) return false;
    const t = await db.one<{ t: string | null }>(`select to_regclass('incident_checklist_templates')::text as t`);
    return Boolean(t?.t);
  }
  const labelOf = async (list: string, value: unknown) =>
    (await ctx.lookups.values(list)).find((v) => v.value === value)?.label ?? (value ? String(value) : '');

  const stepsOf = async (exerciseId: string) => {
    const phases = await ctx.lookups.values('incident_checklist_phase');
    const order = (p: unknown) => { const i = phases.findIndex((x) => x.value === p); return i < 0 ? 99 : i; };
    const rows = await db.query<Row>(
      'select id, phase, step, sort, outcome, notes, source_scenario from exercise_steps where exercise_id = $1 and deleted_at is null order by sort, created_at',
      [exerciseId],
    );
    return rows
      .map((r): Row => ({ ...r, phase_label: phases.find((p) => p.value === r.phase)?.label ?? r.phase ?? null }))
      .sort((a, b) => order(a.phase) - order(b.phase) || Number(a.sort) - Number(b.sort));
  };

  app.get('/api/exercises/scenario-checklists', view, async () => {
    if (!(await templatesAvailable())) return { available: false, scenarios: [] };
    const rows = await db.query<{ scenario: string; steps: number }>(
      `select scenario, count(*)::int as steps from incident_checklist_templates
       where deleted_at is null and coalesce(active, true) group by scenario order by scenario`,
    );
    const scenarios = [];
    for (const r of rows) scenarios.push({ value: r.scenario, label: await labelOf('security_incident_scenario', r.scenario), steps: r.steps });
    return { available: true, scenarios };
  });

  app.get('/api/exercises/:id/steps', view, async (req) => {
    const ex = await needExercise(req);
    const steps = await stepsOf(ex.id);
    const count = (o: string | null) => steps.filter((s) => (s.outcome ?? null) === o).length;
    return {
      steps,
      summary: { total: steps.length, went_well: count('went_well'), with_issues: count('with_issues'), not_done: count('not_done'), not_tested: count('not_tested'), unrecorded: count(null) },
    };
  });

  app.post('/api/exercises/:id/steps/copy', edit, async (req, reply) => {
    const ex = await needExercise(req);
    if (!(await templatesAvailable())) ctx.fail(409, 'unavailable', 'Incident scenario checklists are not available in this installation.');
    const scenario = text((req.body as Row | null)?.scenario);
    if (!scenario) ctx.fail(400, 'validation', 'Check the highlighted fields.', { scenario: 'Choose a scenario.' });
    if (await db.one('select 1 from exercise_steps where exercise_id = $1 and source_scenario = $2 and deleted_at is null limit 1', [ex.id, scenario])) {
      ctx.fail(409, 'already_copied', 'The checklist of this scenario is already on the exercise.');
    }
    const base = (await db.one<{ n: number }>('select coalesce(max(sort), 0)::int as n from exercise_steps where exercise_id = $1', [ex.id]))!.n;
    const made = await db.query<Row>(
      `insert into exercise_steps (exercise_id, phase, step, sort, source_scenario, created_by, updated_by)
       select $1, phase, step, $3 + row_number() over (order by phase, sort, id), scenario, $4, $4 from incident_checklist_templates
       where scenario = $2 and deleted_at is null and coalesce(active, true)
       returning id`,
      [ex.id, scenario, base, req.user!.id],
    );
    if (!made.length) ctx.fail(400, 'validation', 'Check the highlighted fields.', { scenario: 'That scenario has no checklist steps.' });
    const label = await labelOf('security_incident_scenario', scenario);
    await ctx.audit(req, {
      action: 'exercise_step.copy', recordType: 'exercise', recordId: ex.id,
      summary: `Checklist of the incident scenario "${label}" copied to ${name(ex)} (${made.length} steps)`,
      after: { scenario, steps: made.length },
    });
    reply.code(201);
    return { copied: made.length, steps: await stepsOf(ex.id) };
  });

  async function stepInput(body: Row, mode: 'create' | 'update'): Promise<Row> {
    const out: Row = {};
    const fields: Record<string, string> = {};
    if (body.step !== undefined || mode === 'create') {
      const s = text(body.step);
      if (!s) fields.step = 'Describe the step.';
      else out.step = s.slice(0, 1000);
    }
    if (body.notes !== undefined) out.notes = text(body.notes);
    if (body.phase !== undefined) {
      const p = text(body.phase);
      if (p && !(await ctx.lookups.values('incident_checklist_phase')).some((x) => x.value === p)) fields.phase = 'Choose a phase from the list.';
      else out.phase = p;
    }
    if (body.outcome !== undefined) {
      const o = text(body.outcome);
      if (o && !(await ctx.lookups.values('exercise_step_outcome')).some((x) => x.value === o)) fields.outcome = 'Choose how the step went.';
      else out.outcome = o;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  app.post('/api/exercises/:id/steps', edit, async (req, reply) => {
    const ex = await needExercise(req);
    const data = await stepInput((req.body ?? {}) as Row, 'create');
    const base = (await db.one<{ n: number }>('select coalesce(max(sort), 0)::int as n from exercise_steps where exercise_id = $1', [ex.id]))!.n;
    const row = (await db.one<Row>(
      `insert into exercise_steps (exercise_id, phase, step, sort, outcome, notes, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7) returning *`,
      [ex.id, data.phase ?? null, data.step, base + 1, data.outcome ?? null, data.notes ?? null, req.user!.id],
    ))!;
    await ctx.audit(req, {
      action: 'exercise_step.create', recordType: 'exercise', recordId: ex.id,
      summary: `Step added to ${name(ex)}: ${row.step}`, after: { step: row.step, phase: row.phase, outcome: row.outcome },
    });
    reply.code(201);
    return row;
  });

  app.patch('/api/exercises/:id/steps/:stepId', edit, async (req) => {
    const ex = await needExercise(req);
    const before = await needStep(req, ex);
    const data = await stepInput((req.body ?? {}) as Row, 'update');
    const keys = Object.keys(data).filter((k) => (data[k] ?? null) !== (before[k] ?? null));
    if (!keys.length) return before;
    const row = (await db.one<Row>(
      `update exercise_steps set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [before.id, req.user!.id, ...keys.map((k) => data[k])],
    ))!;
    const outcome = keys.includes('outcome') ? await labelOf('exercise_step_outcome', row.outcome) : '';
    await ctx.audit(req, {
      action: 'exercise_step.update', recordType: 'exercise', recordId: ex.id,
      summary: `Step on ${name(ex)} ${outcome ? `recorded as "${outcome}"` : 'updated'}: ${row.step}`,
      before: Object.fromEntries(keys.map((k) => [k, before[k] ?? null])), after: Object.fromEntries(keys.map((k) => [k, data[k] ?? null])),
    });
    return row;
  });

  app.delete('/api/exercises/:id/steps/:stepId', edit, async (req) => {
    const ex = await needExercise(req);
    const before = await needStep(req, ex);
    await db.query('update exercise_steps set deleted_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'exercise_step.delete', recordType: 'exercise', recordId: ex.id,
      summary: `Step removed from ${name(ex)}: ${before.step}`, before: { step: before.step, phase: before.phase, outcome: before.outcome, notes: before.notes },
    });
    return { ok: true };
  });
}
