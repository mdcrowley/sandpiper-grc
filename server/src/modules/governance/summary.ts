import { approvalEngine } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { MINUTES_KIND } from './meetings.ts';
import { MINUTES_AFTER_DAYS } from './reminders.ts';

// Committee and meeting figures (wave 11 contract C5), read by the assistants' `governance_summary`
// tool and open to anyone who may view committee records. Figures only: no meeting titles, no
// names, no decision wording. Every record counts, the same for everyone (docs/security.md):
// decisions about restricted records are counted by their outcome, which is a list value.

const DAY = 86_400_000;

/** Registers the governance summary route. Called from governance/index.ts `register`. */
export function registerGovernanceSummary(ctx: ModuleContext): void {
  const { db } = ctx;

  ctx.app.get('/api/governance/summary', { preHandler: ctx.requirePerm('governance.view') }, async () => {
    const now = new Date();
    const today = dayInZone();
    const since = dayInZone(-365);
    const n = async (sql: string, params: unknown[] = []) => Number((await db.one<Row>(sql, params))?.n ?? 0);

    const committees = await db.one<Row>(
      `select count(*) filter (where coalesce(status, 'active') = 'active')::int as active, count(*)::int as total
       from committees where deleted_at is null`);
    const upcoming = await db.one<Row>(
      `select count(*) filter (where scheduled_at <= $2)::int as next_30, count(*) filter (where scheduled_at <= $3)::int as next_90,
              count(*) filter (where scheduled_at <= $2 and pack_snapshot_id is null)::int as next_30_without_pack
       from meetings where deleted_at is null and status in ('planned', 'agenda_published') and scheduled_at > $1`,
      [now.toISOString(), new Date(now.getTime() + 30 * DAY).toISOString(), new Date(now.getTime() + 90 * DAY).toISOString()]);
    const held12 = await n(
      `select count(*)::int as n from meetings where deleted_at is null and status in ('held', 'minutes_approved') and scheduled_at >= $1::date`, [since]);
    const quorum = await db.one<Row>(
      `select count(*) filter (where quorum_met)::int as met, count(*) filter (where quorum_met = false)::int as not_met
       from meetings where deleted_at is null and status in ('held', 'minutes_approved') and scheduled_at >= $1::date`, [since]);

    // Minutes: a held meeting whose minutes are not approved yet is either waiting for the chair
    // (an approval is running) or waiting to be written up; late once MINUTES_AFTER_DAYS have passed.
    const held = await db.query<Row>(`select id, scheduled_at from meetings where deleted_at is null and status = 'held'`);
    const eng = approvalEngine(ctx.app);
    let awaitingApproval = 0;
    let toWrite = 0;
    let late = 0;
    const lateBefore = now.getTime() - MINUTES_AFTER_DAYS * DAY;
    for (const m of held) {
      if (eng && await eng.running(MINUTES_KIND, m.id)) { awaitingApproval += 1; continue; }
      toWrite += 1;
      if (new Date(m.scheduled_at).getTime() < lateBefore) late += 1;
    }

    const outcomes = await ctx.lookups.values('decision_outcome');
    const counts = await db.query<Row>(
      `select outcome as k, count(*)::int as n, count(*) filter (where created_at >= $1::date)::int as recent
       from meeting_decisions where deleted_at is null group by outcome`, [since]);
    const by_outcome = outcomes.map((o) => {
      const c = counts.find((x) => x.k === o.value);
      return { value: o.value, label: o.label, color: o.color ?? 'gray', count: Number(c?.n ?? 0), last_12_months: Number(c?.recent ?? 0) };
    });

    return {
      today,
      committees: { active: Number(committees?.active ?? 0), total: Number(committees?.total ?? 0) },
      meetings: {
        upcoming_30_days: Number(upcoming?.next_30 ?? 0),
        upcoming_90_days: Number(upcoming?.next_90 ?? 0),
        upcoming_30_days_without_pack: Number(upcoming?.next_30_without_pack ?? 0),
        held_last_12_months: held12,
        quorum_met_last_12_months: Number(quorum?.met ?? 0),
        quorum_not_met_last_12_months: Number(quorum?.not_met ?? 0),
      },
      minutes: { to_write: toWrite, late, awaiting_approval: awaitingApproval, late_after_days: MINUTES_AFTER_DAYS },
      decisions: {
        total: by_outcome.reduce((s, o) => s + o.count, 0),
        last_12_months: by_outcome.reduce((s, o) => s + o.last_12_months, 0),
        applied_to_approvals: await n(`select count(*)::int as n from meeting_decisions where deleted_at is null and applied_at is not null`),
        by_outcome,
      },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/summary', tag: 'Governance', permission: 'governance.view',
    summary: 'Committee and meeting figures: committees, meetings coming up and held, minutes waiting, and decisions by outcome',
    description: 'Figures only, the same for everyone: every meeting and decision counts (decisions about restricted records included), and no title, name or decision wording is returned. '
      + 'Minutes "to write" belong to held meetings with no approval running; they are "late" once the meeting is more than the reminder period behind.',
    response: '{ today, committees: { active, total }, meetings: { upcoming_30_days, upcoming_90_days, upcoming_30_days_without_pack, held_last_12_months, quorum_met_last_12_months, quorum_not_met_last_12_months }, '
      + 'minutes: { to_write, late, awaiting_approval, late_after_days }, decisions: { total, last_12_months, applied_to_approvals, by_outcome: [{ value, label, color, count, last_12_months }] } }',
  });
}
