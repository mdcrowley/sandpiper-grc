// Vendors answer the assessment themselves (E06-21). Staff create a link for a draft assessment;
// the vendor opens it without an account, answers and submits; staff review the answers, take
// over the ones they accept (and may change any of them), then complete the assessment as usual.
//
// Off by default (setting `vendors.response_links_enabled`). A link expires (default 14 days, at
// most 90), can be revoked, stops working once the assessment is completed, and only a hash of
// its secret is stored. The public routes are rate limited per address and answer the same
// "not valid" for an unknown, expired or revoked link, and when the feature is off.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { clientIp } from '../../core/request.ts';
import { ANSWERS, type AnswerEntry, type Answers, type Question } from './assessments.ts';

export const ENABLED_SETTING = 'vendors.response_links_enabled';
export const DAYS_SETTING = 'vendors.response_link_days';
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const clean = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};

type LinkState = 'active' | 'submitted' | 'expired' | 'revoked' | 'closed';
function stateOf(l: Row): LinkState {
  if (l.revoked_at) return 'revoked';
  if (l.assessment_status && l.assessment_status !== 'draft') return 'closed';
  if (l.submitted_at) return 'submitted';
  if (new Date(l.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export function registerResponseLinks(ctx: ModuleContext) {
  const { db, app } = ctx;
  const viewPerm = { preHandler: ctx.requirePerm('vendors.view') };
  const editPerm = { preHandler: ctx.requirePerm('vendors.edit') };
  // Every request to a public route counts (60 a minute per address); a wrong link counts again
  // in a stricter bucket (20 in 15 minutes per address), which then refuses everything.
  const perMinute = makeDbLimiter(db, 'vendor_response', 60, 60_000);
  const wrong = makeDbLimiter(db, 'vendor_response_bad', 20, 15 * 60_000);

  async function settings() {
    const enabled = (await ctx.settings.get<boolean>(ENABLED_SETTING, false)) === true;
    const days = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(await ctx.settings.get<number>(DAYS_SETTING, DEFAULT_DAYS)) || DEFAULT_DAYS)));
    return { enabled, default_days: days, max_days: MAX_DAYS };
  }

  async function needDraft(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).aid ?? '');
    const a = UUID.test(id)
      ? await db.one<Row>(
        `select a.id, a.status, a.vendor_id, a.answers, s.questions from vendor_assessments a
         join vendor_question_sets s on s.id = a.question_set_id where a.id = $1 and a.deleted_at is null`, [id])
      : undefined;
    if (!a) ctx.fail(404, 'not_found', 'Assessment not found.');
    const vendor = await ctx.resources.find('vendor', a!.vendor_id, req.user);
    if (!vendor) ctx.fail(404, 'not_found', 'Assessment not found.');
    return { ...a!, vendor };
  }

  const linkView = (l: Row) => {
    const answers = (l.answers ?? {}) as Answers;
    return {
      id: l.id, recipient: l.recipient, expires_at: l.expires_at, created_at: l.created_at, created_by_name: l.created_by_name ?? null,
      opened_at: l.opened_at, saved_at: l.saved_at, submitted_at: l.submitted_at, revoked_at: l.revoked_at,
      responder_name: l.responder_name, state: stateOf(l), answered: Object.values(answers).filter((x) => x?.answer).length, answers,
    };
  };

  // ---------- settings ----------

  app.get('/api/vendors/response-links/settings', viewPerm, async (req) => ({ ...(await settings()), can_administer: ctx.can(req.user, 'vendors.administer') }));
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/response-links/settings', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Whether vendors may answer assessments through a link, and how long a link lasts',
  });
  app.put('/api/vendors/response-links/settings', { preHandler: ctx.requirePerm('vendors.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const now = await settings();
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') ctx.fail(400, 'validation', 'Check the highlighted fields.', { enabled: 'Send true or false.' });
    if (b.default_days !== undefined) {
      const n = Number(b.default_days);
      if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) ctx.fail(400, 'validation', 'Check the highlighted fields.', { default_days: `Enter a whole number of days from 1 to ${MAX_DAYS}.` });
      if (n !== now.default_days) await ctx.settings.set(DAYS_SETTING, n, req);
    }
    if (b.enabled !== undefined && b.enabled !== now.enabled) {
      await ctx.settings.set(ENABLED_SETTING, b.enabled, req);
      // Switching the feature off stops every link at once.
      if (!b.enabled) {
        await db.query('update vendor_assessment_links set revoked_at = now(), revoked_by = $1 where revoked_at is null and submitted_at is null and expires_at > now()', [req.user!.id]);
      }
    }
    return { ...(await settings()), can_administer: true };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/vendors/response-links/settings', tag: 'Vendors', permission: 'vendors.administer',
    summary: 'Switch vendor response links on or off (off revokes open links) and set how many days a new link lasts',
    body: { type: 'object', properties: { enabled: { type: 'boolean' }, default_days: { type: 'integer', minimum: 1, maximum: MAX_DAYS } } },
  });

  // ---------- staff: links of one assessment ----------

  app.get('/api/vendor-assessments/:aid/links', viewPerm, async (req) => {
    const a = await needDraft(req);
    const rows = await db.query<Row>(
      `select l.*, u.display_name as created_by_name, $2::text as assessment_status from vendor_assessment_links l
       left join users u on u.id = l.created_by where l.assessment_id = $1 order by l.created_at desc`, [a.id, a.status]);
    return { ...(await settings()), rows: rows.map(linkView) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendor-assessments/:aid/links', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Response links of an assessment, with the answers the vendor gave (never the secret)',
  });

  app.post('/api/vendor-assessments/:aid/links', editPerm, async (req, reply) => {
    const s = await settings();
    if (!s.enabled) ctx.fail(409, 'disabled', 'Vendor response links are switched off. An administrator can switch them on under Assessment questions.');
    const a = await needDraft(req);
    if (a.status !== 'draft') ctx.fail(409, 'completed', 'This assessment is completed. Start a new one to ask the vendor again.');
    const b = (req.body ?? {}) as Row;
    const days = b.days === undefined || b.days === null || b.days === '' ? s.default_days : Number(b.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) ctx.fail(400, 'validation', 'Check the highlighted fields.', { days: `Enter a whole number of days from 1 to ${MAX_DAYS}.` });
    const recipient = clean(b.recipient, 200);
    const token = randomBytes(32).toString('base64url');
    // One working link at a time: a new one replaces any earlier link still open.
    const replaced = await db.query<Row>(
      `update vendor_assessment_links set revoked_at = now(), revoked_by = $2
       where assessment_id = $1 and revoked_at is null and submitted_at is null and expires_at > now() returning id`, [a.id, req.user!.id]);
    const row = (await db.one<Row>(
      `insert into vendor_assessment_links (assessment_id, token_hash, recipient, expires_at, created_by)
       values ($1, $2, $3, now() + make_interval(days => $4::int), $5) returning *`, [a.id, hash(token), recipient, days, req.user!.id]))!;
    await ctx.audit(req, {
      action: 'vendor.response_link_create', recordType: 'vendor', recordId: a.vendor_id,
      summary: `Response link created for the assessment of ${a.vendor.name}${recipient ? ` (for ${recipient})` : ''}, valid ${days} day${days === 1 ? '' : 's'}${replaced.length ? '; the earlier link no longer works' : ''}`,
      after: { assessment_id: a.id, link_id: row.id, recipient, expires_at: row.expires_at },
    });
    reply.code(201);
    // The secret is returned this once and never stored.
    return { ...linkView({ ...row, assessment_status: 'draft', created_by_name: req.user!.displayName }), token, path: `/vendor-response/${token}` };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-assessments/:aid/links', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Create a response link for a draft assessment (replaces an open one); the secret is in this answer only',
    body: { type: 'object', properties: { recipient: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: MAX_DAYS } } },
  });

  app.delete('/api/vendor-assessments/:aid/links/:lid', editPerm, async (req) => {
    const a = await needDraft(req);
    const lid = String((req.params as Row).lid ?? '');
    const row = UUID.test(lid)
      ? await db.one<Row>('update vendor_assessment_links set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, $3) where id = $1 and assessment_id = $2 returning *', [lid, a.id, req.user!.id])
      : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Link not found.');
    await ctx.audit(req, {
      action: 'vendor.response_link_revoke', recordType: 'vendor', recordId: a.vendor_id,
      summary: `Response link for the assessment of ${a.vendor.name} revoked`, before: { assessment_id: a.id, link_id: lid },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/vendor-assessments/:aid/links/:lid', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Revoke a response link; the answers already given stay for review',
  });

  // Take over the vendor's answers (all, or the questions named in `keys`) into the draft.
  app.post('/api/vendor-assessments/:aid/links/:lid/accept', editPerm, async (req) => {
    const a = await needDraft(req);
    if (a.status !== 'draft') ctx.fail(409, 'completed', 'A completed assessment cannot be changed.');
    const lid = String((req.params as Row).lid ?? '');
    const link = UUID.test(lid) ? await db.one<Row>('select * from vendor_assessment_links where id = $1 and assessment_id = $2', [lid, a.id]) : undefined;
    if (!link) ctx.fail(404, 'not_found', 'Link not found.');
    const given = (link!.answers ?? {}) as Answers;
    const b = (req.body ?? {}) as Row;
    const keys = Array.isArray(b.keys) ? (b.keys as unknown[]).map(String) : Object.keys(given);
    const questions = a.questions as Question[];
    const merge: Answers = {};
    for (const key of keys) {
      if (!questions.some((q) => q.key === key) || !given[key]?.answer) continue;
      const current = ((a.answers ?? {}) as Answers)[key] ?? {};
      merge[key] = { ...current, answer: given[key].answer, note: given[key].note ?? current.note ?? null };
    }
    if (!Object.keys(merge).length) ctx.fail(400, 'validation', 'The vendor has not answered those questions.');
    await db.query(
      `update vendor_assessments set answers = answers || $2::jsonb, updated_at = now(), updated_by = $3 where id = $1 and status = 'draft'`,
      [a.id, JSON.stringify(merge), req.user!.id]);
    await ctx.audit(req, {
      action: 'vendor.assessment_answer', recordType: 'vendor', recordId: a.vendor_id,
      summary: `${Object.keys(merge).length} answer${Object.keys(merge).length === 1 ? '' : 's'} taken over from the vendor's response for ${a.vendor.name}`,
      after: { assessment_id: a.id, link_id: lid, answers: merge },
    });
    return { accepted: Object.keys(merge) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-assessments/:aid/links/:lid/accept', tag: 'Vendors', permission: 'vendors.edit',
    summary: "Take over the vendor's answers into the draft assessment (all, or `keys`); staff may still change them",
    body: { type: 'object', properties: { keys: { type: 'array', items: { type: 'string' } } } },
  });

  // ---------- public: the vendor's side ----------

  const NOT_VALID = 'This link is not valid. It may have expired or been withdrawn; ask your contact for a new one.';

  async function openLink(req: FastifyRequest): Promise<Row> {
    const ip = clientIp(req);
    if (await wrong.blocked(ip) || await perMinute.blocked(ip)) ctx.fail(429, 'rate_limited', 'Too many requests. Wait a few minutes and try again.');
    await perMinute.hit(ip);
    const token = String((req.params as Row).token ?? '');
    const link = (await settings()).enabled && TOKEN.test(token)
      ? await db.one<Row>(
        `select l.*, a.status as assessment_status, a.vendor_id, a.deleted_at as assessment_deleted, s.questions, s.title as set_title
         from vendor_assessment_links l join vendor_assessments a on a.id = l.assessment_id
         join vendor_question_sets s on s.id = a.question_set_id where l.token_hash = $1`, [hash(token)])
      : undefined;
    const state = link && !link.assessment_deleted ? stateOf(link) : null;
    if (!link || !state || state === 'revoked' || state === 'expired' || state === 'closed') {
      await wrong.hit(ip);
      ctx.fail(404, 'not_found', NOT_VALID);
    }
    return link!;
  }

  async function publicView(l: Row) {
    const vendor = await db.one<Row>('select name from vendors where id = $1', [l.vendor_id]);
    return {
      organization: await ctx.settings.get<string>('app.name', 'Sandpiper GRC'),
      vendor_name: vendor?.name ?? '',
      title: l.set_title,
      expires_at: l.expires_at,
      submitted_at: l.submitted_at,
      responder_name: l.responder_name,
      // Text the vendor needs; weights and staff answers stay inside.
      questions: (l.questions as Question[]).map((q) => ({ key: q.key, section: q.section, text: q.text, guidance: q.guidance })),
      answers: l.answers ?? {},
    };
  }

  app.get('/api/vendor-response/:token', { config: { public: true } }, async (req) => {
    const link = await openLink(req);
    if (!link.opened_at) {
      await db.query('update vendor_assessment_links set opened_at = now() where id = $1', [link.id]);
      await ctx.audit(req, {
        action: 'vendor.response_link_open', recordType: 'vendor', recordId: link.vendor_id,
        summary: 'Vendor opened the assessment response link', after: { link_id: link.id },
      });
    }
    return publicView(link);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendor-response/:token', tag: 'Vendors', public: true,
    summary: 'The questions behind a vendor response link, and the answers saved so far (no account; rate limited)',
  });

  app.put('/api/vendor-response/:token', { config: { public: true } }, async (req) => {
    const link = await openLink(req);
    if (link.submitted_at) ctx.fail(409, 'submitted', 'These answers have been sent. Ask your contact if something needs to change.');
    const b = (req.body ?? {}) as Row;
    const questions = link.questions as Question[];
    const answers: Answers = { ...((link.answers ?? {}) as Answers) };
    if (b.answers !== undefined) {
      if (!b.answers || typeof b.answers !== 'object' || Array.isArray(b.answers)) ctx.fail(400, 'validation', 'Answers must be given by question.');
      for (const [key, raw] of Object.entries(b.answers as Row)) {
        if (!questions.some((q) => q.key === key)) ctx.fail(400, 'validation', `Unknown question "${key}".`);
        const e = (raw ?? {}) as Row;
        const next: AnswerEntry = { ...answers[key] };
        if (e.answer !== undefined) {
          if (e.answer !== null && !ANSWERS.includes(e.answer)) ctx.fail(400, 'validation', 'An answer must be yes, partly, no or not applicable.');
          next.answer = e.answer;
        }
        if (e.note !== undefined) next.note = clean(e.note, 1000);
        answers[key] = { answer: next.answer ?? null, note: next.note ?? null };
      }
    }
    const name = b.responder_name !== undefined ? clean(b.responder_name, 120) : link.responder_name;
    const submit = b.submit === true;
    if (submit) {
      const missing = questions.filter((q) => !answers[q.key]?.answer).length;
      if (missing) ctx.fail(400, 'incomplete', `${missing} question${missing === 1 ? ' has' : 's have'} no answer yet. Answer every question, or choose "Not applicable".`);
      if (!name) ctx.fail(400, 'validation', 'Check the highlighted fields.', { responder_name: 'Give your name, so we know who answered.' });
    }
    // Checked again in the update itself: the link may have been sent, withdrawn or expired since it was read.
    const saved = await db.one<Row>(
      `update vendor_assessment_links set answers = $2::jsonb, responder_name = $3, saved_at = now(),
         submitted_at = case when $4 then now() else submitted_at end
       where id = $1 and submitted_at is null and revoked_at is null and expires_at > now() returning *`,
      [link.id, JSON.stringify(answers), name, submit]);
    if (!saved) ctx.fail(409, 'submitted', 'These answers can no longer be changed. Ask your contact if something needs to change.');
    if (submit) {
      await ctx.audit(req, {
        action: 'vendor.response_submit', recordType: 'vendor', recordId: link.vendor_id,
        summary: `Vendor sent answers to the assessment through the response link (${name})`,
        after: { link_id: link.id, assessment_id: link.assessment_id, answered: Object.keys(answers).length },
      });
      if (ctx.app.hasDecorator('notify') && link.created_by) {
        const vendor = await db.one<Row>('select name from vendors where id = $1', [link.vendor_id]);
        await ctx.app.notify({
          userIds: [link.created_by], kind: 'general', title: `${vendor?.name ?? 'A vendor'} sent its assessment answers`,
          body: 'Review the answers on the vendor\'s Assessment tab, take over the ones you accept, then complete the assessment.',
          recordType: 'vendor', recordId: link.vendor_id,
        }).catch(() => undefined);
      }
    }
    return publicView({ ...link, ...saved! });
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/vendor-response/:token', tag: 'Vendors', public: true,
    summary: 'Save answers through a vendor response link; `submit: true` sends them (every question answered and a name given)',
    body: {
      type: 'object',
      properties: {
        answers: { type: 'object', additionalProperties: { type: 'object', properties: { answer: { type: 'string', enum: ['yes', 'partial', 'no', 'na'] }, note: { type: 'string' } } } },
        responder_name: { type: 'string' },
        submit: { type: 'boolean' },
      },
    },
  });
}
