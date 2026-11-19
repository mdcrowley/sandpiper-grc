import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { isDate, localDate, text, UUID } from './dates.ts';

const SEVERITY_PRIORITY: Record<string, string> = { high: 'high', medium: 'medium', low: 'low' };

export function defineExercise(ctx: ModuleContext) {
  const check = (merged: Row) => {
    if (merged.exercise_date && merged.next_due_on && String(merged.next_due_on) <= String(merged.exercise_date)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { next_due_on: 'Next due must be after the exercise date.' });
    }
  };
  ctx.defineResource({
    type: 'exercise', table: 'exercises', module: 'exercises', label: 'Exercise', plural: 'Exercises',
    path: '/api/exercises', route: '/exercises', titleField: 'title', ref: { field: 'ref', prefix: 'EXR-' },
    searchable: ['title', 'scenario', 'scope', 'objectives', 'outcome', 'facilitator'],
    defaultSort: { field: 'exercise_date', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      type: { label: 'Type', type: 'lookup', list: 'exercise_type', required: true },
      status: { label: 'Status', type: 'lookup', list: 'exercise_status', default: 'planned' },
      exercise_date: { label: 'Date', type: 'date' },
      scenario: { label: 'Scenario', type: 'longtext' },
      scope: { label: 'Scope and systems', type: 'longtext' },
      facilitator: { label: 'Facilitator', type: 'text' },
      objectives: { label: 'Objectives', type: 'longtext' },
      result: { label: 'Result', type: 'lookup', list: 'exercise_result' },
      outcome: { label: 'What happened', type: 'longtext' },
      next_due_on: { label: 'Next due', type: 'date' },
      owner_id: { label: 'Owner', type: 'user' },
    },
    hooks: {
      beforeCreate: (_req, data) => { check(data); return data; },
      beforeUpdate: (_req, existing, patch) => { check({ ...existing, ...patch }); return patch; },
    },
  });
}

