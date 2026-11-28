// Routes of the outside reviewer workspace (E41-09).
//
//  - Staff, per kind of record (`/api/audits/:id/outside-reviewers`, `/api/compliance-reviews/:id/outside-reviewers`):
//    list with the record type's view permission; invite, change the end date, revoke and send the
//    set-up link again with its edit permission, on a record they may see. Inviting creates an
//    account, so it also asks for a recent password confirmation. The routes hang under the record
//    type's own path, so they follow its area (Administration > Features).
//  - Administrators: every reviewer and invitation (`/api/admin/outside-reviewers`), and revoking.
//  - The reviewer (`/api/outside-review...`): their reviews, one review's workspace, its files. The
//    gate (gate.ts) keeps reviewer accounts to these and to their own sign-in security.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { todayInZone } from '../../core/timezone.ts';
import { daysBetween } from '../../../../shared/dates.ts';
import { isLink } from '../attachments/links.ts';
import { sandboxDownload, sendStoredFile } from '../attachments/intake.ts';
import { activeSql, MAX_DAYS, presentGrant, stateOf, type Access } from './access.ts';
import { activeKinds, filesOf, kindOf, SUBJECT_KINDS, type SubjectKind } from './subjects.ts';

const GRANT_SHAPE = '{ id, subject_type, subject_id, user_id, name, email, username, organization, expires_on, note, state: active | expired | revoked, '
  + 'waiting_for_setup, account_disabled, invited_by_name, invited_at, revoked_at, last_opened_at, updated_at }';

