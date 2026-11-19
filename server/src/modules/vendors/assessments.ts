// Vendor assessment questionnaire: a versioned set of weighted questions, completed
// internally for a vendor, scored, and kept as history. Gaps can be raised as actions and a
// completed assessment can be saved as an evidence item.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate, localDate } from './dates.ts';
import { registerEvidenceExpiry } from './evidenceExpiry.ts';
import { registerResponseLinks } from './responseLinks.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Question {
  key: string;
  section: string | null;
  text: string;
  guidance: string | null;
  weight: number;
}

export type Answer = 'yes' | 'partial' | 'no' | 'na';
export const ANSWERS: Answer[] = ['yes', 'partial', 'no', 'na'];
const ANSWER_VALUE: Record<Answer, number | null> = { yes: 1, partial: 0.5, no: 0, na: null };

export interface AnswerEntry { answer?: Answer | null; note?: string | null; action_id?: string | null }
export type Answers = Record<string, AnswerEntry>;

/** General starter questions. An installation replaces them on the Assessment questions page. */
export const DEFAULT_QUESTIONS: Question[] = [
  { key: 'security_owner', section: 'Governance', text: 'Is a named person accountable for information security?', guidance: 'Ask for the role and how it reports to senior management.', weight: 2 },
  { key: 'independent_review', section: 'Governance', text: 'Has security been independently reviewed or certified in the last 12 months?', guidance: 'An assurance report or certificate from an independent assessor.', weight: 3 },
  { key: 'staff_training', section: 'Governance', text: 'Do all staff complete security awareness training at least once a year?', guidance: null, weight: 1 },
  { key: 'mfa', section: 'Access', text: 'Is multi-factor sign-in enforced for staff and for administrator access?', guidance: 'Including remote access and access to our data.', weight: 3 },
  { key: 'least_privilege', section: 'Access', text: 'Is access to our data limited to the people who need it, and reviewed regularly?', guidance: null, weight: 2 },
  { key: 'encryption', section: 'Data protection', text: 'Is our data encrypted in transit and at rest?', guidance: null, weight: 3 },
  { key: 'data_location', section: 'Data protection', text: 'Is it clear where our data is stored and which subcontractors can reach it?', guidance: null, weight: 2 },
  { key: 'data_return', section: 'Data protection', text: 'Will our data be returned or destroyed when the service ends?', guidance: null, weight: 2 },
  { key: 'patching', section: 'Operations', text: 'Are security updates applied within a stated time?', guidance: 'Ask for the target times for critical and other updates.', weight: 2 },
  { key: 'backups', section: 'Operations', text: 'Are backups taken and restores tested, with stated recovery times?', guidance: null, weight: 2 },
  { key: 'incident_notice', section: 'Incidents', text: 'Will we be told about a security incident within a stated time?', guidance: 'Compare with the breach notice term in the contract.', weight: 3 },
  { key: 'incident_plan', section: 'Incidents', text: 'Is there an incident response plan that is exercised at least once a year?', guidance: null, weight: 1 },
];

const clean = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};

/** Validates questions typed on the editor. Returns the cleaned list or a message. */
export function parseQuestions(input: unknown): { questions: Question[] } | { error: string } {
  if (!Array.isArray(input) || !input.length) return { error: 'Add at least one question.' };
  if (input.length > 60) return { error: 'Use at most 60 questions.' };
  const questions: Question[] = [];
  const keys = new Set<string>();
  for (const [i, raw] of input.entries()) {
    const q = (raw ?? {}) as Row;
    const text = clean(q.text, 500);
    if (!text) return { error: `Question ${i + 1} has no text.` };
    const weight = q.weight === undefined || q.weight === null || q.weight === '' ? 1 : Number(q.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 5) return { error: `Question ${i + 1}: the weight must be a whole number from 1 to 5.` };
    let key = typeof q.key === 'string' && /^[a-z0-9_]{1,40}$/.test(q.key) && !keys.has(q.key) ? q.key : '';
    for (let n = i + 1; !key || keys.has(key); n += 1) key = `q${n}`;
    keys.add(key);
    questions.push({ key, section: clean(q.section, 80), text, guidance: clean(q.guidance, 500), weight });
  }
  return { questions };
}

