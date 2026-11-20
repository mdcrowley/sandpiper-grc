// Vendors answer the assessment themselves (E06-21). Staff create a link for a draft assessment;
// the vendor opens it without an account, answers and submits; staff review the answers, take
// over the ones they accept (and may change any of them), then complete the assessment as usual.
//
// Off by default (setting `vendors.response_links_enabled`). A link expires (default 14 days, at
// most 90), can be revoked, stops working once the assessment is completed, and only a hash of
// its secret is stored. The public routes are rate limited per address and answer the same
// "not valid" for an unknown, expired or revoked link, and when the feature is off.
//
// The vendor can also send files through the link (E06-22, responseFiles.ts), and the
// application can email the link (E06-23, responseEmail.ts).
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { organizationName, readOrganization } from '../../core/organization.ts';
import { clientIp } from '../../core/request.ts';
import { ANSWERS, type AnswerEntry, type Answers, type Question } from './assessments.ts';
import { registerResponseEmail } from './responseEmail.ts';
import { heldFiles, publicFile, registerResponseFiles, staffFile, uploadLimits } from './responseFiles.ts';

export const ENABLED_SETTING = 'vendors.response_links_enabled';
export const DAYS_SETTING = 'vendors.response_link_days';
export const MAX_FILES_SETTING = 'vendors.response_link_max_files';
export const MAX_MB_SETTING = 'vendors.response_link_max_mb';
export const FILE_TYPES_SETTING = 'vendors.response_link_file_types';
export const REMINDER_SETTING = 'vendors.response_link_reminder_days';
/** Days after a link closes that files still waiting on it are discarded (E06-24); 0 = never. */
export const DISCARD_SETTING = 'vendors.response_link_discard_days';
const DEFAULT_DISCARD_DAYS = 30;
const MAX_DISCARD_DAYS = 365;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
/** Files a vendor may send through one link, and their total size. */
const DEFAULT_MAX_FILES = 10;
const MAX_MAX_FILES = 50;
const DEFAULT_MAX_MB = 50;
const MAX_MAX_MB = 500;
/** Documents and pictures only. The attachments module's allowed types narrow this further, never widen it. */
export const DEFAULT_FILE_TYPES = ['csv', 'doc', 'docx', 'jpeg', 'jpg', 'pdf', 'png', 'pptx', 'txt', 'xls', 'xlsx'];
const EXTENSION = /^[a-z0-9]{1,10}$/;
/** Days before an emailed link expires that its recipient is reminded (0 = never). */
const DEFAULT_REMINDER_DAYS = 2;
const MB = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const clean = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};
const intIn = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

