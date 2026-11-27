// Policy translations (E41-07): a version of a policy may carry its title, summary, change summary
// and text in another language. The version's own text is the approved original (in BASE_LANGUAGE);
// a translation is kept beside it, may be added or corrected after the version is published (every
// change audited with the text it replaced), and is what staff who chose that language read in the
// portal, on the kiosk and in the app. An acknowledgment records the language that was read and,
// for a translation, a SHA-256 stamp of the translated text (W23 F5), so it shows which text was read
// even if the translation changes later. Changing or removing the translation of a published version
// needs policies.approve, as publishing does; on drafts policies.edit is enough.
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { BASE_LANGUAGE, englishName, isLanguage, languageName, LANGUAGES } from '../../../../shared/i18n.ts';
import type { Db } from '../../core/db.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { renderPolicyMarkdown } from './markdown.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 200_000;

/** Languages a policy can be translated into: every language of the portal but the original's. */
export const TRANSLATION_LANGUAGES = LANGUAGES.filter((l) => l.code !== BASE_LANGUAGE);

/** The language codes each of these versions has a translation in. */
export async function translatedLanguages(db: Db, versionIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!versionIds.length) return out;
  const rows = await db.query<Row>(
    'select version_id, language from policy_version_translations where version_id = any($1::uuid[]) order by language', [versionIds]);
  for (const r of rows) out.set(String(r.version_id), [...(out.get(String(r.version_id)) ?? []), String(r.language)]);
  return out;
}

export interface Reading {
  /** The language of the text given: the translation's when there is one in the language asked for, else the original's. */
  language: string;
  title: string;
  summary: string | null;
  change_summary: string | null;
  body: string;
}

/**
 * What a person reads of a version in the language they asked for: the translation when the version
 * has one in it, else the original. `version` needs `id`, `body`, `change_summary`; `policy` needs
 * `title` and `summary` (or `policy_title` and `policy_summary`).
 */
export async function readingOf(db: Db, policy: Row, version: Row, wanted: unknown): Promise<Reading> {
  const original: Reading = {
    language: BASE_LANGUAGE,
    title: String(policy.title ?? policy.policy_title ?? ''),
    summary: (policy.summary ?? policy.policy_summary ?? null) as string | null,
    change_summary: (version.change_summary ?? null) as string | null,
    body: String(version.body ?? ''),
  };
  if (!isLanguage(wanted) || wanted === BASE_LANGUAGE) return original;
  const tr = await db.one<Row>('select * from policy_version_translations where version_id = $1 and language = $2', [version.id ?? version.version_id, wanted]);
  if (!tr) return original;
  return {
    language: wanted, title: String(tr.title), summary: tr.summary ?? original.summary,
    change_summary: tr.change_summary ?? original.change_summary, body: String(tr.body),
  };
}

/** Translated titles for list rows that carry `version_id`, `policy_title` and `policy_summary`; each row gets `language`. */
export async function translateTitles<T extends Row>(db: Db, rows: T[], wanted: unknown): Promise<T[]> {
  if (!isLanguage(wanted) || wanted === BASE_LANGUAGE || !rows.length) return rows.map((r) => ({ ...r, language: BASE_LANGUAGE }));
  const found = await db.query<Row>(
    'select version_id, title, summary from policy_version_translations where language = $1 and version_id = any($2::uuid[])',
    [wanted, rows.map((r) => r.version_id)]);
  const byVersion = new Map(found.map((f) => [String(f.version_id), f]));
  return rows.map((r) => {
    const tr = byVersion.get(String(r.version_id));
    return tr ? { ...r, policy_title: tr.title, policy_summary: tr.summary ?? r.policy_summary, language: wanted } : { ...r, language: BASE_LANGUAGE };
  });
}

/** The SHA-256 stamp of a translation's text: its title, summary, change summary and body, as stored. */
export function translationStamp(tr: Row): string {
  return createHash('sha256').update(JSON.stringify([tr.title ?? null, tr.summary ?? null, tr.change_summary ?? null, tr.body ?? null])).digest('hex');
}

export interface ReadText {
  /** The language read: the one the person says, when the version has a translation in it; otherwise the original's. */
  language: string;
  /** The stamp of the translation read (translationStamp); null when the original was read. */
  translation_sha256: string | null;
}