/** Score from 0 to 100: the weighted share of "yes" (1) and "partly" (0.5). "Not applicable" is left out. */
export function scoreAnswers(questions: Question[], answers: Answers): number | null {
  let got = 0;
  let possible = 0;
  for (const q of questions) {
    const a = answers[q.key]?.answer;
    const value = a ? ANSWER_VALUE[a] : undefined;
    if (value === null || value === undefined) continue;
    got += value * q.weight;
    possible += q.weight;
  }
  return possible ? Math.round((got / possible) * 100) : null;
}

/** Questions answered "no" or "partly", heaviest first. */
export function gapsOf(questions: Question[], answers: Answers) {
  return questions
    .filter((q) => answers[q.key]?.answer === 'no' || answers[q.key]?.answer === 'partial')
    .map((q) => ({
      key: q.key, section: q.section, text: q.text, weight: q.weight,
      answer: answers[q.key]!.answer as Answer, note: answers[q.key]!.note ?? null, action_id: answers[q.key]!.action_id ?? null,
    }))
    .sort((a, b) => b.weight - a.weight || (a.answer === 'no' ? -1 : 1) - (b.answer === 'no' ? -1 : 1));
}

const answered = (questions: Question[], answers: Answers) => questions.filter((q) => answers[q.key]?.answer).length;

export async function activeQuestionSet(ctx: ModuleContext): Promise<Row | undefined> {
  return ctx.db.one<Row>('select * from vendor_question_sets where active order by version desc limit 1');
}

export async function ensureDefaultQuestionSet(ctx: ModuleContext): Promise<void> {
  const any = await ctx.db.one<Row>('select id from vendor_question_sets limit 1');
  if (any) return;
  await ctx.db.query(
    'insert into vendor_question_sets (version, title, questions) values (1, $1, $2::jsonb)',
    ['Vendor security assessment', JSON.stringify(DEFAULT_QUESTIONS)],
  );
}

/** The latest completed assessment of a vendor, for the vendor summary. */
export async function latestAssessment(ctx: ModuleContext, vendorId: string) {
  const row = await ctx.db.one<Row>(
    `select a.*, s.questions, s.version from vendor_assessments a join vendor_question_sets s on s.id = a.question_set_id
     where a.vendor_id = $1 and a.deleted_at is null and a.status = 'completed'
     order by a.assessed_on desc, a.completed_at desc limit 1`, [vendorId],
  );
  const draft = await ctx.db.one<Row>(
    `select id from vendor_assessments where vendor_id = $1 and deleted_at is null and status = 'draft' limit 1`, [vendorId],
  );
  if (!row) return { id: null, score: null, assessed_on: null, gaps: 0, draft_id: draft?.id ?? null };
  return {
    id: row.id, score: row.score === null ? null : Number(row.score), assessed_on: row.assessed_on,
    gaps: gapsOf(row.questions as Question[], row.answers as Answers).length, draft_id: draft?.id ?? null,
  };
}