type LinkState = 'active' | 'submitted' | 'expired' | 'revoked' | 'closed';
export function stateOf(l: Row): LinkState {
  if (l.revoked_at) return 'revoked';
  if (l.assessment_status && l.assessment_status !== 'draft') return 'closed';
  if (l.submitted_at) return 'submitted';
  if (new Date(l.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export interface LinkSettings {
  enabled: boolean; default_days: number; max_days: number;
  max_files: number; max_mb: number; max_bytes: number; file_types: string[]; reminder_days: number; discard_days: number;
  /** Whether files can be received at all (the attachments module is loaded). */
  files_available: boolean;
  /** Whether the application can email the link (email is switched on). */
  email_available: boolean;
}

/** What the files and email parts share with the links themselves. */
export interface LinkKit {
  settings(): Promise<LinkSettings>;
  /** Public routes: rate limits, then the link behind the token, or the same "not valid" refusal. */
  openLink(req: FastifyRequest): Promise<Row>;
  /** Staff routes: the assessment in `:aid` with its vendor, if the caller may see that vendor. */
  needDraft(req: FastifyRequest): Promise<Row>;
  /** A new link for a draft assessment, replacing any open one. The secret is in the answer only. */
  createLink(req: FastifyRequest, a: Row, input: { recipient: unknown; days: unknown }, note?: string): Promise<{ row: Row; token: string; days: number }>;
  linkView(l: Row, files?: Row[]): Row;
}

export async function registerResponseLinks(ctx: ModuleContext) {
  const { db, app } = ctx;
  const viewPerm = { preHandler: ctx.requirePerm('vendors.view') };
  const editPerm = { preHandler: ctx.requirePerm('vendors.edit') };
  // Every request to a public route counts (60 a minute per address); a wrong link counts again
  // in a stricter bucket (20 in 15 minutes per address), which then refuses everything.
  const perMinute = makeDbLimiter(db, 'vendor_response', 60, 60_000);
  const wrong = makeDbLimiter(db, 'vendor_response_bad', 20, 15 * 60_000);

  async function settings(): Promise<LinkSettings> {
    const enabled = (await ctx.settings.get<boolean>(ENABLED_SETTING, false)) === true;
    const days = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(await ctx.settings.get<number>(DAYS_SETTING, DEFAULT_DAYS)) || DEFAULT_DAYS)));
    const maxFiles = intIn(await ctx.settings.get<number>(MAX_FILES_SETTING, DEFAULT_MAX_FILES), DEFAULT_MAX_FILES, 0, MAX_MAX_FILES);
    const maxMb = intIn(await ctx.settings.get<number>(MAX_MB_SETTING, DEFAULT_MAX_MB), DEFAULT_MAX_MB, 1, MAX_MAX_MB);
    const rawTypes = await ctx.settings.get<unknown>(FILE_TYPES_SETTING, DEFAULT_FILE_TYPES);
    const fileTypes = (Array.isArray(rawTypes) ? rawTypes : DEFAULT_FILE_TYPES).map((x) => String(x).toLowerCase()).filter((x) => EXTENSION.test(x));
    const reminder = intIn(await ctx.settings.get<number>(REMINDER_SETTING, DEFAULT_REMINDER_DAYS), DEFAULT_REMINDER_DAYS, 0, 30);
    const discard = intIn(await ctx.settings.get<number>(DISCARD_SETTING, DEFAULT_DISCARD_DAYS), DEFAULT_DISCARD_DAYS, 0, MAX_DISCARD_DAYS);
    return {
      enabled, default_days: days, max_days: MAX_DAYS, max_files: maxFiles, max_mb: maxMb, max_bytes: maxMb * MB,
      file_types: [...new Set(fileTypes)].sort(), reminder_days: reminder, discard_days: discard,
      files_available: app.hasDecorator('attachmentStores') && app.hasDecorator('fileScanner'),
      email_available: app.hasDecorator('mailEnabled') ? await app.mailEnabled() : false,
    };
  }

  async function needDraft(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).aid ?? '');
    const a = UUID.test(id)
      ? await db.one<Row>(
        `select a.id, a.status, a.vendor_id, a.answers, s.questions, s.title as set_title from vendor_assessments a
         join vendor_question_sets s on s.id = a.question_set_id where a.id = $1 and a.deleted_at is null`, [id])
      : undefined;
    if (!a) ctx.fail(404, 'not_found', 'Assessment not found.');
    const vendor = await ctx.resources.find('vendor', a!.vendor_id, req.user);
    if (!vendor) ctx.fail(404, 'not_found', 'Assessment not found.');
    return { ...a!, vendor };
  }

  const linkView = (l: Row, files: Row[] = []) => {
    const answers = (l.answers ?? {}) as Answers;
    return {
      id: l.id, recipient: l.recipient, expires_at: l.expires_at, created_at: l.created_at, created_by_name: l.created_by_name ?? null,
      opened_at: l.opened_at, saved_at: l.saved_at, submitted_at: l.submitted_at, revoked_at: l.revoked_at,
      responder_name: l.responder_name, state: stateOf(l), answered: Object.values(answers).filter((x) => x?.answer).length, answers,
      emailed_to: l.emailed_to ?? null, emailed_at: l.emailed_at ?? null, reminded_at: l.reminded_at ?? null,
      files: files.map(staffFile),
    };
  };

  async function createLink(req: FastifyRequest, a: Row, input: { recipient: unknown; days: unknown }, note = '') {
    const s = await settings();
    const days = input.days === undefined || input.days === null || input.days === '' ? s.default_days : Number(input.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) ctx.fail(400, 'validation', 'Check the highlighted fields.', { days: `Enter a whole number of days from 1 to ${MAX_DAYS}.` });
    const recipient = clean(input.recipient, 200);
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
      summary: `Response link created for the assessment of ${a.vendor.name}${recipient ? ` (for ${recipient})` : ''}, valid ${days} day${days === 1 ? '' : 's'}${replaced.length ? '; the earlier link no longer works' : ''}${note}`,
      after: { assessment_id: a.id, link_id: row.id, recipient, expires_at: row.expires_at },
    });
    return { row, token, days };
  }

  // ---------- settings ----------

  app.get('/api/vendors/response-links/settings', viewPerm, async (req) => ({ ...(await settings()), can_administer: ctx.can(req.user, 'vendors.administer') }));
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/response-links/settings', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Whether vendors may answer assessments through a link: how long a link lasts, the files a vendor may send, and whether it can be emailed',
  });
  app.put('/api/vendors/response-links/settings', { preHandler: ctx.requirePerm('vendors.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const now = await settings();
    const fields: Record<string, string> = {};
    const whole = (key: string, min: number, max: number, message: string): number | undefined => {
      if (b[key] === undefined) return undefined;
      const n = Number(b[key]);
      if (!Number.isInteger(n) || n < min || n > max) { fields[key] = message; return undefined; }
      return n;
    };
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') fields.enabled = 'Send true or false.';
    const days = whole('default_days', 1, MAX_DAYS, `Enter a whole number of days from 1 to ${MAX_DAYS}.`);
    const maxFiles = whole('max_files', 0, MAX_MAX_FILES, `Enter a whole number of files from 0 to ${MAX_MAX_FILES} (0 = no files).`);
    const maxMb = whole('max_mb', 1, MAX_MAX_MB, `Enter a whole number of megabytes from 1 to ${MAX_MAX_MB}.`);
    const reminder = whole('reminder_days', 0, 30, 'Enter a whole number of days from 0 to 30 (0 = no reminder).');
    const discard = whole('discard_days', 0, MAX_DISCARD_DAYS, `Enter a whole number of days from 0 to ${MAX_DISCARD_DAYS} (0 = never discard).`);
    let types: string[] | undefined;
    if (b.file_types !== undefined) {
      const list = (Array.isArray(b.file_types) ? b.file_types as unknown[] : String(b.file_types).split(/[\s,;]+/))
        .map((x) => String(x ?? '').trim().toLowerCase().replace(/^\*?\./, '')).filter(Boolean);
      const bad = list.filter((x) => !EXTENSION.test(x));
      if (!list.length) fields.file_types = 'List at least one file type, or set the number of files to 0.';
      else if (bad.length) fields.file_types = `Not a file type: ${bad.join(', ')}. Use letters and numbers only, for example pdf.`;
      else types = [...new Set(list)].sort();
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    // Switching links on opens a way in for people outside the organization (E01-34).
    if (b.enabled === true && !now.enabled) await requireRecentAuth({ db: ctx.db, audit: ctx.audit, settings: ctx.settings }, req, 'switching on vendor response links');
    if (days !== undefined && days !== now.default_days) await ctx.settings.set(DAYS_SETTING, days, req);
    if (maxFiles !== undefined && maxFiles !== now.max_files) await ctx.settings.set(MAX_FILES_SETTING, maxFiles, req);
    if (maxMb !== undefined && maxMb !== now.max_mb) await ctx.settings.set(MAX_MB_SETTING, maxMb, req);
    if (reminder !== undefined && reminder !== now.reminder_days) await ctx.settings.set(REMINDER_SETTING, reminder, req);
    if (discard !== undefined && discard !== now.discard_days) await ctx.settings.set(DISCARD_SETTING, discard, req);
    if (types && types.join() !== now.file_types.join()) await ctx.settings.set(FILE_TYPES_SETTING, types, req);
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
    summary: 'Switch vendor response links on or off (off revokes open links); how long a new link lasts, the files a vendor may send, how long unreviewed files are kept after the link closes, and the reminder before an emailed link expires',
    body: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' }, default_days: { type: 'integer', minimum: 1, maximum: MAX_DAYS },
        max_files: { type: 'integer', minimum: 0, maximum: MAX_MAX_FILES }, max_mb: { type: 'integer', minimum: 1, maximum: MAX_MAX_MB },
        file_types: { type: 'array', items: { type: 'string' } }, reminder_days: { type: 'integer', minimum: 0, maximum: 30 },
        discard_days: { type: 'integer', minimum: 0, maximum: MAX_DISCARD_DAYS },
      },
    },
  });

  // ---------- staff: links of one assessment ----------

  app.get('/api/vendor-assessments/:aid/links', viewPerm, async (req) => {
    const a = await needDraft(req);
    const rows = await db.query<Row>(
      `select l.*, u.display_name as created_by_name, $2::text as assessment_status from vendor_assessment_links l
       left join users u on u.id = l.created_by where l.assessment_id = $1 order by l.created_at desc`, [a.id, a.status]);
    const files = await heldFiles(ctx, rows.map((r) => r.id));
    return { ...(await settings()), rows: rows.map((r) => linkView(r, files.filter((f) => f.record_id === r.id))) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendor-assessments/:aid/links', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Response links of an assessment, with the answers and the files the vendor sent (never the secret)',
  });

  app.post('/api/vendor-assessments/:aid/links', editPerm, async (req, reply) => {
    if (!(await settings()).enabled) ctx.fail(409, 'disabled', 'Vendor response links are switched off. An administrator can switch them on under Assessment questions.');
    const a = await needDraft(req);
    if (a.status !== 'draft') ctx.fail(409, 'completed', 'This assessment is completed. Start a new one to ask the vendor again.');
    const b = (req.body ?? {}) as Row;
    const { row, token } = await createLink(req, a, { recipient: b.recipient, days: b.days });
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
    summary: 'Revoke a response link; the answers and files already sent stay for review',
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
    const s = await settings();
    const files = await heldFiles(ctx, [l.id]);
    return {
      // The organization's name (Administration > Organization), else the application name.
      organization: organizationName(await readOrganization(db)),
      vendor_name: vendor?.name ?? '',
      title: l.set_title,
      expires_at: l.expires_at,
      submitted_at: l.submitted_at,
      responder_name: l.responder_name,
      // Text the vendor needs; weights and staff answers stay inside.
      questions: (l.questions as Question[]).map((q) => ({ key: q.key, section: q.section, text: q.text, guidance: q.guidance })),
      answers: l.answers ?? {},
      // The files sent through this link that staff have not yet taken over or discarded.
      files: files.map(publicFile),
      upload: await uploadLimits(ctx, s),
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
    summary: 'The questions behind a vendor response link, the answers saved so far and the files sent (no account; rate limited)',
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
      const files = (await heldFiles(ctx, [link.id])).length;
      await ctx.audit(req, {
        action: 'vendor.response_submit', recordType: 'vendor', recordId: link.vendor_id,
        summary: `Vendor sent answers to the assessment through the response link (${name})${files ? ` with ${files} file${files === 1 ? '' : 's'}` : ''}`,
        after: { link_id: link.id, assessment_id: link.assessment_id, answered: Object.keys(answers).length, files },
      });
      if (ctx.app.hasDecorator('notify') && link.created_by) {
        const vendor = await db.one<Row>('select name from vendors where id = $1', [link.vendor_id]);
        await ctx.app.notify({
          userIds: [link.created_by], kind: 'general', title: `${vendor?.name ?? 'A vendor'} sent its assessment answers`,
          body: `Review the answers${files ? ' and files' : ''} on the vendor's Assessment tab, take over the ones you accept, then complete the assessment.`,
          recordType: 'vendor', recordId: link.vendor_id,
        }).catch(() => undefined);
      }
    }
    return publicView({ ...link, ...saved! });
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/vendor-response/:token', tag: 'Vendors', public: true,
    summary: 'Save answers through a vendor response link; `submit: true` sends them (every question answered and a name given), after which no more files can be sent',
    body: {
      type: 'object',
      properties: {
        answers: { type: 'object', additionalProperties: { type: 'object', properties: { answer: { type: 'string', enum: ['yes', 'partial', 'no', 'na'] }, note: { type: 'string' } } } },
        responder_name: { type: 'string' },
        submit: { type: 'boolean' },
      },
    },
  });

  const kit: LinkKit = { settings, openLink, needDraft, createLink, linkView };
  await registerResponseFiles(ctx, kit);
  await registerResponseEmail(ctx, kit);
}
