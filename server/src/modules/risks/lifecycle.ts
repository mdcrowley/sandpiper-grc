import type { FastifyReply, FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { displayDate } from '../../core/timezone.ts';
import type { Scales } from './scales.ts';

// What happens to a risk over time: an acceptance is revoked or expires, a review falls due and
// is completed, and the board asks for a report. Every route here needs security.view as well as
// the risks permission, because risks are restricted records.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(v));

export const SETTING_ACCEPTANCE_REMINDER_DAYS = 'risks.acceptance_reminder_days';
const HOUR = 3_600_000;

export interface LifecycleDeps {
  scales: Scales;
  riskPre: (action: string) => ((req: FastifyRequest, reply: FastifyReply) => Promise<void>)[];
  visibleRisk: (req: FastifyRequest) => Promise<Row>;
  statusesWith: (list: string, flag: string) => Promise<string[]>;
  today: () => Promise<string>;
}

export function makeLifecycle(ctx: ModuleContext, deps: LifecycleDeps) {
  const { db } = ctx;
  const { scales, riskPre, visibleRisk, statusesWith, today } = deps;
  const notify = async (input: Parameters<typeof ctx.app.notify>[0]) =>
    (ctx.app.hasDecorator('notify') ? ctx.app.notify(input) : { sent: 0, skipped: 0 });
  const text = (b: Row, k: string) => String(b[k] ?? '').trim();

  /** True while a risk has an acceptance that is neither revoked nor expired. */
  const hasCurrentAcceptance = async (riskId: string) => Boolean(await db.one(
    'select 1 from risk_acceptances where risk_id = $1 and revoked_on is null and expires_on >= current_date', [riskId]));

  /** Label and color of a rating on its own scale. */
  async function rater() {
    const all = await scales.all();
    return (scaleKey: unknown, ratingKey: unknown) => {
      const r = all.find((s) => s.key === scaleKey)?.ratings.find((x) => x.key === ratingKey);
      return { label: r?.label ?? (ratingKey as string | null) ?? null, color: r?.color ?? 'gray' };
    };
  }

  // ------------------------------------------------------------------ the daily check

  /**
   * Run daily (and on demand). Safe to repeat: each step changes or tells only once.
   *  1. A risk shown as accepted with no current acceptance moves to the "needs review" status.
   *  2. The owner is told once when an acceptance comes within the reminder window.
   *  3. The owner is told once when a risk's review date arrives.
   */
  async function runChecks(): Promise<{ expired: number; expiring: number; reviews: number }> {
    const result = { expired: 0, expiring: 0, reviews: 0 };
    const closed = await statusesWith('risk_status', 'closed');
    const needsReview = (await statusesWith('risk_status', 'needs_review'))[0] ?? 'open';

    const lapsed = await db.query<Row>(
      `select r.id, r.ref, r.title, r.owner_id,
              (select max(a.expires_on)::text from risk_acceptances a where a.risk_id = r.id and a.revoked_on is null) as expired_on
       from risks r
       where r.deleted_at is null and r.status = 'accepted'
         and not exists (select 1 from risk_acceptances a where a.risk_id = r.id and a.revoked_on is null and a.expires_on >= current_date)`);
    for (const r of lapsed) {
      await ctx.resources.update('risk', r.id, { status: needsReview });
      await ctx.audit(null, {
        action: 'risk.acceptance_expired', recordType: 'risk', recordId: r.id,
        summary: `Acceptance of ${r.ref} expired${r.expired_on ? ` on ${r.expired_on}` : ''}: the risk needs review`,
        before: { status: 'accepted' }, after: { status: needsReview },
      });
      await notify({
        userIds: [r.owner_id], permission: r.owner_id ? undefined : 'risks.approve', kind: 'reminder',
        title: `Acceptance expired: ${r.ref} ${r.title}`,
        body: 'The risk is no longer accepted. Review it, then renew the acceptance or change its treatment.',
        recordType: 'risk', recordId: r.id,
      });
      result.expired += 1;
    }

    const days = Math.min(365, Math.max(0, Math.round(Number(await ctx.settings.get<unknown>(SETTING_ACCEPTANCE_REMINDER_DAYS, 30))) || 0));
    const soon = await db.query<Row>(
      `select a.id, a.expires_on::text as expires_on, (a.expires_on - current_date)::int as days_left, r.id as risk_id, r.ref, r.title, r.owner_id
       from risks r
       join lateral (select * from risk_acceptances x where x.risk_id = r.id and x.revoked_on is null
                     order by x.approved_on desc, x.created_at desc limit 1) a on true
       where r.deleted_at is null and r.status = 'accepted' and a.expiry_reminded_at is null
         and a.expires_on >= current_date and a.expires_on <= current_date + $1::int`, [days]);
    for (const a of soon) {
      // Claimed first (BS-7): of two runs at once, only the one whose write lands sends it.
      if (!(await db.one('update risk_acceptances set expiry_reminded_at = now() where id = $1 and expiry_reminded_at is null returning id', [a.id]))) continue;
      const sent = await notify({
        userIds: [a.owner_id], permission: a.owner_id ? undefined : 'risks.approve', kind: 'reminder',
        title: `Acceptance expires in ${a.days_left} ${a.days_left === 1 ? 'day' : 'days'}: ${a.ref} ${a.title}`,
        body: `It expires on ${displayDate(a.expires_on)}. Review the risk and renew the acceptance if it still stands.`,
        recordType: 'risk', recordId: a.risk_id,
      });
      if (sent.sent > 0) result.expiring += 1;
      else await db.query('update risk_acceptances set expiry_reminded_at = null where id = $1', [a.id]); // nobody received it: the next run tries again
    }

    const due = await db.query<Row>(
      `select id, ref, title, owner_id, review_on::text as review_on from risks
       where deleted_at is null and owner_id is not null and review_on <= current_date
         and review_reminded_for is distinct from review_on and not (coalesce(status, '') = any($1::text[]))`, [closed]);
    for (const r of due) {
      // Claimed first (BS-7), as above; released when nobody received it.
      const claimed = await db.one<{ was: string | null }>(
        `update risks x set review_reminded_for = x.review_on from (select id, review_reminded_for as was from risks where id = $1) old
         where x.id = old.id and x.review_reminded_for is distinct from x.review_on returning old.was::text as was`, [r.id]);
      if (!claimed) continue;
      const sent = await notify({
        userIds: [r.owner_id], kind: 'reminder', title: `Risk review due: ${r.ref} ${r.title}`,
        body: `The review date was ${displayDate(r.review_on)}. Open the risk and select "Complete review".`,
        recordType: 'risk', recordId: r.id,
      });
      if (sent.sent > 0) result.reviews += 1;
      else await db.query('update risks set review_reminded_for = $2::date where id = $1', [r.id, claimed.was]);
    }
    return result;
  }

  async function register(): Promise<void> {
    const { app } = ctx;

    app.post('/api/risks/checks/run', { preHandler: riskPre('administer') }, async () => runChecks());

    // Several times a day on the job queue (Administration > Background jobs); each reminder still goes out once.
    await scheduleWork(ctx, 'risks.lifecycle', () => runChecks(), { every: 6 * HOUR, firstRunInMs: 90_000 });

    // ---------------------------------------------------------------- revoke an acceptance

    app.post('/api/risks/:id/acceptances/:acceptanceId/revoke', { preHandler: riskPre('approve') }, async (req) => {
      const risk = await visibleRisk(req);
      const b = (req.body ?? {}) as Row;
      const acceptanceId = (req.params as { acceptanceId: string }).acceptanceId;
      const acceptance = /^[0-9a-f-]{36}$/i.test(acceptanceId)
        ? await db.one<Row>(`select *, approved_on::text as approved_text from risk_acceptances where id = $1 and risk_id = $2`, [acceptanceId, risk.id])
        : undefined;
      if (!acceptance) return ctx.fail(404, 'not_found', 'Acceptance not found.');
      if (acceptance.revoked_on) ctx.fail(400, 'already_revoked', 'This acceptance has already been revoked.');

      const now = await today();
      const revokedOn = text(b, 'revoked_on') || now;
      const errors: Record<string, string> = {};
      if (!text(b, 'reason')) errors.reason = 'Say why the acceptance is being revoked.';
      if (!validDate(revokedOn)) errors.revoked_on = 'Revoked on must be a date (YYYY-MM-DD).';
      else if (revokedOn > now) errors.revoked_on = 'The revocation date cannot be in the future.';
      else if (revokedOn < acceptance.approved_text) errors.revoked_on = 'The revocation date cannot be before the approval date.';
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

      const row = (await db.one<Row>(
        `update risk_acceptances set revoked_on = $2, revoked_by = $3, revoked_reason = $4 where id = $1 returning *`,
        [acceptance.id, revokedOn, req.user!.id, text(b, 'reason')]))!;
      await ctx.audit(req, {
        action: 'risk.acceptance_revoke', recordType: 'risk', recordId: risk.id,
        summary: `Risk acceptance revoked for ${risk.ref}: ${text(b, 'reason').slice(0, 160)}`,
        before: { revoked_on: null }, after: { acceptance_id: row.id, revoked_on: revokedOn, revoked_reason: row.revoked_reason },
      });
      // The risk stops being "accepted" unless another acceptance still stands.
      if (risk.status === 'accepted' && !(await hasCurrentAcceptance(risk.id))) {
        await ctx.resources.update('risk', risk.id, { status: 'open' }, req);
      }
      if (risk.owner_id && risk.owner_id !== req.user!.id) {
        await notify({
          userIds: [risk.owner_id], kind: 'reminder', title: `Acceptance revoked: ${risk.ref} ${risk.title}`,
          body: 'The risk is open again and needs a treatment decision.', recordType: 'risk', recordId: risk.id,
        });
      }
      return row;
    });

    // ---------------------------------------------------------------- reviews

    app.get('/api/risks/reviews-due', { preHandler: riskPre('view') }, async (req) => {
      const days = Math.min(3650, Math.max(0, Number((req.query as Row).days ?? 30) || 0));
      const closed = await statusesWith('risk_status', 'closed');
      const rate = await rater();
      const rows = await db.query<Row>(
        `select r.id, r.ref, r.title, r.status, r.scale_key, r.owner_id, u.display_name as owner_name,
                r.review_on::text as review_on, r.last_reviewed_on::text as last_reviewed_on,
                (r.review_on - current_date)::int as days_left, r.review_on < current_date as overdue,
                coalesce(r.residual_rating, r.inherent_rating) as rating
         from risks r left join users u on u.id = r.owner_id
         where r.deleted_at is null and not (coalesce(r.status, '') = any($1::text[])) and r.review_on <= current_date + $2::int
         order by r.review_on, r.ref`, [closed, days]);
      return rows.map((r) => ({ ...r, rating_label: rate(r.scale_key, r.rating).label, color: rate(r.scale_key, r.rating).color }));
    });

    app.get('/api/risks/:id/reviews', { preHandler: riskPre('view') }, async (req) => {
      const risk = await visibleRisk(req);
      const rate = await rater();
      const rows = await db.query<Row>(
        `select v.id, v.reviewed_on::text as reviewed_on, v.note, v.next_review_on::text as next_review_on,
                v.inherent_rating, v.residual_rating, v.status, u.display_name as reviewed_by
         from risk_reviews v left join users u on u.id = v.created_by
         where v.risk_id = $1 order by v.reviewed_on desc, v.created_at desc`, [risk.id]);
      return rows.map((v) => ({
        ...v,
        inherent_label: rate(risk.scale_key, v.inherent_rating).label, inherent_color: rate(risk.scale_key, v.inherent_rating).color,
        residual_label: rate(risk.scale_key, v.residual_rating).label, residual_color: rate(risk.scale_key, v.residual_rating).color,
      }));
    });

    app.post('/api/risks/:id/reviews', { preHandler: riskPre('edit') }, async (req, reply) => {
      const risk = await visibleRisk(req);
      const b = (req.body ?? {}) as Row;
      const now = await today();
      const reviewedOn = text(b, 'reviewed_on') || now;
      const next = text(b, 'next_review_on');
      const errors: Record<string, string> = {};
      if (!validDate(reviewedOn)) errors.reviewed_on = 'Reviewed on must be a date (YYYY-MM-DD).';
      else if (reviewedOn > now) errors.reviewed_on = 'The review date cannot be in the future.';
      if (!validDate(next)) errors.next_review_on = 'Give the date of the next review (YYYY-MM-DD).';
      else if (next <= reviewedOn) errors.next_review_on = 'The next review must be after this one.';
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

      const row = (await db.one<Row>(
        `insert into risk_reviews (risk_id, reviewed_on, note, next_review_on, inherent_rating, inherent_score, residual_rating, residual_score, summary_level, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [risk.id, reviewedOn, text(b, 'note') || null, next, risk.inherent_rating, risk.inherent_score, risk.residual_rating,
          risk.residual_score, risk.summary_level, risk.status, req.user!.id]))!;
      await db.query('update risks set last_reviewed_on = $2 where id = $1', [risk.id, reviewedOn]);
      await ctx.audit(req, {
        action: 'risk.review', recordType: 'risk', recordId: risk.id,
        summary: `Review of ${risk.ref} completed; next review ${next}`,
        before: { last_reviewed_on: risk.last_reviewed_on ?? null }, after: { last_reviewed_on: reviewedOn, note: row.note },
      });
      if (next !== risk.review_on) await ctx.resources.update('risk', risk.id, { review_on: next }, req);
      reply.code(201);
      return row;
    });

    // ---------------------------------------------------------------- the board report

    app.get('/api/risks/report', { preHandler: riskPre('view') }, async (req) => {
      const q = req.query as Row;
      const top = Math.min(50, Math.max(1, Number(q.top ?? 10) || 10));
      const window = Math.min(3650, Math.max(0, Number(q.days ?? 90) || 0));
      const closed = await statusesWith('risk_status', 'closed');
      const rate = await rater();
      const levels = await ctx.lookups.values('risk_summary_level');
      const lookupLabel = async (list: string) => new Map((await ctx.lookups.values(list)).map((v) => [v.value, v]));
      const [statuses, treatments, categories] = [await lookupLabel('risk_status'), await lookupLabel('risk_treatment'), await lookupLabel('risk_category')];

      const risks = await db.query<Row>(
        `select r.id, r.ref, r.title, r.scale_key, r.category, r.status, r.treatment, r.summary_level, r.owner_id, u.display_name as owner_name,
                r.inherent_rating, r.inherent_score, r.residual_rating, r.residual_score,
                coalesce(r.residual_score, r.inherent_score) as score, coalesce(r.residual_rating, r.inherent_rating) as rating,
                r.review_on::text as review_on, r.last_reviewed_on::text as last_reviewed_on, r.review_on < current_date as review_overdue
         from risks r left join users u on u.id = r.owner_id
         where r.deleted_at is null and not (coalesce(r.status, '') = any($1::text[]))
         order by score desc nulls last, r.created_at`, [closed]);
      const reviews = await db.query<Row>(
        `select risk_id, reviewed_on::text as reviewed_on, coalesce(residual_score, inherent_score) as score, coalesce(residual_rating, inherent_rating) as rating
         from risk_reviews order by reviewed_on desc, created_at desc`);

      // Follow-up work per risk, for people who may see actions (the caller holds security.view, so restricted ones count).
      const actionCounts = new Map<string, { open: number; overdue: number }>();
      if (ctx.can(req.user, 'actions.view')) {
        const closedActions = await statusesWith('action_status', 'closed');
        for (const a of await db.query<Row>(
          `select source_id::text as id, count(*)::int as open, count(*) filter (where due_on < current_date)::int as overdue
           from actions where deleted_at is null and source_type = 'risk' and not (coalesce(status, '') = any($1::text[])) group by 1`, [closedActions])) {
          actionCounts.set(a.id, { open: a.open, overdue: a.overdue });
        }
      }

      const shaped = risks.map((r) => {
        // Movement: the rating now against the rating recorded at the last review; when nothing
        // has changed since that review, against the review before it.
        const mine = reviews.filter((v) => v.risk_id === r.id);
        const baseline = mine.find((v, i) => i > 0 || v.score !== r.score) ?? null;
        const direction = !baseline || baseline.score === null || r.score === null ? 'none'
          : r.score > baseline.score ? 'up' : r.score < baseline.score ? 'down' : 'same';
        return {
          id: r.id, ref: r.ref, title: r.title, score: r.score, status: r.status, status_label: statuses.get(r.status)?.label ?? r.status,
          status_color: statuses.get(r.status)?.color ?? 'gray',
          category_label: categories.get(r.category)?.label ?? r.category, treatment_label: treatments.get(r.treatment)?.label ?? r.treatment,
          owner_name: r.owner_name, summary_level: r.summary_level,
          inherent_label: rate(r.scale_key, r.inherent_rating).label, inherent_color: rate(r.scale_key, r.inherent_rating).color,
          residual_label: rate(r.scale_key, r.residual_rating).label, residual_color: rate(r.scale_key, r.residual_rating).color,
          rating_label: rate(r.scale_key, r.rating).label, color: rate(r.scale_key, r.rating).color,
          review_on: r.review_on, last_reviewed_on: r.last_reviewed_on, review_overdue: r.review_overdue === true,
          movement: direction, previous_label: baseline ? rate(r.scale_key, baseline.rating).label : null,
          previous_color: baseline ? rate(r.scale_key, baseline.rating).color : 'gray', previous_on: baseline?.reviewed_on ?? null,
          actions: actionCounts.get(r.id) ?? (ctx.can(req.user, 'actions.view') ? { open: 0, overdue: 0 } : null),
        };
      });

      const acceptances = await db.query<Row>(
        `select a.id, a.risk_id, r.ref, r.title, r.status, r.scale_key, coalesce(r.residual_rating, r.inherent_rating) as rating,
                a.approver_name, a.approver_title, a.approved_on::text as approved_on, a.expires_on::text as expires_on,
                (a.expires_on - current_date)::int as days_left, a.expires_on < current_date as expired
         from risks r
         join lateral (select * from risk_acceptances x where x.risk_id = r.id and x.revoked_on is null
                       order by x.approved_on desc, x.created_at desc limit 1) a on true
         where r.deleted_at is null and (r.status = 'accepted' or r.status = any($2::text[])) and a.expires_on <= current_date + $1::int
         order by a.expires_on, r.ref`, [window, await statusesWith('risk_status', 'needs_review')]);

      return {
        generated_on: await today(), window_days: window,
        total: shaped.length,
        unscored: shaped.filter((r) => r.score === null).length,
        // E18-88: scored on the inherent rating only, so "all scored" is not claimed for them.
        no_residual: risks.filter((r) => r.score !== null && r.residual_score === null).length,
        accepted: shaped.filter((r) => r.status === 'accepted').length,
        reviews_overdue: shaped.filter((r) => r.review_overdue).length,
        levels: levels.map((lv) => ({ value: lv.value, label: lv.label, color: lv.color ?? 'gray', count: shaped.filter((r) => r.summary_level === lv.value).length })),
        top: shaped.filter((r) => r.score !== null).slice(0, top),
        increased: shaped.filter((r) => r.movement === 'up'),
        decreased: shaped.filter((r) => r.movement === 'down'),
        unchanged: shaped.filter((r) => r.movement === 'same').length,
        not_reviewed: shaped.filter((r) => r.movement === 'none').length,
        acceptances: acceptances.map((a) => ({ ...a, rating_label: rate(a.scale_key, a.rating).label, color: rate(a.scale_key, a.rating).color })),
      };
    });
  }

  return { register, runChecks, hasCurrentAcceptance };
}