export function registerAssessments(ctx: ModuleContext) {
  const { db } = ctx;
  // Vendors answering through a link (E06-21) and one expiry date for evidence (E06-20).
  registerResponseLinks(ctx);
  registerEvidenceExpiry(ctx);

  const setView = (s: Row) => ({
    id: s.id, version: s.version, title: s.title, active: s.active, created_at: s.created_at, questions: s.questions as Question[],
  });

  function view(a: Row, full: boolean) {
    const questions = a.questions as Question[];
    const answers = (a.answers ?? {}) as Answers;
    const base = {
      id: a.id, vendor_id: a.vendor_id, status: a.status, assessed_on: a.assessed_on,
      score: a.status === 'completed' ? (a.score === null ? null : Number(a.score)) : scoreAnswers(questions, answers),
      version: a.version, set_title: a.set_title, answered: answered(questions, answers), total: questions.length,
      gaps: gapsOf(questions, answers).length, notes: a.notes, evidence_item_id: a.evidence_item_id,
      created_at: a.created_at, completed_at: a.completed_at, completed_by_name: a.completed_by_name ?? null,
    };
    if (!full) return base;
    return { ...base, questions, answers, gap_list: gapsOf(questions, answers) };
  }

  const SELECT = `select a.*, s.questions, s.version, s.title as set_title, u.display_name as completed_by_name
     from vendor_assessments a
     join vendor_question_sets s on s.id = a.question_set_id
     left join users u on u.id = a.completed_by`;

  async function needVendor(id: unknown, req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('vendor', String(id), req.user)) ?? ctx.fail(404, 'not_found', 'Vendor not found.');
  }

  async function needAssessment(req: FastifyRequest): Promise<{ a: Row; vendor: Row }> {
    const id = String((req.params as Row).aid);
    const a = UUID.test(id) ? await db.one<Row>(`${SELECT} where a.id = $1 and a.deleted_at is null`, [id]) : undefined;
    if (!a) ctx.fail(404, 'not_found', 'Assessment not found.');
    return { a: a!, vendor: await needVendor(a!.vendor_id, req) };
  }

  // ---------- question sets ----------

  ctx.app.get('/api/vendors/question-sets', { preHandler: ctx.requirePerm('vendors.view') }, async () => {
    const rows = await db.query<Row>('select * from vendor_question_sets order by version desc');
    const active = rows.find((r) => r.active);
    return {
      active: active ? setView(active) : null,
      versions: rows.map((r) => ({
        id: r.id, version: r.version, title: r.title, active: r.active, created_at: r.created_at,
        questions: (r.questions as Question[]).length,
      })),
    };
  });

  ctx.app.post('/api/vendors/question-sets', { preHandler: ctx.requirePerm('vendors.administer') }, async (req, reply) => {
    const body = (req.body ?? {}) as Row;
    const parsed = parseQuestions(body.questions);
    if ('error' in parsed) ctx.fail(400, 'validation', parsed.error, { questions: parsed.error });
    const title = clean(body.title, 120) ?? 'Vendor security assessment';
    const row = await db.tx(async (tx) => {
      const next = (await tx.one<{ v: number }>('select coalesce(max(version), 0)::int + 1 as v from vendor_question_sets'))!.v;
      await tx.query('update vendor_question_sets set active = false where active');
      return (await tx.one<Row>(
        'insert into vendor_question_sets (version, title, questions, created_by) values ($1,$2,$3::jsonb,$4) returning *',
        [next, title, JSON.stringify((parsed as { questions: Question[] }).questions), req.user!.id],
      ))!;
    });
    await ctx.audit(req, {
      action: 'vendor.question_set', recordType: 'vendor_question_set', recordId: row.id,
      summary: `Vendor assessment questions saved as version ${row.version} (${(row.questions as Question[]).length} questions)`,
      after: { version: row.version, title: row.title, questions: row.questions },
    });
    reply.code(201);
    return setView(row);
  });

  // ---------- assessments ----------

  ctx.app.get('/api/vendors/:id/assessments', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
    const vendor = await needVendor((req.params as Row).id, req);
    const rows = await db.query<Row>(
      `${SELECT} where a.vendor_id = $1 and a.deleted_at is null
       order by (a.status = 'draft') desc, a.assessed_on desc nulls last, a.created_at desc`, [vendor.id],
    );
    return { rows: rows.map((a) => view(a, false)), can_raise_actions: !!ctx.resources.get('action') && ctx.can(req.user, 'actions.create') };
  });

  ctx.app.post('/api/vendors/:id/assessments', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const vendor = await needVendor((req.params as Row).id, req);
    const draft = await db.one<Row>(
      `${SELECT} where a.vendor_id = $1 and a.deleted_at is null and a.status = 'draft' limit 1`, [vendor.id],
    );
    if (draft) return view(draft, true); // one draft at a time: carry on with it
    const set = (await activeQuestionSet(ctx)) ?? ctx.fail(409, 'no_questions', 'No assessment questions are set up.');
    const made = (await db.one<Row>(
      'insert into vendor_assessments (vendor_id, question_set_id, created_by, updated_by) values ($1,$2,$3,$3) returning id',
      [vendor.id, set.id, req.user!.id],
    ))!;
    await ctx.audit(req, {
      action: 'vendor.assessment_start', recordType: 'vendor', recordId: vendor.id,
      summary: `Assessment started for ${vendor.name} (questions version ${set.version})`,
      after: { assessment_id: made.id, version: set.version },
    });
    reply.code(201);
    return view((await db.one<Row>(`${SELECT} where a.id = $1`, [made.id]))!, true);
  });

  ctx.app.get('/api/vendor-assessments/:aid', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
    const { a } = await needAssessment(req);
    return view(a, true);
  });

  ctx.app.patch('/api/vendor-assessments/:aid', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
    const { a, vendor } = await needAssessment(req);
    if (a.status !== 'draft') ctx.fail(409, 'completed', 'A completed assessment cannot be changed. Start a new one instead.');
    const body = (req.body ?? {}) as Row;
    const questions = a.questions as Question[];
    const answers: Answers = { ...(a.answers as Answers) };
    const changed: Row = {};
    if (body.answers !== undefined) {
      if (typeof body.answers !== 'object' || body.answers === null || Array.isArray(body.answers)) {
        ctx.fail(400, 'validation', 'Answers must be given by question.', { answers: 'Answers must be given by question.' });
      }
      for (const [key, raw] of Object.entries(body.answers as Row)) {
        if (!questions.some((q) => q.key === key)) ctx.fail(400, 'validation', `Unknown question "${key}".`, { answers: `Unknown question "${key}".` });
        const entry = (raw ?? {}) as Row;
        const next: AnswerEntry = { ...answers[key] };
        if (entry.answer !== undefined) {
          if (entry.answer !== null && !ANSWERS.includes(entry.answer)) {
            ctx.fail(400, 'validation', 'An answer must be yes, partly, no or not applicable.', { answers: 'An answer must be yes, partly, no or not applicable.' });
          }
          next.answer = entry.answer;
        }
        if (entry.note !== undefined) next.note = clean(entry.note, 1000);
        if (JSON.stringify(next) !== JSON.stringify(answers[key] ?? {})) changed[key] = { answer: next.answer ?? null, note: next.note ?? null };
        answers[key] = next;
      }
    }
    const notes = body.notes !== undefined ? clean(body.notes, 4000) : a.notes;
    if (Object.keys(changed).length || notes !== a.notes) {
      // Only the questions in this request are written (merged in the database), so two
      // answers saved at almost the same moment cannot overwrite each other.
      const merge: Answers = {};
      for (const key of Object.keys(changed)) merge[key] = answers[key];
      await db.query(
        `update vendor_assessments set answers = answers || $2::jsonb, notes = $3, updated_at = now(), updated_by = $4
         where id = $1 and status = 'draft'`,
        [a.id, JSON.stringify(merge), notes, req.user!.id],
      );
      await ctx.audit(req, {
        action: 'vendor.assessment_answer', recordType: 'vendor', recordId: vendor.id,
        summary: `Assessment answers saved for ${vendor.name}`,
        after: { assessment_id: a.id, answers: changed, ...(notes !== a.notes ? { notes } : {}) },
      });
    }
    return view((await db.one<Row>(`${SELECT} where a.id = $1`, [a.id]))!, true);
  });

  ctx.app.post('/api/vendor-assessments/:aid/complete', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
    const { a, vendor } = await needAssessment(req);
    if (a.status !== 'draft') ctx.fail(409, 'completed', 'This assessment is already completed.');
    const body = (req.body ?? {}) as Row;
    const questions = a.questions as Question[];
    const answers = a.answers as Answers;
    const missing = questions.length - answered(questions, answers);
    if (missing) {
      ctx.fail(400, 'incomplete', `${missing} question${missing === 1 ? ' has' : 's have'} no answer yet. Answer every question, or choose "Not applicable".`);
    }
    const today = localDate();
    const assessedOn = body.assessed_on === undefined || body.assessed_on === null || body.assessed_on === '' ? today : String(body.assessed_on);
    const fields: Record<string, string> = {};
    if (!DATE.test(assessedOn) || assessedOn > today) fields.assessed_on = 'The assessment date cannot be in the future.';
    const expires = body.evidence_expires_on ? String(body.evidence_expires_on) : null;
    if (expires && (!DATE.test(expires) || expires < assessedOn)) fields.evidence_expires_on = 'Expiry cannot be before the assessment date.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    const score = scoreAnswers(questions, answers);
    const gaps = gapsOf(questions, answers);
    let evidenceId: string | null = null;
    if (body.save_evidence === true) {
      if (!ctx.can(req.user, 'vendors.create')) ctx.fail(403, 'forbidden', 'You do not have permission to add evidence.');
      const evidence = await ctx.resources.create('evidence_item', {
        title: `Security assessment, ${displayDate(assessedOn)}`, vendor_id: vendor.id, type: 'questionnaire',
        received_on: assessedOn, expires_on: expires,
        note: `Completed internally with questions version ${a.version}. Score ${score ?? 'not scored'}${score === null ? '' : ' out of 100'}; `
          + `${gaps.length} gap${gaps.length === 1 ? '' : 's'}.`,
      }, req);
      evidenceId = evidence.id;
    }
    await db.query(
      `update vendor_assessments set status = 'completed', assessed_on = $2, score = $3, evidence_item_id = $4,
         completed_at = now(), completed_by = $5, updated_at = now(), updated_by = $5 where id = $1`,
      [a.id, assessedOn, score, evidenceId, req.user!.id],
    );
    await ctx.audit(req, {
      action: 'vendor.assessment_complete', recordType: 'vendor', recordId: vendor.id,
      summary: `Assessment completed for ${vendor.name}: score ${score ?? 'not scored'}${score === null ? '' : ' out of 100'}, ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`,
      after: { assessment_id: a.id, assessed_on: assessedOn, score, gaps: gaps.map((g) => g.key), evidence_item_id: evidenceId },
    });
    return view((await db.one<Row>(`${SELECT} where a.id = $1`, [a.id]))!, true);
  });

  ctx.app.delete('/api/vendor-assessments/:aid', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
    const { a, vendor } = await needAssessment(req);
    if (a.status !== 'draft') ctx.fail(409, 'completed', 'A completed assessment is kept as history and cannot be removed.');
    await db.query('update vendor_assessments set deleted_at = now(), updated_by = $2 where id = $1', [a.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'vendor.assessment_discard', recordType: 'vendor', recordId: vendor.id,
      summary: `Draft assessment discarded for ${vendor.name}`, before: { assessment_id: a.id },
    });
    return { ok: true };
  });

  ctx.app.post('/api/vendor-assessments/:aid/gaps/:key/action', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const { a, vendor } = await needAssessment(req);
    if (!ctx.resources.get('action')) ctx.fail(409, 'no_actions', 'The action tracker is not switched on.');
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You do not have permission to add actions.');
    if (a.status !== 'completed') ctx.fail(409, 'draft', 'Complete the assessment before raising actions.');
    const key = String((req.params as Row).key);
    const answers = { ...(a.answers as Answers) };
    const gap = gapsOf(a.questions as Question[], answers).find((g) => g.key === key);
    if (!gap) ctx.fail(404, 'not_found', 'That question is not a gap on this assessment.');
    if (gap!.action_id) ctx.fail(409, 'exists', 'An action has already been raised for this gap.');
    const body = (req.body ?? {}) as Row;
    const action = await ctx.resources.create('action', {
      title: `${vendor.name}: ${gap!.text}`.slice(0, 200),
      description: `Gap found in the vendor assessment of ${a.assessed_on}. Answer: ${gap!.answer === 'no' ? 'No' : 'Partly'}.`
        + `${gap!.note ? `\n${gap!.note}` : ''}`,
      priority: gap!.weight >= 3 ? 'high' : gap!.weight === 2 ? 'medium' : 'low',
      source: 'assessment', source_type: 'vendor', source_id: vendor.id,
      ...(body.owner_id ? { owner_id: body.owner_id } : {}),
      ...(body.due_on ? { due_on: body.due_on } : {}),
    }, req);
    answers[key] = { ...answers[key], action_id: action.id };
    await db.query('update vendor_assessments set answers = $2::jsonb, updated_at = now(), updated_by = $3 where id = $1',
      [a.id, JSON.stringify(answers), req.user!.id]);
    await ctx.audit(req, {
      action: 'vendor.assessment_action', recordType: 'vendor', recordId: vendor.id,
      summary: `Action ${action.ref ?? ''} raised for an assessment gap at ${vendor.name}`.replace(/\s+/g, ' '),
      after: { assessment_id: a.id, question: key, action_id: action.id },
    });
    reply.code(201);
    return { id: action.id, ref: action.ref ?? null, title: action.title };
  });
}
