import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { meanings } from './lists.ts';
import { UUID_RE } from './shared.ts';

/**
 * Written test steps (E41-12). A control carries the steps a tester follows, in order, each with what
 * the tester should find. When a test of the control is recorded the steps are copied into it, and
 * the tester gives each one a result (list `control_step_result`) and a note. The copy is the test's
 * own: changing the control's steps later never rewrites a past test, and steps added to the control
 * after a test started can be brought in with "Copy the control's steps". A test cannot be marked
 * finished while a step has no result, and a reviewed test's steps cannot be changed.
 */

const STEP_COLUMNS = 'id, sort, step, expected, created_at, updated_at';
const RESULT_COLUMNS = 'id, step_id, sort, step, expected, result, note, done_by, done_at';
const MAX_STEPS = 100;

/** Steps of a test that still have no result. */
export async function stepsWithoutResult(ctx: ModuleContext, testId: string): Promise<number> {
  return (await ctx.db.one<{ n: number }>('select count(*)::int as n from control_test_steps where test_id = $1 and result is null', [testId]))!.n;
}

/** Copies the control's steps that the test does not have yet; returns how many were added. */
export async function copySteps(ctx: ModuleContext, testId: string, controlId: string, userId: string | null): Promise<number> {
  const steps = await ctx.db.query<Row>(
    `select s.id, s.step, s.expected from control_steps s
     where s.control_id = $1 and not exists (select 1 from control_test_steps t where t.test_id = $2 and t.step_id = s.id)
     order by s.sort, s.created_at`, [controlId, testId]);
  if (!steps.length) return 0;
  const base = (await ctx.db.one<{ n: number }>('select coalesce(max(sort), 0)::int as n from control_test_steps where test_id = $1', [testId]))!.n;
  for (const [i, s] of steps.entries()) {
    await ctx.db.query(
      `insert into control_test_steps (test_id, step_id, sort, step, expected, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $6)`,
      [testId, s.id, base + (i + 1) * 10, s.step, s.expected, userId]);
  }
  return steps.length;
}

