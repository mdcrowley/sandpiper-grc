// Acknowledgment routes: a person's own list and acknowledgment, and the tracking view per policy.
import type { FastifyRequest } from 'fastify';
import { actorOf, asDataLoad, dataLoadFor, resolvePerson } from '../../core/dataload.ts';
import { guardFormula } from '../../core/export/csv.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { readableSql, readerIdsSql, readerParams, tablesFor, type AccessTables } from './access.ts';
import { ackState, ackTracking } from './acknowledgments.ts';
import { daysBetween, localDate } from './dates.ts';
import { renderPolicyMarkdown } from './markdown.ts';
import { readingOf, textRead, translatedLanguages, translateTitles } from './translations.ts';
import { BASE_LANGUAGE, englishName, isLanguage, LANGUAGES } from '../../../../shared/i18n.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  s = guardFormula(s); // stop spreadsheet formula injection (core/export/csv.ts, W17-5)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATE_LABEL: Record<string, string> = {
  acknowledged: 'Acknowledged', overdue: 'Overdue', outstanding: 'Outstanding', superseded: 'Closed',
};

export function registerAckRoutes(ctx: ModuleContext, tables: AccessTables = tablesFor(ctx)) {
  const { db } = ctx;

  // E43: only documents the person may read (requests go only to readers; narrowing who may read
  // closes open ones, and an answered one is kept but no longer shown once the person cannot read it).
  const mine = (req: FastifyRequest) => `${MINE} and ${readableSql(req.user, 'p', tables)}`;
  const MINE = `
    select a.id, a.policy_id, a.version_id, a.requested_at, a.due_on, a.acknowledged_at, a.superseded_at, a.language as acknowledged_language,
           p.ref as policy_ref, p.title as policy_title, p.summary as policy_summary, v.version, v.effective_on
    from policy_acknowledgements a
    join policies p on p.id = a.policy_id and p.deleted_at is null
    join policy_versions v on v.id = a.version_id
    where a.user_id = $1`;

  const mineView = (a: Row, today: string) => {
    const state = ackState(a, today);
    return {
      id: a.id, policy_id: a.policy_id, policy_ref: a.policy_ref, policy_title: a.policy_title, policy_summary: a.policy_summary,
      version: Number(a.version), effective_on: a.effective_on, requested_at: a.requested_at, due_on: a.due_on,
      acknowledged_at: a.acknowledged_at, acknowledged_language: a.acknowledged_language ?? null, state, days_left: daysBetween(today, a.due_on),
    };
  };

  // A person's own requests. Needs only a session: the people asked to acknowledge a policy
  // are often not people who can open the policy library.
  // `lang` (E41-07): titles of versions translated into that language are given in it.
  ctx.app.get('/api/policies/acknowledgments/mine', async (req) => {
    const today = localDate();
    const rows = await db.query<Row>(
      `${mine(req)} and (a.acknowledged_at is not null or a.superseded_at is null)
       order by (a.acknowledged_at is not null), a.due_on, p.title`,
      [req.user!.id],
    );
    const list = (await translateTitles(db, rows, (req.query as Row).lang)).map((a) => ({ ...mineView(a, today), language: a.language }));
    return {
      today,
      awaiting: list.filter((r) => r.state !== 'acknowledged'),
      acknowledged: list.filter((r) => r.state === 'acknowledged').sort((a, b) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at))),
    };
  });

  async function needOwn(req: FastifyRequest): Promise<Row> {
    const id = (req.params as Row).ackId;
    const row = typeof id === 'string' && UUID.test(id) ? await db.one<Row>(`${mine(req)} and a.id = $2`, [req.user!.id, id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Acknowledgment request not found.');
  }

  /**
   * The text a person is asked to acknowledge: exactly the version named in their request, in the
   * language asked for (`lang`) when the version has a translation in it, else the original (E41-07).
   */
  ctx.app.get('/api/policies/acknowledgments/:ackId', async (req) => {
    const a = await needOwn(req);
    const v = (await db.one<Row>('select id, body, change_summary from policy_versions where id = $1', [a.version_id]))!;
    const reading = await readingOf(db, a, v, (req.query as Row).lang);
    const languages = (await translatedLanguages(db, [String(a.version_id)])).get(String(a.version_id)) ?? [];
    return {
      ...mineView(a, localDate()), policy_title: reading.title, policy_summary: reading.summary,
      change_summary: reading.change_summary, body_html: renderPolicyMarkdown(reading.body),
      language: reading.language, original_language: BASE_LANGUAGE, translations: languages,
    };
  });

  // Body (optional): { language } - the language the person read (E41-07). It is recorded when the
  // version has a translation in it; otherwise the original's language is recorded.
  ctx.app.post('/api/policies/acknowledgments/:ackId/acknowledge', async (req) => {
    const a = await needOwn(req);
    const today = localDate();
    if (a.acknowledged_at) return mineView(a, today);
    if (a.superseded_at) ctx.fail(409, 'superseded', 'This version has been replaced or the policy retired. There is nothing to acknowledge.');
    const { language, translation_sha256: stamp } = await textRead(db, String(a.version_id), ((req.body ?? {}) as Row).language);
    const stamped = await db.one<Row>(
      'update policy_acknowledgements set acknowledged_at = now(), language = $2, translation_sha256 = $3 where id = $1 and acknowledged_at is null returning acknowledged_at', [a.id, language, stamp],
    );
    const at = stamped?.acknowledged_at ?? new Date();
    await ctx.audit(req, {
      action: 'policy.acknowledge', recordType: 'policy', recordId: a.policy_id,
      summary: `${req.user!.displayName} acknowledged version ${a.version} of ${[a.policy_ref, a.policy_title].filter(Boolean).join(' ')}${language === BASE_LANGUAGE ? '' : ` (read in ${englishName(language)})`}`,
      after: { version: Number(a.version), user_id: req.user!.id, acknowledged_at: at, late: a.due_on < today, language, translation_sha256: stamp },
    });
    return mineView({ ...a, acknowledged_at: at, acknowledged_language: language }, today);
  });

  // ---------- loading past acknowledgments (E18-94) ----------

  /** Whether an account (disabled ones too) is among the document's readers, as its distribution stands. */
  async function accountReads(policy: Row, userId: string): Promise<boolean> {
    const sql = readerIdsSql(tables).replace(`u.deleted_at is null and u.status = 'active'`, 'u.id = $9::uuid');
    return (await db.query(sql, [...readerParams(policy), userId])).length > 0;
  }

  /** Whether a roster person is inside the distribution: their department is (below) a reader department. */
  async function rosterReads(policy: Row, personId: string): Promise<boolean> {
    if (policy.access !== 'restricted') return true;
    const list = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.map(String) : []);
    return !!(await db.one(
      `select 1 from people p where p.id = $1 and p.department_id in (
         with recursive dn(id) as (
           select d.id from departments d where d.deleted_at is null and (d.id::text in (select jsonb_array_elements_text($2::jsonb))
             or exists (select 1 from document_groups g where g.deleted_at is null and $3::jsonb @> jsonb_build_array(g.id::text)
                        and g.departments @> jsonb_build_array(d.id::text)))
           union select d.id from departments d join dn on d.parent_id = dn.id where d.deleted_at is null)
         select id from dn)`, [personId, list(policy.access_departments), list(policy.access_groups)]));
  }

  /**
   * Data load mode only: records that a person acknowledged a version on a past date (history from
   * another system). `user` names them as `on_behalf_of` does (an account by id, username or email,
   * disabled ones too, or a roster person); a roster person without an account is recorded on the
   * roster's list (method "recorded"). The person must be one of the document's readers. Nobody is
   * told; the audit log names the loader. Without `user`, the person named by `on_behalf_of` is meant.
   */
  ctx.app.post('/api/policies/:id/versions/:vid/acknowledgments', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => {
    if (!(await dataLoadFor(db, req, ctx.audit))) {
      ctx.fail(409, 'not_loading', 'Another person\'s acknowledgment can be recorded only in data load mode (Administration > Settings), by an administrator.');
    }
    req.dataLoad = true;
    return asDataLoad(async () => {
      const policy = (await ctx.resources.find('policy', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Document not found.');
      const vid = String((req.params as Row).vid ?? '');
      const version = await db.one<Row>(
        `select * from policy_versions where policy_id = $1 and status in ('published', 'superseded', 'withdrawn')
           and (id::text = $2 or ($2 ~ '^[0-9]{1,6}$' and version = ($2)::int))`, [policy.id, vid])
        ?? ctx.fail(404, 'not_found', 'No published version of this document has that id or number.');
      const b = (req.body ?? {}) as Row;
      const fields: Record<string, string> = {};
      const named = b.user ?? b.person;
      const who = named !== undefined && named !== null && named !== '' ? await resolvePerson(db, named, 'user') : req.onBehalf;
      if (!who) fields.user = 'Name the person who acknowledged it.';
      else if (who.kind === 'name') fields.user = `${who.name} has no account and is not on the roster, so an acknowledgment cannot be recorded for them.`;
      const raw = String(b.acknowledged_at ?? '').trim();
      const at = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
      if (!raw || Number.isNaN(at.getTime())) fields.acknowledged_at = 'Give the date or time it was acknowledged (YYYY-MM-DD or ISO 8601).';
      else if (at.getTime() > Date.now()) fields.acknowledged_at = 'The date cannot be in the future.';
      if (b.language !== undefined && b.language !== null && b.language !== '' && !isLanguage(b.language)) {
        fields.language = `Choose one of: ${LANGUAGES.map((l) => l.code).join(', ')}.`;
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const person = who!;
      const reads = person.userId ? await accountReads(policy, person.userId) : await rosterReads(policy, person.personId!);
      if (!reads) ctx.fail(400, 'validation', 'Check the highlighted fields.', { user: `${person.name} is not one of this document's readers. Add them to its distribution first.` });
      const { language, translation_sha256: stamp } = await textRead(db, String(version.id), b.language);
      const iso = at.toISOString();
      const day = localDate(at);
      const row = person.userId
        ? await db.one<Row>(
          `insert into policy_acknowledgements (policy_id, version_id, user_id, requested_at, due_on, acknowledged_at, language, translation_sha256)
           values ($1, $2, $3, $4, $5::date, $4, $6, $7)
           on conflict (version_id, user_id) do update set acknowledged_at = excluded.acknowledged_at, superseded_at = null,
             language = excluded.language, translation_sha256 = excluded.translation_sha256
           where policy_acknowledgements.acknowledged_at is null
           returning id`, [policy.id, version.id, person.userId, iso, day, language, stamp])
        : await db.one<Row>(
          `insert into policy_person_acknowledgements (policy_id, version_id, person_id, requested_at, due_on, acknowledged_at, method, recorded_by, language, translation_sha256)
           values ($1, $2, $3, $4, $5::date, $4, 'recorded', $6, $7, $8)
           on conflict (version_id, person_id) do update set acknowledged_at = excluded.acknowledged_at, method = excluded.method,
             recorded_by = excluded.recorded_by, superseded_at = null, language = excluded.language, translation_sha256 = excluded.translation_sha256
           where policy_person_acknowledgements.acknowledged_at is null
           returning id`, [policy.id, version.id, person.personId, iso, day, actorOf(req).id, language, stamp]);
      const name = [policy.doc_number ?? policy.ref, policy.title].filter(Boolean).join(' ');
      if (row) {
        await ctx.audit(req, {
          action: person.userId ? 'policy.acknowledge' : 'policy.person_acknowledge', recordType: 'policy', recordId: policy.id,
          summary: `${person.name} acknowledged version ${version.version} of ${name} on ${day}${language === BASE_LANGUAGE ? '' : ` (read in ${englishName(language)})`} (loaded)`,
          after: { version: Number(version.version), user_id: person.userId, person_id: person.userId ? null : person.personId, acknowledged_at: iso, language, translation_sha256: stamp, loaded: true },
        });
        reply.code(201);
      }
      return {
        recorded: !!row, already: !row, kind: person.userId ? 'user' : 'person', user_id: person.userId, person_id: person.userId ? null : person.personId,
        name: person.name, policy_id: policy.id, version: Number(version.version), acknowledged_at: iso, language,
      };
    });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/:id/versions/:vid/acknowledgments', permission: 'policies.edit',
    summary: 'Data load mode only: record that a reader of the document acknowledged a version on a past date (an account, or a roster person without one)',
    body: '{ user (user id, username or email; "person:<roster id, reference or email>"; default: on_behalf_of), acknowledged_at: YYYY-MM-DD or ISO time, language? }',
    response: '{ recorded, already, kind: user | person, user_id, person_id, name, policy_id, version, acknowledged_at, language }',
  });

  // ---------- tracking ----------

  ctx.app.get('/api/policies/:id/acknowledgments', { preHandler: ctx.requirePerm('policies.view') }, async (req, reply) => {
    const policy = (await ctx.resources.find('policy', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Policy not found.');
    const query = req.query as Record<string, string>;
    const wanted = Number(query.version);
    // Default: the version readers see now (the last one published, even after the policy is retired).
    const version = await db.one<Row>(
      Number.isInteger(wanted) && wanted > 0
        ? `select * from policy_versions where policy_id = $1 and version = $2 and status in ('published', 'superseded', 'withdrawn')`
        : `select * from policy_versions where policy_id = $1 and status in ('published', 'withdrawn') and $2::int is null order by version desc limit 1`,
      [policy.id, Number.isInteger(wanted) && wanted > 0 ? wanted : null],
    );
    const data = await ackTracking(ctx, policy, version);
    if (query.format !== 'csv') return data;

    if (!ctx.can(req.user, 'policies.export')) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    const head = ['Policy', 'Version', 'Person', 'Email', 'Department', 'Status', 'Requested', 'Due', 'Acknowledged', 'Language read', 'Translation read (SHA-256)', 'Days overdue', 'Last reminded'];
    const lines = [head.join(',')];
    for (const r of data.rows) {
      lines.push([
        [policy.ref, policy.title].filter(Boolean).join(' '), data.version?.version, r.user_name, r.email, r.department,
        STATE_LABEL[r.state], r.requested_at, r.due_on, r.acknowledged_at, r.language ? englishName(String(r.language)) : '', r.translation_sha256 ?? '', r.days_overdue || '', r.reminded_at,
      ].map(csvCell).join(','));
    }
    await ctx.audit(req, {
      action: 'policy.ack_export', recordType: 'policy', recordId: policy.id,
      summary: `Exported ${data.rows.length} acknowledgment record${data.rows.length === 1 ? '' : 's'} for ${[policy.ref, policy.title].filter(Boolean).join(' ')} to CSV`,
    });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="policy-acknowledgments.csv"`);
    return '﻿' + lines.join('\r\n');
  });
}
