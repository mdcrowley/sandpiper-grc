// Seed loader. Both profiles get the same invented "[Sample]" policies and exceptions; the
// dev profile also gets a few sample people so that acknowledgment tracking has something
// to show. Idempotent: a sample whose title already exists is left alone.
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { audienceUserIds, publishVersion, syncPolicyStatus } from './acknowledgments.ts';
import { addDays, localDate } from './dates.ts';
import { runExceptionExpiry } from './exceptions.ts';
import { OUTCOME_RELATION, OUTCOME_TYPE } from './outcomes.ts';
import { SAMPLE_EXCEPTIONS, SAMPLE_PEOPLE, SAMPLE_POLICIES } from './seedData.ts';

const DAY = 86_400_000;

/** Sample people (dev profile only): active accounts with no password, so nobody can sign in as them. */
async function samplePeople(ctx: ModuleContext): Promise<number> {
  let added = 0;
  for (const p of SAMPLE_PEOPLE) {
    if (await ctx.db.one('select 1 from users where lower(username) = lower($1)', [p.username])) continue;
    const dept = (await ctx.db.one<Row>('select id from departments where name = $1', [p.department]))
      ?? (await ctx.db.one<Row>('insert into departments (name) values ($1) returning id', [p.department]))!;
    const user = (await ctx.db.one<Row>(
      `insert into users (username, email, display_name, status, department_id) values ($1,$2,$3,'active',$4) returning id`,
      [p.username, `${p.username}@example.test`, p.name, dept.id],
    ))!;
    const role = await ctx.db.one<Row>('select id from roles where key = $1', [p.role]);
    if (role) await ctx.db.query('insert into user_roles (user_id, role_id) values ($1,$2) on conflict do nothing', [user.id, role.id]);
    await ctx.audit(null, { action: 'user.create', recordType: 'user', recordId: user.id, summary: `Sample person added: ${p.name}` });
    added += 1;
  }
  return added;
}

/**
 * Dev profile only: the sample people answer the published sample policies, so tracking has
 * something to show. Everyone acknowledges, except that half of them leave the newest
 * acceptable use policy outstanding. Real accounts are never answered for.
 */
async function sampleAcknowledgments(ctx: ModuleContext, topUp: boolean): Promise<number> {
  const sample = await ctx.db.query<Row>(`select id, username from users where username like 'sample.%' and password_hash is null order by username`);
  if (!sample.length) return 0;
  const usernames = new Map(sample.map((u) => [u.id as string, u.username as string]));
  const slow = new Set(SAMPLE_PEOPLE.slice(Math.ceil(SAMPLE_PEOPLE.length / 2)).map((p) => p.username));
  let done = 0;
  for (const s of SAMPLE_POLICIES) {
    const policy = await ctx.db.one<Row>(`select * from policies where title = $1 and deleted_at is null and status = 'published'`, [s.title]);
    const version = policy && await ctx.db.one<Row>(`select * from policy_versions where policy_id = $1 and status = 'published'`, [policy.id]);
    if (!policy || !version?.published_at) continue;
    const at = new Date(version.published_at);
    if (topUp) {
      // Sample people added after the policy was published are asked as if they had been there that day.
      const due = addDays(localDate(at), Math.max(1, Math.trunc(Number(policy.ack_days) || 14)));
      for (const uid of (await audienceUserIds(ctx, policy)).filter((u) => usernames.has(u))) {
        await ctx.db.query(
          `insert into policy_acknowledgements (policy_id, version_id, user_id, requested_at, due_on) values ($1,$2,$3,$4,$5)
           on conflict (version_id, user_id) do nothing`,
          [policy.id, version.id, uid, at.toISOString(), due],
        );
      }
    }
    const open = await ctx.db.query<Row>(
      'select id, user_id from policy_acknowledgements where version_id = $1 and acknowledged_at is null and superseded_at is null and user_id = any($2::uuid[]) order by user_id',
      [version.id, [...usernames.keys()]],
    );
    const answer = open.filter((a) => !(s.key === 'acceptable_use' && slow.has(usernames.get(a.user_id)!)));
    for (const [n, a] of answer.entries()) {
      await ctx.db.query('update policy_acknowledgements set acknowledged_at = $2 where id = $1', [a.id, new Date(at.getTime() + (n + 1) * DAY).toISOString()]);
    }
    if (answer.length) {
      await ctx.audit(null, {
        action: 'policy.acknowledge', recordType: 'policy', recordId: policy.id,
        summary: `Sample data: ${answer.length} acknowledgment${answer.length === 1 ? '' : 's'} recorded for version ${version.version} of ${policy.ref}`,
        after: { version: Number(version.version), acknowledged: answer.length },
      });
    }
    done += answer.length;
  }
  return done;
}

