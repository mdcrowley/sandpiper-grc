// Qualifications (E29-02 to E29-07): what each position needs, people's certifications and their
// expiry, the qualification matrix, a roster person's training and the training metrics.
// Positions and people belong to the people module (always on, but guarded: `rosterOn`).
import type { FastifyRequest } from 'fastify';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, addMonths, localDate, text, UUID } from './dates.ts';
import { recordsCte, rosterOn } from './people.ts';

export const CERT_REMINDER_SETTING = 'training.certification_reminder_days';
export const DEFAULT_CERT_REMINDER_DAYS = [90, 60, 30];
/** A requirement met but running out within this many days is shown as "expiring". */
const EXPIRING_DAYS = 30;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** The reminder steps in days before expiry (setting `training.certification_reminder_days`), largest first. */
export async function certificationReminderDays(ctx: ModuleContext): Promise<number[]> {
  const raw = await ctx.settings.get<unknown>(CERT_REMINDER_SETTING, DEFAULT_CERT_REMINDER_DAYS);
  const list = (Array.isArray(raw) ? raw : [raw]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365);
  return [...new Set(list.length ? list : DEFAULT_CERT_REMINDER_DAYS)].sort((a, b) => b - a);
}

export async function seedQualificationDefaults(ctx: ModuleContext) {
  // Generic certification types; administrators rename and add their own (no jurisdiction's scheme built in).
  await ctx.lookups.ensure('certification_type', [
    { value: 'vehicle_operator_license', label: 'Driver or operator license', color: 'blue', sort: 10, meta: { validity_months: 60, issuing_body: 'Licensing authority' } },
    { value: 'medical_fitness', label: 'Medical fitness certificate', color: 'teal', sort: 20, meta: { validity_months: 24, issuing_body: 'Occupational health provider' } },
    { value: 'first_aid', label: 'First aid', color: 'green', sort: 30, meta: { validity_months: 36, issuing_body: '' } },
    { value: 'track_access', label: 'Track access permit', color: 'amber', sort: 40, meta: { validity_months: 12, issuing_body: 'Internal' } },
    { value: 'safety_critical_competence', label: 'Critical-task competence assessment', color: 'red', sort: 50, meta: { validity_months: 24, issuing_body: 'Internal' } },
    { value: 'electrical_safety', label: 'Electrical work qualification', color: 'purple', sort: 60, meta: { validity_months: 36, issuing_body: '' } },
    { value: 'equipment_operator', label: 'Equipment operator (lifts, forklifts)', color: 'orange', sort: 70, meta: { validity_months: 36, issuing_body: '' } },
  ], { module: 'training' });
  await ctx.lookups.ensure('certification_status', [
    { value: 'active', label: 'Active', color: 'green', sort: 10 },
    { value: 'suspended', label: 'Suspended', color: 'amber', sort: 20 },
    { value: 'revoked', label: 'Revoked', color: 'red', sort: 30 },
  ], { module: 'training' });
  if ((await ctx.settings.get<unknown>(CERT_REMINDER_SETTING, null)) === null) {
    await ctx.settings.set(CERT_REMINDER_SETTING, DEFAULT_CERT_REMINDER_DAYS);
  }
}

// ---------- the qualification engine ----------

export interface Requirement { id: string; position_id: string; kind: 'course' | 'certification'; course_id: string | null; certification_type: string | null; mandatory: boolean; grace_days: number; label: string; key: string; recurrence_months: number | null }
export type CellState = 'met' | 'expiring' | 'expired' | 'missing';
export interface Cell { state: CellState; until: string | null; since: string | null }

async function requirements(ctx: ModuleContext, positionIds?: string[]): Promise<Requirement[]> {
  const types = new Map((await ctx.lookups.values('certification_type')).map((v) => [v.value, v.label]));
  const rows = await ctx.db.query<Row>(
    `select r.*, c.title as course_title, c.ref as course_ref, c.recurrence_months
     from position_requirements r left join courses c on c.id = r.course_id and c.deleted_at is null
     where r.deleted_at is null and ($1::uuid[] is null or r.position_id = any($1::uuid[]))
       and (r.kind <> 'course' or c.id is not null)
     order by r.kind, coalesce(c.title, r.certification_type)`,
    [positionIds ?? null],
  );
  return rows.map((r) => ({
    id: r.id, position_id: r.position_id, kind: r.kind, course_id: r.course_id, certification_type: r.certification_type,
    mandatory: r.mandatory === true, grace_days: Number(r.grace_days) || 0,
    recurrence_months: Number(r.recurrence_months) > 0 ? Number(r.recurrence_months) : null,
    label: r.kind === 'course' ? String(r.course_title) : types.get(r.certification_type) ?? String(r.certification_type),
    key: r.kind === 'course' ? `course:${r.course_id}` : `cert:${r.certification_type}`,
  }));
}

