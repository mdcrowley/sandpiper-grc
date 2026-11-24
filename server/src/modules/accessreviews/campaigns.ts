import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { UUID_RE } from '../../core/errors.ts';
import { csvCell } from '../../core/export/csv.ts';
import { addDays } from '../../../../shared/dates.ts';

/**
 * Access review campaigns (E41-02). A campaign names the systems to review and, for each, the person
 * asked to review its accounts (by default the system's business owner, else its technical owner).
 * Launching copies every active account of those systems into the campaign; each reviewer then keeps
 * or removes every account of their system and signs the system off. Nobody decides on their own
 * account: such an account goes to the campaign owner. Signing off turns each "remove" into a removal
 * to be done by a due date (and an action in the action tracker, owned by the system's technical
 * owner), tracked until someone records it as done, the action is finished, or the account is no longer
 * in the system's next import. A campaign whose systems are all signed off can be completed, and a
 * completed campaign can be recorded as an operating test of a control (the controls module's
 * `control_test` record type, through the resource engine).
 *
 * Permissions: the campaign itself is in the `systems` module (view to see it, edit to set it up,
 * launch, complete and record removals, export for the decision file). Deciding needs no permission:
 * only the named reviewer (or, for the reviewer's own account, the campaign owner) may decide.
 */

const DECISIONS = ['keep', 'remove'] as const;
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

export interface ItemRow extends Row {
  id: string; review_id: string; review_system_id: string; system_id: string; account_id: string;
  decision: string | null; removal_status: string | null; holder_user_id: string | null;
  /** Accounts here whose username or email is the account's name or email on the system (case-insensitive). */
  same_user_ids: string[] | null;
}

/** Whether the item is this person's own account: through the staff roster, or by name or email. */
const holds = (item: ItemRow, userId: string | null | undefined): boolean =>
  !!userId && (item.holder_user_id === userId || (item.same_user_ids ?? []).includes(userId));

/** An item as the API gives it (the matched account ids are only for the check above). */
const shown = ({ same_user_ids: _matched, ...item }: ItemRow): Row => item;

