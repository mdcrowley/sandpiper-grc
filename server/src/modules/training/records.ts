import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { isDate, localDate, text, UUID } from './dates.ts';
import { loadUsers, RECORDS_CTE, resolvePerson, saveTraining } from './people.ts';
import type { Completion, Person } from './people.ts';
import { syncTrainingAssignments } from './sync.ts';

const MAX_PEOPLE = 500;
const STATUSES = ['complete', 'due', 'overdue'];

/** Checks the completion part of a request body. Only keys that are present are returned. */
export async function completionInput(ctx: ModuleContext, body: Row, today: string): Promise<{ data: Completion; errors: Record<string, string> }> {
  const data: Completion = {};
  const errors: Record<string, string> = {};
  for (const k of ['assigned_on', 'due_on', 'completed_on'] as const) {
    if (body[k] === undefined) continue;
    const v = text(body[k]);
    if (v === null) data[k] = null;
    else if (!isDate(v)) errors[k] = 'Enter a date as YYYY-MM-DD.';
    else data[k] = v;
  }
  if (data.completed_on && data.completed_on > today) errors.completed_on = 'The completion date cannot be in the future.';
  if (body.score !== undefined) {
    const raw = text(body.score);
    const n = raw === null ? null : Number(raw.replace(/%$/, ''));
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) errors.score = 'Enter a score between 0 and 100.';
    else data.score = n;
  }
  if (body.result !== undefined) {
    const v = text(body.result);
    const hit = v === null ? null : (await ctx.lookups.values('training_result'))
      .find((x) => x.value.toLowerCase() === v.toLowerCase() || x.label.toLowerCase() === v.toLowerCase());
    if (v !== null && !hit) errors.result = `"${v}" is not an allowed result.`;
    else data.result = hit ? hit.value : null;
  }
  if (body.evidence_note !== undefined) data.evidence_note = text(body.evidence_note);
  return { data, errors };
}