/** What to record for an acknowledgment: the language read and, for a translation, the stamp of its text. */
export async function textRead(db: Db, versionId: string, said: unknown): Promise<ReadText> {
  const original = { language: BASE_LANGUAGE, translation_sha256: null };
  if (!isLanguage(said) || said === BASE_LANGUAGE) return original;
  const tr = await db.one<Row>('select title, summary, change_summary, body from policy_version_translations where version_id = $1 and language = $2', [versionId, said]);
  return tr ? { language: said, translation_sha256: translationStamp(tr) } : original;
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const view = (t: Row, withBody = true) => ({
  id: t.id, version_id: t.version_id, language: t.language, language_name: languageName(String(t.language)),
  title: t.title, summary: t.summary, change_summary: t.change_summary,
  updated_at: t.updated_at, updated_by_name: t.updated_by_name ?? null, sha256: translationStamp(t),
  ...(withBody ? { body: t.body, body_html: renderPolicyMarkdown(String(t.body ?? '')) } : {}),
});

export function registerTranslations(ctx: ModuleContext): void {
  const { db } = ctx;
  const label = (p: Row) => [p.ref, p.title].filter(Boolean).join(' ');
  const seesDrafts = (req: FastifyRequest) => ctx.can(req.user, 'policies.edit') || ctx.can(req.user, 'policies.approve');
  /** Staff read a published version's translation at once, so changing it is an approval, as publishing is (W23 F5). */
  function mayChange(req: FastifyRequest, version: Row) {
    if (version.status === 'published' && !ctx.can(req.user, 'policies.approve')) {
      ctx.fail(403, 'forbidden', 'This version is published, so changing or removing its translations needs permission to approve policies.');
    }
  }

  async function needVersion(req: FastifyRequest): Promise<{ policy: Row; version: Row }> {
    const params = req.params as Row;
    const policy = (await ctx.resources.find('policy', String(params.id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Policy not found.');
    const vid = String(params.vid ?? '');
    const version = UUID.test(vid) ? await db.one<Row>('select * from policy_versions where id = $1 and policy_id = $2', [vid, policy.id]) : undefined;
    if (!version || (!seesDrafts(req) && !['published', 'superseded', 'withdrawn'].includes(String(version.status)))) ctx.fail(404, 'not_found', 'Version not found.');
    return { policy, version: version! };
  }
  function needLanguage(req: FastifyRequest): string {
    const lang = String((req.params as Row).lang ?? '');
    if (!TRANSLATION_LANGUAGES.some((l) => l.code === lang)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', {
        language: `Choose one of: ${TRANSLATION_LANGUAGES.map((l) => `${l.code} (${l.english})`).join(', ')}.`,
      });
    }
    return lang;
  }

  ctx.app.get('/api/policies/translation-languages', { preHandler: ctx.requirePerm('policies.view') }, async () => ({
    original: { code: BASE_LANGUAGE, name: languageName(BASE_LANGUAGE) },
    languages: TRANSLATION_LANGUAGES.map((l) => ({ code: l.code, name: l.name, english: l.english })),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/translation-languages', permission: 'policies.view', tag: 'Policies',
    summary: 'The language of policies\' own text, and the languages a version can be translated into',
    response: '{ original: { code, name }, languages: [{ code, name, english }] }',
  });

  ctx.app.get('/api/policies/:id/versions/:vid/translations', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const { version } = await needVersion(req);
    const rows = await db.query<Row>(
      `select t.*, u.display_name as updated_by_name from policy_version_translations t left join users u on u.id = t.updated_by
       where t.version_id = $1 order by t.language`, [version.id]);
    return { version: Number(version.version), status: version.status, original_language: BASE_LANGUAGE, rows: rows.map((r) => view(r)) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/versions/:vid/translations', permission: 'policies.view', tag: 'Policies',
    summary: 'Translations of one version of a policy',
    description: 'Callers without `policies.edit` or `policies.approve` see only published and superseded versions (404 `not_found` otherwise).',
    response: '{ version, status, original_language, rows: [{ id, language, language_name, title, summary, change_summary, body, body_html, updated_at, updated_by_name }] }',
  });

  ctx.app.put('/api/policies/:id/versions/:vid/translations/:lang', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const { policy, version } = await needVersion(req);
    const lang = needLanguage(req);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This policy is retired. Its translations cannot change.');
    if (version.status === 'superseded') ctx.fail(409, 'superseded', 'A newer version has been published. Translate that version instead.');
    mayChange(req, version);
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const title = text(b.title);
    const body = typeof b.body === 'string' ? b.body : '';
    if (!title) fields.title = 'Write the title in this language.';
    else if (title.length > 500) fields.title = 'The title is too long.';
    if (!body.trim()) fields.body = 'Write the translated text.';
    else if (body.length > MAX_BODY) fields.body = 'The text is too long.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const summary = text(b.summary);
    const changeSummary = text(b.change_summary);
    const before = await db.one<Row>('select * from policy_version_translations where version_id = $1 and language = $2', [version.id, lang]);
    if (before && before.title === title && before.body === body && (before.summary ?? null) === summary && (before.change_summary ?? null) === changeSummary) {
      return view(before);
    }
    const row = (await db.one<Row>(
      `insert into policy_version_translations (policy_id, version_id, language, title, summary, change_summary, body, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       on conflict (version_id, language) do update set title = excluded.title, summary = excluded.summary,
         change_summary = excluded.change_summary, body = excluded.body, updated_at = now(), updated_by = excluded.updated_by
       returning *`,
      [policy.id, version.id, lang, title, summary, changeSummary, body, req.user!.id],
    ))!;
    await ctx.audit(req, {
      action: 'policy.translation_save', recordType: 'policy', recordId: policy.id,
      summary: `${englishName(lang)} translation of version ${version.version} of ${label(policy)} ${before ? 'changed' : 'added'}`,
      // The text it replaced is kept, so what a person read and acknowledged can always be shown again.
      before: before ? { language: lang, title: before.title, summary: before.summary, change_summary: before.change_summary, body: before.body } : undefined,
      after: { language: lang, version: Number(version.version), title, summary, change_summary: changeSummary, body_length: body.length, sha256: translationStamp(row) },
    });
    return view(row);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/policies/:id/versions/:vid/translations/:lang', permission: 'policies.edit', tag: 'Policies',
    summary: 'Add or change the translation of a version into one language',
    description: 'Allowed on drafts (`policies.edit`) and on the published version (a translation may follow publication; that needs `policies.approve` too, else 403 `forbidden`); 409 `superseded` on a replaced version and `retired` on a retired policy. `lang` is a translation language (GET /api/policies/translation-languages). Audited with the text it replaced. `sha256` is the stamp of the translated text that acknowledgments record.',
    body: '{ title, summary?, change_summary?, body (Markdown, as the version\'s own text) }',
    response: '{ id, language, language_name, title, summary, change_summary, body, body_html, updated_at, sha256 }',
  });

  ctx.app.delete('/api/policies/:id/versions/:vid/translations/:lang', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const { policy, version } = await needVersion(req);
    const lang = needLanguage(req);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This policy is retired. Its translations cannot change.');
    if (version.status === 'superseded') ctx.fail(409, 'superseded', 'A newer version has been published. Its translations are kept as they were.');
    mayChange(req, version);
    const gone = await db.one<Row>('delete from policy_version_translations where version_id = $1 and language = $2 returning *', [version.id, lang]);
    if (!gone) ctx.fail(404, 'not_found', 'This version has no translation in that language.');
    await ctx.audit(req, {
      action: 'policy.translation_delete', recordType: 'policy', recordId: policy.id,
      summary: `${englishName(lang)} translation of version ${version.version} of ${label(policy)} removed`,
      before: { language: lang, title: gone!.title, summary: gone!.summary, change_summary: gone!.change_summary, body: gone!.body },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/policies/:id/versions/:vid/translations/:lang', permission: 'policies.edit', tag: 'Policies',
    summary: 'Remove the translation of a version into one language',
    description: 'On the published version this needs `policies.approve` too (403 `forbidden`). 404 `not_found` when there is none. Acknowledgments already given in that language keep it and the stamp of the text read. Audited with the text removed.',
    response: '{ ok: true }',
  });
}
