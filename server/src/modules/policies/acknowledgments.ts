// Acknowledgment requests: who is asked, publishing a version, tracking and the reminder run.
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { readerIds, tablesFor } from './access.ts';
import { notifyRecalls } from './copies.ts';
import { addDays, daysBetween, localDate } from './dates.ts';
import { requestRosterAcks } from './personAcks.ts';
import { refreshSearchText } from './search.ts';
import { cycleOf } from './types.ts';

export const REMINDER_SETTING = 'policies.reminder_interval_days';
export const DEFAULT_REMINDER_INTERVAL = 7;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Days between reminders to someone who has not acknowledged (setting `policies.reminder_interval_days`). */
export async function reminderInterval(ctx: ModuleContext): Promise<number> {
  const raw = Number(await ctx.settings.get<unknown>(REMINDER_SETTING, DEFAULT_REMINDER_INTERVAL));
  return Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : DEFAULT_REMINDER_INTERVAL;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plainDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso; };

/**
 * Tells one person about their acknowledgment request. The link opens their own reader for
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
    route: `/policies/acknowledgments/${a.id}`,
  });
  return res.sent;
}

/** The review cycle in months of a document type (list policy_document_type, meta.review_months), or null. */
export async function reviewMonths(ctx: ModuleContext, documentType: unknown): Promise<number | null> {
  if (!documentType) return null;
  const v = (await ctx.lookups.values('policy_document_type')).find((x) => x.value === documentType);
  const n = Number((v?.meta as Row | undefined)?.review_months);
  return Number.isInteger(n) && n > 0 && n <= 120 ? n : null;
}

/**
 * Active users in the policy's audience: everyone, or anyone holding one of the roles or in one of
 * the departments. Only people who may read the document are asked (E43: the audience lies inside
 * the distribution).
 */
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
  const ids = rows.map((r) => r.id);
  if (policy.access !== 'restricted') return ids;
  const readers = new Set(await readerIds(ctx, tablesFor(ctx), policy));
  return ids.filter((id) => readers.has(id));
}

/**
 * Recomputes the policy's status from its versions (a retired policy stays retired). The effective
 * version is the published one; `current_version` is its number.
 */
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

export interface PublishResult { policy: Row; version: Row; requested: number; roster_requested?: number; due_on: string; moved?: number }

/** SHA-256 of a version's text: the fingerprint shown with acknowledgments. */
export const bodyHash = (body: unknown): string => createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex');

/**
 * Publishes an approved version: it becomes what readers see, the version before it is kept
 * as superseded (with the date it stopped being in force), and everyone in the audience who may
 * read the document is asked to acknowledge the new text (requests for earlier versions that were
 * never answered are closed).
 * - `minor`: a typo or formatting fix; nobody new is asked, and open requests move to this version.
 * - a document that does not need acknowledging (`ack_required` false) asks nobody.
 * - in data load mode (`load`), nobody is asked and nothing is sent: it is history.
 */
