import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { rollUp } from './controls.ts';
import { flagCoverage } from './coverage.ts';
import { meanings } from './lists.ts';
import { DATE_RE, UUID_RE, wholeNumber } from './shared.ts';

/**
 * Control tests (E26-05): one test of a control's design or operation over a period, with its
 * method, population, the items sampled, the exceptions found, a result and a conclusion, and
 * evidence files. Finishing the testing ("Awaiting review") needs a result and the date it was
 * performed; the review (`POST /api/control-tests/:id/review`) needs `controls.approve` and someone
 * other than the tester, and is the only way to reach the final status. A reviewed test cannot be
 * changed; the newest reviewed test sets the control's ratings and next due date. An ineffective
 * result flags the risks and hazards the control covers for review (E26-06), and a test that was not
 * effective can raise a corrective action plan (contract C1).
 */
export function registerTests(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function check(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const m = await meanings(ctx);
    if (existing && req && m.final.includes(existing.status)) {
      ctx.fail(409, 'reviewed', 'A reviewed test cannot be changed. Record a new test instead.');
    }
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (req && 'status' in patch && m.final.includes(patch.status) && patch.status !== existing?.status) {
      errors.status = 'A test is marked reviewed by its reviewer, with the Review button.';
    }
    if ('control_id' in patch || !existing) {
      const control = merged.control_id ? await ctx.resources.find('control', merged.control_id, req?.user) : undefined;
      if (!control) errors.control_id = 'Choose the control this test is for.';
      else if (!existing && !String(patch.title ?? '').trim()) {
        const type = (await ctx.lookups.values('control_test_type')).find((v) => v.value === merged.test_type)?.label ?? 'Control';
        patch.title = `${type} test: ${control.title}`.slice(0, 200);
      }
    }
    for (const f of ['sample_size', 'exceptions_found'] as const) {
      if (!(f in patch)) continue;
      const n = wholeNumber(patch[f], 0, 1_000_000);
      if (n === undefined) errors[f] = 'Enter a whole number, zero or more.';
      else patch[f] = n;
    }
    if (!errors.sample_size && !errors.exceptions_found && merged.sample_size != null && merged.exceptions_found != null
      && Number(merged.exceptions_found) > Number(merged.sample_size)) {
      errors.exceptions_found = 'There cannot be more exceptions than items sampled.';
    }
    if (merged.period_start && merged.period_end && String(merged.period_end) < String(merged.period_start)) {
      errors.period_end = 'The period cannot end before it starts.';
    }
    if (m.done.includes(merged.status)) {
      if (!merged.result) errors.result = 'Give the result before marking the testing finished.';
      if (!merged.performed_on) errors.performed_on = 'Give the date the test was performed.';
    }
    if (merged.performed_on && String(merged.performed_on) > dayInZone()) errors.performed_on = 'A test cannot be performed in the future.';
    if (Object.keys(errors).length) invalid(errors);
    return patch;
  }

  ctx.defineResource({
    type: 'control_test', table: 'control_tests', module: 'controls', label: 'Control test', plural: 'Control tests',
    path: '/api/control-tests', route: '/controls/tests', titleField: 'title',
    ref: { field: 'ref', prefix: 'CTT-' },
    evidence: true,
    searchable: ['title', 'population', 'conclusion'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Test', type: 'text' },
      control_id: { label: 'Control', type: 'ref', to: 'control', required: true },
      test_type: { label: 'Test of', type: 'lookup', list: 'control_test_type', default: 'operating' },
      period_start: { label: 'Period from', type: 'date' },
      period_end: { label: 'Period to', type: 'date' },
      planned_on: { label: 'Planned for', type: 'date' },
      performed_on: { label: 'Performed on', type: 'date' },
      tester_id: { label: 'Tester', type: 'user' },
      method: { label: 'Method', type: 'lookup', list: 'control_test_method' },
      population: { label: 'Population', type: 'longtext', personal: false },
      sample_size: { label: 'Items sampled', type: 'number' },
      exceptions_found: { label: 'Exceptions found', type: 'number' },
      result: { label: 'Result', type: 'lookup', list: 'control_test_result' },
      conclusion: { label: 'Conclusion', type: 'longtext' },
      status: { label: 'Status', type: 'lookup', list: 'control_test_status', default: 'planned' },
      reviewer_id: { label: 'Reviewed by', type: 'user', readOnly: true },
      reviewed_on: { label: 'Reviewed on', type: 'date', readOnly: true },
      review_note: { label: 'Review note', type: 'longtext', readOnly: true },
      cap_id: { label: 'Corrective action plan', type: 'ref', to: 'cap', readOnly: true },
      flagged_on: { label: 'Covered records flagged on', type: 'date', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => check(req, null, data),
      beforeUpdate: (req, existing, patch) => check(req, existing, patch),
    },
  });

  // A reviewed test that is deleted no longer counts towards its control's ratings.
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (def.type === 'control_test' && (action === 'delete' || action === 'purge') && row.control_id) await rollUp(ctx, row.control_id);
  });

  const needTest = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id);
    return (UUID_RE.test(id) ? await ctx.resources.find('control_test', id, req.user) : undefined)
      ?? ctx.fail(404, 'not_found', 'Control test not found.');
  };

  // ---------- review (E26-05) ----------

  app.post('/api/control-tests/:id/review', { preHandler: ctx.requirePerm('controls.approve') }, async (req) => {
    const test = await needTest(req);
    const m = await meanings(ctx);
    if (m.final.includes(test.status)) ctx.fail(409, 'reviewed', 'This test has already been reviewed.');
    if (!m.done.includes(test.status)) ctx.fail(409, 'not_finished', 'Only a test whose testing is finished (awaiting review) can be reviewed.');
    const tester = test.tester_id ?? test.created_by;
    if (tester && tester === req.user!.id) {
      ctx.fail(403, 'not_independent', 'A test is reviewed by someone other than its tester.');
    }
    const body = (req.body ?? {}) as Row;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : '';
    if ((m.failed.includes(test.result) || m.partial.includes(test.result)) && !String(test.conclusion ?? '').trim()) {
      invalid({ conclusion: 'A test that was not effective needs a conclusion before it is reviewed.' });
    }
    const reviewed = await ctx.resources.update('control_test', test.id, {
      status: m.reviewed, reviewer_id: req.user!.id, reviewed_on: dayInZone(), review_note: note || null,
    }, null);
    const result = (await ctx.lookups.values('control_test_result')).find((v) => v.value === test.result)?.label ?? test.result;
    await ctx.audit(req, {
      action: 'control_test.review', recordType: 'control_test', recordId: test.id,
      summary: `Test reviewed and signed off: ${result}`, after: { reviewer_id: req.user!.id, reviewed_on: reviewed.reviewed_on, note: note || null },
    });
    const control = await rollUp(ctx, test.control_id);
    let flagged = 0;
    if (m.failed.includes(test.result) && control) flagged = await flagCoverage(ctx, reviewed, control, req);
    return { test: (await ctx.resources.find('control_test', test.id, req.user)) ?? reviewed, control, flagged };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/control-tests/:id/review', permission: 'controls.approve',
    summary: 'Review and sign off a finished control test (someone other than the tester)',
    description: 'Marks the test reviewed, records the reviewer, and rolls the result up to the control\'s ratings and next test date. An ineffective result sets the next review date of every risk and hazard the control covers to today and tells their owners. `flagged` counts only the flagged records the caller may see.',
    body: { type: 'object', properties: { note: { type: 'string', description: 'Optional review note' } } },
    response: '{ test, control, flagged }',
  });

  // ---------- samples ----------

  const SAMPLE_COLUMNS = 'id, item, result, note, sort, created_at, updated_at';
  const sampleOf = async (test: Row, sampleId: string): Promise<Row> =>
    (UUID_RE.test(sampleId) ? await db.one<Row>(`select ${SAMPLE_COLUMNS} from control_test_samples where id = $1 and test_id = $2`, [sampleId, test.id]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Sample item not found.');

  async function sampleInput(body: Row, partial: boolean): Promise<Row> {
    const out: Row = {};
    const errors: Record<string, string> = {};
    if (!partial || 'item' in body) {
      const item = String(body.item ?? '').trim();
      if (!item) errors.item = 'Say which item was looked at.';
      else if (item.length > 500) errors.item = 'Keep the item to 500 characters.';
      else out.item = item;
    }
    if ('result' in body) {
      const r = body.result === null || body.result === '' ? null : String(body.result);
      if (r && !(await ctx.lookups.values('control_sample_result')).some((v) => v.value === r)) errors.result = 'Choose a result from the list.';
      else out.result = r;
    }
    if ('note' in body) {
      const n = body.note === null ? '' : String(body.note).trim();
      if (n.length > 2000) errors.note = 'Keep the note to 2,000 characters.';
      else out.note = n || null;
    }
    if (Object.keys(errors).length) invalid(errors);
    return out;
  }

  /** Keeps the test's sample size and exceptions in step with its sample rows, when it has any. */
  async function countSamples(test: Row): Promise<Row> {
    const c = (await db.one<Row>(
      `select count(*)::int as n, count(*) filter (where result = 'exception')::int as exceptions from control_test_samples where test_id = $1`, [test.id],
    ))!;
    if (c.n > 0 && (Number(test.sample_size) !== c.n || Number(test.exceptions_found) !== c.exceptions)) {
      await db.query('update control_tests set sample_size = $2, exceptions_found = $3, updated_at = now() where id = $1', [test.id, c.n, c.exceptions]);
    }
    return { sample_size: c.n ? c.n : test.sample_size, exceptions_found: c.n ? c.exceptions : test.exceptions_found };
  }

  const notFinal = async (test: Row) => {
    if ((await meanings(ctx)).final.includes(test.status)) ctx.fail(409, 'reviewed', 'A reviewed test cannot be changed. Record a new test instead.');
  };

  app.get('/api/control-tests/:id/samples', { preHandler: ctx.requirePerm('controls.view') }, async (req) => {
    const test = await needTest(req);
    const rows = await db.query<Row>(`select ${SAMPLE_COLUMNS} from control_test_samples where test_id = $1 order by sort, created_at`, [test.id]);
    return { rows, sample_size: test.sample_size, exceptions_found: test.exceptions_found };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/control-tests/:id/samples', permission: 'controls.view', summary: 'The items a control test sampled, with each one\'s result', response: '{ rows: [{ id, item, result, note, sort }], sample_size, exceptions_found }' });

  app.post('/api/control-tests/:id/samples', { preHandler: ctx.requirePerm('controls.edit') }, async (req, reply) => {
    const test = await needTest(req);
    await notFinal(test);
    const data = await sampleInput((req.body ?? {}) as Row, false);
    const sort = (await db.one<Row>('select coalesce(max(sort), 0) + 10 as s from control_test_samples where test_id = $1', [test.id]))!.s;
    const row = (await db.one<Row>(
      `insert into control_test_samples (test_id, item, result, note, sort, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6) returning ${SAMPLE_COLUMNS}`,
      [test.id, data.item, data.result ?? null, data.note ?? null, sort, req.user!.id],
    ))!;
    const counts = await countSamples(test);
    await ctx.audit(req, { action: 'control_test.sample_add', recordType: 'control_test', recordId: test.id, summary: `Sample item added: ${row.item}`, after: { item: row.item, result: row.result } });
    reply.code(201);
    return { ...row, ...counts };
  });
  ctx.describeRoute({ method: 'POST', path: '/api/control-tests/:id/samples', permission: 'controls.edit', summary: 'Add a sampled item to a control test (not once it is reviewed)', body: { type: 'object', required: ['item'], properties: { item: { type: 'string' }, result: { type: 'string', description: 'A value of the control_sample_result list' }, note: { type: 'string' } } } });

  app.patch('/api/control-tests/:id/samples/:sampleId', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const test = await needTest(req);
    await notFinal(test);
    const before = await sampleOf(test, String((req.params as Row).sampleId));
    const data = await sampleInput((req.body ?? {}) as Row, true);
    const row = Object.keys(data).length
      ? (await db.one<Row>(
        `update control_test_samples set item = coalesce($2, item), result = case when $5 then $3 else result end,
           note = case when $6 then $4 else note end, updated_at = now(), updated_by = $7 where id = $1 returning ${SAMPLE_COLUMNS}`,
        [before.id, data.item ?? null, data.result ?? null, data.note ?? null, 'result' in data, 'note' in data, req.user!.id],
      ))!
      : before;
    const counts = await countSamples(test);
    await ctx.audit(req, {
      action: 'control_test.sample_update', recordType: 'control_test', recordId: test.id, summary: `Sample item changed: ${row.item}`,
      before: { item: before.item, result: before.result, note: before.note }, after: { item: row.item, result: row.result, note: row.note },
    });
    return { ...row, ...counts };
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/control-tests/:id/samples/:sampleId', permission: 'controls.edit', summary: 'Change a sampled item of a control test (not once it is reviewed)', body: { type: 'object', properties: { item: { type: 'string' }, result: { type: ['string', 'null'] }, note: { type: ['string', 'null'] } } } });

  app.delete('/api/control-tests/:id/samples/:sampleId', { preHandler: ctx.requirePerm('controls.edit') }, async (req) => {
    const test = await needTest(req);
    await notFinal(test);
    const before = await sampleOf(test, String((req.params as Row).sampleId));
    await db.query('delete from control_test_samples where id = $1', [before.id]);
    const counts = await countSamples(test);
    await ctx.audit(req, { action: 'control_test.sample_remove', recordType: 'control_test', recordId: test.id, summary: `Sample item removed: ${before.item}`, before: { item: before.item, result: before.result } });
    return { ok: true, ...counts };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/control-tests/:id/samples/:sampleId', permission: 'controls.edit', summary: 'Remove a sampled item from a control test (not once it is reviewed)' });

  // ---------- corrective action plan (E26-06, contract C1) ----------

  /** The corrective action plan type, when the risks module provides it with the agreed fields. */
  const capDef = () => {
    const def = ctx.resources.get('cap');
    return def && ['source_type', 'source_id', 'problem_statement'].every((f) => f in def.fields) ? def : undefined;
  };

  app.post('/api/control-tests/:id/cap', { preHandler: ctx.requirePerm('controls.edit') }, async (req, reply) => {
    const test = await needTest(req);
    const def = capDef() ?? ctx.fail(409, 'caps_unavailable', 'Corrective action plans are not available on this installation. Record the follow-up in the test\'s conclusion.');
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You do not have permission to create corrective action plans.');
    const m = await meanings(ctx);
    if (!m.failed.includes(test.result) && !m.partial.includes(test.result)) {
      ctx.fail(409, 'not_failed', 'A corrective action plan is raised for a test that was not effective.');
    }
    if (test.cap_id && await ctx.resources.find('cap', test.cap_id)) ctx.fail(409, 'exists', 'This test already has a corrective action plan.');
    const control = (await ctx.resources.find('control', test.control_id, req.user)) ?? ctx.fail(404, 'not_found', 'Control not found.');
    const body = (req.body ?? {}) as Row;
    const due = typeof body.due_on === 'string' && body.due_on ? body.due_on : null;
    if (due && !DATE_RE.test(due)) invalid({ due_on: 'Enter a date as YYYY-MM-DD.' });
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : `Fix control ${control.ref}: ${control.title}`.slice(0, 200);
    const result = (await ctx.lookups.values('control_test_result')).find((v) => v.value === test.result)?.label ?? test.result;
    const problem = typeof body.problem_statement === 'string' && body.problem_statement.trim()
      ? body.problem_statement.trim()
      : [`Control ${control.ref} ${control.title} was rated ${String(result).toLowerCase()} by test ${test.ref}.`,
        test.exceptions_found != null && test.sample_size != null ? `${test.exceptions_found} exception(s) in ${test.sample_size} item(s) sampled.` : '',
        test.conclusion ?? ''].filter(Boolean).join('\n\n');
    const data: Row = { title, source: 'control', source_type: 'control_test', source_id: test.id, problem_statement: problem };
    const responsible = typeof body.responsible_id === 'string' && body.responsible_id ? body.responsible_id : control.owner_id;
    if (responsible && 'responsible_id' in def.fields) data.responsible_id = responsible;
    if (due && 'due_on' in def.fields) data.due_on = due;
    const cap = await ctx.resources.create('cap', data, req);
    await ctx.resources.update('control_test', test.id, { cap_id: cap.id }, null);
    await ctx.audit(req, {
      action: 'control_test.cap', recordType: 'control_test', recordId: test.id,
      summary: `Corrective action plan ${cap.ref ?? ''} raised`.replace('  ', ' '), after: { cap_id: cap.id },
    });
    reply.code(201);
    return { cap: { id: cap.id, ref: cap.ref ?? null, title: cap.title, route: def.route } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/control-tests/:id/cap', permission: 'controls.edit',
    summary: 'Raise a corrective action plan for a control test that was not effective (also needs actions.create)',
    description: 'Creates a corrective action plan (record type `cap`, from the action tracker) whose source is the test, one per test. Answers 409 `caps_unavailable` when the installation has no corrective action plans.',
    body: { type: 'object', properties: { title: { type: 'string' }, problem_statement: { type: 'string' }, responsible_id: { type: 'string' }, due_on: { type: 'string', format: 'date' } } },
    response: '{ cap: { id, ref, title, route } }',
  });
}