const stateOf = (until: string | null, graceDays: number, asOf: string): CellState => {
  if (!until) return 'met';
  if (addDays(until, graceDays) < asOf) return 'expired';
  return until <= addDays(asOf, EXPIRING_DAYS) ? 'expiring' : 'met';
};

/**
 * Each person's state for each requirement of their position, as of a day: a course counts when
 * completed (and passed) on or before that day and, for a repeating course, not older than the
 * repeat period plus the grace days; a certification counts when active, issued by then and not
 * expired beyond the grace days. Qualified = every mandatory requirement met or expiring.
 */
export async function qualificationRows(ctx: ModuleContext, people: Row[], asOf: string): Promise<{ reqs: Requirement[]; rows: (Row & { cells: Record<string, Cell>; qualified: boolean; required: number })[] }> {
  const positionIds = [...new Set(people.map((p) => p.position_id).filter(Boolean))] as string[];
  const reqs = positionIds.length ? await requirements(ctx, positionIds) : [];
  const ids = people.map((p) => p.id);
  const keys = people.flatMap((p) => [`p:${p.id}`, ...(p.user_id ? [`u:${p.user_id}`] : [])]);
  const completions = ids.length ? await ctx.db.query<Row>(
    `select r.course_id, r.person_id, r.person_key, max(r.completed_on) as completed_on
     from training_records r
     where r.deleted_at is null and r.completed_on is not null and r.completed_on <= $3::date and r.result is distinct from 'failed'
       and (r.person_id = any($1::uuid[]) or r.person_key = any($2::text[]))
     group by r.course_id, r.person_id, r.person_key`,
    [ids, keys, asOf],
  ) : [];
  const certs = ids.length ? await ctx.db.query<Row>(
    `select person_id, certification_type, max(coalesce(expires_on, '9999-12-31'::date)) as expires_on, min(issued_on) as issued_on
     from certifications
     where deleted_at is null and status = 'active' and person_id = any($1::uuid[]) and (issued_on is null or issued_on <= $2::date)
     group by person_id, certification_type`,
    [ids, asOf],
  ) : [];
  const rows = people.map((p) => {
    const mine = reqs.filter((r) => r.position_id === p.position_id);
    const cells: Record<string, Cell> = {};
    let qualified = true;
    for (const r of mine) {
      let cell: Cell;
      if (r.kind === 'course') {
        const done = completions
          .filter((c) => c.course_id === r.course_id && (c.person_id === p.id || c.person_key === `p:${p.id}` || (p.user_id && c.person_key === `u:${p.user_id}`)))
          .map((c) => iso(c.completed_on)!).sort().pop() ?? null;
        if (!done) cell = { state: 'missing', until: null, since: null };
        else {
          const until = r.recurrence_months ? addMonths(done, r.recurrence_months) : null;
          cell = { state: stateOf(until, r.grace_days, asOf), until, since: done };
        }
      } else {
        const c = certs.find((x) => x.person_id === p.id && x.certification_type === r.certification_type);
        if (!c) cell = { state: 'missing', until: null, since: null };
        else {
          const exp = iso(c.expires_on);
          const until = exp === '9999-12-31' ? null : exp;
          cell = { state: stateOf(until, r.grace_days, asOf), until, since: iso(c.issued_on) };
        }
      }
      cells[r.key] = cell;
      if (r.mandatory && (cell.state === 'missing' || cell.state === 'expired')) qualified = false;
    }
    return { ...p, cells, qualified: mine.some((r) => r.mandatory) ? qualified : true, required: mine.filter((r) => r.mandatory).length };
  });
  return { reqs, rows };
}

const ROSTER_SELECT = `
  select p.id, p.ref, p.full_name, p.employee_number, p.user_id, p.position_id, p.department_id, p.work_site_id, p.status,
         pos.name as position, d.name as department
  from people p
  left join positions pos on pos.id = p.position_id and pos.deleted_at is null
  left join departments d on d.id = p.department_id and d.deleted_at is null
  where p.deleted_at is null and p.status <> 'left'`;

/** Monthly figure helpers: the end of the month that starts on monthStart, or today for the month running. */
const asOfMonth = (monthStart: string): string => {
  const end = addDays(addMonths(monthStart, 1), -1);
  const today = localDate();
  return end < today ? end : today;
};

