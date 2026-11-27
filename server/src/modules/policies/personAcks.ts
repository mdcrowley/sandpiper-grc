// Acknowledgments by roster people (E29-09, E29-10): staff on the roster (people module), who
// may have no account, are asked by position when a version is published; a supervisor records
// their acknowledgments from a sign-in sheet, by hand, or on the kiosk on a signed-in device.
// There is no unauthenticated route: every acknowledgment records who recorded it.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { readableSql, readerIds, tablesFor, type AccessTables } from './access.ts';
import { addDays, daysBetween, isDate, localDate } from './dates.ts';
import { renderPolicyMarkdown } from './markdown.ts';
import { readingOf, textRead } from './translations.ts';
import { BASE_LANGUAGE, englishName, isLanguage, LANGUAGES } from '../../../../shared/i18n.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PEOPLE = 500;
/**
 * Wrong employee numbers for one person within KIOSK_LOCK_MS after which the kiosk stops trying for
 * them (five within 15 minutes). Counted in the database (rate_limit_hits, bucket `kiosk`), so a
 * restart or a second server process does not reset them.
 */
const KIOSK_TRIES = 5;
const KIOSK_LOCK_MS = 15 * 60 * 1000;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const rosterThere = (ctx: ModuleContext) => !!ctx.resources.get('person');

/**
 * Asks the roster people in the policy's audience to acknowledge a newly published version: with
 * `ack_roster` on, active people in one of `audience_positions` (or everyone on the roster when the
 * policy is for everyone). People whose account was asked already are left out (one person, one
 * request). Earlier unanswered roster requests for the policy are closed. Returns how many were asked.
 */
export async function requestRosterAcks(ctx: ModuleContext, policy: Row, version: Row, dueOn: string, now: Date): Promise<number> {
  await ctx.db.query(
    `update policy_person_acknowledgements set superseded_at = $3
     where policy_id = $1 and version_id <> $2 and acknowledged_at is null and superseded_at is null`,
    [policy.id, version.id, now.toISOString()],
  );
  if (policy.ack_roster !== true || !rosterThere(ctx)) return 0;
  const positions = list(policy.audience_positions);
  if (!positions.length && policy.audience_everyone !== true) return 0;
  // E43: on a restricted document only roster people inside its distribution are asked: people
  // whose account may read it, or whose roster department is (or is below) a reader department.
  const restricted = policy.access === 'restricted';
  const readers = restricted ? await readerIds(ctx, tablesFor(ctx), policy) : [];
  const made = await ctx.db.query<{ id: string }>(
    `insert into policy_person_acknowledgements (policy_id, version_id, person_id, requested_at, due_on)
     select $1, $2, p.id, $3, $4::date from people p
     where p.deleted_at is null and p.status = 'active'
       and ($5::boolean or p.position_id::text = any($6::text[]))
       and not exists (select 1 from policy_acknowledgements a where a.version_id = $2 and p.user_id is not null and a.user_id = p.user_id)
       and (not $7::boolean or p.user_id = any($8::uuid[]) or p.department_id in (
         with recursive dn(id) as (
           select d.id from departments d where d.deleted_at is null and (d.id::text in (select jsonb_array_elements_text($9::jsonb))
             or exists (select 1 from document_groups g where g.deleted_at is null and $10::jsonb @> jsonb_build_array(g.id::text)
                        and g.departments @> jsonb_build_array(d.id::text)))
           union select d.id from departments d join dn on d.parent_id = dn.id where d.deleted_at is null)
         select id from dn))
     on conflict (version_id, person_id) do nothing
     returning id`,
    [policy.id, version.id, now.toISOString(), dueOn, policy.audience_everyone === true, positions,
      restricted, readers, JSON.stringify(list(policy.access_departments)), JSON.stringify(list(policy.access_groups))],
  );
  return made.length;
}

type State = 'acknowledged' | 'overdue' | 'outstanding' | 'superseded';
const stateOf = (a: Row, today: string): State =>
  a.acknowledged_at ? 'acknowledged' : a.superseded_at ? 'superseded' : a.due_on && String(a.due_on).slice(0, 10) < today ? 'overdue' : 'outstanding';

