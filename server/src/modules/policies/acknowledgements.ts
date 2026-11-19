// Acknowledgement requests: who is asked, publishing a version, tracking and the reminder run.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, daysBetween, localDate } from './dates.ts';

export const REMINDER_SETTING = 'policies.reminder_interval_days';
export const DEFAULT_REMINDER_INTERVAL = 7;
const HOUR = 3_600_000;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Days between reminders to someone who has not acknowledged (setting `policies.reminder_interval_days`). */
export async function reminderInterval(ctx: ModuleContext): Promise<number> {
  const raw = Number(await ctx.settings.get<unknown>(REMINDER_SETTING, DEFAULT_REMINDER_INTERVAL));
  return Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : DEFAULT_REMINDER_INTERVAL;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plainDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso; };

/**
 * Tells one person about their acknowledgement request. The link opens their own reader for
 * that request, which they may always open, so no record permission is needed to follow it.
 */
async function notifyAck(
  ctx: ModuleContext, a: { id: string; user_id: string }, policy: { ref?: string | null; title: string }, version: number, dueOn: string, reminder: boolean,
): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  const name = [policy.ref, policy.title].filter(Boolean).join(' ');
  const res = await ctx.app.notify({
    userIds: [a.user_id], kind: 'acknowledgement',
    title: reminder ? `Reminder: please read and acknowledge ${name}` : `Please read and acknowledge ${name}`,
    body: reminder ? `Version ${version} was due on ${plainDate(dueOn)}.` : `Version ${version}. Please acknowledge it by ${plainDate(dueOn)}.`,
    route: `/policies/acknowledgements/${a.id}`,
  });
  return res.sent;
}

/** Active users in the policy's audience: everyone, or anyone holding one of the roles or in one of the departments. */
export async function audienceUserIds(ctx: ModuleContext, policy: Row): Promise<string[]> {
  const rows = await ctx.db.query<{ id: string }>(
    `select u.id from users u
     where u.deleted_at is null and u.status = 'active' and (
       $1::boolean
       or u.department_id::text = any($2::text[])
       or exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                  where ur.user_id = u.id and r.key = any($3::text[])))
     order by u.display_name`,
    [policy.audience_everyone === true, list(policy.audience_departments), list(policy.audience_roles)],
  );
  return rows.map((r) => r.id);
}

/** Recomputes the policy's status from its versions (a retired policy stays retired). */
export async function syncPolicyStatus(ctx: ModuleContext, policyId: string, userId: string | null): Promise<Row> {
  const policy = (await ctx.db.one<Row>('select * from policies where id = $1', [policyId]))!;
  if (policy.status === 'retired') return policy;
  const versions = await ctx.db.query<Row>('select version, status from policy_versions where policy_id = $1 order by version desc', [policyId]);
  const published = versions.find((v) => v.status === 'published');
  const latest = versions[0];
  const status = published ? 'published' : latest && ['in_review', 'approved'].includes(latest.status) ? latest.status : 'draft';
  const current = published ? Number(published.version) : null;
  if (status === policy.status && (policy.current_version === null ? null : Number(policy.current_version)) === current) return policy;
  return (await ctx.db.one<Row>(
    'update policies set status = $2, current_version = $3, updated_at = now(), updated_by = $4 where id = $1 returning *',
    [policyId, status, current, userId],
  ))!;
}

export interface PublishResult { policy: Row; version: Row; requested: number; due_on: string }

/**
 * Publishes an approved version: it becomes what readers see, the version before it is kept
 * as superseded, and everyone in the audience is asked to acknowledge the new text (requests
 * for earlier versions that were never answered are closed).
 */