export function registerRecords(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('training.view') };
  const edit = { preHandler: ctx.requirePerm('training.edit') };

  const needCourse = async (id: unknown, req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('course', String(id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Course not found.');
  const courseName = (c: Row) => [c.ref, c.title].filter(Boolean).join(' ');

  // ---------- who can be assigned ----------

  app.get('/api/training/audiences', view, async () => ({
    roles: await db.query('select id, name from roles where enabled order by lower(name)'),
    departments: await db.query('select id, name from departments where deleted_at is null order by lower(name)'),
    department_names: (await db.query<{ name: string }>(
      `select distinct coalesce(d.name, r.person_department) as name
       from training_records r left join users u on u.id = r.user_id
       left join departments d on d.id = u.department_id and d.deleted_at is null
       where r.deleted_at is null and coalesce(d.name, r.person_department) is not null order by 1`,
    )).map((r) => r.name),
  }));

  // ---------- assignment rules ----------

  const RULES = `
    select a.id, a.course_id, a.audience_type, a.role_id, a.department_id, a.user_id, a.created_at,
           case a.audience_type when 'everyone' then 'Everyone with an account'
                when 'role' then coalesce(ro.name, 'Role removed')
                when 'department' then coalesce(d.name, 'Department removed')
                else coalesce(u.display_name, 'User removed') end as audience_label,
           (select count(*)::int from users x where x.status = 'active' and x.deleted_at is null and (
              a.audience_type = 'everyone'
              or (a.audience_type = 'user' and x.id = a.user_id)
              or (a.audience_type = 'department' and x.department_id = a.department_id)
              or (a.audience_type = 'role' and exists (
                    select 1 from user_roles ur where ur.user_id = x.id and ur.role_id = a.role_id)))) as people
    from training_assignments a
    left join roles ro on ro.id = a.role_id
    left join departments d on d.id = a.department_id and d.deleted_at is null
    left join users u on u.id = a.user_id and u.deleted_at is null
    where a.deleted_at is null`;

  app.get('/api/courses/:id/assignments', view, async (req) => {
    const course = await needCourse((req.params as Row).id, req);
    return db.query(`${RULES} and a.course_id = $1 order by a.created_at`, [course.id]);
  });

  app.post('/api/courses/:id/assignments', edit, async (req, reply) => {
    const course = await needCourse((req.params as Row).id, req);
    const body = (req.body ?? {}) as Row;
    const type = String(body.audience_type ?? '');
    const column = ({ role: 'role_id', department: 'department_id', user: 'user_id' } as Record<string, string>)[type];
    if (type !== 'everyone' && !column) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { audience_type: 'Choose everyone, a role, a department or a person.' });
    }
    let target: string | null = null;
    if (column) {
      target = text(body[column]);
      const table = type === 'role' ? 'roles where true' : type === 'department' ? 'departments where deleted_at is null' : 'users where deleted_at is null';
      if (!target || !UUID.test(target) || !(await db.one(`select 1 from ${table} and id = $1`, [target]))) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { [column]: `Choose a ${type === 'user' ? 'person' : type}.` });
      }
    }
    const clash = await db.one(
      `select 1 from training_assignments where course_id = $1 and deleted_at is null and audience_type = $2
         and coalesce(role_id, department_id, user_id)::text is not distinct from $3`,
      [course.id, type, target],
    );
    if (clash) ctx.fail(409, 'duplicate', 'This course is already assigned to that audience.');
    const row = await db.one<Row>(
      `insert into training_assignments (course_id, audience_type, role_id, department_id, user_id, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$6) returning id`,
      [course.id, type, type === 'role' ? target : null, type === 'department' ? target : null, type === 'user' ? target : null, req.user!.id],
    );
    const rule = (await db.one<Row>(`${RULES} and a.id = $1`, [row!.id]))!;
    await ctx.audit(req, {
      action: 'training_assignment.create', recordType: 'course', recordId: course.id,
      summary: `Assignment rule added to ${courseName(course)}: ${rule.audience_label}`,
      after: { audience_type: type, role_id: rule.role_id, department_id: rule.department_id, user_id: rule.user_id },
    });
    const sync = await syncTrainingAssignments(ctx);
    reply.code(201);
    return { ...rule, records_created: sync.created };
  });

  app.delete('/api/courses/:id/assignments/:ruleId', edit, async (req) => {
    const { id, ruleId } = req.params as Row;
    const course = await needCourse(id, req);
    const rule = UUID.test(String(ruleId))
      ? await db.one<Row>(`${RULES} and a.id = $1 and a.course_id = $2`, [ruleId, course.id]) : undefined;
    if (!rule) ctx.fail(404, 'not_found', 'Assignment rule not found.');
    await db.query('update training_assignments set deleted_at = now(), updated_by = $2 where id = $1', [rule!.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'training_assignment.delete', recordType: 'course', recordId: course.id,
      summary: `Assignment rule removed from ${courseName(course)}: ${rule!.audience_label}`,
      before: { audience_type: rule!.audience_type, role_id: rule!.role_id, department_id: rule!.department_id, user_id: rule!.user_id },
    });
    return { ok: true };
  });

  app.post('/api/training/sync', edit, async () => syncTrainingAssignments(ctx));

  // ---------- reading records ----------

  app.get('/api/courses/:id/progress', view, async (req) => {
    const course = await needCourse((req.params as Row).id, req);
    const today = localDate();
    const people = await db.query<Row>(
      `${RECORDS_CTE} select * from latest where course_id = $2
       order by case status when 'overdue' then 0 when 'due' then 1 else 2 end, due_on nulls last, lower(person)`,
      [today, course.id],
    );
    const count = (s: string) => people.filter((p) => p.status === s).length;
    const complete = count('complete');
    return {
      today, total: people.length, complete, due: count('due'), overdue: count('overdue'),
      rate: people.length ? Math.round((complete / people.length) * 100) : null, people,
    };
  });

  /**
   * Filters: course_id, department ("none" = no department), status (complete, due, overdue; comma separated),
   * q (person or course), scope=all (every record; default is one per person per course), active=true (active
   * courses only), overdue_at=YYYY-MM-DD (records that were overdue on that day; always scope=all).
   */
  app.get('/api/training/records', view, async (req) => {
    const query = req.query as Record<string, string>;
    const today = localDate();
    const where: string[] = ['true'];
    const params: unknown[] = [today];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let from = query.scope === 'all' ? 'rec' : 'latest';
    if (query.course_id) {
      if (!UUID.test(query.course_id)) ctx.fail(400, 'bad_filter', 'That course filter is not valid.');
      where.push(`course_id = ${add(query.course_id)}`);
    }
    if (query.department === 'none') where.push('department is null');
    else if (query.department) where.push(`lower(department) = lower(${add(query.department)})`);
    if (query.status) {
      const wanted = query.status.split(',').filter((s) => STATUSES.includes(s));
      if (!wanted.length) ctx.fail(400, 'bad_filter', 'Status must be complete, due or overdue.');
      where.push(`status = any(${add(wanted)}::text[])`);
    }
    if (query.active === 'true') where.push(`course_status = 'active'`);
    if (query.q?.trim()) {
      const p = add(`%${query.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(person ilike ${p} or email ilike ${p} or course_title ilike ${p} or course_ref ilike ${p})`);
    }
    if (query.overdue_at) {
      if (!isDate(query.overdue_at)) ctx.fail(400, 'bad_filter', 'overdue_at must be a date (YYYY-MM-DD).');
      const p = add(query.overdue_at);
      from = 'rec';
      where.push(`due_on < ${p}::date and (completed_on is null or completed_on > ${p}::date) and coalesce(assigned_on, due_on) <= ${p}::date`);
    }
    const rows = await db.query<Row>(
      `${RECORDS_CTE} select * from ${from} where ${where.join(' and ')}
       order by case status when 'overdue' then 0 when 'due' then 1 else 2 end, due_on nulls last, completed_on desc nulls last, lower(person)
       limit 2000`,
      params,
    );
    return { today, rows, total: rows.length };
  });

  // The signed-in user's own training. Needs no permission: it shows only their own records.
  app.get('/api/training/mine', async (req) => {
    const today = localDate();
    const rows = await db.query<Row>(
      `${RECORDS_CTE} select * from rec where user_id = $2
       order by (completed_on is null) desc, due_on nulls last, completed_on desc`,
      [today, req.user!.id],
    );
    return { today, rows };
  });

  // ---------- writing records ----------

  /**
   * Body: { course_id, people: [{ user_id } | { name, email, department }], completed_on?, score?, result?,
   * evidence_note?, assigned_on?, due_on? }. With a completion date each person's training is recorded as
   * completed; without one it is assigned to them.
   */
  app.post('/api/training/records', { preHandler: ctx.requirePerm('training.create') }, async (req, reply) => {
    const body = (req.body ?? {}) as Row;
    const course = await needCourse(body.course_id, req);
    const today = localDate();
    const { data, errors } = await completionInput(ctx, body, today);
    const list = Array.isArray(body.people) ? body.people as Row[] : [];
    if (!list.length) errors.people = 'Add at least one person.';
    if (list.length > MAX_PEOPLE) errors.people = `Record at most ${MAX_PEOPLE} people at a time.`;
    const users = await loadUsers(ctx);
    const people: Person[] = [];
    const seen = new Set<string>();
    for (const [i, raw] of list.entries()) {
      const p = resolvePerson(raw && typeof raw === 'object' ? raw : {}, users);
      if (typeof p === 'string') { errors.people = `Person ${i + 1}: ${p}`; break; }
      if (!seen.has(p.key)) { seen.add(p.key); people.push(p); }
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    const counts: Record<string, number> = { created: 0, completed: 0, assigned: 0, duplicate: 0, exists: 0 };
    const rows: Row[] = [];
    for (const p of people) {
      const saved = await saveTraining(db, course, p, data, 'manual', today, req.user!.id);
      counts[saved.outcome]++;
      rows.push({ id: saved.id, person: p.label, outcome: saved.outcome });
    }
    const done = counts.created + counts.completed;
    await ctx.audit(req, {
      action: data.completed_on ? 'training_record.complete' : 'training_record.assign', recordType: 'course', recordId: course.id,
      summary: data.completed_on
        ? `Training completion recorded for ${courseName(course)}: ${done} of ${people.length} people (completed ${data.completed_on})`
        : `Training assigned for ${courseName(course)}: ${counts.assigned} of ${people.length} people`,
      after: { ...counts, ...data, people: rows.filter((r) => r.outcome !== 'duplicate' && r.outcome !== 'exists').map((r) => r.person) },
    });
    reply.code(201);
    return { ...counts, skipped: counts.duplicate + counts.exists, rows };
  });

  const needRecord = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID.test(id)
      ? await db.one<Row>(`${RECORDS_CTE} select * from rec where id = $2`, [localDate(), id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Training record not found.');
  };
  const EDITABLE = ['assigned_on', 'due_on', 'completed_on', 'score', 'result', 'evidence_note'] as const;

  app.patch('/api/training/records/:id', edit, async (req) => {
    const before = await needRecord(req);
    const today = localDate();
    const { data, errors } = await completionInput(ctx, (req.body ?? {}) as Row, today);
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const changed: Row = {};
    const was: Row = {};
    for (const k of EDITABLE) {
      if (data[k] !== undefined && (data[k] ?? null) !== (before[k] ?? null)) { changed[k] = data[k]; was[k] = before[k]; }
    }
    if (!Object.keys(changed).length) return before;
    const keys = Object.keys(changed);
    await db.query(
      `update training_records set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now(), updated_by = $2 where id = $1`,
      [before.id, req.user!.id, ...keys.map((k) => changed[k])],
    );
    const completing = changed.completed_on && !before.completed_on;
    await ctx.audit(req, {
      action: completing ? 'training_record.complete' : 'training_record.update', recordType: 'course', recordId: before.course_id,
      summary: completing
        ? `Training completed by ${before.person}: ${before.course_title} (${changed.completed_on})`
        : `Training record updated for ${before.person}: ${before.course_title} (${keys.join(', ')})`,
      before: was, after: changed,
    });
    return needRecord(req);
  });

  app.delete('/api/training/records/:id', { preHandler: ctx.requirePerm('training.delete') }, async (req) => {
    const before = await needRecord(req);
    await db.query('update training_records set deleted_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'training_record.delete', recordType: 'course', recordId: before.course_id,
      summary: `Training record removed for ${before.person}: ${before.course_title}`,
      before: { person: before.person, due_on: before.due_on, completed_on: before.completed_on, score: before.score, result: before.result },
    });
    return { ok: true };
  });
}