export async function seedPolicies(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const now = new Date();
  const today = localDate(now);
  // Sample people are only added once a real account exists: the first-run setup wizard is
  // offered only while there are no users at all, so adding them earlier would lock everyone out.
  const anyone = await ctx.db.one('select 1 from users limit 1');
  const people = opts.profile === 'dev' && anyone ? await samplePeople(ctx) : 0;
  const roleKeys = new Set((await ctx.db.query<{ key: string }>('select key from roles')).map((r) => r.key));
  const ids = new Map<string, string>();
  let policies = 0;

  for (const s of SAMPLE_POLICIES) {
    const existing = await ctx.db.one<Row>('select id from policies where title = $1', [s.title]);
    if (existing) { ids.set(s.key, existing.id); continue; }
    let policy = await ctx.resources.create('policy', {
      title: s.title, summary: s.summary, category: s.category, approver_name: s.approver_name, approver_role: s.approver_role,
      review_date: addDays(today, s.reviewInDays), ack_days: s.ack_days ?? 14,
      audience_everyone: s.audience.everyone ?? false,
      audience_roles: (s.audience.roles ?? []).filter((r) => roleKeys.has(r)),
    });
    ids.set(s.key, policy.id);
    policies += 1;

    for (const [i, v] of s.versions.entries()) {
      const at = new Date(now.getTime() - (v.daysAgo ?? 0) * DAY);
      const approved = v.stage === 'approved' || v.stage === 'published';
      const version = (await ctx.db.one<Row>(
        `insert into policy_versions (policy_id, version, body, change_summary, status, approved_by_name, approved_on, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [policy.id, i + 1, v.body, v.change_summary, v.stage === 'published' ? 'approved' : v.stage,
          approved ? s.approver_name : null, approved ? localDate(at) : null, at.toISOString()],
      ))!;
      await ctx.audit(null, {
        action: 'policy.version_create', recordType: 'policy', recordId: policy.id,
        summary: `Sample version ${i + 1} of ${policy.ref} ${policy.title} added (${v.stage.replace('_', ' ')})`,
        after: { version: i + 1, status: version.status },
      });
      if (v.stage !== 'published') { policy = await syncPolicyStatus(ctx, policy.id, null); continue; }
      const result = await publishVersion(ctx, null, policy, version, { now: at });
      policy = result.policy;
    }
  }

  const acknowledged = opts.profile === 'dev' ? await sampleAcknowledgments(ctx, people > 0) : 0;

  // Map the first two policies to a few framework outcomes, when that module is loaded and has any.
  const outcomes = ctx.resources.get(OUTCOME_TYPE);
  if (outcomes && policies) {
    const some = await ctx.db.query<Row>(`select id from ${outcomes.table} where deleted_at is null order by ${outcomes.ref?.field ?? 'created_at'} limit 4`);
    for (const [n, o] of some.entries()) {
      const from = ids.get(n < 2 ? 'acceptable_use' : 'access_control');
      if (!from) continue;
      await ctx.db.query(
        `insert into record_links (from_type, from_id, to_type, to_id, relation) values ('policy', $1, $2, $3, $4) on conflict do nothing`,
        [from, OUTCOME_TYPE, o.id, OUTCOME_RELATION],
      );
    }
  }

  let exceptions = 0;
  for (const e of SAMPLE_EXCEPTIONS) {
    if (await ctx.db.one('select 1 from policy_exceptions where title = $1', [e.title])) continue;
    await ctx.resources.create('policy_exception', {
      title: e.title, policy_id: ids.get(e.policy) ?? null, description: e.description, justification: e.justification,
      compensating_controls: e.compensating_controls, status: e.status,
      expires_on: e.expiresInDays === undefined ? null : addDays(today, e.expiresInDays),
      ...(e.status === 'approved'
        ? { approver_name: 'Sample Approver', approver_role: 'Head of IT', approved_on: addDays(today, -(e.approvedDaysAgo ?? 0)) }
        : {}),
    });
    exceptions += 1;
  }
  // The sample whose date has passed is flagged the same way a real one would be.
  const expired = await runExceptionExpiry(ctx, now);

  const notes = [
    `${policies} sample policies`, `${exceptions} sample exceptions (${expired.length} marked expired)`,
    ...(people ? [`${people} sample people`] : []),
    ...(acknowledged ? [`${acknowledged} sample acknowledgments`] : []),
    ...(opts.profile === 'dev' && !anyone ? ['sample people skipped until the first administrator exists (run the seed again after setup)'] : []),
  ];
  return notes.join(', ');
}
