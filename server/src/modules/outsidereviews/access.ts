// Outside reviewer accounts and their invitations (E41-09).
//
// An invitation names one engagement or review, a person's email address and an end date. The
// first invitation of an address creates an account for it (no roles, waiting for its password)
// and marks it as an outside reviewer's for good; the set-up link goes to that address by email
// only, sealed in the queued message like every set-up link, so nobody in the organization ever
// sees it. A later invitation of the same address reuses the account. An address that belongs to
// a staff account is refused: staff get access through roles. The account then signs in like any
// other, under the same password, lockout, session and second-factor rules.
//
// Access ends at the end of the invitation's end date (the organization's date) or when it is
// revoked. When an account has no invitation left running its sessions end and the account is
// disabled (at once on revoking, and by the job `outsidereviews.expire`); a new invitation turns
// it back on, unless an administrator disabled it.
import type { FastifyRequest } from 'fastify';
import { randomToken, sha256 } from '../../core/auth.ts';
import { ensureMail } from '../../core/mail/index.ts';
import { expiresText } from '../../core/mail/links.ts';
import { EMAIL_RE } from '../../core/mail/service.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { organizationName, readOrganization } from '../../core/organization.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import type { SubjectKind } from './subjects.ts';

/** The furthest end date an invitation may have, in days from today. */
export const MAX_DAYS = 366;
/** How long the emailed set-up link works. */
export const SETUP_LINK_DAYS = 7;

export type GrantState = 'active' | 'expired' | 'revoked';

/** Active through the end of `expires_on` (the organization's date), until revoked. */
export const stateOf = (g: Row, today = todayInZone()): GrantState =>
  g.revoked_at ? 'revoked' : String(g.expires_on).slice(0, 10) < today ? 'expired' : 'active';

/** SQL for "this grant (alias g) is running today ($n = today)". */
export const activeSql = (alias: string, todayParam: string) => `(${alias}.revoked_at is null and ${alias}.expires_on >= ${todayParam}::date)`;

const GRANT_SELECT = `
  select g.*, g.expires_on::text as expires_on, u.username, u.email, u.display_name, u.status as account_status,
    (u.password_hash is not null) as has_password, o.organization, o.ended_at, ib.display_name as invited_by_name
  from outside_review_grants g
  join users u on u.id = g.user_id
  join outside_reviewers o on o.user_id = g.user_id
  left join users ib on ib.id = g.created_by`;

/** What staff see of one invitation. Never the set-up link. */
export function presentGrant(g: Row, today = todayInZone()) {
  return {
    id: g.id, subject_type: g.subject_type, subject_id: g.subject_id, user_id: g.user_id,
    name: g.display_name, email: g.email, username: g.username, organization: g.organization ?? null,
    expires_on: g.expires_on, note: g.note ?? null, state: stateOf(g, today),
    // The person has not set their password yet (the set-up link can be sent again).
    waiting_for_setup: !g.has_password && g.account_status !== 'disabled',
    account_disabled: g.account_status === 'disabled',
    invited_by_name: g.invited_by_name ?? null, invited_at: g.created_at, revoked_at: g.revoked_at ?? null,
    last_opened_at: g.last_opened_at ?? null, updated_at: g.updated_at,
  };
}