export async function publishVersion(
  ctx: ModuleContext, req: FastifyRequest | null, policy: Row, version: Row,
  opts: { effective_on?: string | null; now?: Date } = {},
): Promise<PublishResult> {
  if (policy.status === 'retired') ctx.fail(409, 'retired', 'This policy is retired. It cannot be published.');
  if (version.status === 'published') ctx.fail(409, 'already_published', 'This version is already published.');
  if (version.status !== 'approved') ctx.fail(409, 'not_approved', 'Only an approved version can be published.');
  const now = opts.now ?? new Date();
  const today = localDate(now);
  const userId = req?.user?.id ?? null;

  await ctx.db.query(
    `update policy_versions set status = 'superseded', updated_at = now(), updated_by = $2 where policy_id = $1 and status = 'published'`,
    [policy.id, userId],
  );
  const published = (await ctx.db.one<Row>(
    `update policy_versions set status = 'published', published_at = $2, effective_on = coalesce($3::date, effective_on, $4::date),
       updated_at = now(), updated_by = $5 where id = $1 returning *`,
    [version.id, now.toISOString(), opts.effective_on ?? null, today, userId],
  ))!;
  await ctx.db.query(
    `update policy_acknowledgements set superseded_at = $3
     where policy_id = $1 and version_id <> $2 and acknowledged_at is null and superseded_at is null`,
    [policy.id, version.id, now.toISOString()],
  );
  const days = Math.max(1, Math.trunc(Number(policy.ack_days) || 14));
  const dueOn = addDays(today, days);
  let requested = 0;
  const made: { id: string; user_id: string }[] = [];
  for (const uid of await audienceUserIds(ctx, policy)) {
    const row = await ctx.db.one<{ id: string; user_id: string }>(
      `insert into policy_acknowledgements (policy_id, version_id, user_id, requested_at, due_on) values ($1,$2,$3,$4,$5)
       on conflict (version_id, user_id) do nothing returning id, user_id`,
      [policy.id, version.id, uid, now.toISOString(), dueOn],
    );
    if (row) { requested += 1; made.push(row); }
  }
  // Each person asked is told, except the person publishing (they know).
  for (const a of made) {
    if (a.user_id !== userId) await notifyAck(ctx, a, { ref: policy.ref, title: String(policy.title) }, Number(version.version), dueOn, false);
  }
  const after = await syncPolicyStatus(ctx, policy.id, userId);
  await ctx.audit(req, {
    action: 'policy.publish', recordType: 'policy', recordId: policy.id,
    summary: `Version ${version.version} of ${[policy.ref, policy.title].filter(Boolean).join(' ')} published; ${requested} ${requested === 1 ? 'person' : 'people'} asked to acknowledge by ${dueOn}`,
    before: { status: policy.status, current_version: policy.current_version },
    after: { status: after.status, current_version: Number(version.version), acknowledgements_requested: requested, due_on: dueOn },
  });
  return { policy: after, version: published, requested, due_on: dueOn };
}

export type AckState = 'acknowledged' | 'overdue' | 'outstanding' | 'superseded';

export const ackState = (a: Row, today: string): AckState =>
  a.acknowledged_at ? 'acknowledged' : a.superseded_at ? 'superseded' : a.due_on < today ? 'overdue' : 'outstanding';

type TrackedRow = Row & { state: AckState; days_overdue: number };

const pct = (n: number, total: number): number => (total ? Math.round((n / total) * 1000) / 10 : 0);

