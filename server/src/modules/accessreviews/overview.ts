import { defineCalendarSource } from '../../core/calendar.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { onAnonymize } from '../../core/retention.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, daysBetween } from '../../../../shared/dates.ts';
import { refreshAccounts } from './accounts.ts';

const DAY = 24 * 3_600_000;
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

/**
 * The figures of the access reviews page (the same for everyone: every account and campaign counts),
 * the calendar source for reviewers, the daily reminders and flag refresh, the roster listener and the
 * anonymizing hooks.
 */
export function registerOverview(ctx: ModuleContext) {
  const { app, db } = ctx;

  app.get('/api/access-reviews/summary', { preHandler: ctx.requirePerm('systems.view') }, async () => {
    const a = await db.one<Row>(
      `select count(*) filter (where status = 'active')::int as active,
              count(*) filter (where status = 'active' and attention = 'leaver')::int as leavers,
              count(*) filter (where status = 'active' and attention = 'on_leave')::int as on_leave,
              count(*) filter (where status = 'active' and attention = 'unmatched')::int as unmatched,
              count(*) filter (where status = 'active' and privileged)::int as privileged,
              count(distinct system_id) filter (where status = 'active')::int as systems
       from system_accounts where deleted_at is null`);
    const c = await db.one<Row>(
      `select count(*) filter (where status = 'in_progress')::int as running,
              count(*) filter (where status = 'in_progress' and due_on < $1::date)::int as overdue,
              max(completed_on) as last_completed
       from access_reviews where deleted_at is null`, [dayInZone()]);
    const r = await db.one<Row>(
      `select count(*) filter (where i.removal_status = 'pending')::int as pending,
              count(*) filter (where i.removal_status = 'pending' and i.removal_due_on < $1::date)::int as overdue
       from access_review_items i join access_reviews r on r.id = i.review_id and r.deleted_at is null`, [dayInZone()]);
    return {
      accounts: { active: a?.active ?? 0, leavers: a?.leavers ?? 0, onLeave: a?.on_leave ?? 0, unmatched: a?.unmatched ?? 0, privileged: a?.privileged ?? 0, systems: a?.systems ?? 0 },
      campaigns: { running: c?.running ?? 0, overdue: c?.overdue ?? 0, lastCompleted: c?.last_completed ? ymd(c.last_completed) : null },
      removals: { pending: r?.pending ?? 0, overdue: r?.overdue ?? 0 },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/access-reviews/summary', permission: 'systems.view',
    summary: 'Figures for user access reviews: active accounts and those flagged, campaigns running, removals pending',
    response: '{ accounts: { active, leavers, onLeave, unmatched, privileged, systems }, campaigns: { running, overdue, lastCompleted }, removals: { pending, overdue } }',
  });

  // The reviewer's systems still to sign off (E41-02, E41-03): in My work, the compliance calendar and
  // the calendar feed. `named`: a reviewer needs no systems permission, as on the decision page; each
  // item is one system the asker is named on, with the count of its accounts left to decide and nothing else.
  defineCalendarSource(app, {
    key: 'accessreviews.decisions', label: 'My access reviews due', recordType: 'access_review', permission: 'systems.view',
    work: true, named: true, kind: 'Access reviews', // an overdue system stays listed until it is signed off
    events: async (c, user, from, to) => {
      // The reviewer's own accounts are decided by the campaign owner (campaigns.ts mayDecide): by the
      // roster link, or by the account's name or email on the system being the reviewer's.
      const own = `${c.resources.get('person')
        ? `and not exists (select 1 from people p where p.id = i.holder_person_id and p.user_id = s.reviewer_id and p.deleted_at is null)` : ''}
        and not exists (select 1 from users su left join system_accounts a on a.id = i.account_id where su.id = s.reviewer_id
          and (lower(su.username) in (lower(i.account_name), lower(a.email)) or lower(su.email) in (lower(i.account_name), lower(a.email))))`;
      const rows = await c.db.query<Row>(
        `select r.id, r.ref, r.title, r.due_on, s.system_id, sy.name as system_name,
                (select count(*)::int from access_review_items i where i.review_system_id = s.id and i.decision is null ${own}) as open
         from access_review_systems s join access_reviews r on r.id = s.review_id
         left join systems sy on sy.id = s.system_id
         where s.reviewer_id = $1 and s.signed_off_at is null and r.status = 'in_progress' and r.deleted_at is null
           and r.due_on <= $3::date and (r.due_on >= $2::date or r.due_on < $4::date)
           and ${c.resources.visibleWhere('access_review', user, 'r')}`, [user.id, from, to, dayInZone()]);
      return rows.map((r) => ({
        uid: `accessreviews.decisions:${r.id}:${r.system_id}`,
        title: `Access review ${r.ref ?? ''}: ${r.system_name ?? 'a system'}, ${r.open ? `${r.open} account${r.open === 1 ? '' : 's'} to decide` : 'ready to sign off'}`.replace(/ +:/, ':'),
        start: ymd(r.due_on), allDay: true, url: `/access-reviews/${r.id}/systems/${r.system_id}`, recordType: 'access_review', recordId: r.id,
        personId: user.id, ref: r.ref ?? null,
      }));
    },
  });

  // Anything that changes a person on the roster (leaving, going on leave, a new email) flags their accounts again.
  ctx.resources.onChange?.(async (c) => {
    if (c.def.type !== 'person' || !ctx.resources.get('system_account')) return;
    const p = c.row;
    await refreshAccounts(ctx,
      `a.holder_person_id = $1 or (a.holder_person_id is null and (lower(a.email) = lower($2) or lower(a.employee_number) = lower($3) or lower(a.display_name) = lower($4) or lower(a.account_name) = lower($2)))`,
      [p.id, p.email ?? '', p.employee_number ?? '', p.full_name ?? '']);
  });

  // Personal details copied into campaigns go when the account, or the campaign, is anonymized.
  onAnonymize('system_account', async (tx, id) => {
    await tx.query(`update access_review_items set account_name = 'Removed at the end of the retention period', display_name = null, holder_person_id = null, comment = null where account_id = $1`, [id]);
  }, 'accessreviews');
  onAnonymize('access_review', async (tx, id) => {
    await tx.query(`update access_review_items set account_name = 'Removed at the end of the retention period', display_name = null, holder_person_id = null, comment = null, removal_note = null where review_id = $1`, [id]);
  }, 'accessreviews');
}

export interface ReminderRun { reviewers: number; removals: number; refreshed: number }

/**
 * Daily: reviewers with accounts still to decide hear once when the due date is near (the campaign's
 * `remind_days_before`) and once a week while it is overdue; the owner of an overdue removal's action
 * hears once a week too (the campaign owner when there is no action). Flags are worked out again.
 */
export async function runReminders(ctx: ModuleContext): Promise<ReminderRun> {
  const run: ReminderRun = { reviewers: 0, removals: 0, refreshed: 0 };
  run.refreshed = await refreshAccounts(ctx);
  if (!ctx.app.hasDecorator('notify') || !ctx.resources.get('access_review')) return run;
  const today = dayInZone();
  const due = await ctx.db.query<Row>(
    `select s.id, s.system_id, s.reviewer_id, sy.name as system_name, r.id as review_id, r.ref, r.title, r.due_on, r.remind_days_before,
            (select count(*)::int from access_review_items i where i.review_system_id = s.id and i.decision is null) as open
     from access_review_systems s join access_reviews r on r.id = s.review_id and r.deleted_at is null and r.status = 'in_progress'
     left join systems sy on sy.id = s.system_id
     where s.signed_off_at is null and s.reviewer_id is not null and r.due_on is not null`);
  for (const s of due) {
    const dueOn = ymd(s.due_on);
    const lead = Math.max(0, Number(s.remind_days_before ?? 3));
    if (today < addDays(dueOn, -lead)) continue;
    const late = today > dueOn ? daysBetween(dueOn, today) : 0;
    const res = await ctx.app.notify({
      userIds: [s.reviewer_id], kind: 'access_review',
      title: late ? `Access review overdue: ${s.system_name ?? 'a system'}` : `Access review due ${dueOn}: ${s.system_name ?? 'a system'}`,
      body: s.open ? `${s.open} account${s.open === 1 ? '' : 's'} still to keep or remove, then sign the system off.` : 'Every account is decided: sign the system off.',
      route: `/access-reviews/${s.review_id}/systems/${s.system_id}`,
      once: late ? `accessreviews.overdue:${s.id}:${Math.floor(late / 7)}` : `accessreviews.due:${s.id}:${dueOn}`,
    });
    run.reviewers += res.sent;
  }
  const removals = await ctx.db.query<Row>(
    `select i.id, i.account_name, i.removal_due_on, i.review_id, i.action_id, r.owner_id, r.ref, sy.name as system_name
     from access_review_items i join access_reviews r on r.id = i.review_id and r.deleted_at is null
     left join systems sy on sy.id = i.system_id
     where i.removal_status = 'pending' and i.removal_due_on < $1::date`, [today]);
  for (const i of removals) {
    const late = daysBetween(ymd(i.removal_due_on), today);
    let owner: string | null = i.owner_id ?? null;
    if (i.action_id && ctx.resources.get('action')) {
      const a = await ctx.db.one<Row>('select owner_id from actions where id = $1 and deleted_at is null', [i.action_id]);
      owner = a?.owner_id ?? owner;
    }
    if (!owner) continue;
    const res = await ctx.app.notify({
      userIds: [owner], kind: 'access_review',
      title: `Account removal overdue: ${i.account_name} on ${i.system_name ?? 'a system'}`,
      body: `Decided in ${i.ref ?? 'an access review'}. Remove the account and record it as done.`,
      route: `/access-reviews/${i.review_id}?tab=removals`,
      once: `accessreviews.removal:${i.id}:${Math.floor(late / 7)}`,
    });
    run.removals += res.sent;
  }
  return run;
}

export async function registerReminders(ctx: ModuleContext) {
  await scheduleWork(ctx, 'accessreviews.reminders', () => runReminders(ctx), { every: DAY, firstRunInMs: 150_000 });
}