export function registerPersonAcks(ctx: ModuleContext, tables: AccessTables = tablesFor(ctx)): void {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const needRoster = () => { if (!rosterThere(ctx)) ctx.fail(404, 'not_found', 'The roster is not available.'); };
  const label = (p: Row) => [p.ref, p.title].filter(Boolean).join(' ');

  const needPolicy = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('policy', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Policy not found.');

  /** The published version, or the published or superseded version with the number asked for. */
  async function versionOf(policy: Row, wanted: unknown): Promise<Row | undefined> {
    const n = Number(wanted);
    return Number.isInteger(n) && n > 0
      ? db.one<Row>(`select * from policy_versions where policy_id = $1 and version = $2 and status in ('published', 'superseded', 'withdrawn')`, [policy.id, n])
      : db.one<Row>(`select * from policy_versions where policy_id = $1 and status in ('published', 'withdrawn') order by version desc limit 1`, [policy.id]);
  }

  // ---------- tracking and recording (sign-in sheets) ----------

  // Names come from the roster, so these need people.view as well.
  const viewing = { preHandler: [ctx.requirePerm('policies.view'), ctx.requirePerm('people.view')] };
  const recording = { preHandler: [ctx.requirePerm('policies.edit'), ctx.requirePerm('people.view')] };

  app.get('/api/policies/:id/person-acknowledgments', viewing, async (req) => {
    needRoster();
    const policy = await needPolicy(req);
    const version = await versionOf(policy, (req.query as Row).version);
    const today = localDate();
    if (!version) return { today, version: null, counts: { total: 0, acknowledged: 0, outstanding: 0, overdue: 0 }, rows: [], positions: [] };
    const raw = await db.query<Row>(
      `select a.id, a.person_id, a.requested_at, a.due_on, a.acknowledged_at, a.method, a.superseded_at, a.sheet_attachment_id, a.language, a.translation_sha256,
              p.ref as person_ref, p.full_name as person, p.employee_number, pos.name as position, d.name as department,
              u.display_name as recorded_by_name
       from policy_person_acknowledgements a
       join people p on p.id = a.person_id
       left join positions pos on pos.id = p.position_id and pos.deleted_at is null
       left join departments d on d.id = p.department_id and d.deleted_at is null
       left join users u on u.id = a.recorded_by
       where a.policy_id = $1 and a.version_id = $2
       order by lower(p.full_name)`,
      [policy.id, version.id],
    );
    const rows: Row[] = raw.map((a) => {
      const state = stateOf(a, today);
      return { ...a, state, days_overdue: state === 'overdue' ? daysBetween(String(a.due_on).slice(0, 10), today) : 0 };
    });
    const count = (set: Row[]) => ({
      total: set.length,
      acknowledged: set.filter((r) => r.state === 'acknowledged').length,
      outstanding: set.filter((r) => r.state !== 'acknowledged' && r.state !== 'superseded').length,
      overdue: set.filter((r) => r.state === 'overdue').length,
    });
    const names = [...new Set(rows.map((r) => r.position ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    return {
      today, version: { id: version.id, version: Number(version.version), status: version.status }, counts: count(rows), rows,
      positions: names.map((n) => ({ position: n || null, ...count(rows.filter((r) => (r.position ?? '') === n)) })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/:id/person-acknowledgments', permission: 'people.view',
    summary: 'Roster people asked to acknowledge a version of a policy, and who has (needs policies.view and people.view)',
    query: { version: 'version number (default: the published version)' },
    response: '{ today, version, counts: { total, acknowledged, outstanding, overdue }, rows: [{ id, person_id, person, employee_number, position, state, method, acknowledged_at, language, translation_sha256, recorded_by_name, sheet_attachment_id }], positions }',
  });

  /**
   * Records acknowledgments for the published version, from a sign-in sheet or by hand. Body:
   * { people?: [person id], employee_numbers?: [text], method: 'sign_in_sheet' | 'recorded',
   *   acknowledged_on?: YYYY-MM-DD (default today, never in the future), sheet_attachment_id? }.
   * A person who was not asked is added; one who has already acknowledged is skipped.
   */
  app.post('/api/policies/:id/person-acknowledgments', recording, async (req, reply) => {
    needRoster();
    const policy = await needPolicy(req);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This policy is retired. There is nothing to acknowledge.');
    const version = await versionOf(policy, undefined) ?? ctx.fail(409, 'not_published', 'This policy has no published version to acknowledge.');
    const body = (req.body ?? {}) as Row;
    const today = localDate();
    const fields: Record<string, string> = {};
    const method = String(body.method ?? 'recorded');
    if (!['sign_in_sheet', 'recorded'].includes(method)) fields.method = 'Choose a sign-in sheet or recorded by hand.';
    const on = body.acknowledged_on ? String(body.acknowledged_on) : today;
    if (!isDate(on)) fields.acknowledged_on = 'Enter a date as YYYY-MM-DD.';
    else if (on > today) fields.acknowledged_on = 'The date cannot be in the future.';
    // E41-07: the language the sheet was read in, when the version has a translation in it (default: the original's).
    if (body.language !== undefined && body.language !== null && body.language !== '' && !isLanguage(body.language)) {
      fields.language = `Choose one of: ${LANGUAGES.map((l) => l.code).join(', ')}.`;
    }
    const ids = list(body.people);
    const numbers = list(body.employee_numbers).map((s) => s.trim()).filter(Boolean);
    if (!ids.length && !numbers.length) fields.people = 'Choose at least one person.';
    if (ids.length + numbers.length > MAX_PEOPLE) fields.people = `Record at most ${MAX_PEOPLE} people at a time.`;
    if (ids.some((i) => !UUID.test(i))) fields.people = 'One of the people is not valid.';
    let sheet: string | null = null;
    if (body.sheet_attachment_id) {
      sheet = String(body.sheet_attachment_id);
      // The sheet must be a file on this policy (attachments module).
      const ok = UUID.test(sheet) && await db.one(
        `select 1 from attachments where id = $1 and record_type = 'policy' and record_id = $2 and deleted_at is null`, [sheet, policy.id],
      ).catch(() => undefined);
      if (!ok) fields.sheet_attachment_id = 'Attach the sign-in sheet to this policy first, then choose it.';
    }
    if (Object.keys(fields).length) invalid(fields);

    const found = await db.query<Row>(
      `select id, full_name, employee_number from people
       where deleted_at is null and (id::text = any($1::text[]) or lower(employee_number) = any($2::text[]))`,
      [ids, numbers.map((n) => n.toLowerCase())],
    );
    const known = new Set(found.flatMap((p) => [p.id, String(p.employee_number ?? '').toLowerCase()]));
    const unknown = [...ids.filter((i) => !known.has(i)), ...numbers.filter((n) => !known.has(n.toLowerCase()))];
    const at = on === today ? new Date().toISOString() : `${on}T12:00:00Z`;
    const due = addDays(today, Math.max(1, Math.trunc(Number(policy.ack_days) || 14)));
    const { language, translation_sha256: stamp } = await textRead(db, String(version.id), body.language);
    let recorded = 0;
    let already = 0;
    for (const p of found) {
      const row = await db.one<Row>(
        `insert into policy_person_acknowledgements (policy_id, version_id, person_id, due_on, acknowledged_at, method, recorded_by, sheet_attachment_id, language, translation_sha256)
         values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)
         on conflict (version_id, person_id) do update
           set acknowledged_at = excluded.acknowledged_at, method = excluded.method, recorded_by = excluded.recorded_by,
               sheet_attachment_id = excluded.sheet_attachment_id, superseded_at = null, language = excluded.language, translation_sha256 = excluded.translation_sha256
           where policy_person_acknowledgements.acknowledged_at is null
         returning id`,
        [policy.id, version.id, p.id, due, at, method, req.user!.id, sheet, language, stamp],
      );
      if (row) recorded++; else already++;
    }
    await ctx.audit(req, {
      action: 'policy.person_acknowledge', recordType: 'policy', recordId: policy.id,
      summary: `${recorded} roster ${recorded === 1 ? 'acknowledgment' : 'acknowledgments'} of version ${version.version} of ${label(policy)} recorded by ${req.user!.displayName} (${method === 'sign_in_sheet' ? 'sign-in sheet' : 'by hand'}, ${on})`,
      after: { version: Number(version.version), method, acknowledged_on: on, people: found.map((p) => p.id), recorded, already, sheet_attachment_id: sheet, language, translation_sha256: stamp },
    });
    reply.code(201);
    return { recorded, already, unknown };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/:id/person-acknowledgments', permission: 'policies.edit',
    summary: 'Record roster people\'s acknowledgments of the published version, from a sign-in sheet or by hand (needs policies.edit and people.view)',
    body: '{ people?: [person id], employee_numbers?: [text], method: sign_in_sheet | recorded, acknowledged_on?: YYYY-MM-DD, sheet_attachment_id?, language? (the language read; recorded when the version has a translation in it) }',
    response: '{ recorded, already, unknown: [ids or numbers not on the roster] }',
  });

  // A roster person's acknowledgments, for their record page.
  app.get('/api/policies/person-acknowledgments/person/:personId', viewing, async (req) => {
    needRoster();
    const personId = String((req.params as Row).personId ?? '');
    const person = UUID.test(personId) ? await ctx.resources.find('person', personId, req.user) : undefined;
    if (!person) ctx.fail(404, 'not_found', 'Person not found.');
    const today = localDate();
    const rows = await db.query<Row>(
      `select a.id, a.policy_id, a.due_on, a.acknowledged_at, a.method, a.superseded_at, p.ref as policy_ref, p.title as policy_title,
              p.document_type, v.version, u.display_name as recorded_by_name
       from policy_person_acknowledgements a
       join policies p on p.id = a.policy_id and p.deleted_at is null
       join policy_versions v on v.id = a.version_id
       left join users u on u.id = a.recorded_by
       where a.person_id = $1 and ${ctx.resources.visibleWhere('policy', req.user, 'p')}
       order by (a.acknowledged_at is null and a.superseded_at is null) desc, a.due_on desc nulls last`, [person!.id]);
    return { today, rows: rows.map((r) => ({ ...r, version: Number(r.version), state: stateOf(r, today) })) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/person-acknowledgments/person/:personId', permission: 'people.view',
    summary: 'The policy acknowledgments asked of one roster person (needs policies.view and people.view)',
  });

  // ---------- the kiosk (a supervisor's signed-in device) ----------

  const kiosk = { preHandler: ctx.requirePerm('policies.edit') };
  const failures = makeDbLimiter(db, 'kiosk', KIOSK_TRIES, KIOSK_LOCK_MS);
  // E43: only documents the signed-in supervisor may read.
  const pending = (req: FastifyRequest) => `
    select a.id, a.policy_id, a.version_id, a.due_on, p.ref as policy_ref, p.title as policy_title, p.summary as policy_summary,
           p.document_type, v.version, v.effective_on
    from policy_person_acknowledgements a
    join policies p on p.id = a.policy_id and p.deleted_at is null and p.status = 'published'
    join policy_versions v on v.id = a.version_id and v.status = 'published'
    where a.person_id = $1 and a.acknowledged_at is null and a.superseded_at is null and ${readableSql(req.user, 'p', tables)}`;

  /** The person, when the employee number they typed is theirs. Wrong numbers are counted, and too many stop the kiosk for that person a while. */
  async function checkNumber(req: FastifyRequest, personId: unknown, number: unknown): Promise<Row> {
    needRoster();
    const id = String(personId ?? '');
    if (!UUID.test(id)) invalid({ person_id: 'Choose your name.' });
    // The attempt is claimed before the number is compared (take(), not blocked() then hit()), so a
    // burst of parallel guesses cannot all be compared before the first failures are recorded.
    const attempt = await failures.take(id);
    if (!attempt.ok) ctx.fail(429, 'too_many_tries', 'Too many wrong employee numbers. Ask your supervisor.');
    const person = await db.one<Row>(
      `select id, ref, full_name, preferred_name, employee_number from people where id = $1 and deleted_at is null and status = 'active'`, [id]);
    const typed = String(number ?? '').trim();
    if (!person || !person.employee_number || !typed || String(person.employee_number).toLowerCase() !== typed.toLowerCase()) {
      // The claimed attempt stays recorded as a failure.
      const locked = await failures.blocked(id);
      await ctx.audit(req, {
        action: 'policy.kiosk_mismatch', recordType: 'person', recordId: id,
        summary: `Kiosk: an employee number that does not match was given${locked ? '; the kiosk stops trying for this person for up to 15 minutes' : ''}`,
      });
      ctx.fail(403, 'not_matched', 'That employee number does not match. Try again or ask your supervisor.');
    }
    await failures.clear(id);
    return person!;
  }

  // Names of active roster people with something to acknowledge (name and position only).
  app.get('/api/policies/kiosk/people', kiosk, async (req) => {
    needRoster();
    const q = String((req.query as Row).q ?? '').trim();
    const rows = await db.query<Row>(
      `select pp.id, coalesce(nullif(pp.preferred_name, ''), pp.full_name) as name, pos.name as position
       from people pp left join positions pos on pos.id = pp.position_id and pos.deleted_at is null
       where pp.deleted_at is null and pp.status = 'active'
         and ($1 = '' or pp.full_name ilike $2 or pp.preferred_name ilike $2)
         and exists (${pending(req).replace('$1', 'pp.id')})
       order by lower(coalesce(nullif(pp.preferred_name, ''), pp.full_name)) limit 100`,
      [q, `%${q.replace(/[%_\\]/g, '\\$&')}%`],
    );
    return rows;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/kiosk/people', permission: 'policies.edit',
    summary: 'Kiosk: names of roster people with something to acknowledge', query: { q: 'part of a name' },
    response: '[{ id, name, position }]',
  });

  app.get('/api/policies/kiosk/pending', kiosk, async (req) => {
    const query = req.query as Row;
    const person = await checkNumber(req, query.person_id, query.employee_number);
    const items = await db.query<Row>(`${pending(req)} order by a.due_on nulls last, p.title`, [person.id]);
    const versions = new Map((await db.query<Row>('select id, body, change_summary from policy_versions where id = any($1::uuid[])', [items.map((i) => i.version_id)])).map((v) => [v.id, v]));
    const lang = query.lang;
    const out = [];
    for (const i of items) {
      // E41-07: in the language the person chose, when the version has a translation in it.
      const reading = await readingOf(db, i, versions.get(i.version_id) ?? { id: i.version_id }, lang);
      out.push({
        id: i.id, policy_ref: i.policy_ref, policy_title: reading.title, policy_summary: reading.summary, document_type: i.document_type,
        version: Number(i.version), due_on: i.due_on, body_html: renderPolicyMarkdown(reading.body),
        language: reading.language, original_language: BASE_LANGUAGE,
      });
    }
    return { person: { id: person.id, name: person.preferred_name || person.full_name }, items: out };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/policies/kiosk/pending', permission: 'policies.edit',
    summary: 'Kiosk: what one roster person has to acknowledge, once they give their employee number',
    query: { person_id: 'the person chosen', employee_number: 'typed by the person', lang: 'the language chosen for this person (a version translated into it is given translated)' },
    response: '{ person: { id, name }, items: [{ id, policy_ref, policy_title, version, due_on, body_html, language, original_language }] }',
  });

  app.post('/api/policies/kiosk/acknowledge', kiosk, async (req) => {
    const body = (req.body ?? {}) as Row;
    const person = await checkNumber(req, body.person_id, body.employee_number);
    const wanted = list(body.ack_ids).filter((i) => UUID.test(i));
    if (!wanted.length) invalid({ ack_ids: 'Choose at least one document to acknowledge.' });
    const stamped = await db.query<Row>(
      `update policy_person_acknowledgements a set acknowledged_at = now(), method = 'kiosk', recorded_by = $3
       from policies p, policy_versions v
       where a.id = any($2::uuid[]) and a.person_id = $1 and a.acknowledged_at is null and a.superseded_at is null
         and p.id = a.policy_id and p.deleted_at is null and p.status = 'published' and v.id = a.version_id and v.status = 'published'
         and ${readableSql(req.user, 'p', tables)}
       returning a.id, a.policy_id, a.version_id, p.ref, p.title, v.version`,
      [person.id, wanted, req.user!.id],
    );
    // E41-07: the language each document was read in ({ ack id: code }, or one `language` for all).
    const said = (body.languages && typeof body.languages === 'object' ? body.languages : {}) as Row;
    for (const s of stamped) {
      const { language, translation_sha256: stamp } = await textRead(db, String(s.version_id), said[s.id] ?? body.language);
      await db.query('update policy_person_acknowledgements set language = $2, translation_sha256 = $3 where id = $1', [s.id, language, stamp]);
      await ctx.audit(req, {
        action: 'policy.person_acknowledge', recordType: 'policy', recordId: s.policy_id,
        summary: `${person.ref} acknowledged version ${s.version} of ${label(s)} on the kiosk${language === BASE_LANGUAGE ? '' : ` (read in ${englishName(language)})`} (recorded by ${req.user!.displayName})`,
        after: { version: Number(s.version), person_id: person.id, method: 'kiosk', recorded_by: req.user!.id, language, translation_sha256: stamp },
      });
    }
    return { acknowledged: stamped.length };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/policies/kiosk/acknowledge', permission: 'policies.edit',
    summary: 'Kiosk: a roster person acknowledges documents on a supervisor\'s signed-in device; recorded as the signed-in user',
    body: '{ person_id, employee_number, ack_ids: [id], languages?: { <ack id>: language code }, language? (for every document) }', response: '{ acknowledged }',
  });
}