export function registerQualifications(ctx: ModuleContext) {
  const { app, db } = ctx;
  const roster = rosterOn(db);
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  // ---------- certifications (a record type) ----------

  ctx.defineResource({
    type: 'certification', table: 'certifications', module: 'training', label: 'Certification', plural: 'Certifications',
    path: '/api/certifications', route: '/training/certifications', titleField: 'ref', ref: { field: 'ref', prefix: 'CRT-' },
    evidence: true,
    searchable: ['number', 'issuing_body'],
    defaultSort: { field: 'expires_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      person_id: { label: 'Person', type: 'ref', to: 'person', required: true },
      certification_type: { label: 'Certification', type: 'lookup', list: 'certification_type', required: true },
      number: { label: 'Certificate number', type: 'text', personal: true },
      issuing_body: { label: 'Issued by', type: 'text' },
      issued_on: { label: 'Issued on', type: 'date' },
      expires_on: { label: 'Expires on', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'certification_status', default: 'active' },
      notes: { label: 'Notes', type: 'longtext', personal: true },
      // E46-72: the holder's position and department on the roster, copied on save and kept in step when the person moves.
      position_id: { label: 'Position', type: 'ref', to: 'position', readOnly: true, help: 'The holder\'s position on the roster; filled in from the person and kept in step when it changes.' },
      department_id: { label: 'Department', type: 'ref', to: 'department', readOnly: true, help: 'The holder\'s department on the roster; filled in from the person and kept in step when it changes.' },
    },
    hooks: {
      beforeCreate: async (_req, data) => checkCertification(data, null),
      beforeUpdate: async (_req, existing, patch) => checkCertification(patch, existing),
    },
  });

  /** A real roster person; dates in order; the type's validity and issuing body fill empty fields. */
  async function checkCertification(patch: Row, existing: Row | null): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const fields: Record<string, string> = {};
    if ('person_id' in patch && patch.person_id && roster
      && !(await db.one('select 1 from people where id = $1 and deleted_at is null', [patch.person_id]))) {
      fields.person_id = 'That person is not on the roster.';
    }
    if (merged.issued_on && merged.expires_on && iso(merged.expires_on)! < iso(merged.issued_on)!) fields.expires_on = 'The expiry date cannot be before the issue date.';
    if (merged.issued_on && iso(merged.issued_on)! > localDate()) fields.issued_on = 'The issue date cannot be in the future.';
    if (Object.keys(fields).length) invalid(fields);
    const type = (await ctx.lookups.values('certification_type')).find((v) => v.value === merged.certification_type);
    const meta = (type?.meta ?? {}) as Row;
    if (!existing || 'issued_on' in patch || 'certification_type' in patch) {
      const months = Number(meta.validity_months);
      if (!merged.expires_on && merged.issued_on && Number.isInteger(months) && months > 0) patch.expires_on = addMonths(iso(merged.issued_on)!, months);
    }
    if (!merged.issuing_body && typeof meta.issuing_body === 'string' && meta.issuing_body) patch.issuing_body = meta.issuing_body;
    // E46-72: the holder's position and department, from the roster (a data load may give them).
    if (roster && merged.person_id && (!existing || 'person_id' in patch)) {
      const p = await db.one<Row>('select position_id, department_id from people where id = $1', [merged.person_id]);
      patch.position_id = p?.position_id ?? null;
      patch.department_id = p?.department_id ?? null;
    }
    // A new expiry date starts the reminders again.
    if (existing && 'expires_on' in patch && iso(patch.expires_on) !== iso(existing.expires_on)) patch.reminded_for = null;
    return patch;
  }

  // ---------- position requirements ----------

  const view = { preHandler: ctx.requirePerm('training.view') };
  const edit = { preHandler: ctx.requirePerm('training.edit') };
  const needPosition = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id ?? '');
    const row = roster && UUID.test(id) ? await ctx.resources.find('position', id, req.user) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Position not found.');
  };
  const REQ_SELECT = `
    select r.id, r.position_id, r.kind, r.course_id, r.certification_type, r.mandatory, r.grace_days, r.created_at,
           c.title as course_title, c.ref as course_ref
    from position_requirements r left join courses c on c.id = r.course_id
    where r.deleted_at is null`;

  async function requirementInput(body: Row, existing: Row | null): Promise<Row> {
    const out: Row = {};
    const fields: Record<string, string> = {};
    const kind = body.kind ?? existing?.kind;
    if (!['course', 'certification'].includes(kind)) fields.kind = 'Choose a course or a certification.';
    if (kind === 'course' && (!existing || 'course_id' in body)) {
      const id = text(body.course_id);
      if (!id || !UUID.test(id) || !(await db.one('select 1 from courses where id = $1 and deleted_at is null', [id]))) fields.course_id = 'Choose a course.';
      out.course_id = id; out.certification_type = null;
    }
    if (kind === 'certification' && (!existing || 'certification_type' in body)) {
      const v = text(body.certification_type);
      if (!v || !(await ctx.lookups.values('certification_type')).some((x) => x.value === v)) fields.certification_type = 'Choose a certification.';
      out.certification_type = v; out.course_id = null;
    }
    if ('mandatory' in body || !existing) out.mandatory = body.mandatory === undefined ? true : body.mandatory === true || body.mandatory === 'true';
    if ('grace_days' in body || !existing) {
      const n = body.grace_days === undefined || body.grace_days === null || body.grace_days === '' ? 0 : Number(body.grace_days);
      if (!Number.isInteger(n) || n < 0 || n > 365) fields.grace_days = 'Grace days must be a whole number from 0 to 365.';
      out.grace_days = n;
    }
    out.kind = kind;
    if (Object.keys(fields).length) invalid(fields);
    return out;
  }

  app.get('/api/positions/:id/requirements', view, async (req) => {
    const pos = await needPosition(req);
    return db.query(`${REQ_SELECT} and r.position_id = $1 order by r.kind, coalesce(c.title, r.certification_type)`, [pos.id]);
  });
  app.post('/api/positions/:id/requirements', edit, async (req, reply) => {
    const pos = await needPosition(req);
    const data = await requirementInput((req.body ?? {}) as Row, null);
    const clash = await db.one(
      `select 1 from position_requirements where position_id = $1 and deleted_at is null and kind = $2
         and coalesce(course_id::text, certification_type) = coalesce($3::text, $4)`,
      [pos.id, data.kind, data.course_id ?? null, data.certification_type ?? null]);
    if (clash) ctx.fail(409, 'duplicate', 'This position already has that requirement.');
    const row = (await db.one<Row>(
      `insert into position_requirements (position_id, kind, course_id, certification_type, mandatory, grace_days, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
      [pos.id, data.kind, data.course_id ?? null, data.certification_type ?? null, data.mandatory, data.grace_days, req.user!.id]))!;
    const saved = (await db.one<Row>(`${REQ_SELECT} and r.id = $1`, [row.id]))!;
    await ctx.audit(req, {
      action: 'position_requirement.create', recordType: 'position', recordId: pos.id,
      summary: `Requirement added to ${[pos.ref, pos.name].filter(Boolean).join(' ')}: ${saved.course_title ?? saved.certification_type}`,
      after: data,
    });
    reply.code(201);
    return saved;
  });
  const needReq = async (req: FastifyRequest, pos: Row): Promise<Row> => {
    const rid = String((req.params as Row).rid ?? '');
    const row = UUID.test(rid) ? await db.one<Row>(`${REQ_SELECT} and r.id = $1 and r.position_id = $2`, [rid, pos.id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Requirement not found.');
  };
  app.patch('/api/positions/:id/requirements/:rid', edit, async (req) => {
    const pos = await needPosition(req);
    const before = await needReq(req, pos);
    const body = (req.body ?? {}) as Row;
    const data = await requirementInput({ mandatory: body.mandatory, grace_days: body.grace_days, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) }, before);
    await db.query(
      `update position_requirements set mandatory = coalesce($2, mandatory), grace_days = coalesce($3, grace_days), updated_at = now(), updated_by = $4 where id = $1`,
      [before.id, 'mandatory' in body ? data.mandatory : null, 'grace_days' in body ? data.grace_days : null, req.user!.id]);
    const after = (await db.one<Row>(`${REQ_SELECT} and r.id = $1`, [before.id]))!;
    await ctx.audit(req, {
      action: 'position_requirement.update', recordType: 'position', recordId: pos.id,
      summary: `Requirement changed on ${[pos.ref, pos.name].filter(Boolean).join(' ')}: ${after.course_title ?? after.certification_type}`,
      before: { mandatory: before.mandatory, grace_days: before.grace_days }, after: { mandatory: after.mandatory, grace_days: after.grace_days },
    });
    return after;
  });
  app.delete('/api/positions/:id/requirements/:rid', edit, async (req) => {
    const pos = await needPosition(req);
    const before = await needReq(req, pos);
    await db.query('update position_requirements set deleted_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'position_requirement.delete', recordType: 'position', recordId: pos.id,
      summary: `Requirement removed from ${[pos.ref, pos.name].filter(Boolean).join(' ')}: ${before.course_title ?? before.certification_type}`,
      before: { kind: before.kind, course_id: before.course_id, certification_type: before.certification_type },
    });
    return { ok: true };
  });
  for (const [method, path, summary, body] of [
    ['GET', '/api/positions/:id/requirements', 'The courses and certifications a position needs', undefined],
    ['POST', '/api/positions/:id/requirements', 'Add a requirement to a position', '{ kind: course | certification, course_id?, certification_type?, mandatory?, grace_days? }'],
    ['PATCH', '/api/positions/:id/requirements/:rid', 'Change whether a requirement is mandatory, or its grace days', '{ mandatory?, grace_days? }'],
    ['DELETE', '/api/positions/:id/requirements/:rid', 'Remove a requirement from a position', undefined],
  ] as const) {
    ctx.describeRoute({ method, path, summary, permission: method === 'GET' ? 'training.view' : 'training.edit', ...(body ? { body } : {}) });
  }

  // ---------- the qualification matrix ----------

  // Names come from the roster, so the matrix needs people.view as well as training.view.
  const viewRoster = { preHandler: [ctx.requirePerm('training.view'), ctx.requirePerm('people.view')] };

  app.get('/api/training/qualifications', viewRoster, async (req) => {
    if (!roster) ctx.fail(404, 'not_found', 'The roster is not available.');
    const q = req.query as Record<string, string>;
    // Only the people the caller may see on the roster (E41-01: a role scoped to departments or sites).
    const where: string[] = [ctx.resources.visibleWhere('person', req.user, 'p')];
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    for (const [key, col] of [['position', 'p.position_id'], ['department', 'p.department_id'], ['site', 'p.work_site_id']] as const) {
      if (!q[key]) continue;
      if (!UUID.test(q[key])) ctx.fail(400, 'bad_filter', `That ${key} filter is not valid.`);
      where.push(`${col} = ${add(q[key])}`);
    }
    if (q.qualified && !['true', 'false'].includes(q.qualified)) ctx.fail(400, 'bad_filter', 'qualified must be true or false.');
    const people = await db.query<Row>(`${ROSTER_SELECT} ${where.map((w) => `and ${w}`).join(' ')} and p.position_id is not null order by lower(p.full_name) limit 5000`, params);
    const today = localDate();
    const { reqs, rows } = await qualificationRows(ctx, people, today);
    const columns = [...new Map(reqs.map((r) => [r.key, { key: r.key, label: r.label, kind: r.kind }])).values()]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    const shown = q.qualified ? rows.filter((r) => String(r.qualified) === q.qualified) : rows;
    return {
      today, columns,
      // Qualified counts only people whose position has mandatory requirements.
      counts: { people: rows.length, qualified: rows.filter((r) => r.required > 0 && r.qualified).length, withRequirements: rows.filter((r) => r.required > 0).length },
      rows: shown.map((r) => ({
        id: r.id, ref: r.ref, full_name: r.full_name, employee_number: r.employee_number, position_id: r.position_id, position: r.position,
        department: r.department, status: r.status, qualified: r.qualified, required: r.required, cells: r.cells,
      })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/training/qualifications', permission: 'people.view',
    summary: 'Who is qualified now: each roster person against the requirements of their position (needs training.view and people.view)',
    query: { position: 'position id', department: 'department id', site: 'site id', qualified: 'true | false' },
    response: '{ today, columns: [{ key, label, kind }], counts: { people, qualified (of those with requirements), withRequirements }, rows: [{ id, ref, full_name, position, department, qualified, cells: { [key]: { state: met | expiring | expired | missing, until, since } } }] }',
  });

  // One roster person's training, certifications and qualification, for their record page.
  app.get('/api/training/people/:id', viewRoster, async (req) => {
    const id = String((req.params as Row).id ?? '');
    const person = roster && UUID.test(id) ? await ctx.resources.find('person', id, req.user) : undefined;
    if (!person) ctx.fail(404, 'not_found', 'Person not found.');
    const today = localDate();
    const keys = [`p:${person!.id}`, ...(person!.user_id ? [`u:${person!.user_id}`] : [])];
    const records = await db.query<Row>(
      `${recordsCte(db)} select * from rec where person_id = $2 or person_key = any($3::text[])
       order by (completed_on is null) desc, due_on nulls last, completed_on desc`, [today, person!.id, keys]);
    const certifications = await db.query<Row>(
      `select id, ref, certification_type, number, issuing_body, issued_on, expires_on, status from certifications
       where deleted_at is null and person_id = $1 order by expires_on nulls last`, [person!.id]);
    const { reqs, rows } = await qualificationRows(ctx, [person!], today);
    return {
      today, records, certifications,
      qualified: rows[0].qualified,
      requirements: reqs.filter((r) => r.position_id === person!.position_id).map((r) => ({ key: r.key, label: r.label, kind: r.kind, mandatory: r.mandatory, ...rows[0].cells[r.key] })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/training/people/:id', permission: 'people.view',
    summary: 'A roster person\'s training records, certifications and qualification against their position (needs training.view and people.view)',
    response: '{ today, records, certifications, qualified, requirements: [{ key, label, kind, mandatory, state, until, since }] }',
  });

  // ---------- expiring certifications ----------

  app.get('/api/training/certifications/expiring', viewRoster, async (req) => {
    const q = req.query as Record<string, string>;
    const days = q.days === undefined ? 90 : Number(q.days);
    if (!Number.isInteger(days) || days < 0 || days > 730) ctx.fail(400, 'bad_filter', 'days must be a whole number from 0 to 730.');
    // E46-72: by the holder's position or department on the roster.
    const by: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of [['position', 'c.position_id'], ['department', 'c.department_id']] as const) {
      if (!q[key]) continue;
      if (!UUID.test(q[key])) ctx.fail(400, 'bad_filter', `That ${key} filter is not valid.`);
      params.push(q[key]);
      by.push(`and ${col} = $${params.length + 2}`);
    }
    const today = localDate();
    const until = addDays(today, days);
    const rows = await db.query<Row>(
      `select c.id, c.ref, c.person_id, c.certification_type, c.number, c.issuing_body, c.issued_on, c.expires_on, c.status,
              ${roster ? 'p.full_name as person, p.ref as person_ref, pos.name as position, d.name as department' : 'null as person, null as person_ref, null as position, null as department'},
              (c.expires_on - $1::date) as days_left
       from certifications c
       ${roster ? `join people p on p.id = c.person_id and p.deleted_at is null and p.status <> 'left'
                   left join positions pos on pos.id = p.position_id and pos.deleted_at is null
                   left join departments d on d.id = p.department_id and d.deleted_at is null` : ''}
       where c.deleted_at is null and c.status = 'active' and c.expires_on is not null and c.expires_on <= $2::date ${by.join(' ')}
         and not exists (select 1 from certifications n where n.deleted_at is null and n.status = 'active' and n.person_id = c.person_id
                           and n.certification_type = c.certification_type and n.id <> c.id
                           and (n.expires_on is null or n.expires_on > c.expires_on))
       order by c.expires_on`, [today, until, ...params]);
    const within = (n: number) => rows.filter((r) => Number(r.days_left) >= 0 && Number(r.days_left) <= n).length;
    return {
      today, days, rows: rows.map((r) => ({ ...r, days_left: Number(r.days_left) })),
      counts: { expired: rows.filter((r) => Number(r.days_left) < 0).length, within30: within(30), within60: within(60), within90: within(90) },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/training/certifications/expiring', permission: 'people.view',
    summary: 'Certifications that have expired or expire within the given days and have not been renewed (needs training.view and people.view)',
    query: { days: 'whole number of days ahead, 0 to 730 (default 90)', position: 'position id (the holder\'s position)', department: 'department id (the holder\'s department)' },
    response: '{ today, days, counts: { expired, within30, within60, within90 }, rows: [{ id, ref, person, person_ref, position, department, certification_type, expires_on, days_left }] }',
  });

  // ---------- my certifications (E46-70) ----------

  // Every employee's own certifications and when they expire, for My work and My training. Needs no
  // permission: it answers only about the roster person linked to the signed-in account.
  app.get('/api/training/mine/certifications', async (req) => {
    const today = localDate();
    const empty = { today, person: null, rows: [], missing: [] };
    if (!roster) return empty;
    const person = await db.one<Row>(`${ROSTER_SELECT} and p.user_id = $1 order by p.created_at limit 1`, [req.user!.id]);
    if (!person) return empty;
    const types = new Map((await ctx.lookups.values('certification_type')).map((v) => [v.value, v.label]));
    const certs = await db.query<Row>(
      `select c.id, c.ref, c.certification_type, c.number, c.issuing_body, c.issued_on, c.expires_on, c.status,
              (c.expires_on - $2::date) as days_left,
              exists (select 1 from certifications n where n.deleted_at is null and n.status = 'active' and n.person_id = c.person_id
                        and n.certification_type = c.certification_type and n.id <> c.id
                        and (n.expires_on is null or (c.expires_on is not null and n.expires_on > c.expires_on))) as renewed
       from certifications c where c.deleted_at is null and c.person_id = $1
       order by c.status <> 'active', c.expires_on nulls last, c.ref`, [person.id, today]);
    const rows = certs.map((c) => {
      const left = c.days_left === null ? null : Number(c.days_left);
      const state = c.status !== 'active' ? 'inactive' : c.renewed ? 'renewed' : left === null ? 'current'
        : left < 0 ? 'expired' : left <= EXPIRING_DAYS ? 'expiring' : 'current';
      return {
        id: c.id, ref: c.ref, certification_type: c.certification_type, label: types.get(c.certification_type) ?? c.certification_type,
        number: c.number, issuing_body: c.issuing_body, issued_on: iso(c.issued_on), expires_on: iso(c.expires_on), status: c.status,
        days_left: left, state,
      };
    });
    // What the person's position needs that they do not hold in date.
    const { reqs, rows: q } = await qualificationRows(ctx, [person], today);
    const missing = reqs.filter((r) => r.kind === 'certification' && r.position_id === person.position_id)
      .map((r) => ({ key: r.key, label: r.label, mandatory: r.mandatory, state: q[0].cells[r.key]?.state ?? 'missing' }))
      .filter((r) => r.state === 'missing' || r.state === 'expired');
    return { today, person: { id: person.id, full_name: person.full_name, position: person.position, department: person.department }, rows, missing };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/training/mine/certifications',
    summary: 'My certifications: the signed-in person\'s own certifications and when each expires (no permission needed)',
    description: 'Answers about the roster person linked to your account only. `state`: current, expiring (within 30 days), expired, renewed (a later one of the same kind exists) or inactive (suspended or revoked). `missing` lists certifications your position needs that you do not hold in date.',
    response: '{ today, person: { id, full_name, position, department } | null, rows: [{ id, ref, certification_type, label, number, issuing_body, issued_on, expires_on, status, days_left, state }], missing: [{ key, label, mandatory, state }] }',
  });

  // ---------- settings: certification reminder steps ----------

  app.get('/api/training/certifications/settings', view, async () => ({ reminder_days: await certificationReminderDays(ctx) }));
  app.put('/api/training/certifications/settings', { preHandler: ctx.requirePerm('training.administer') }, async (req) => {
    const raw = (req.body as Row | null)?.reminder_days;
    const list = Array.isArray(raw) ? raw.map(Number) : [];
    if (!list.length || list.length > 6 || list.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) {
      invalid({ reminder_days: 'Give one to six whole numbers of days from 1 to 365.' });
    }
    const steps = [...new Set(list)].sort((a, b) => b - a);
    await ctx.settings.set(CERT_REMINDER_SETTING, steps, req);
    return { reminder_days: steps };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/training/certifications/settings', permission: 'training.view', summary: 'Days before expiry at which certification reminders are sent' });
  ctx.describeRoute({ method: 'PUT', path: '/api/training/certifications/settings', permission: 'training.administer', summary: 'Change the certification reminder days', body: '{ reminder_days: number[] }' });

  // ---------- metrics (contract C3) ----------

  defineMetric(app, {
    key: 'training.compliance_pct', label: 'Staff qualified for their position', unit: 'percent', recordType: 'course',
    description: 'Roster people (not left) whose position has mandatory requirements and who met every one of them at the end of the month, as a percentage of those people.',
    compute: async (mctx, monthStart) => {
      if (!rosterOn(mctx.db)) return null;
      const asOf = asOfMonth(monthStart);
      const people = await mctx.db.query<Row>(
        `select id, user_id, position_id from people where deleted_at is null and status <> 'left' and position_id is not null
           and (hire_date is null or hire_date <= $1::date)`, [asOf]);
      const { rows } = await qualificationRows(mctx, people, asOf);
      const counted = rows.filter((r) => r.required > 0);
      return counted.length ? Math.round((counted.filter((r) => r.qualified).length / counted.length) * 1000) / 10 : null;
    },
  });
  defineMetric(app, {
    key: 'training.certifications_expired', label: 'Expired certifications not renewed', unit: 'count', recordType: 'certification',
    description: 'Active certifications that had expired by the end of the month with no later certification of the same type for the same person.',
    compute: async (mctx, monthStart) => {
      const asOf = asOfMonth(monthStart);
      const row = await mctx.db.one<{ n: number }>(
        `select count(*)::int as n from certifications c
         where c.deleted_at is null and c.status = 'active' and c.expires_on < $1::date
           and not exists (select 1 from certifications n where n.deleted_at is null and n.status = 'active' and n.person_id = c.person_id
                             and n.certification_type = c.certification_type and n.id <> c.id
                             and (n.expires_on is null or n.expires_on >= $1::date) and (n.issued_on is null or n.issued_on <= $1::date))`,
        [asOf]);
      return row?.n ?? 0;
    },
  });
}

// ---------- expiry reminders (job training.certifications) ----------

/**
 * Tells the person (when they have an account) and their supervisor (when the supervisor has one)
 * that a certification expires within one of the reminder steps, once per step and expiry date.
 * Each certification is claimed (`reminded_for`) before anyone is told, so two runs never send twice.
 */
export async function runCertificationReminders(ctx: ModuleContext, now: Date = new Date()): Promise<{ reminded: number; notifications: number }> {
  if (!rosterOn(ctx.db)) return { reminded: 0, notifications: 0 };
  const today = localDate(now);
  const steps = await certificationReminderDays(ctx);
  const types = new Map((await ctx.lookups.values('certification_type')).map((v) => [v.value, v.label]));
  const due = await ctx.db.query<Row>(
    `select c.id, c.ref, c.certification_type, c.expires_on, c.reminded_for, (c.expires_on - $1::date) as days_left,
            p.id as person_id, p.full_name, pu.id as person_user, su.id as supervisor_user
     from certifications c
     join people p on p.id = c.person_id and p.deleted_at is null and p.status = 'active'
     left join users pu on pu.id = p.user_id and pu.deleted_at is null and pu.status = 'active'
     left join people s on s.id = p.supervisor_person_id and s.deleted_at is null
     left join users su on su.id = s.user_id and su.deleted_at is null and su.status = 'active'
     where c.deleted_at is null and c.status = 'active' and c.expires_on is not null and c.expires_on <= $2::date
       and not exists (select 1 from certifications n where n.deleted_at is null and n.status = 'active' and n.person_id = c.person_id
                         and n.certification_type = c.certification_type and n.id <> c.id and (n.expires_on is null or n.expires_on > c.expires_on))`,
    [today, addDays(today, steps[0])],
  );
  let reminded = 0;
  let notifications = 0;
  for (const c of due) {
    const left = Number(c.days_left);
    // The step it is in now: 0 once expired, else the smallest step that still covers the days left.
    const step = left < 0 ? 0 : steps.filter((s) => s >= left).sort((a, b) => a - b)[0];
    if (step === undefined) continue;
    const mark = `${iso(c.expires_on)}:${step}`;
    const prev = typeof c.reminded_for === 'string' && c.reminded_for.startsWith(`${iso(c.expires_on)}:`) ? Number(c.reminded_for.split(':')[1]) : null;
    if (prev !== null && prev <= step) continue;
    const claimed = await ctx.db.one(
      'update certifications set reminded_for = $2 where id = $1 and reminded_for is not distinct from $3 returning id', [c.id, mark, c.reminded_for ?? null]);
    if (!claimed) continue;
    reminded++;
    const label = types.get(c.certification_type) ?? c.certification_type;
    const when = left < 0 ? `expired on ${iso(c.expires_on)}` : left === 0 ? 'expires today' : `expires in ${left} day${left === 1 ? '' : 's'} (${iso(c.expires_on)})`;
    if (ctx.app.hasDecorator('notify')) {
      if (c.person_user) {
        notifications += (await ctx.app.notify({ userIds: [c.person_user], kind: 'reminder', title: `Your ${label} ${when}`, body: 'Arrange the renewal and give the new certificate to your supervisor.', route: '/training/mine' })).sent;
      }
      const sup = c.supervisor_user && c.supervisor_user !== c.person_user ? [c.supervisor_user] : [];
      if (sup.length) {
        notifications += (await ctx.app.notify({
          userIds: sup, kind: 'reminder', title: `${label} of ${c.full_name} ${when}`, body: `Certification ${c.ref}.`,
          route: `/training/certifications/${c.id}`, recordType: 'certification', recordId: c.id,
        })).sent;
      }
    }
    await ctx.audit(null, {
      action: 'certification.reminder', recordType: 'certification', recordId: c.id,
      summary: `Expiry reminder for ${c.ref}: ${label} ${when}`, after: { step, expires_on: iso(c.expires_on) },
    });
  }
  return { reminded, notifications };
}

/** Training records kept by email before the person was on the roster become theirs (one person, never two). */
export async function adoptRosterRecords(ctx: ModuleContext, person: Row): Promise<void> {
  if (!rosterOn(ctx.db) || person.deleted_at) return;
  if (person.user_id) {
    await ctx.db.query('update training_records set person_id = $1 where user_id = $2 and person_id is null', [person.id, person.user_id]);
    // Records kept for the person before they had an account follow the account.
    await ctx.db.query(`update training_records set user_id = $2::uuid, person_key = $3 where person_key = $1`, [`p:${person.id}`, person.user_id, `u:${person.user_id}`]);
  } else if (person.email) {
    await ctx.db.query(
      `update training_records set person_id = $1::uuid, person_key = $2
       where user_id is null and person_key = $3`, [person.id, `p:${person.id}`, `e:${String(person.email).toLowerCase()}`]);
  }
}


/**
 * E46-72: certifications carry their holder's position and department. Copies one person's (when a
 * roster person is saved) or everyone's (at start, for certifications from before wave 27). A derived
 * copy of the roster, which is audited on its own change: nothing is audited here.
 */
export async function syncCertificationRoster(ctx: ModuleContext, personId?: string): Promise<number> {
  if (!rosterOn(ctx.db)) return 0;
  const rows = await ctx.db.query<{ id: string }>(
    `update certifications c set position_id = p.position_id, department_id = p.department_id
     from people p
     where p.id = c.person_id and ($1::uuid is null or c.person_id = $1::uuid)
       and (c.position_id is distinct from p.position_id or c.department_id is distinct from p.department_id)
     returning c.id`, [personId ?? null]);
  return rows.length;
}