export function registerRoutes(ctx: ModuleContext, access: Access, isReviewer: (userId: string) => Promise<boolean>) {
  const { app, db } = ctx;
  const resends = makeDbLimiter(db, 'outside_review_resend', 5, 24 * 3_600_000);
  const param = (req: FastifyRequest, name: string) => {
    const v = String((req.params as Row)[name] ?? '');
    return UUID_RE.test(v) ? v : null;
  };

  // ---------- staff, per kind ----------

  for (const kind of SUBJECT_KINDS) {
    const view = { preHandler: ctx.requirePerm(`${kind.module}.view`) };
    const edit = { preHandler: ctx.requirePerm(`${kind.module}.edit`) };
    const base = `${kind.path}/:id/outside-reviewers`;
    const tag = kind.module === 'audits' ? 'Audits' : 'Funding';

    /** The record, if the caller may see it (restricted and scoped records included). */
    async function needSubject(req: FastifyRequest): Promise<{ id: string; ref: string | null; title: string }> {
      const id = param(req, 'id');
      const row = id && kindOf(ctx, kind.type) ? await ctx.resources.find(kind.type, id, req.user) : undefined;
      if (!row) ctx.fail(404, 'not_found', `${kind.kind} not found.`);
      return { id: row!.id, ref: row!.ref ?? null, title: row!.title };
    }
    async function needGrant(req: FastifyRequest) {
      const subject = await needSubject(req);
      const gid = param(req, 'grantId');
      const g = gid ? await access.grant(gid) : undefined;
      if (!g || g.subject_type !== kind.type || g.subject_id !== subject.id) ctx.fail(404, 'not_found', 'Invitation not found.');
      return { subject, g: g! };
    }

    app.get(base, view, async (req) => {
      const subject = await needSubject(req);
      const today = todayInZone();
      const rows = await access.grants('g.subject_type = $1 and g.subject_id = $2', [kind.type, subject.id]);
      return {
        rows: rows.map((g) => presentGrant(g, today)), today, max_days: MAX_DAYS,
        can_edit: ctx.can(req.user, `${kind.module}.edit`), email_on: await ctx.app.mailEnabled(),
      };
    });
    ctx.describeRoute({
      method: 'GET', path: base, tag, permission: `${kind.module}.view`,
      summary: `The outside reviewers invited to one ${kind.kind.toLowerCase()}: who, until when, and whether their access is running`,
      response: `{ rows: [${GRANT_SHAPE}], today, max_days, can_edit, email_on }`,
    });

    app.post(base, edit, async (req, reply) => {
      const subject = await needSubject(req);
      // Inviting makes an account for someone outside the organization.
      await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, `inviting an outside reviewer to ${subject.ref ?? kind.kind.toLowerCase()}`);
      const made = await access.invite(req, kind, subject, (req.body ?? {}) as Row);
      reply.code(201);
      return made;
    });
    ctx.describeRoute({
      method: 'POST', path: base, tag, permission: `${kind.module}.edit`,
      summary: `Invite an outside reviewer to one ${kind.kind.toLowerCase()} until an end date; the invitation (and, for a new account, its set-up link) goes by email`,
      description: 'Needs a recent password confirmation and email switched on (409 `email_off`). The first invitation of an address makes an account with no roles, '
        + 'confined to the reviews it is invited to. 409 `staff_account` when the address belongs to a staff account, `account_disabled` when an administrator '
        + `disabled the reviewer's account, \`already_invited\` when access is already running. The end date is today at the earliest and at most ${MAX_DAYS} days ahead. Audited.`,
      body: '{ email, name, organization?, expires_on: YYYY-MM-DD, note? }', response: GRANT_SHAPE,
    });

    app.patch(`${base}/:grantId`, edit, async (req) => {
      const { subject, g } = await needGrant(req);
      if (g.revoked_at) ctx.fail(409, 'revoked', 'This invitation was revoked. Invite the reviewer again instead.');
      const b = (req.body ?? {}) as Row;
      const expiresOn = access.endDate(b.expires_on);
      const note = b.note === undefined ? g.note : String(b.note ?? '').trim().slice(0, 2000) || null;
      // Compare-and-set on the version read, so two people changing it at once do not overwrite each other.
      const version = req.headers['if-match'] ?? b.updated_at;
      const changed = await db.one<Row>(
        `update outside_review_grants set expires_on = $2, note = $3, updated_at = now(), updated_by = $4
         where id = $1 and revoked_at is null ${version ? "and date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $5::timestamptz)" : ''} returning id`,
        [g.id, expiresOn, note, req.user!.id, ...(version ? [String(version).replace(/^W\/|"/g, '')] : [])]);
      if (!changed) ctx.fail(409, 'version_conflict', 'Someone else changed this invitation. Reload and try again.');
      if (stateOf(g) !== 'active') {
        // Access running again: an account ended for want of a review is turned back on.
        await db.query(
          `update users set status = case when password_hash is null then 'pending' else 'active' end, updated_at = now()
           where id = $1 and status = 'disabled' and exists (select 1 from outside_reviewers o where o.user_id = $1 and o.ended_at is not null)`, [g.user_id]);
        await db.query('update outside_reviewers set ended_at = null where user_id = $1', [g.user_id]);
      }
      await ctx.audit(req, {
        action: 'outside_review.change', recordType: kind.type, recordId: subject.id,
        summary: `Outside reviewer ${g.display_name}'s access to ${subject.ref ?? kind.kind.toLowerCase()} now ends on ${expiresOn}`,
        before: { grant_id: g.id, expires_on: g.expires_on, note: g.note }, after: { expires_on: expiresOn, note },
      });
      await access.endIfIdle(g.user_id, req);
      return presentGrant((await access.grant(g.id))!);
    });
    ctx.describeRoute({
      method: 'PATCH', path: `${base}/:grantId`, tag, permission: `${kind.module}.edit`,
      summary: 'Change the end date (or note) of an outside reviewer\'s access',
      description: 'Sending `If-Match` (or `updated_at`) with the version read refuses with 409 `version_conflict` when it changed meanwhile. Audited.',
      body: '{ expires_on: YYYY-MM-DD, note?, updated_at? }', response: GRANT_SHAPE,
    });

    app.post(`${base}/:grantId/revoke`, edit, async (req) => {
      const { subject, g } = await needGrant(req);
      const done = await db.one('update outside_review_grants set revoked_at = now(), revoked_by = $2, updated_at = now(), updated_by = $2 where id = $1 and revoked_at is null returning id', [g.id, req.user!.id]);
      if (done) {
        await ctx.audit(req, {
          action: 'outside_review.revoke', recordType: kind.type, recordId: subject.id,
          summary: `Outside reviewer ${g.display_name}'s access to ${subject.ref ?? kind.kind.toLowerCase()} revoked`, before: { grant_id: g.id, expires_on: g.expires_on },
        });
      }
      await access.endIfIdle(g.user_id, req);
      return presentGrant((await access.grant(g.id))!);
    });
    ctx.describeRoute({
      method: 'POST', path: `${base}/:grantId/revoke`, tag, permission: `${kind.module}.edit`,
      summary: 'Revoke an outside reviewer\'s access now; with no other review open to them, their sessions end and the account is disabled',
      response: GRANT_SHAPE,
    });

    app.post(`${base}/:grantId/resend`, edit, async (req) => {
      const { subject, g } = await needGrant(req);
      if (stateOf(g) !== 'active') ctx.fail(409, 'not_active', 'This invitation has ended. Change its end date or invite the reviewer again.');
      if (!(await ctx.app.mailEnabled())) ctx.fail(409, 'email_off', 'Email is not set up, so nothing can be sent. Ask an administrator to set up email.');
      if (await resends.blocked(g.id)) ctx.fail(429, 'rate_limited', 'The invitation has been sent again 5 times today. Try again tomorrow.');
      await resends.hit(g.id);
      const sent = await access.tell(req, g.user_id, kind, subject.ref, g.expires_on, true);
      await ctx.audit(req, {
        action: 'outside_review.resend', recordType: kind.type, recordId: subject.id,
        summary: `Invitation to ${subject.ref ?? kind.kind.toLowerCase()} emailed again to ${g.email}${sent.link ? ' with a new set-up link (earlier links stop working)' : ''}`,
        after: { grant_id: g.id },
      });
      return { ok: true, setup_link: sent.link };
    });
    ctx.describeRoute({
      method: 'POST', path: `${base}/:grantId/resend`, tag, permission: `${kind.module}.edit`,
      summary: 'Email the invitation again; a reviewer who has not set a password yet gets a new set-up link (earlier links stop working)',
      description: 'At most 5 times a day for one invitation. Email must be on. Audited.', response: '{ ok, setup_link }',
    });
  }

  // ---------- administrators ----------

  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  app.get('/api/admin/outside-reviewers', admin, async () => {
    const today = todayInZone();
    const kinds = activeKinds(ctx);
    const rows = kinds.length ? await access.grants('g.subject_type = any($1::text[])', [kinds.map((k) => k.type)]) : [];
    const heads = new Map<string, { ref: string | null; title: string } | null>();
    for (const g of rows) {
      const key = `${g.subject_type}:${g.subject_id}`;
      if (!heads.has(key)) heads.set(key, await kindOf(ctx, g.subject_type)!.head(ctx, g.subject_id));
    }
    return {
      today,
      rows: rows.map((g) => {
        const kind = kindOf(ctx, g.subject_type)!;
        const head = heads.get(`${g.subject_type}:${g.subject_id}`);
        return {
          ...presentGrant(g, today), kind: kind.kind, subject_ref: head?.ref ?? null, subject_title: head?.title ?? null,
          subject_route: head ? `${kind.route}/${g.subject_id}` : null,
        };
      }),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/outside-reviewers', tag: 'Administration', permission: 'admin.administer',
    summary: 'Every outside reviewer invitation, with the engagement or review it opens (kinds whose area is switched off are left out)',
    response: `{ today, rows: [${GRANT_SHAPE} & { kind, subject_ref, subject_title, subject_route }] }`,
  });

  app.post('/api/admin/outside-reviewers/:grantId/revoke', admin, async (req) => {
    const gid = param(req, 'grantId');
    const g = gid ? await access.grant(gid) : undefined;
    const kind = g ? kindOf(ctx, g.subject_type) : undefined;
    if (!g || !kind) ctx.fail(404, 'not_found', 'Invitation not found.');
    const done = await db.one('update outside_review_grants set revoked_at = now(), revoked_by = $2, updated_at = now(), updated_by = $2 where id = $1 and revoked_at is null returning id', [g!.id, req.user!.id]);
    if (done) {
      await ctx.audit(req, {
        action: 'outside_review.revoke', recordType: kind!.type, recordId: g!.subject_id,
        summary: `Outside reviewer ${g!.display_name}'s access revoked by an administrator`, before: { grant_id: g!.id, expires_on: g!.expires_on },
      });
    }
    await access.endIfIdle(g!.user_id, req);
    return presentGrant((await access.grant(g!.id))!);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/admin/outside-reviewers/:grantId/revoke', tag: 'Administration', permission: 'admin.administer',
    summary: 'Revoke any outside reviewer\'s access now', response: GRANT_SHAPE,
  });

  // ---------- the reviewer ----------

  /** One of the caller's own invitations, running today, on a kind that is on, with its record still there. */
  async function needOwnGrant(req: FastifyRequest): Promise<{ g: Row; kind: SubjectKind }> {
    const gid = param(req, 'grantId');
    const g = gid && (await isReviewer(req.user!.id))
      ? await db.one<Row>(`select g.*, g.expires_on::text as expires_on from outside_review_grants g where g.id = $1 and g.user_id = $2 and ${activeSql('g', '$3')}`,
        [gid, req.user!.id, todayInZone()])
      : undefined;
    const kind = g ? kindOf(ctx, g.subject_type) : undefined;
    if (!g || !kind || !(await kind.head(ctx, g.subject_id))) ctx.fail(404, 'not_found', 'This review is not open to you. Your access may have ended.');
    return { g: g!, kind: kind! };
  }

  app.get('/api/outside-review', async (req) => {
    const today = todayInZone();
    if (!(await isReviewer(req.user!.id))) return { reviewer: false, today, reviews: [] };
    const rows = await db.query<Row>(
      `select g.*, g.expires_on::text as expires_on from outside_review_grants g where g.user_id = $1 order by g.expires_on desc, g.created_at desc`, [req.user!.id]);
    const reviews = [];
    for (const g of rows) {
      const kind = kindOf(ctx, g.subject_type);
      if (!kind) continue;
      const state = stateOf(g, today);
      // An ended review is named by its reference only.
      const head = await kind.head(ctx, g.subject_id);
      if (!head) continue;
      reviews.push({
        id: g.id, kind: kind.kind, state, expires_on: g.expires_on, ref: head.ref, title: state === 'active' ? head.title : null,
        days_left: state === 'active' ? daysBetween(today, g.expires_on) : null,
      });
    }
    return { reviewer: true, today, reviews };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/outside-review', tag: 'Outside review',
    summary: 'For an outside reviewer: the engagements and reviews they were invited to, and whether each is still open to them',
    description: 'Needs only a session. Anyone else gets `reviewer: false` and no reviews. An ended review is named by its reference only.',
    response: '{ reviewer, today, reviews: [{ id, kind, state: active | expired | revoked, expires_on, ref, title, days_left }] }',
  });

  app.get('/api/outside-review/:grantId', async (req) => {
    const { g, kind } = await needOwnGrant(req);
    const ws = await kind.workspace(ctx, g.subject_id);
    if (!ws) ctx.fail(404, 'not_found', 'This review is not open to you. Your access may have ended.');
    // Opening is recorded on the invitation, and in the audit log at most once an hour.
    const opened = await db.one<Row>(
      `update outside_review_grants set last_opened_at = now() where id = $1 returning (coalesce($2::timestamptz, 'epoch') < now() - interval '1 hour') as log`,
      [g.id, g.last_opened_at ?? null]);
    if (opened?.log) {
      await ctx.audit(req, {
        action: 'outside_review.open', recordType: kind.type, recordId: g.subject_id,
        summary: `Outside reviewer ${req.user!.displayName} opened ${ws.subject.ref ?? kind.kind.toLowerCase()}`, after: { grant_id: g.id },
      });
    }
    const today = todayInZone();
    return { grant: { id: g.id, expires_on: g.expires_on, days_left: daysBetween(today, g.expires_on) }, today, ...ws };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/outside-review/:grantId', tag: 'Outside review',
    summary: 'For an outside reviewer: one engagement or review they may open, with its requests, evidence files and findings',
    description: 'Needs only a session, and only the reviewer it was given to, while it runs. Anything else answers 404. Audited at most once an hour.',
    response: '{ grant: { id, expires_on, days_left }, today, subject: { type, kind, ref, title, facts, sections }, requests: [...], findings: [...], files: [...], evidence: [{ id, ref, title, part, part_label, relation, valid_until, period, files }] (library evidence linked to it, not restricted, E45-59), labels }',
  });

  app.get('/api/outside-review/:grantId/files/:fileId', { onSend: sandboxDownload }, async (req, reply) => {
    const { g, kind } = await needOwnGrant(req);
    const fid = param(req, 'fileId');
    const files = fid ? await filesOf(ctx, await kind.fileScope(ctx, g.subject_id)) : [];
    const att = files.find((f) => f.id === fid);
    if (!att) ctx.fail(404, 'not_found', 'File not found.');
    if (isLink(att!)) ctx.fail(409, 'is_link', 'This is a link to a document kept elsewhere. Open its address instead.');
    return sendStoredFile(ctx, reply, att!, async (code, message, reason) => {
      await ctx.audit(req, {
        action: 'attachment.integrity_failure', recordType: att!.record_type, recordId: att!.record_id,
        summary: `File could not be served to an outside reviewer: ${att!.file_name} (${reason})`, after: { attachment_id: att!.id },
      });
      return ctx.fail(500, code, message);
    }, async () => {
      await ctx.audit(req, {
        action: 'outside_review.download', recordType: kind.type, recordId: g.subject_id,
        summary: `Outside reviewer ${req.user!.displayName} downloaded ${att!.file_name}`, after: { grant_id: g.id, attachment_id: att!.id, record_type: att!.record_type, record_id: att!.record_id },
      });
    });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/outside-review/:grantId/files/:fileId', tag: 'Outside review',
    summary: 'For an outside reviewer: download one evidence file of an engagement or review open to them',
    description: 'Only files on its evidence requests, evidence files on the record itself, and the files of evidence library records linked to it that are not restricted (E45-59). Every download is audited on the record.',
  });
}