export function registerCampaigns(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const idOf = (req: FastifyRequest, key = 'id') => {
    const v = String((req.params as Row)[key] ?? '');
    return UUID_RE.test(v) ? v : null;
  };

  ctx.defineResource({
    type: 'access_review', table: 'access_reviews', module: 'systems', label: 'Access review', plural: 'Access reviews',
    path: '/api/access-reviews', route: '/access-reviews', titleField: 'title',
    ref: { field: 'ref', prefix: 'UAR-' },
    evidence: true,
    searchable: ['title', 'description', 'notes'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      description: { label: 'Scope and instructions', type: 'longtext', personal: false },
      status: { label: 'Status', type: 'lookup', list: 'access_review_status', default: 'draft', readOnly: true },
      owner_id: { label: 'Campaign owner', type: 'user' },
      starts_on: { label: 'Starts on', type: 'date' },
      due_on: { label: 'Decisions due', type: 'date', required: true },
      remind_days_before: { label: 'Remind reviewers (days before)', type: 'number', default: 3 },
      removal_days: { label: 'Days to carry out a removal', type: 'number', default: 14 },
      launched_at: { label: 'Launched', type: 'datetime', readOnly: true },
      completed_on: { label: 'Completed on', type: 'date', readOnly: true },
      control_id: { label: 'Control', type: 'ref', to: 'control' },
      control_test_id: { label: 'Recorded as control test', type: 'ref', to: 'control_test', readOnly: true },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => checkCampaign(req, null, data),
      beforeUpdate: (req, existing, patch) => checkCampaign(req, existing, patch),
    },
  });

  function checkCampaign(req: FastifyRequest | null, existing: Row | null, patch: Row): Row {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    for (const [f, max] of [['remind_days_before', 60], ['removal_days', 365]] as const) {
      if (!(f in patch) || patch[f] === null) continue;
      const n = Number(patch[f]);
      if (!Number.isInteger(n) || n < 0 || n > max) errors[f] = `Enter a whole number from 0 to ${max}.`;
    }
    if (merged.starts_on && merged.due_on && String(merged.due_on) < String(merged.starts_on)) errors.due_on = 'Decisions cannot be due before the campaign starts.';
    if (req && existing && ['complete', 'canceled'].includes(existing.status)
      && Object.keys(patch).some((k) => !['notes', 'control_id'].includes(k))) {
      ctx.fail(409, 'closed', 'A finished or canceled campaign cannot be changed, except its notes.');
    }
    if (Object.keys(errors).length) invalid(errors);
    if (!existing && req && !patch.owner_id) patch.owner_id = req.user!.id;
    return patch;
  }

  /** The campaign, for anyone who may see it or reviews part of it. */
  async function campaignFor(req: FastifyRequest, opts: { reviewer?: boolean } = {}): Promise<Row> {
    const id = idOf(req) ?? ctx.fail(404, 'not_found', 'Access review not found.');
    const seen = ctx.can(req.user, 'systems.view') ? await ctx.resources.find('access_review', id, req.user) : undefined;
    if (seen) return seen;
    if (opts.reviewer) {
      const row = await db.one<Row>(
        `select r.* from access_reviews r where r.id = $1 and r.deleted_at is null
           and exists (select 1 from access_review_systems s where s.review_id = r.id and s.reviewer_id = $2)`, [id, req.user!.id]);
      if (row) return row;
    }
    return ctx.fail(404, 'not_found', 'Access review not found.');
  }
  const needStatus = (review: Row, ...statuses: string[]) => {
    if (!statuses.includes(review.status)) {
      const what: Record<string, string> = {
        draft: 'a draft campaign', in_progress: 'a campaign in progress', complete: 'a completed campaign', canceled: 'a canceled campaign',
      };
      ctx.fail(409, 'wrong_status', `This can only be done on ${statuses.map((s) => what[s] ?? s).join(' or ')}.`);
    }
  };
  async function reviewSystem(reviewId: string, systemId: string | null): Promise<Row> {
    const rs = systemId ? await db.one<Row>('select * from access_review_systems where review_id = $1 and system_id = $2', [reviewId, systemId]) : undefined;
    return rs ?? ctx.fail(404, 'not_found', 'That system is not part of this review.');
  }

  // ---------- reading ----------

  async function systemsOf(reviewId: string): Promise<Row[]> {
    return db.query<Row>(
      `select s.id as review_system_id, s.system_id, sy.name as system_name, sy.ref as system_ref, s.reviewer_id,
              coalesce(u.display_name, u.username) as reviewer_name, s.signed_off_by, coalesce(so.display_name, so.username) as signed_off_by_name, s.signed_off_at,
              (select count(*)::int from access_review_items i where i.review_system_id = s.id) as total,
              (select count(*)::int from access_review_items i where i.review_system_id = s.id and i.decision is not null) as decided,
              (select count(*)::int from access_review_items i where i.review_system_id = s.id and i.decision = 'remove') as removals,
              (select count(*)::int from access_review_items i where i.review_system_id = s.id and i.removal_status = 'done') as removed,
              (select count(*)::int from access_review_items i join system_accounts a on a.id = i.account_id
                 where i.review_system_id = s.id and a.attention in ('leaver', 'on_leave')) as flagged,
              (select count(*)::int from system_accounts a where a.system_id = s.system_id and a.deleted_at is null and a.status = 'active') as active_accounts
       from access_review_systems s
       left join systems sy on sy.id = s.system_id
       left join users u on u.id = s.reviewer_id
       left join users so on so.id = s.signed_off_by
       where s.review_id = $1 order by lower(sy.name)`, [reviewId]);
  }

  async function itemsOf(where: string, params: unknown[]): Promise<ItemRow[]> {
    // The staff roster is read only, and only when the people module is installed.
    const roster = !!ctx.resources.get('person');
    return db.query<ItemRow>(
      `select i.*, a.attention as attention_now, a.status as account_status, a.ref as account_ref,
              ${roster ? 'p.full_name as holder_name, p.status as holder_status, p.user_id as holder_user_id,' : 'null as holder_name, null as holder_status, null::uuid as holder_user_id,'}
              coalesce(d.display_name, d.username) as decided_by_name, coalesce(rm.display_name, rm.username) as removed_by_name,
              sy.name as system_name,
              -- Nobody decides on their own account, even when the roster does not link it to them.
              array(select su.id from users su where su.deleted_at is null and (
                lower(su.username) in (lower(i.account_name), lower(a.email))
                or lower(su.email) in (lower(i.account_name), lower(a.email)))) as same_user_ids
       from access_review_items i
       left join system_accounts a on a.id = i.account_id
       ${roster ? 'left join people p on p.id = i.holder_person_id and p.deleted_at is null' : ''}
       left join users d on d.id = i.decided_by
       left join users rm on rm.id = i.removed_by
       left join systems sy on sy.id = i.system_id
       where ${where}
       order by (case when a.attention = 'leaver' then 0 when a.attention = 'on_leave' then 1 when a.attention = 'unmatched' then 2 else 3 end), lower(i.account_name)`, params);
  }

  app.get('/api/access-reviews/:id/systems', { preHandler: ctx.requirePerm('systems.view') }, async (req) => {
    const review = await campaignFor(req);
    return systemsOf(review.id);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/access-reviews/:id/systems', permission: 'systems.view',
    summary: 'The systems of an access review, with their reviewers and progress',
    response: '[{ review_system_id, system_id, system_name, reviewer_id, reviewer_name, signed_off_at, total, decided, removals, removed, flagged, active_accounts }]',
  });

  app.get('/api/access-reviews/:id/systems/:systemId/items', async (req) => {
    const review = await campaignFor(req, { reviewer: true });
    const rs = await reviewSystem(review.id, idOf(req, 'systemId'));
    const viewer = ctx.can(req.user, 'systems.view');
    const isReviewer = rs.reviewer_id === req.user!.id;
    const isOwner = review.owner_id === req.user!.id;
    if (!viewer && !isReviewer) ctx.fail(404, 'not_found', 'Access review not found.');
    const items = await itemsOf('i.review_system_id = $1', [rs.id]);
    const system = await db.one<Row>('select id, ref, name from systems where id = $1', [rs.system_id]);
    const open = review.status === 'in_progress' && !rs.signed_off_at;
    return {
      review: { id: review.id, ref: review.ref, title: review.title, status: review.status, due_on: review.due_on, owner_id: review.owner_id, description: review.description },
      system: { ...system, review_system_id: rs.id, reviewer_id: rs.reviewer_id, signed_off_at: rs.signed_off_at, signed_off_by: rs.signed_off_by },
      isReviewer, mayManage: ctx.can(req.user, 'systems.edit'),
      items: items.map((i) => ({
        ...shown(i),
        own: holds(i, req.user!.id),
        mayDecide: open && mayDecide(req.user!, review, rs, i),
      })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/access-reviews/:id/systems/:systemId/items',
    summary: 'The accounts of one system in an access review, with the decision on each',
    description: 'For people who may view systems and for the system\'s named reviewer. Each item says whether the caller may decide on it (`mayDecide`).',
    response: '{ review, system, isReviewer, mayManage, items: [{ id, account_id, account_name, display_name, holder_name, holder_status, role_on_system, privileged, last_seen_on, attention, attention_now, decision, comment, decided_by_name, decided_at, removal_status, removal_due_on, removed_at, own, mayDecide }] }',
  });

  /**
   * The named reviewer decides, except on their own account, which the campaign owner decides. An
   * account is someone's own when the roster links it to them, or when its name or email on the
   * system is their username or email (so it holds without the people module too, and for an
   * account the roster does not match).
   */
  function mayDecide(user: SessionUser, review: Row, rs: Row, item: ItemRow): boolean {
    if (holds(item, user.id)) return false;
    if (rs.reviewer_id === user.id) return true;
    return review.owner_id === user.id && holds(item, rs.reviewer_id);
  }

  app.get('/api/access-reviews/mine', async (req) => {
    const rows = await db.query<Row>(
      `select r.id as review_id, r.ref, r.title, r.status, r.due_on, s.system_id, sy.name as system_name, s.signed_off_at,
              (select count(*)::int from access_review_items i where i.review_system_id = s.id) as total,
              (select count(*)::int from access_review_items i where i.review_system_id = s.id and i.decision is not null) as decided
       from access_review_systems s
       join access_reviews r on r.id = s.review_id and r.deleted_at is null
       left join systems sy on sy.id = s.system_id
       where s.reviewer_id = $1 and r.status in ('in_progress', 'complete')
       order by (s.signed_off_at is null) desc, r.due_on nulls last, lower(sy.name)`, [req.user!.id]);
    return rows;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/access-reviews/mine',
    summary: 'The systems the caller is asked to review, in campaigns that are in progress or complete',
    response: '[{ review_id, ref, title, status, due_on, system_id, system_name, signed_off_at, total, decided }]',
  });

  // ---------- setting up ----------

  async function defaultReviewer(systemId: string): Promise<string | null> {
    const s = await db.one<Row>('select business_owner_id, technical_owner_id from systems where id = $1', [systemId]);
    return s?.business_owner_id ?? s?.technical_owner_id ?? null;
  }
  async function activeUser(id: unknown): Promise<string | null> {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
    const u = await db.one<{ id: string }>(`select id from users where id = $1 and deleted_at is null and status = 'active'`, [id]);
    return u?.id ?? null;
  }

  /** Copies the active accounts of one system into a campaign (those not already in it). */
  async function snapshot(reviewId: string, rs: Row): Promise<number> {
    const rows = await db.query<{ id: string }>(
      `insert into access_review_items (review_id, review_system_id, system_id, account_id, account_name, display_name, holder_person_id,
                                        account_kind, role_on_system, privileged, last_seen_on, attention)
       select $1, $2, a.system_id, a.id, a.account_name, a.display_name, a.holder_person_id, a.account_kind, a.role_on_system,
              coalesce(a.privileged, false), a.last_seen_on, a.attention
       from system_accounts a where a.system_id = $3 and a.deleted_at is null and a.status = 'active'
       on conflict (review_id, account_id) do nothing returning id`, [reviewId, rs.id, rs.system_id]);
    return rows.length;
  }

  app.post('/api/access-reviews/:id/systems', { preHandler: ctx.requirePerm('systems.edit') }, async (req, reply) => {
    const review = await campaignFor(req);
    needStatus(review, 'draft', 'in_progress');
    const body = (req.body ?? {}) as Row;
    const ids = (Array.isArray(body.system_ids) ? body.system_ids : [body.system_id]).filter((v: unknown) => typeof v === 'string');
    if (!ids.length) invalid({ system_id: 'Choose a system.' });
    const added: Row[] = [];
    for (const systemId of ids as string[]) {
      const system = UUID_RE.test(systemId) ? await ctx.resources.find('system', systemId, req.user) : undefined;
      if (!system) invalid({ system_id: 'System not found.' });
      if (await db.one('select 1 from access_review_systems where review_id = $1 and system_id = $2', [review.id, systemId])) continue;
      let reviewer = body.reviewer_id ? await activeUser(body.reviewer_id) : await defaultReviewer(systemId);
      if (body.reviewer_id && !reviewer) invalid({ reviewer_id: 'Choose an active user as the reviewer.' });
      if (reviewer && !(await activeUser(reviewer))) reviewer = null;
      const rs = (await db.one<Row>(
        'insert into access_review_systems (review_id, system_id, reviewer_id) values ($1, $2, $3) returning *', [review.id, systemId, reviewer]))!;
      const copied = review.status === 'in_progress' ? await snapshot(review.id, rs) : 0;
      await ctx.audit(req, {
        action: 'access_review.system_add', recordType: 'access_review', recordId: review.id,
        summary: `System added to the review: ${system!.name}${copied ? ` (${copied} accounts)` : ''}`, after: { system_id: systemId, reviewer_id: reviewer },
      });
      if (review.status === 'in_progress' && reviewer) await askReviewer(review, rs, String(system!.name));
      added.push(rs);
    }
    reply.code(201);
    return systemsOf(review.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/systems', permission: 'systems.edit',
    summary: 'Adds systems to a draft or running access review',
    description: 'The reviewer defaults to the system\'s business owner, else its technical owner. Added to a running review, the system\'s active accounts are copied in at once and the reviewer is told.',
    body: '{ system_id? , system_ids?: [], reviewer_id? }', response: 'The review\'s systems, as GET returns them',
  });

  app.patch('/api/access-reviews/:id/systems/:systemId', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const review = await campaignFor(req);
    needStatus(review, 'draft', 'in_progress');
    const rs = await reviewSystem(review.id, idOf(req, 'systemId'));
    if (rs.signed_off_at) ctx.fail(409, 'signed_off', 'This system has been signed off; its reviewer cannot change.');
    const body = (req.body ?? {}) as Row;
    const reviewer = await activeUser(body.reviewer_id);
    if (!reviewer) invalid({ reviewer_id: 'Choose an active user as the reviewer.' });
    await db.query('update access_review_systems set reviewer_id = $2 where id = $1', [rs.id, reviewer]);
    const name = (await db.one<Row>('select name from systems where id = $1', [rs.system_id]))?.name ?? 'System';
    await ctx.audit(req, {
      action: 'access_review.reviewer', recordType: 'access_review', recordId: review.id,
      summary: `Reviewer of ${name} changed`, before: { reviewer_id: rs.reviewer_id }, after: { reviewer_id: reviewer },
    });
    if (review.status === 'in_progress') await askReviewer(review, { ...rs, reviewer_id: reviewer }, String(name));
    return systemsOf(review.id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/access-reviews/:id/systems/:systemId', permission: 'systems.edit',
    summary: 'Changes who reviews one system of an access review', body: '{ reviewer_id }', response: 'The review\'s systems',
  });

  app.delete('/api/access-reviews/:id/systems/:systemId', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const review = await campaignFor(req);
    needStatus(review, 'draft', 'in_progress');
    const rs = await reviewSystem(review.id, idOf(req, 'systemId'));
    if (await db.one('select 1 from access_review_items where review_system_id = $1 and decision is not null limit 1', [rs.id])) {
      ctx.fail(409, 'decided', 'Accounts of this system have already been decided on; it stays in the review.');
    }
    await db.query('delete from access_review_systems where id = $1', [rs.id]);
    const name = (await db.one<Row>('select name from systems where id = $1', [rs.system_id]))?.name ?? 'System';
    await ctx.audit(req, { action: 'access_review.system_remove', recordType: 'access_review', recordId: review.id, summary: `System taken out of the review: ${name}`, before: { system_id: rs.system_id } });
    return systemsOf(review.id);
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/access-reviews/:id/systems/:systemId', permission: 'systems.edit',
    summary: 'Takes a system out of an access review (only while none of its accounts is decided)', response: 'The review\'s systems',
  });

  async function askReviewer(review: Row, rs: Row, systemName: string) {
    if (!rs.reviewer_id || !app.hasDecorator('notify')) return;
    await app.notify({
      userIds: [rs.reviewer_id], kind: 'access_review',
      title: `Review the accounts on ${systemName}`,
      body: `${review.ref ?? ''} ${review.title}: keep or remove each account${review.due_on ? ` by ${ymd(review.due_on)}` : ''}.`.trim(),
      // No record: a reviewer need not hold systems.view (the notification would be skipped). The
      // route's first segment still hides it while the area is switched off.
      route: `/access-reviews/${review.id}/systems/${rs.system_id}`,
      once: `accessreviews.ask:${rs.id}:${rs.reviewer_id}`,
    });
  }

  app.post('/api/access-reviews/:id/launch', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const review = await campaignFor(req);
    needStatus(review, 'draft');
    const systems = await db.query<Row>(
      'select s.*, sy.name from access_review_systems s left join systems sy on sy.id = s.system_id where s.review_id = $1', [review.id]);
    if (!systems.length) ctx.fail(409, 'no_systems', 'Add at least one system before launching the review.');
    const noReviewer = systems.filter((s) => !s.reviewer_id).map((s) => s.name);
    if (noReviewer.length) ctx.fail(409, 'no_reviewer', `Choose a reviewer for ${noReviewer.join(', ')} first.`);
    if (!review.due_on) invalid({ due_on: 'Give the date decisions are due.' });
    let copied = 0;
    for (const rs of systems) copied += await snapshot(review.id, rs);
    await db.query(`update access_reviews set status = 'in_progress', launched_at = now(), starts_on = coalesce(starts_on, $2::date), updated_at = now(), updated_by = $3 where id = $1`,
      [review.id, dayInZone(), req.user!.id]);
    await ctx.audit(req, {
      action: 'access_review.launch', recordType: 'access_review', recordId: review.id,
      summary: `Review launched: ${systems.length} system${systems.length === 1 ? '' : 's'}, ${copied} account${copied === 1 ? '' : 's'} to decide on`,
      before: { status: review.status }, after: { status: 'in_progress' },
    });
    for (const rs of systems) await askReviewer(review, rs, String(rs.name ?? 'a system'));
    return { review: await ctx.resources.find('access_review', review.id, req.user), systems: await systemsOf(review.id), accounts: copied };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/launch', permission: 'systems.edit',
    summary: 'Launches a draft access review: copies each system\'s active accounts in and asks each reviewer',
    response: '{ review, systems, accounts }',
  });

  // ---------- deciding ----------

  app.post('/api/access-reviews/:id/decisions', async (req) => {
    const review = await campaignFor(req, { reviewer: true });
    needStatus(review, 'in_progress');
    const body = (req.body ?? {}) as Row;
    const ids = (Array.isArray(body.items) ? body.items : [body.item_id]).filter((v: unknown) => typeof v === 'string' && UUID_RE.test(v as string)) as string[];
    if (!ids.length) invalid({ items: 'Choose the accounts to decide on.' });
    const decision = body.decision === null ? null : String(body.decision ?? '');
    if (decision !== null && !(DECISIONS as readonly string[]).includes(decision)) invalid({ decision: 'Keep or remove.' });
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
    const items = await itemsOf('i.review_id = $1 and i.id = any($2::uuid[])', [review.id, ids]);
    if (items.length !== new Set(ids).size) ctx.fail(404, 'not_found', 'Account not found in this review.');
    const systems = new Map((await db.query<Row>('select * from access_review_systems where review_id = $1', [review.id])).map((s) => [s.id, s]));
    for (const i of items) {
      const rs = systems.get(i.review_system_id)!;
      if (rs.signed_off_at) ctx.fail(409, 'signed_off', `${i.system_name ?? 'This system'} has been signed off; its decisions are final.`);
      if (!mayDecide(req.user!, review, rs, i)) {
        if (holds(i, req.user!.id)) ctx.fail(403, 'own_account', 'Someone else decides on your own account. The campaign owner decides on a reviewer\'s own account.');
        ctx.fail(403, 'forbidden', 'Only the reviewer named for this system may decide on its accounts.');
      }
      if (decision === 'keep' && !comment && !i.comment && (i.attention_now === 'leaver' || i.attention === 'leaver')) {
        invalid({ comment: `Say why ${i.account_name} should stay although its holder has left.` });
      }
    }
    const saved = await db.query<{ id: string }>(
      `update access_review_items set decision = $2, decided_by = case when $2::text is null then null else $3::uuid end,
              decided_at = case when $2::text is null then null else now() end, comment = coalesce(nullif($4, ''), comment)
       where id = any($1::uuid[]) and review_system_id in (select id from access_review_systems where review_id = $5 and signed_off_at is null)
       returning id`, [ids, decision, req.user!.id, comment, review.id]);
    const label = decision === 'keep' ? 'Keep' : decision === 'remove' ? 'Remove' : 'Undecided';
    await ctx.audit(req, {
      action: 'access_review.decide', recordType: 'access_review', recordId: review.id,
      summary: items.length === 1 ? `${label}: ${items[0].account_name} on ${items[0].system_name ?? 'a system'}` : `${label}: ${items.length} accounts`,
      after: { items: items.map((i) => ({ id: i.id, account: i.account_name, system: i.system_name })), decision, comment: comment || null },
    });
    return { saved: saved.length };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/decisions',
    summary: 'Keeps or removes one or more accounts in a running access review',
    description: 'Only the reviewer named for the accounts\' system may decide (the campaign owner decides on the reviewer\'s own account); nobody decides on their own account. Keeping a leaver\'s account needs a comment. `decision: null` clears a decision before sign-off.',
    body: '{ items: [item id], decision: "keep" | "remove" | null, comment? }', response: '{ saved }',
  });

  app.post('/api/access-reviews/:id/systems/:systemId/sign-off', async (req) => {
    const review = await campaignFor(req, { reviewer: true });
    needStatus(review, 'in_progress');
    const rs = await reviewSystem(review.id, idOf(req, 'systemId'));
    if (rs.reviewer_id !== req.user!.id) ctx.fail(403, 'forbidden', 'Only the reviewer named for this system signs it off.');
    if (rs.signed_off_at) ctx.fail(409, 'signed_off', 'This system has already been signed off.');
    const open = await db.one<{ n: number }>('select count(*)::int as n from access_review_items where review_system_id = $1 and decision is null', [rs.id]);
    if (open && open.n > 0) ctx.fail(409, 'undecided', `${open.n} account${open.n === 1 ? ' is' : 's are'} still to be decided.`);
    const claimed = await db.one<{ id: string }>(
      'update access_review_systems set signed_off_by = $2, signed_off_at = now() where id = $1 and signed_off_at is null returning id', [rs.id, req.user!.id]);
    if (!claimed) ctx.fail(409, 'signed_off', 'This system has already been signed off.');
    const system = await db.one<Row>('select id, name, technical_owner_id, business_owner_id from systems where id = $1', [rs.system_id]);
    const removals = await db.query<Row>(`select * from access_review_items where review_system_id = $1 and decision = 'remove'`, [rs.id]);
    const due = addDays(dayInZone(), Math.max(0, Number(review.removal_days ?? 14)));
    for (const i of removals) {
      let actionId: string | null = null;
      if (ctx.resources.get('action')) {
        try {
          const action = await ctx.resources.create('action', {
            title: `Remove account ${i.account_name} from ${system?.name ?? 'a system'}`.slice(0, 200),
            description: `Decided in access review ${review.ref ?? ''} ${review.title}. Record the removal on the review once it is done.`.trim(),
            owner_id: system?.technical_owner_id ?? rs.reviewer_id, due_on: due, priority: i.attention === 'leaver' ? 'high' : 'medium',
            source: 'access_review', source_type: 'access_review', source_id: review.id,
          }, null);
          actionId = action.id;
        } catch (err) {
          app.log.warn({ err }, 'access review: the removal action could not be created');
        }
      }
      await db.query(`update access_review_items set removal_status = 'pending', removal_due_on = $2, action_id = $3 where id = $1`, [i.id, due, actionId]);
      if (ctx.resources.get('system_account') && await db.one('select 1 from system_accounts where id = $1 and deleted_at is null', [i.account_id])) {
        await db.query('update system_accounts set removal_requested_on = $2, updated_at = now() where id = $1', [i.account_id, dayInZone()]);
      }
    }
    await ctx.audit(req, {
      action: 'access_review.sign_off', recordType: 'access_review', recordId: review.id,
      summary: `${system?.name ?? 'System'} signed off: ${removals.length} account${removals.length === 1 ? '' : 's'} to remove by ${due}`,
      after: { system_id: rs.system_id, removals: removals.length },
    });
    if (app.hasDecorator('notify') && review.owner_id) {
      const left = await db.one<{ n: number }>('select count(*)::int as n from access_review_systems where review_id = $1 and signed_off_at is null', [review.id]);
      if (left && left.n === 0) {
        await app.notify({
          userIds: [review.owner_id], kind: 'access_review', title: `Every system of ${review.ref ?? 'the review'} is signed off`,
          body: 'The review can now be completed.', recordType: 'access_review', recordId: review.id,
          once: `accessreviews.signed:${review.id}`,
        });
      }
    }
    return { removals: removals.length, due_on: due };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/systems/:systemId/sign-off',
    summary: 'The reviewer signs off one system once every account is decided; each removal is then tracked (and raised as an action)',
    response: '{ removals, due_on }',
  });

  // ---------- removals ----------

  /** Marks removals done (system work besides the audit event); closes their actions and accounts. */
  async function finishRemovals(items: Row[], by: string | null, note: string, req: FastifyRequest | null): Promise<number> {
    let n = 0;
    for (const i of items) {
      const done = await db.one<{ id: string }>(
        `update access_review_items set removal_status = 'done', removed_by = $2, removed_at = now(), removal_note = nullif($3, '')
         where id = $1 and removal_status = 'pending' returning id`, [i.id, by, note]);
      if (!done) continue;
      n += 1;
      if (ctx.resources.get('system_account')) {
        const acc = await db.one<Row>('select id, status from system_accounts where id = $1 and deleted_at is null', [i.account_id]);
        if (acc && acc.status !== 'removed') await ctx.resources.update('system_account', acc.id, { status: 'removed' }, null, { via: 'an access review' });
      }
      if (i.action_id && ctx.resources.get('action')) {
        const action = await db.one<Row>('select id, status from actions where id = $1 and deleted_at is null', [i.action_id]);
        if (action && !['done', 'canceled', 'cancelled'].includes(action.status)) {
          try { await ctx.resources.update('action', action.id, { status: 'done' }, null, { via: 'an access review' }); } catch (err) {
            app.log.warn({ err }, 'access review: the removal action could not be closed');
          }
        }
      }
      await ctx.audit(req, {
        action: 'access_review.removed', recordType: 'access_review', recordId: i.review_id,
        summary: `Removal done: ${i.account_name}${note ? ` (${note})` : ''}`, after: { item_id: i.id, account_id: i.account_id },
      });
    }
    return n;
  }

  app.post('/api/access-reviews/:id/items/:itemId/removed', async (req) => {
    const review = await campaignFor(req, { reviewer: true });
    const itemId = idOf(req, 'itemId');
    const item = itemId ? await db.one<Row>('select * from access_review_items where id = $1 and review_id = $2', [itemId, review.id]) : undefined;
    if (!item) ctx.fail(404, 'not_found', 'Account not found in this review.');
    const rs = (await db.one<Row>('select * from access_review_systems where id = $1', [item!.review_system_id]))!;
    const sys = await db.one<Row>('select technical_owner_id from systems where id = $1', [item!.system_id]);
    const allowed = ctx.can(req.user, 'systems.edit') || rs.reviewer_id === req.user!.id || sys?.technical_owner_id === req.user!.id;
    if (!allowed) ctx.fail(403, 'forbidden', 'The system\'s reviewer, its technical owner or someone who may edit systems records a removal.');
    if (item!.removal_status !== 'pending') ctx.fail(409, 'not_pending', item!.removal_status === 'done' ? 'This removal is already recorded as done.' : 'This account is not waiting to be removed.');
    const body = (req.body ?? {}) as Row;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    await finishRemovals([item!], req.user!.id, note, req);
    return { done: true };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/items/:itemId/removed',
    summary: 'Records that an account decided "remove" has been removed from its system',
    description: 'For the system\'s reviewer, its technical owner, or anyone who may edit systems. Marks the account removed and finishes its action.',
    body: '{ note? }', response: '{ done }',
  });

  app.get('/api/access-reviews/:id/removals', { preHandler: ctx.requirePerm('systems.view') }, async (req) => {
    const review = await campaignFor(req);
    return (await itemsOf(`i.review_id = $1 and i.removal_status is not null`, [review.id])).map(shown);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/access-reviews/:id/removals', permission: 'systems.view',
    summary: 'The removals an access review decided on, pending and done', response: '[item]',
  });

  // An action raised for a removal that is finished in the action tracker finishes the removal.
  ctx.resources.onChange?.(async (c) => {
    if (c.def.type !== 'action' || c.action !== 'update' || c.row.source_type !== 'access_review' || c.row.status !== 'done') return;
    const items = await db.query<Row>(`select * from access_review_items where action_id = $1 and removal_status = 'pending'`, [c.row.id]);
    if (items.length) await finishRemovals(items, c.req?.user?.id ?? null, 'Action finished', c.req);
  });

  /** Accounts the system no longer lists (an import): their pending removals are done. */
  async function confirmByImport(accountIds: string[], req: FastifyRequest): Promise<number> {
    if (!accountIds.length) return 0;
    const items = await db.query<Row>(`select * from access_review_items where account_id = any($1::uuid[]) and removal_status = 'pending'`, [accountIds]);
    return finishRemovals(items, req.user?.id ?? null, 'No longer in the system\'s account file', req);
  }

  // ---------- finishing ----------

  app.post('/api/access-reviews/:id/complete', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const review = await campaignFor(req);
    needStatus(review, 'in_progress');
    const left = await db.query<Row>(
      'select sy.name from access_review_systems s left join systems sy on sy.id = s.system_id where s.review_id = $1 and s.signed_off_at is null', [review.id]);
    if (left.length) ctx.fail(409, 'not_signed_off', `Still to be signed off: ${left.map((s) => s.name ?? 'a system').join(', ')}.`);
    const today = dayInZone();
    await db.query(`update access_reviews set status = 'complete', completed_on = $2, updated_at = now(), updated_by = $3 where id = $1`, [review.id, today, req.user!.id]);
    const t = await totals(review.id);
    await ctx.audit(req, {
      action: 'access_review.complete', recordType: 'access_review', recordId: review.id,
      summary: `Review completed: ${t.accounts} accounts, ${t.kept} kept, ${t.removals} to remove (${t.removed} done)`,
      before: { status: review.status }, after: { status: 'complete', completed_on: today, ...t },
    });
    return { review: await ctx.resources.find('access_review', review.id, req.user), totals: t };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/complete', permission: 'systems.edit',
    summary: 'Completes an access review whose systems are all signed off (removals may still be under way)', response: '{ review, totals }',
  });

  app.post('/api/access-reviews/:id/cancel', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const review = await campaignFor(req);
    needStatus(review, 'draft', 'in_progress');
    await db.query(`update access_reviews set status = 'canceled', updated_at = now(), updated_by = $2 where id = $1`, [review.id, req.user!.id]);
    await ctx.audit(req, { action: 'access_review.cancel', recordType: 'access_review', recordId: review.id, summary: 'Review canceled', before: { status: review.status }, after: { status: 'canceled' } });
    return { review: await ctx.resources.find('access_review', review.id, req.user) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/cancel', permission: 'systems.edit',
    summary: 'Cancels a draft or running access review (decisions already made are kept)', response: '{ review }',
  });

  async function totals(reviewId: string) {
    const t = await db.one<Row>(
      `select count(*)::int as accounts, count(*) filter (where decision = 'keep')::int as kept,
              count(*) filter (where decision = 'remove')::int as removals, count(*) filter (where removal_status = 'done')::int as removed,
              count(*) filter (where attention = 'leaver')::int as leavers, count(*) filter (where attention = 'on_leave')::int as on_leave,
              count(*) filter (where attention = 'unmatched')::int as unmatched, count(distinct system_id)::int as systems
       from access_review_items where review_id = $1`, [reviewId]);
    return {
      accounts: t?.accounts ?? 0, kept: t?.kept ?? 0, removals: t?.removals ?? 0, removed: t?.removed ?? 0,
      leavers: t?.leavers ?? 0, onLeave: t?.on_leave ?? 0, unmatched: t?.unmatched ?? 0, systems: t?.systems ?? 0,
    };
  }

  app.get('/api/access-reviews/:id/totals', { preHandler: ctx.requirePerm('systems.view') }, async (req) => {
    const review = await campaignFor(req);
    return totals(review.id);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/access-reviews/:id/totals', permission: 'systems.view',
    summary: 'Counts of an access review: accounts, kept, removals and removals done, and accounts flagged at launch',
    response: '{ accounts, kept, removals, removed, leavers, onLeave, unmatched, systems }',
  });

  // ---------- recording as a control test ----------

  app.post('/api/access-reviews/:id/control-test', { preHandler: ctx.requirePerm('controls.create') }, async (req, reply) => {
    if (!ctx.resources.get('control_test')) ctx.fail(404, 'not_found', 'The control library is not available.');
    const review = await campaignFor(req);
    needStatus(review, 'complete');
    if (review.control_test_id) ctx.fail(409, 'recorded', 'This review has already been recorded as a control test.');
    const body = (req.body ?? {}) as Row;
    const controlId = typeof body.control_id === 'string' && body.control_id ? body.control_id : review.control_id;
    if (!controlId || !UUID_RE.test(String(controlId)) || !(await ctx.resources.find('control', String(controlId), req.user))) {
      invalid({ control_id: 'Choose the control this review tests.' });
    }
    const t = await totals(review.id);
    const results = (await ctx.lookups.values('control_test_result')).map((v) => v.value);
    const result = typeof body.result === 'string' && results.includes(body.result) ? body.result
      : t.removals === 0 ? 'effective' : results.includes('partly_effective') ? 'partly_effective' : results[0];
    const extra = typeof body.conclusion === 'string' ? body.conclusion.trim().slice(0, 4000) : '';
    const conclusion = [
      `Access review ${review.ref ?? ''} ${review.title}: ${t.accounts} account${t.accounts === 1 ? '' : 's'} on ${t.systems} system${t.systems === 1 ? '' : 's'} reviewed by their owners; ${t.kept} kept and ${t.removals} to be removed (${t.removed} removed so far).`,
      t.leavers ? `${t.leavers} active account${t.leavers === 1 ? '' : 's'} belonged to people who had left when the review began.` : '',
      extra,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const launched = review.launched_at ? new Date(review.launched_at).toISOString().slice(0, 10) : null;
    const test = await ctx.resources.create('control_test', {
      control_id: controlId, test_type: 'operating', title: `Access review: ${review.title}`.slice(0, 200),
      period_start: review.starts_on ?? launched, period_end: review.completed_on, performed_on: review.completed_on,
      tester_id: req.user!.id, method: 'inspection',
      population: `Active accounts on ${t.systems} system${t.systems === 1 ? '' : 's'} at launch: ${t.accounts}`,
      sample_size: t.accounts, exceptions_found: t.removals, result, conclusion, status: 'complete',
    }, req);
    await ctx.resources.update('access_review', review.id, { control_id: controlId, control_test_id: test.id }, null, { via: 'recording the review as a control test' });
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('control_test', $1, 'access_review', $2, 'evidence', $3)
       on conflict do nothing`, [test.id, review.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'access_review.control_test', recordType: 'access_review', recordId: review.id,
      summary: `Recorded as control test ${test.ref ?? ''}`.trim(), after: { control_id: controlId, control_test_id: test.id, result },
    });
    reply.code(201);
    return { test };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/access-reviews/:id/control-test', permission: 'controls.create',
    summary: 'Records a completed access review as an operating test of a control, awaiting its independent review',
    description: 'Population: the accounts reviewed; exceptions: the accounts decided "remove". The result defaults to effective with no removals, else partly effective. The test links back to the review.',
    body: '{ control_id?, result?, conclusion? }', response: '{ test }',
  });

  // ---------- the decision file ----------

  app.get('/api/access-reviews/:id/export', { preHandler: ctx.requirePerm('systems.export') }, async (req, reply: FastifyReply) => {
    const review = await campaignFor(req);
    const items = await itemsOf('i.review_id = $1', [review.id]);
    const head = ['Review', 'System', 'Account', 'Name on the system', 'Holder', 'Holder status', 'Role on the system', 'Privileged', 'Last seen',
      'Flag at launch', 'Decision', 'Decided by', 'Decided at', 'Comment', 'Removal', 'Removal due', 'Removed at', 'Removed by', 'Removal note'];
    const lines = [head.map(csvCell).join(',')];
    const day = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? '');
    for (const i of items) {
      lines.push([
        `${review.ref ?? ''} ${review.title}`.trim(), i.system_name, i.account_name, i.display_name, i.holder_name, i.holder_status, i.role_on_system,
        i.privileged ? 'Yes' : 'No', day(i.last_seen_on), i.attention, i.decision, i.decided_by_name, day(i.decided_at), i.comment,
        i.removal_status, day(i.removal_due_on), day(i.removed_at), i.removed_by_name, i.removal_note,
      ].map(csvCell).join(','));
    }
    await ctx.audit(req, { action: 'access_review.export', recordType: 'access_review', recordId: review.id, summary: `Exported the decisions of ${items.length} accounts to CSV` });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="access-review-${String(review.ref ?? 'decisions').toLowerCase()}.csv"`);
    return '﻿' + lines.join('\r\n');
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/access-reviews/:id/export', permission: 'systems.export',
    summary: 'Every decision of an access review as a CSV file, for the evidence file', response: 'text/csv',
  });

  return { confirmByImport, totals };
}