export function registerExercises(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('exercises.view') };
  const edit = { preHandler: ctx.requirePerm('exercises.edit') };

  const needExercise = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('exercise', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Exercise not found.');
  const name = (e: Row) => [e.ref, e.title].filter(Boolean).join(' ');

  // ---------- calendar ----------

  /**
   * What is coming up and what is late. An entry is either a planned exercise (by its date)
   * or the next run of a completed one (by its "next due" date), unless a later exercise of
   * the same type is already on record. `by_type` shows when each kind was last run.
   */
  app.get('/api/exercises/calendar', view, async () => {
    const today = localDate();
    const types = await ctx.lookups.values('exercise_type');
    const label = (v: string | null) => types.find((t) => t.value === v)?.label ?? v ?? 'No type';
    const rows = await db.query<Row>(
      `select e.id, e.ref, e.title, e.type, coalesce(e.status, 'planned') as status, e.exercise_date, e.next_due_on, e.result,
              e.facilitator, u.display_name as owner_name
       from exercises e left join users u on u.id = e.owner_id
       where e.deleted_at is null and coalesce(e.status, 'planned') <> 'cancelled'
       order by e.exercise_date nulls last`,
    );
    const entries: Row[] = [];
    for (const e of rows) {
      const base = { id: e.id, ref: e.ref, title: e.title, type: e.type, type_label: label(e.type), owner_name: e.owner_name, facilitator: e.facilitator };
      if (e.status === 'planned') {
        entries.push({ ...base, kind: 'planned', date: e.exercise_date, last_run: null });
      } else if (e.next_due_on) {
        const later = rows.some((o) => o.id !== e.id && o.type === e.type && o.exercise_date && e.exercise_date && o.exercise_date > e.exercise_date);
        if (!later) entries.push({ ...base, kind: 'repeat', date: e.next_due_on, last_run: e.exercise_date });
      }
    }
    const dated = entries.filter((e) => e.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const by_type = types.map((t) => {
      const done = rows.filter((e) => e.type === t.value && e.status === 'completed' && e.exercise_date)
        .sort((a, b) => String(b.exercise_date).localeCompare(String(a.exercise_date)));
      const next = dated.find((e) => e.type === t.value);
      return {
        type: t.value, label: t.label, color: t.color ?? 'gray', completed: done.length,
        last_run: done[0]?.exercise_date ?? null, last_id: done[0]?.id ?? null, last_result: done[0]?.result ?? null,
        next_due: next?.date ?? null, next_id: next?.id ?? null, overdue: !!next && String(next.date) < today,
      };
    });
    return {
      today,
      overdue: dated.filter((e) => String(e.date) < today),
      upcoming: dated.filter((e) => String(e.date) >= today),
      undated: entries.filter((e) => !e.date),
      by_type,
    };
  });

  // ---------- participants ----------

  function participantInput(body: Row, mode: 'create' | 'update'): Row {
    const out: Row = {};
    const fields: Record<string, string> = {};
    for (const k of ['name', 'role']) if (body[k] !== undefined) out[k] = text(body[k]);
    if (body.attended !== undefined) {
      if (typeof body.attended !== 'boolean') fields.attended = 'Attended must be yes or no.';
      else out.attended = body.attended;
    }
    if ((mode === 'create' || out.name !== undefined) && !out.name) fields.name = 'Name is required.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  app.get('/api/exercises/:id/participants', view, async (req) => {
    const ex = await needExercise(req);
    return db.query(
      'select id, name, role, attended from exercise_participants where exercise_id = $1 and deleted_at is null order by created_at, name', [ex.id],
    );
  });

  app.post('/api/exercises/:id/participants', edit, async (req, reply) => {
    const ex = await needExercise(req);
    const body = (req.body ?? {}) as Row;
    // Several people at once: { names: "one per line" } or a single { name, role, attended }.
    const many = typeof body.names === 'string'
      ? body.names.split(/\r?\n/).map((n: string) => n.trim()).filter(Boolean).map((n: string) => ({ name: n, role: body.role, attended: body.attended }))
      : [body];
    if (!many.length) ctx.fail(400, 'validation', 'Check the highlighted fields.', { names: 'Enter at least one name.' });
    const made: Row[] = [];
    for (const one of many) {
      const data = participantInput(one, 'create');
      made.push((await db.one<Row>(
        `insert into exercise_participants (exercise_id, name, role, attended, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$5) returning id, name, role, attended`,
        [ex.id, data.name, data.role ?? null, data.attended ?? true, req.user!.id],
      ))!);
    }
    await ctx.audit(req, {
      action: 'exercise_participant.create', recordType: 'exercise', recordId: ex.id,
      summary: `Participant${made.length === 1 ? '' : 's'} added to ${name(ex)}: ${made.map((m) => m.name).join(', ')}`,
      after: made.map(({ name: n, role, attended }) => ({ name: n, role, attended })),
    });
    reply.code(201);
    return made.length === 1 ? made[0] : made;
  });

  const needChild = async (table: string, what: string, req: FastifyRequest, ex: Row): Promise<Row> => {
    const id = String((req.params as Row).childId ?? '');
    const row = UUID.test(id)
      ? await db.one<Row>(`select * from ${table} where id = $1 and exercise_id = $2 and deleted_at is null`, [id, ex.id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', `${what} not found.`);
  };

  async function patchChild(table: string, before: Row, data: Row, userId: string) {
    const keys = Object.keys(data).filter((k) => (data[k] ?? null) !== (before[k] ?? null));
    if (!keys.length) return { row: before, was: {}, now: {} };
    const row = (await db.one<Row>(
      `update ${table} set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [before.id, userId, ...keys.map((k) => data[k])],
    ))!;
    return { row, was: Object.fromEntries(keys.map((k) => [k, before[k]])), now: Object.fromEntries(keys.map((k) => [k, data[k]])) };
  }

  app.patch('/api/exercises/:id/participants/:childId', edit, async (req) => {
    const ex = await needExercise(req);
    const before = await needChild('exercise_participants', 'Participant', req, ex);
    const { row, was, now } = await patchChild('exercise_participants', before, participantInput((req.body ?? {}) as Row, 'update'), req.user!.id);
    if (Object.keys(now).length) {
      await ctx.audit(req, {
        action: 'exercise_participant.update', recordType: 'exercise', recordId: ex.id,
        summary: `Participant updated on ${name(ex)}: ${row.name}`, before: was, after: now,
      });
    }
    return { id: row.id, name: row.name, role: row.role, attended: row.attended };
  });

  app.delete('/api/exercises/:id/participants/:childId', edit, async (req) => {
    const ex = await needExercise(req);
    const before = await needChild('exercise_participants', 'Participant', req, ex);
    await db.query('update exercise_participants set deleted_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'exercise_participant.delete', recordType: 'exercise', recordId: ex.id,
      summary: `Participant removed from ${name(ex)}: ${before.name}`, before: { name: before.name, role: before.role, attended: before.attended },
    });
    return { ok: true };
  });

  // ---------- findings ----------

  async function findingInput(body: Row, mode: 'create' | 'update'): Promise<Row> {
    const out: Row = {};
    const fields: Record<string, string> = {};
    for (const k of ['finding', 'recommendation']) if (body[k] !== undefined) out[k] = text(body[k]);
    if (body.severity !== undefined) {
      out.severity = text(body.severity);
      if (out.severity && !(await ctx.lookups.values('exercise_finding_severity')).some((v) => v.value === out.severity)) {
        fields.severity = `"${out.severity}" is not an allowed severity.`;
      }
    }
    if ((mode === 'create' || out.finding !== undefined) && !out.finding) fields.finding = 'Describe the finding.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  /** Findings with the state of their follow-up action, when the actions module is there and the caller may see it. */
  async function findingsOf(ex: Row, req: FastifyRequest): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select id, finding, severity, recommendation, action_id from exercise_findings
       where exercise_id = $1 and deleted_at is null order by created_at, id`, [ex.id],
    );
    const actions = ctx.resources.get('action') && ctx.can(req.user, 'actions.view');
    const statuses = actions ? await ctx.lookups.values('action_status') : [];
    for (const f of rows) {
      f.action = null;
      if (!f.action_id || !actions) continue;
      const a = await ctx.resources.find('action', f.action_id, req.user);
      if (!a) continue;
      const s = statuses.find((x) => x.value === a.status);
      f.action = { id: a.id, ref: a.ref, title: a.title, status: a.status, status_label: s?.label ?? a.status, status_color: s?.color ?? 'gray', due_on: a.due_on };
    }
    return rows;
  }

  app.get('/api/exercises/:id/findings', view, async (req) => {
    const ex = await needExercise(req);
    return { actions_available: !!ctx.resources.get('action'), findings: await findingsOf(ex, req) };
  });

  app.post('/api/exercises/:id/findings', edit, async (req, reply) => {
    const ex = await needExercise(req);
    const data = await findingInput((req.body ?? {}) as Row, 'create');
    const row = (await db.one<Row>(
      `insert into exercise_findings (exercise_id, finding, severity, recommendation, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$5) returning id, finding, severity, recommendation, action_id`,
      [ex.id, data.finding, data.severity ?? null, data.recommendation ?? null, req.user!.id],
    ))!;
    await ctx.audit(req, {
      action: 'exercise_finding.create', recordType: 'exercise', recordId: ex.id,
      summary: `Finding recorded on ${name(ex)}: ${String(row.finding).slice(0, 120)}`,
      after: { finding: row.finding, severity: row.severity, recommendation: row.recommendation },
    });
    reply.code(201);
    return { ...row, action: null };
  });

  app.patch('/api/exercises/:id/findings/:childId', edit, async (req) => {
    const ex = await needExercise(req);
    const before = await needChild('exercise_findings', 'Finding', req, ex);
    const { row, was, now } = await patchChild('exercise_findings', before, await findingInput((req.body ?? {}) as Row, 'update'), req.user!.id);
    if (Object.keys(now).length) {
      await ctx.audit(req, {
        action: 'exercise_finding.update', recordType: 'exercise', recordId: ex.id,
        summary: `Finding updated on ${name(ex)}: ${String(row.finding).slice(0, 120)}`, before: was, after: now,
      });
    }
    return (await findingsOf(ex, req)).find((f) => f.id === row.id);
  });

  app.delete('/api/exercises/:id/findings/:childId', edit, async (req) => {
    const ex = await needExercise(req);
    const before = await needChild('exercise_findings', 'Finding', req, ex);
    await db.query('update exercise_findings set deleted_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'exercise_finding.delete', recordType: 'exercise', recordId: ex.id,
      summary: `Finding removed from ${name(ex)}: ${String(before.finding).slice(0, 120)}`,
      before: { finding: before.finding, severity: before.severity, recommendation: before.recommendation, action_id: before.action_id },
    });
    return { ok: true };
  });

  /**
   * Raises the follow-up action for a finding through the shared Actions contract.
   * Body (all optional): { title, owner_id, due_on, priority }. One action per finding.
   */
  app.post('/api/exercises/:id/findings/:childId/action', edit, async (req, reply) => {
    const ex = await needExercise(req);
    const finding = await needChild('exercise_findings', 'Finding', req, ex);
    if (!ctx.resources.get('action')) {
      ctx.fail(409, 'actions_unavailable', 'Follow-up actions are not available because the action tracker is not switched on. The finding is kept; record the follow-up in its recommendation.');
    }
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You do not have permission to create actions.');
    if (finding.action_id && await ctx.resources.find('action', finding.action_id)) {
      ctx.fail(409, 'exists', 'This finding already has a follow-up action.');
    }
    const body = (req.body ?? {}) as Row;
    const due = text(body.due_on);
    if (due && !isDate(due)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { due_on: 'Enter a date as YYYY-MM-DD.' });
    const action = await createFindingAction(ctx, ex, finding, {
      title: text(body.title), owner_id: text(body.owner_id) ?? ex.owner_id ?? null, due_on: due, priority: text(body.priority),
    }, req);
    await db.query('update exercise_findings set action_id = $2, updated_at = now(), updated_by = $3 where id = $1', [finding.id, action.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'exercise_finding.action', recordType: 'exercise', recordId: ex.id,
      summary: `Follow-up action ${action.ref ?? ''} raised from a finding on ${name(ex)}`.replace('  ', ' '),
      after: { finding_id: finding.id, action_id: action.id },
    });
    reply.code(201);
    return { finding_id: finding.id, action: { id: action.id, ref: action.ref, title: action.title, status: action.status, due_on: action.due_on } };
  });
}

/** Creates the action for a finding. The caller has checked that the action type exists. */
export async function createFindingAction(
  ctx: ModuleContext, ex: Row, finding: Row,
  opts: { title?: string | null; owner_id?: string | null; due_on?: string | null; priority?: string | null; extra?: Row },
  req: FastifyRequest | null,
): Promise<Row> {
  const firstLine = String(finding.finding).split(/\r?\n/)[0];
  const data: Row = {
    title: opts.title ?? (firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine),
    description: [
      `Finding from exercise ${[ex.ref, ex.title].filter(Boolean).join(' ')}:`, finding.finding,
      finding.recommendation ? `Recommendation: ${finding.recommendation}` : '',
    ].filter(Boolean).join('\n\n'),
    source: 'exercise', source_type: 'exercise', source_id: ex.id,
    priority: opts.priority ?? SEVERITY_PRIORITY[finding.severity] ?? 'medium',
    ...opts.extra,
  };
  if (opts.owner_id) data.owner_id = opts.owner_id;
  if (opts.due_on) data.due_on = opts.due_on;
  return ctx.resources.create('action', data, req);
}
