// The daily document-control run (E43), part of the job `policies.daily_checks`:
// - versions approved to take effect on a future date are published on that date (that is what
//   supersedes the version before; acknowledgment requests are made then);
// - review reminders to the owner 60 and 30 days before the next review, on the day, then weekly;
//   external documents ask the owner to check for a new edition; reference documents and plans
//   (which have their own annual review, plans.ts) are left out;
// - bulletins past their expiry date are offered to the owner for making obsolete.
// Notifications go only to people who may read the document; with no owner, to document controllers.
import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, daysBetween } from '../../../../shared/dates.ts';
import { type AccessTables, readerIdsSql, readerParams, tablesFor } from './access.ts';
import { publishVersion } from './acknowledgments.ts';
import { localDate } from './dates.ts';
import { typeMap } from './types.ts';

export interface DailyResult { published: number; reminders: number; bulletins: number }

const ymd = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const name = (p: Row) => [p.doc_number ?? p.ref, p.title].filter(Boolean).join(' ');

/** Which reminder a review date gets today: 60, 30, due, or a weekly overdue one; null for none. */
export function reviewStage(next: string, today: string): string | null {
  const left = daysBetween(today, next);
  if (left === 60) return '60';
  if (left === 30) return '30';
  if (left === 0) return 'due';
  if (left < 0 && (-left) % 7 === 0) return `overdue-${-left}`;
  return null;
}

export async function runDocumentDailyChecks(ctx: ModuleContext, tables: AccessTables = tablesFor(ctx), now: Date = new Date()): Promise<DailyResult> {
  const { db } = ctx;
  const today = localDate(now);
  const out: DailyResult = { published: 0, reminders: 0, bulletins: 0 };

  // 1. Future effective dates that have come.
  const due = await db.query<Row>(
    `select v.* from policy_versions v join policies p on p.id = v.policy_id
     where v.scheduled and v.status = 'approved' and v.effective_on <= $1::date and p.deleted_at is null and p.status <> 'retired'
     order by v.effective_on, v.version`, [today]);
  for (const v of due) {
    const policy = await db.one<Row>('select * from policies where id = $1', [v.policy_id]);
    if (!policy) continue;
    await publishVersion(ctx, null, policy, v, { effective_on: ymd(v.effective_on), now });
    out.published += 1;
  }

  if (!ctx.app.hasDecorator('notify')) return out;
  const types = await typeMap(ctx);
  const skip = [...types.values()].filter((t) => t.uncontrolled || t.plan).map((t) => t.value);
  const external = [...types.values()].filter((t) => t.external).map((t) => t.value);

  /** Tells the owner (when they may still read it), else the document controllers. */
  async function tell(p: Row, title: string, body: string, once: string): Promise<number> {
    let owner: string | null = p.owner_id ?? null;
    if (owner && p.access === 'restricted') {
      const ok = await db.one(`select 1 from (${readerIdsSql(tables)}) r where r.id = $9::uuid`, [...readerParams(p), owner]);
      if (!ok) owner = null;
    }
    const res = await ctx.app.notify({
      ...(owner ? { userIds: [owner] } : { permission: 'policies.administer' }),
      kind: 'reminder', title, body, recordType: 'policy', recordId: p.id, once,
    });
    return res.sent;
  }

  // 2. Review reminders.
  const reviews = await db.query<Row>(
    `select * from policies where deleted_at is null and status = 'published' and review_date is not null
       and not (document_type = any($1::text[])) and review_date <= ($2::date + 60) order by review_date limit 2000`, [skip, today]);
  for (const p of reviews) {
    const next = ymd(p.review_date);
    const stage = reviewStage(next, today);
    if (!stage) continue;
    const isExternal = external.includes(p.document_type);
    const title = stage === 'due' ? `Review due today: ${name(p)}`
      : stage.startsWith('overdue') ? `Review overdue: ${name(p)}` : `Review due on ${next}: ${name(p)}`;
    const body = isExternal
      ? 'Check whether a new edition of this external document has been published, and record the review.'
      : 'Review the document and record the result: no change, revise, or make obsolete.';
    await tell(p, title, body, `policy.review:${p.id}:${next}:${stage}`);
    out.reminders += 1;
  }

  // 3. Bulletins past their expiry date (any type with an expiry date set).
  const expired = await db.query<Row>(
    `select * from policies where deleted_at is null and status = 'published' and expires_on is not null and expires_on < $1::date
       and expires_on >= $2::date order by expires_on limit 500`, [today, addDays(today, -30)]);
  for (const p of expired) {
    await tell(p, `Expired: ${name(p)}`, `This document expired on ${ymd(p.expires_on)}. Make it obsolete if it no longer applies.`, `policy.expired:${p.id}:${ymd(p.expires_on)}`);
    out.bulletins += 1;
  }
  return out;
}