export function registerSteps(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  const needControl = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id);
    return (UUID_RE.test(id) ? await ctx.resources.find('control', id, req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Control not found.');
  };
  const needTest = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id);
    return (UUID_RE.test(id) ? await ctx.resources.find('control_test', id, req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Control test not found.');
  };
  const stepOf = async (control: Row, stepId: string): Promise<Row> =>
    (UUID_RE.test(stepId) ? await db.one<Row>(`select ${STEP_COLUMNS} from control_steps where id = $1 and control_id = $2`, [stepId, control.id]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Test step not found.');
  const notFinal = async (test: Row) => {
    if ((await meanings(ctx)).final.includes(test.status)) ctx.fail(409, 'reviewed', 'A reviewed test cannot be changed. Record a new test instead.');
  };

  function stepInput(body: Row, partial: boolean): Row {
    const out: Row = {};
    const errors: Record<string, string> = {};
    if (!partial || 'step' in body) {
      const step = String(body.step ?? '').trim();
      if (!step) errors.step = 'Say what the tester does.';
      else if (step.length > 2000) errors.step = 'Keep the step to 2,000 characters.';
      else out.step = step;
    }
    if ('expected' in body) {
      const expected = body.expected === null ? '' : String(body.expected).trim();
      if (expected.length > 2000) errors.expected = 'Keep the expected result to 2,000 characters.';
      else out.expected = expected || null;
    }
    if (Object.keys(errors).length) invalid(errors);
    return out;
  }

  const listSteps = (controlId: string) => db.query<Row>(`select ${STEP_COLUMNS} from control_steps where control_id = $1 order by sort, created_at`, [controlId]);

  // ---------- the control's written steps ----------

  app.get('/api/controls/:id/steps', { preHandler: ctx.requirePerm('controls.view') }, async (req) => ({ rows: await listSteps((await needControl(req)).id) }));
  ctx.describeRoute({
    method: 'GET', path: '/api/controls/:id/steps', permission: 'controls.view',
    summary: 'The written test steps of a control, in order', response: '{ rows: [{ id, sort, step, expected }] }',
  });

  app.post('/api/controls/:id/steps', { preHandler: ctx.requirePerm('controls.edit') }, async (req, reply) => {
    const control = await needControl(req);
    const data = stepInput((req.body ?? {}) as Row, false);
    const count = (await db.one<{ n: number; s: number }>('select count(*)::int as n, coalesce(max(sort), 0)::int as s from control_steps where control_id = $1', [control.id]))!;
    if (count.n >= MAX_STEPS) ctx.fail(409, 'too_many', `A control can have at most ${MAX_STEPS} test steps.`);
    const row = (await db.one<Row>(
      `insert into control_steps (control_id, sort, step, expected, created_by, updated_by) values ($1, $2, $3, $4, $5, $5) returning ${STEP_COLUMNS}`,
      [control.id, count.s + 10, data.step, data.expected ?? null, req.user!.id]))!;
    await ctx.audit(req, { action: 'control.step_add', recordType: 'control', recordId: control.id, summary: `Test step added: ${row.step.slice(0, 120)}`, after: { step: row.step, expected: row.expected } });
    reply.code(201);
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/controls/:id/steps', permission: 'controls.edit', summary: 'Add a written test step to a control (at the end)',
    body: { type: 'object', required: ['step'], properties: { step: { type: 'string', description: 'What the tester does' }, expected: { type: 'string', description: 'What the tester should find' } } },
  });

  app.patch('/api/controls/:id/steps/:stepId', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const control = await needControl(req);
    const before = await stepOf(control, String((req.params as Row).stepId));
    const data = stepInput((req.body ?? {}) as Row, true);
    if (!Object.keys(data).length) return before;
    const row = (await db.one<Row>(
      `update control_steps set step = coalesce($2, step), expected = case when $4 then $3 else expected end, updated_at = now(), updated_by = $5
       where id = $1 returning ${STEP_COLUMNS}`,
      [before.id, data.step ?? null, data.expected ?? null, 'expected' in data, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'control.step_update', recordType: 'control', recordId: control.id, summary: `Test step changed: ${row.step.slice(0, 120)}`,
      before: { step: before.step, expected: before.expected }, after: { step: row.step, expected: row.expected },
    });
    return row;
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/controls/:id/steps/:stepId', permission: 'controls.edit',
    summary: 'Change a written test step (tests already recorded keep their own copy)',
    body: { type: 'object', properties: { step: { type: 'string' }, expected: { type: ['string', 'null'] } } },
  });

  app.delete('/api/controls/:id/steps/:stepId', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const control = await needControl(req);
    const before = await stepOf(control, String((req.params as Row).stepId));
    await db.query('delete from control_steps where id = $1', [before.id]);
    await ctx.audit(req, { action: 'control.step_remove', recordType: 'control', recordId: control.id, summary: `Test step removed: ${before.step.slice(0, 120)}`, before: { step: before.step, expected: before.expected } });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/controls/:id/steps/:stepId', permission: 'controls.edit',
    summary: 'Remove a written test step (tests already recorded keep their own copy)',
  });

  app.put('/api/controls/:id/steps/order', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const control = await needControl(req);
    const ids = (req.body as Row | null)?.ids;
    const have = await listSteps(control.id);
    if (!Array.isArray(ids) || ids.length !== have.length || new Set(ids.map(String)).size !== ids.length || !have.every((s) => ids.map(String).includes(s.id))) {
      invalid({ ids: 'Send every step of this control once, in the new order.' });
    }
    await db.tx(async (tx) => {
      for (const [i, id] of (ids as string[]).entries()) await tx.query('update control_steps set sort = $2, updated_at = now(), updated_by = $3 where id = $1', [String(id), (i + 1) * 10, req.user!.id]);
    });
    await ctx.audit(req, { action: 'control.step_order', recordType: 'control', recordId: control.id, summary: 'Test steps put in a new order' });
    return { rows: await listSteps(control.id) };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/controls/:id/steps/order', permission: 'controls.edit',
    summary: 'Put a control\'s written test steps in a new order',
    body: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Every step id of the control, in the new order' } } },
    response: '{ rows }',
  });

  // ---------- each step's result in a test ----------

  const testSteps = async (test: Row) => {
    const rows = await db.query<Row>(
      `select s.id, s.step_id, s.sort, s.step, s.expected, s.result, s.note, s.done_by, s.done_at, u.display_name as done_by_name
       from control_test_steps s left join users u on u.id = s.done_by
       where s.test_id = $1 order by s.sort, s.created_at`, [test.id]);
    const failed = new Set((await ctx.lookups.values('control_step_result')).filter((v) => v.meta?.failed === true).map((v) => v.value));
    const control = await db.one<{ n: number }>('select count(*)::int as n from control_steps s where s.control_id = $1 and not exists (select 1 from control_test_steps t where t.test_id = $2 and t.step_id = s.id)', [test.control_id, test.id]);
    return {
      rows,
      total: rows.length,
      done: rows.filter((r) => r.result).length,
      failed: rows.filter((r) => r.result && (failed.size ? failed.has(r.result) : r.result === 'fail')).length,
      not_copied: control?.n ?? 0,
    };
  };

  app.get('/api/control-tests/:id/steps', { preHandler: ctx.requirePerm('controls.view') }, async (req) => testSteps(await needTest(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/control-tests/:id/steps', permission: 'controls.view',
    summary: 'The test steps of a control test, each with its result',
    response: '{ rows: [{ id, step_id, sort, step, expected, result, note, done_by, done_by_name, done_at }], total, done, failed, not_copied }',
    description: '`not_copied` counts the control\'s steps that this test does not have yet (added to the control after the test was recorded).',
  });

  app.post('/api/control-tests/:id/steps/copy', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const test = await needTest(req);
    await notFinal(test);
    const added = await copySteps(ctx, test.id, test.control_id, req.user!.id);
    if (added) await ctx.audit(req, { action: 'control_test.steps_copy', recordType: 'control_test', recordId: test.id, summary: `${added} test step${added === 1 ? '' : 's'} copied from the control` });
    return { added, ...(await testSteps(test)) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/control-tests/:id/steps/copy', permission: 'controls.edit',
    summary: 'Copy the control\'s test steps that this test does not have yet (not once it is reviewed)', response: '{ added, rows, total, done, failed, not_copied }',
  });

  app.patch('/api/control-tests/:id/steps/:rowId', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const test = await needTest(req);
    await notFinal(test);
    const rowId = String((req.params as Row).rowId);
    const before = (UUID_RE.test(rowId) ? await db.one<Row>(`select ${RESULT_COLUMNS} from control_test_steps where id = $1 and test_id = $2`, [rowId, test.id]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Test step not found.');
    const body = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    let result = before.result as string | null;
    let note = before.note as string | null;
    if ('result' in body) {
      result = body.result === null || body.result === '' ? null : String(body.result);
      if (result && !(await ctx.lookups.values('control_step_result')).some((v) => v.value === result)) errors.result = 'Choose a result from the list.';
    }
    if ('note' in body) {
      const n = body.note === null ? '' : String(body.note).trim();
      if (n.length > 4000) errors.note = 'Keep the note to 4,000 characters.';
      note = n || null;
    }
    if (Object.keys(errors).length) invalid(errors);
    const resultChanged = result !== before.result;
    const row = (await db.one<Row>(
      `update control_test_steps set result = $2, note = $3,
         done_by = case when $4 then (case when $2::text is null then null else $5::uuid end) else done_by end,
         done_at = case when $4 then (case when $2::text is null then null else now() end) else done_at end,
         updated_at = now(), updated_by = $5
       where id = $1 returning ${RESULT_COLUMNS}`,
      [before.id, result, note, resultChanged, actorOf(req).id]))!;
    if (resultChanged || note !== before.note) {
      const label = result ? (await ctx.lookups.values('control_step_result')).find((v) => v.value === result)?.label ?? result : 'no result';
      await ctx.audit(req, {
        action: 'control_test.step_result', recordType: 'control_test', recordId: test.id,
        summary: `Step ${String(before.step).slice(0, 80)}: ${label}`, before: { result: before.result, note: before.note }, after: { result, note },
      });
    }
    return row;
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/control-tests/:id/steps/:rowId', permission: 'controls.edit',
    summary: 'Record the result of one test step (not once the test is reviewed)',
    body: { type: 'object', properties: { result: { type: ['string', 'null'], description: 'A value of the control_step_result list' }, note: { type: ['string', 'null'] } } },
  });
}