export async function publishVersion(
  ctx: ModuleContext, req: FastifyRequest | null, policy: Row, version: Row,
  opts: { effective_on?: string | null; now?: Date; minor?: boolean; load?: boolean; published_at?: string | null } = {},
): Promise<PublishResult> {
  if (policy.status === 'retired') ctx.fail(409, 'retired', 'This document is obsolete. It cannot be published.');
  if (version.status === 'published') ctx.fail(409, 'already_published', 'This version is already published.');
  if (version.status !== 'approved') ctx.fail(409, 'not_approved', 'Only an approved version can be published.');
  const now = opts.now ?? new Date();
  const today = localDate(now);
  const userId = req?.user?.id ?? null;
  const effective = opts.effective_on ?? (version.effective_on ? String(version.effective_on instanceof Date ? version.effective_on.toISOString() : version.effective_on).slice(0, 10) : today);
  const minor = opts.minor ?? version.minor === true;

  await ctx.db.query(
    `update policy_versions set status = 'superseded', superseded_on = coalesce(superseded_on, $3::date), scheduled = false,
       updated_at = now(), updated_by = $2 where policy_id = $1 and status = 'published'`,
    [policy.id, userId, effective],
  );
  const published = (await ctx.db.one<Row>(
    `update policy_versions set status = 'published', published_at = $2, effective_on = $3::date, scheduled = false, minor = $5,
       body_sha256 = coalesce(body_sha256, $6), updated_at = now(), updated_by = $4 where id = $1 returning *`,
    [version.id, opts.published_at ?? now.toISOString(), effective, userId, minor, bodyHash(version.body)],
  ))!;
  // The review cycle (the document's own, else its type's, E29-08/E43): the next review falls that
  // many months after the version takes effect, unless a later review date is already set.
  const months = await cycleOf(ctx, policy);
  if (months) {
    await ctx.db.query(
      `update policies p set review_date = (v.effective_on + make_interval(months => $3::int))::date, updated_at = now(), updated_by = $4
       from policy_versions v
       where p.id = $1 and v.id = $2 and (p.review_date is null or p.review_date < (v.effective_on + make_interval(months => $3::int))::date)`,
      [policy.id, published.id, months, userId],
    );
  }
  const days = Math.max(1, Math.trunc(Number(policy.ack_days) || 14));
  const dueOn = addDays(today, days);
  let requested = 0;
  let roster = 0;
  let moved = 0;
  const made: { id: string; user_id: string }[] = [];
  if (minor && !opts.load) {
    // A minor version: what people were asked to read is still what they read, so their open
    // requests now point at this version and keep their due dates.
    moved = (await ctx.db.query(
      `update policy_acknowledgements set version_id = $2
       where policy_id = $1 and version_id <> $2 and acknowledged_at is null and superseded_at is null returning id`,
      [policy.id, version.id])).length;
    moved += (await ctx.db.query(
      `update policy_person_acknowledgements set version_id = $2
       where policy_id = $1 and version_id <> $2 and acknowledged_at is null and superseded_at is null returning id`,
      [policy.id, version.id])).length;
  } else {
    await ctx.db.query(
      `update policy_acknowledgements set superseded_at = $3
       where policy_id = $1 and version_id <> $2 and acknowledged_at is null and superseded_at is null`,
      [policy.id, version.id, now.toISOString()],
    );
    const asks = !opts.load && policy.ack_required !== false;
    if (asks) {
      for (const uid of await audienceUserIds(ctx, policy)) {
        const row = await ctx.db.one<{ id: string; user_id: string }>(
          `insert into policy_acknowledgements (policy_id, version_id, user_id, requested_at, due_on) values ($1,$2,$3,$4,$5)
           on conflict (version_id, user_id) do nothing returning id, user_id`,
          [policy.id, version.id, uid, now.toISOString(), dueOn],
        );
        if (row) { requested += 1; made.push(row); }
      }
    }
    // Roster people (E29-09): asked by position, recorded on a sign-in sheet or the kiosk.
    roster = await requestRosterAcks(ctx, asks ? policy : { ...policy, ack_roster: false }, published, dueOn, now);
  }
  // Each person asked is told, except the person publishing (they know).
  for (const a of made) {
    if (a.user_id !== userId) await notifyAck(ctx, a, { ref: policy.ref, title: String(policy.title) }, Number(version.version), dueOn, false);
  }
  const after = await syncPolicyStatus(ctx, policy.id, userId);
  await refreshSearchText(ctx, policy.id);
  const name = [policy.doc_number ?? policy.ref, policy.title].filter(Boolean).join(' ');
  await ctx.audit(req, {
    action: 'policy.publish', recordType: 'policy', recordId: policy.id,
    summary: minor && !opts.load
      ? `Version ${version.version} of ${name} published as a minor version; nobody new asked to acknowledge${moved ? ` (${moved} open request${moved === 1 ? '' : 's'} moved to it)` : ''}`
      : `Version ${version.version} of ${name} published; ${requested} ${requested === 1 ? 'person' : 'people'} asked to acknowledge by ${dueOn}${roster ? `, and ${roster} on the roster` : ''}`,
    before: { status: policy.status, current_version: policy.current_version },
    after: { status: after.status, current_version: Number(version.version), effective_on: effective, minor, acknowledgements_requested: requested, roster_requested: roster, moved, due_on: dueOn },
  });
  // Paper copies of earlier versions are now due to be recalled (E43-14).
  if (!opts.load) await notifyRecalls(ctx, policy.id);
  return { policy: after, version: published, requested, roster_requested: roster, due_on: dueOn, moved };
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
            a.requested_at, a.due_on, a.acknowledged_at, a.reminded_at, a.reminder_count, a.superseded_at, a.language, a.translation_sha256
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
 * The reminder run. For each published policy it finds acknowledgments that are past their
 * due date and not yet reminded (or last reminded at least the configured interval ago),
 * stamps `reminded_at`, writes one audit event per policy and, when the notification service
 * is loaded, sends each person a reminder that opens their reader. Running it again within the
 * interval sends nothing.
 */
export async function runPolicyReminders(ctx: ModuleContext, now: Date = new Date()): Promise<PolicyReminder[]> {
  const today = localDate(now);
  const interval = await reminderInterval(ctx);
  // An hour of slack, so a daily timer that drifts a little still fires on the day it should.
  // A policy may set its own interval (E10-18); otherwise the module setting applies.
  const cutoff = `($2::timestamptz - make_interval(days => coalesce(p.reminder_interval_days, $3::int)) + interval '1 hour')`;
  const due = await ctx.db.query<Row>(
    `select a.id, a.user_id, a.policy_id, a.due_on, v.version, p.ref, p.title
     from policy_acknowledgements a
     join policies p on p.id = a.policy_id
     join policy_versions v on v.id = a.version_id
     join users u on u.id = a.user_id
     where a.acknowledged_at is null and a.superseded_at is null and a.due_on < $1::date
       and p.deleted_at is null and p.status = 'published' and v.status = 'published'
       and u.deleted_at is null and u.status = 'active'
       and (a.reminded_at is null or a.reminded_at <= ${cutoff})
     order by p.ref, a.user_id`,
    [today, now.toISOString(), interval],
  );
  const out: PolicyReminder[] = [];
  for (const policyId of [...new Set(due.map((d) => d.policy_id))]) {
    const mine = due.filter((d) => d.policy_id === policyId);
    // The same condition again in the update keeps this safe if two runs ever overlap.
    const claimed = await ctx.db.query<{ id: string; user_id: string; due_on: unknown }>(
      `update policy_acknowledgements a set reminded_at = $2, reminder_count = reminder_count + 1
       from policies p
       where a.id = any($1::uuid[]) and p.id = a.policy_id and a.acknowledged_at is null
         and (a.reminded_at is null or a.reminded_at <= ${cutoff})
       returning a.id, a.user_id, a.due_on`,
      [mine.map((m) => m.id), now.toISOString(), interval],
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
      summary: `Acknowledgment reminder: ${item.user_ids.length} ${item.user_ids.length === 1 ? 'person is' : 'people are'} overdue for version ${item.version} of ${[first.ref, first.title].filter(Boolean).join(' ')}`,
      after: { version: item.version, user_ids: item.user_ids },
    });
    out.push(item);
  }
  return out;
}