export function makeAccess(ctx: ModuleContext) {
  const { db } = ctx;

  const grants = (where: string, params: unknown[]) => db.query<Row>(`${GRANT_SELECT} where ${where} order by g.created_at desc, g.id`, params);
  const grant = async (id: string) => (await grants('g.id = $1', [id]))[0];

  /** A username for a new account, from the address: letters, digits, dots, dashes; unique. */
  async function freeUsername(email: string): Promise<string> {
    let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/^[._-]+|[._-]+$/g, '').slice(0, 50);
    if (base.length < 3) base = `reviewer.${base}`.replace(/\.$/, '');
    for (let n = 1; n < 1000; n += 1) {
      const name = n === 1 ? base : `${base}${n}`;
      if (!(await db.one('select 1 from users where lower(username) = lower($1) and deleted_at is null', [name]))) return name;
    }
    return `${base}.${randomToken().slice(0, 6).toLowerCase()}`;
  }

  const organization = async () => organizationName(await readOrganization(db));

  /** Emails the person: with a sealed set-up link when they have no password yet, else a notice. */
  async function tell(req: FastifyRequest, userId: string, kind: SubjectKind, ref: string | null, expiresOn: string, again = false) {
    const mail = await ensureMail(ctx);
    const u = (await db.one<Row>('select id, username, email, display_name, password_hash is not null as has_password from users where id = $1', [userId]))!;
    const org = await organization();
    const what = `${kind.kind.toLowerCase()}${ref ? ` ${ref}` : ''}`;
    const until = `It is open to you until the end of ${expiresOn}.`;
    // Only the reference is named: the title may say more than the organization wants in an email.
    if (!u.has_password) {
      const token = randomToken();
      await db.query('update one_time_tokens set used_at = now() where user_id = $1 and used_at is null', [u.id]);
      const row = await db.one<{ expires_at: string }>(
        `insert into one_time_tokens (token_hash, user_id, purpose, expires_at, created_by)
         values ($1, $2, 'setup', now() + make_interval(days => $3::int), $4) returning expires_at`,
        [sha256(token), u.id, SETUP_LINK_DAYS, req.user!.id]);
      await mail.queueOne({
        template: 'message', purpose: 'outside_review',
        data: {
          subject: `${org}: you are invited to review ${what}`,
          message: [
            `${org} has invited you to review ${what}: its requests, the evidence provided and its findings. ${until}`,
            `An account has been made for you. Your username is ${u.username}. Set your password with the link below. It works once and expires ${expiresText(row!.expires_at)}.`,
            'The link is meant for you: please do not forward it. If you were not expecting this message, you can ignore it.',
          ].join('\n\n'),
          link: `/redeem?token=${token}`,
        },
      }, { userId: u.id, to: u.email }, { accountLink: true }, { maxAttempts: 3 });
      return { link: true };
    }
    await mail.queueOne({
      template: 'message', purpose: 'outside_review',
      data: {
        subject: `${org}: ${again ? 'your access to' : 'you are invited to review'} ${what}`,
        message: `${org} has ${again ? 'given you access to' : 'invited you to review'} ${what}. ${until} Sign in with your username ${u.username} to open it.`,
        link: '/',
      },
    }, { userId: u.id, to: u.email }, {}, { maxAttempts: 3 });
    return { link: false };
  }

  /** Ends an account's access when no invitation of it is running: sessions end and it is disabled. */
  async function endIfIdle(userId: string, req: FastifyRequest | null) {
    const today = todayInZone();
    const running = await db.one(`select 1 from outside_review_grants g where g.user_id = $1 and ${activeSql('g', '$2')}`, [userId, today]);
    if (running) return false;
    const u = await db.one<Row>(`update users set status = 'disabled', updated_at = now() where id = $1 and status <> 'disabled' and deleted_at is null returning username`, [userId]);
    await db.query('delete from sessions where user_id = $1', [userId]);
    await db.query('update one_time_tokens set used_at = now() where user_id = $1 and used_at is null', [userId]);
    if (!u) return false;
    await db.query('update outside_reviewers set ended_at = now() where user_id = $1', [userId]);
    await ctx.audit(req, {
      action: 'outside_review.account_end', recordType: 'user', recordId: userId,
      summary: `Outside reviewer account ${u.username} disabled: no review is open to it any more`,
    });
    return true;
  }

  /** Daily (and every few hours): accounts whose last invitation ended are disabled. */
  async function sweep(): Promise<{ disabled: number; rolesRemoved: number }> {
    // A role given to a reviewer account by mistake is taken off: the account works without one, and a
    // role would make it a recipient of notifications and email about records.
    const withRoles = await db.query<{ user_id: string; username: string; roles: string[] }>(
      `select ur.user_id, u.username, array_agg(r.key order by r.key) as roles from user_roles ur
       join outside_reviewers o on o.user_id = ur.user_id join users u on u.id = ur.user_id join roles r on r.id = ur.role_id
       group by ur.user_id, u.username`);
    for (const r of withRoles) {
      await db.query('delete from user_roles where user_id = $1', [r.user_id]);
      await ctx.audit(null, {
        action: 'outside_review.roles_removed', recordType: 'user', recordId: r.user_id,
        summary: `Roles removed from outside reviewer account ${r.username}: ${r.roles.join(', ')} (these accounts hold no roles)`,
        before: { roles: r.roles }, after: { roles: [] },
      });
    }
    return { ...(await disableIdle()), rolesRemoved: withRoles.length };
  }

  async function disableIdle(): Promise<{ disabled: number }> {
    const idle = await db.query<{ user_id: string }>(
      `select o.user_id from outside_reviewers o join users u on u.id = o.user_id
       where u.status <> 'disabled' and u.deleted_at is null
         and not exists (select 1 from outside_review_grants g where g.user_id = o.user_id and ${activeSql('g', '$1')})`, [todayInZone()]);
    let disabled = 0;
    for (const r of idle) if (await endIfIdle(r.user_id, null)) disabled += 1;
    return { disabled };
  }

  /** Checks an end date: a date from today to MAX_DAYS ahead. */
  function endDate(v: unknown): string {
    const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
    const today = todayInZone();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { expires_on: 'Give the last day the reviewer may open it.' });
    }
    if (s < today) ctx.fail(400, 'validation', 'Check the highlighted fields.', { expires_on: 'The end date cannot be in the past.' });
    if (s > addDays(today, MAX_DAYS)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { expires_on: `Access can run for at most ${MAX_DAYS} days. Invite again later if more time is needed.` });
    return s;
  }

  async function invite(req: FastifyRequest, kind: SubjectKind, subject: { id: string; ref: string | null }, body: Row) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim().slice(0, 200);
    const org = String(body.organization ?? '').trim().slice(0, 200) || null;
    const note = String(body.note ?? '').trim().slice(0, 2000) || null;
    const fields: Record<string, string> = {};
    if (!EMAIL_RE.test(email) || email.length > 254) fields.email = 'Enter the reviewer\'s email address.';
    if (!name) fields.name = 'Enter the reviewer\'s name.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const expiresOn = endDate(body.expires_on);
    if (!(await ctx.app.mailEnabled())) {
      ctx.fail(409, 'email_off', 'Email is not set up, so the invitation cannot be sent. Ask an administrator to set up email (Administration > Email).');
    }

    const existing = await db.one<Row>(
      `select u.id, u.status, u.username, o.user_id as reviewer, o.ended_at from users u left join outside_reviewers o on o.user_id = u.id
       where lower(u.email) = $1 and u.deleted_at is null`, [email]);
    if (existing && !existing.reviewer) {
      ctx.fail(409, 'staff_account', 'This address belongs to an account of your organization. Staff are given access through their roles, not as outside reviewers.');
    }
    if (existing?.status === 'disabled' && !existing.ended_at) {
      ctx.fail(409, 'account_disabled', 'An administrator has disabled this reviewer\'s account. Ask an administrator to enable it first.');
    }
    if (existing && await db.one(
      `select 1 from outside_review_grants g where g.user_id = $1 and g.subject_type = $2 and g.subject_id = $3 and ${activeSql('g', '$4')}`,
      [existing.id, kind.type, subject.id, todayInZone()])) {
      ctx.fail(409, 'already_invited', 'This reviewer already has access to it. Change the end date instead.');
    }

    // Read before the transaction: the embedded database has one connection, which the transaction holds.
    const username = existing ? null : await freeUsername(email);
    const made = await db.tx(async (tx) => {
      let userId = existing?.id as string | undefined;
      let created = false;
      if (!userId) {
        userId = (await tx.one<{ id: string }>(
          `insert into users (username, email, display_name, status, created_by, updated_by) values ($1, $2, $3, 'pending', $4, $4) returning id`,
          [username, email, name, req.user!.id]))!.id;
        await tx.query('insert into outside_reviewers (user_id, organization, created_by) values ($1, $2, $3)', [userId, org, req.user!.id]);
        created = true;
      } else {
        if (existing!.status === 'disabled') {
          // Ended by this module (no review left open), so a new invitation turns it back on.
          await tx.query(
            `update users set status = case when password_hash is null then 'pending' else 'active' end, updated_at = now(), updated_by = $2 where id = $1`,
            [userId, req.user!.id]);
          await tx.query('update outside_reviewers set ended_at = null where user_id = $1', [userId]);
        }
        if (org) await tx.query('update outside_reviewers set organization = $2 where user_id = $1', [userId, org]);
      }
      const g = (await tx.one<{ id: string }>(
        `insert into outside_review_grants (user_id, subject_type, subject_id, expires_on, note, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $6) returning id`,
        [userId, kind.type, subject.id, expiresOn, note, req.user!.id]))!;
      return { userId, grantId: g.id, created };
    });
    const sent = await tell(req, made.userId, kind, subject.ref, expiresOn);
    if (made.created) {
      await ctx.audit(req, {
        action: 'outside_review.account_create', recordType: 'user', recordId: made.userId,
        summary: `Outside reviewer account created for ${email} (no roles; limited to the reviews it is invited to)`,
        after: { email, display_name: name, organization: org },
      });
    }
    await ctx.audit(req, {
      action: 'outside_review.invite', recordType: kind.type, recordId: subject.id,
      summary: `Outside reviewer ${name} <${email}> invited to ${subject.ref ?? kind.kind.toLowerCase()} until ${expiresOn}${sent.link ? '; set-up link emailed' : ''}`,
      after: { grant_id: made.grantId, user_id: made.userId, email, expires_on: expiresOn, organization: org },
    });
    return presentGrant((await grant(made.grantId))!);
  }

  return { grants, grant, invite, tell, endIfIdle, sweep, endDate };
}

export type Access = ReturnType<typeof makeAccess>;