/** Who has and has not acknowledged one version of a policy. */
export async function ackTracking(ctx: ModuleContext, policy: Row, version: Row | undefined, now: Date = new Date()) {
  const today = localDate(now);
  const empty = { total: 0, acknowledged: 0, outstanding: 0, overdue: 0, acknowledged_pct: 0, outstanding_pct: 0, overdue_pct: 0 };
  if (!version) return { today, version: null, counts: empty, rows: [] as TrackedRow[], departments: [] };
  const raw = await ctx.db.query<Row>(
    `select a.id, a.user_id, u.display_name as user_name, u.email, u.status as user_status, d.name as department,
            a.requested_at, a.due_on, a.acknowledged_at, a.reminded_at, a.reminder_count, a.superseded_at
     from policy_acknowledgements a
     join users u on u.id = a.user_id
     left join departments d on d.id = u.department_id and d.deleted_at is null
     where a.policy_id = $1 and a.version_id = $2
     order by u.display_name`,
    [policy.id, version.id],
  );
  const rows: TrackedRow[] = raw.map((a) => {
    const state = ackState(a, today);
    return { ...a, state, days_overdue: state === 'overdue' ? daysBetween(a.due_on, today) : 0 };
  });
  const count = (set: TrackedRow[]) => {
    const total = set.length;
    const acknowledged = set.filter((r) => r.state === 'acknowledged').length;
    const overdue = set.filter((r) => r.state === 'overdue').length;
    const outstanding = total - acknowledged;
    return {
      total, acknowledged, outstanding, overdue,
      acknowledged_pct: pct(acknowledged, total), outstanding_pct: pct(outstanding, total), overdue_pct: pct(overdue, total),
    };
  };
  const names = [...new Set(rows.map((r) => r.department ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  return {
    today,
    version: { id: version.id, version: Number(version.version), status: version.status, published_at: version.published_at },
    counts: count(rows),
    rows,
    departments: names.map((n) => ({ department: n || null, ...count(rows.filter((r) => (r.department ?? '') === n)) })),
  };
}

export interface PolicyReminder { policy_id: string; ref: string | null; title: string; version: number; user_ids: string[] }

/**
 * The reminder run. For each published policy it finds acknowledgements that are past their
 * due date and not yet reminded (or last reminded at least the configured interval ago),
 * stamps `reminded_at`, writes one audit event per policy and, when the notification service
 * is loaded, sends each person a reminder that opens their reader. Running it again within the
 * interval sends nothing.
 */
export async function runPolicyReminders(ctx: ModuleContext, now: Date = new Date()): Promise<PolicyReminder[]> {
  const today = localDate(now);
  const interval = await reminderInterval(ctx);
  // An hour of slack, so a daily timer that drifts a little still fires on the day it should.
  const cutoff = new Date(now.getTime() - interval * 24 * HOUR + HOUR).toISOString();
  const due = await ctx.db.query<Row>(
    `select a.id, a.user_id, a.policy_id, a.due_on, v.version, p.ref, p.title
     from policy_acknowledgements a
     join policies p on p.id = a.policy_id
     join policy_versions v on v.id = a.version_id
     join users u on u.id = a.user_id
     where a.acknowledged_at is null and a.superseded_at is null and a.due_on < $1::date
       and p.deleted_at is null and p.status = 'published' and v.status = 'published'
       and u.deleted_at is null and u.status = 'active'
       and (a.reminded_at is null or a.reminded_at <= $2::timestamptz)
     order by p.ref, a.user_id`,
    [today, cutoff],
  );
  const out: PolicyReminder[] = [];
  for (const policyId of [...new Set(due.map((d) => d.policy_id))]) {
    const mine = due.filter((d) => d.policy_id === policyId);
    // The same condition again in the update keeps this safe if two runs ever overlap.
    const claimed = await ctx.db.query<{ id: string; user_id: string; due_on: unknown }>(
      `update policy_acknowledgements set reminded_at = $2, reminder_count = reminder_count + 1
       where id = any($1::uuid[]) and acknowledged_at is null and (reminded_at is null or reminded_at <= $3::timestamptz)
       returning id, user_id, due_on`,
      [mine.map((m) => m.id), now.toISOString(), cutoff],
    );
    if (!claimed.length) continue;
    for (const c of claimed) {
      const due = c.due_on instanceof Date ? c.due_on.toISOString().slice(0, 10) : String(c.due_on);
      await notifyAck(ctx, c, { ref: mine[0].ref, title: mine[0].title }, Number(mine[0].version), due, true);
    }
    const first = mine[0];
    const item: PolicyReminder = {
      policy_id: policyId, ref: first.ref ?? null, title: first.title, version: Number(first.version),
      user_ids: claimed.map((c) => c.user_id),
    };
    await ctx.audit(null, {
      action: 'policy.ack_reminder', recordType: 'policy', recordId: policyId,
      summary: `Acknowledgement reminder: ${item.user_ids.length} ${item.user_ids.length === 1 ? 'person is' : 'people are'} overdue for version ${item.version} of ${[first.ref, first.title].filter(Boolean).join(' ')}`,
      after: { version: item.version, user_ids: item.user_ids },
    });
    out.push(item);
  }
  return out;
}
