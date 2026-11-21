// Policy versions and the policy life cycle: write, send for review, approve, publish, retire.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { audienceUserIds, publishVersion, syncPolicyStatus } from './acknowledgments.ts';
import { isDate, localDate } from './dates.ts';
import { renderPolicyMarkdown } from './markdown.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 200_000;

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

export const versionView = (v: Row, withBody = true) => ({
  id: v.id, policy_id: v.policy_id, version: Number(v.version), status: v.status,
  change_summary: v.change_summary, approved_by_name: v.approved_by_name, approved_on: v.approved_on,
  effective_on: v.effective_on, published_at: v.published_at, created_at: v.created_at, updated_at: v.updated_at,
  author_name: v.author_name ?? null, created_by: v.created_by ?? null,
  ...(withBody ? { body: v.body, body_html: renderPolicyMarkdown(v.body) } : {}),
});

const label = (p: Row) => [p.ref, p.title].filter(Boolean).join(' ');

export function registerVersionRoutes(ctx: ModuleContext) {
  const { db } = ctx;

  async function needPolicy(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('policy', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Policy not found.');
  }
  async function needVersion(policy: Row, vid: unknown): Promise<Row> {
    const row = typeof vid === 'string' && UUID.test(vid)
      ? await db.one<Row>('select * from policy_versions where id = $1 and policy_id = $2', [vid, policy.id])
      : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Version not found.');
  }
  /** People who write or approve policies see every version; readers see only what has been published. */
  const seesDrafts = (req: FastifyRequest) => ctx.can(req.user, 'policies.edit') || ctx.can(req.user, 'policies.approve');

  function bodyInput(b: Row, mode: 'create' | 'update'): Row {
    const out: Row = {};
    const fields: Record<string, string> = {};
    if (b.body !== undefined || mode === 'create') {
      const body = typeof b.body === 'string' ? b.body : '';
      if (!body.trim()) fields.body = 'Write the policy text.';
      else if (body.length > MAX_BODY) fields.body = 'The policy text is too long.';
      else out.body = body;
    }
    if (b.change_summary !== undefined) out.change_summary = text(b.change_summary);
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  ctx.app.post('/api/policies/preview', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const body = (req.body as Row | null)?.body;
    return { html: renderPolicyMarkdown(typeof body === 'string' ? body.slice(0, MAX_BODY) : '') };
  });

  ctx.app.get('/api/policies/audience-options', { preHandler: ctx.requirePerm('policies.view') }, async () => ({
    roles: await db.query<Row>('select key, name, enabled from roles order by name'),
    departments: await db.query<Row>('select id, name from departments where deleted_at is null order by lower(name)'),
    // Positions of the roster (people module, E29-09), for roster audiences; empty without it.
    positions: ctx.resources.get('position')
      ? await db.query<Row>('select id, name, active from positions where deleted_at is null order by lower(name)') : [],
  }));

  /** How many people would be asked to acknowledge if a version were published now. */
  ctx.app.get('/api/policies/:id/audience', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await needPolicy(req);
    return { count: (await audienceUserIds(ctx, policy)).length, ack_days: Number(policy.ack_days) };
  });

  ctx.app.get('/api/policies/:id/versions', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await needPolicy(req);
    const rows = await db.query<Row>(
      `select v.*, u.display_name as author_name from policy_versions v left join users u on u.id = v.created_by
       where v.policy_id = $1 order by v.version desc`, [policy.id],
    );
    return rows.filter((v) => seesDrafts(req) || ['published', 'superseded'].includes(v.status)).map((v) => versionView(v));
  });

  ctx.app.post('/api/policies/:id/versions', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => {
    const policy = await needPolicy(req);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This policy is retired. It cannot have a new version.');
    const data = bodyInput((req.body ?? {}) as Row, 'create');
    // One request at a time per policy (BS-8): the policy row is locked while the open-version check
    // and the next number are worked out, so two requests at once (a double click) cannot both pass.
    const openVersion = (v: unknown) => ctx.fail(409, 'version_open', `Version ${v} is not published yet. Finish that version before starting another.`);
    let row: Row;
    try {
      row = await db.tx(async (tx) => {
        await tx.query('select id from policies where id = $1 for update', [policy.id]);
        const open = await tx.one<Row>(
          `select version from policy_versions where policy_id = $1 and status in ('draft', 'in_review', 'approved') order by version desc limit 1`,
          [policy.id],
        );
        if (open) openVersion(open.version);
        const n = (await tx.one<{ n: number }>('select coalesce(max(version), 0)::int + 1 as n from policy_versions where policy_id = $1', [policy.id]))!.n;
        return (await tx.one<Row>(
          `insert into policy_versions (policy_id, version, body, change_summary, created_by, updated_by) values ($1,$2,$3,$4,$5,$5) returning *`,
          [policy.id, n, data.body, data.change_summary ?? null, req.user!.id],
        ))!;
      });
    } catch (err) {
      // A database without row locks for this case still keeps one version per number: answer as above.
      if ((err as { code?: string }).code === '23505' || /unique|duplicate/i.test((err as Error).message)) {
        const open = await db.one<Row>(`select version from policy_versions where policy_id = $1 and status in ('draft', 'in_review', 'approved') order by version desc limit 1`, [policy.id]);
        openVersion(open?.version ?? 'being drafted');
      }
      throw err;
    }
    const next = row.version as number;
    await syncPolicyStatus(ctx, policy.id, req.user!.id);
    await ctx.audit(req, {
      action: 'policy.version_create', recordType: 'policy', recordId: policy.id,
      summary: `Version ${next} of ${label(policy)} drafted`, after: { version: next, change_summary: row.change_summary },
    });
    reply.code(201);
    return versionView(row);
  });

  ctx.app.patch('/api/policies/:id/versions/:vid', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    if (version.status !== 'draft') ctx.fail(409, 'not_draft', 'Only a draft version can be edited. Start a new version instead.');
    const data = bodyInput((req.body ?? {}) as Row, 'update');
    const merged = { ...version, ...data };
    if (merged.body === version.body && merged.change_summary === version.change_summary) return versionView(version);
    const row = (await db.one<Row>(
      'update policy_versions set body = $2, change_summary = $3, updated_at = now(), updated_by = $4 where id = $1 returning *',
      [version.id, merged.body, merged.change_summary, req.user!.id],
    ))!;
    await ctx.audit(req, {
      action: 'policy.version_update', recordType: 'policy', recordId: policy.id,
      summary: `Draft version ${version.version} of ${label(policy)} edited`,
      before: { change_summary: version.change_summary, body_length: String(version.body ?? '').length },
      after: { change_summary: row.change_summary, body_length: String(row.body ?? '').length },
    });
    return versionView(row);
  });

  /** Discards a version that has not been approved. Its text is kept in the audit event, so nothing is lost for good. */
  ctx.app.delete('/api/policies/:id/versions/:vid', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    if (!['draft', 'in_review'].includes(version.status)) {
      ctx.fail(409, 'not_draft', 'Only a version that has not been approved can be discarded.');
    }
    await db.query('delete from policy_versions where id = $1', [version.id]);
    await syncPolicyStatus(ctx, policy.id, req.user!.id);
    await ctx.audit(req, {
      action: 'policy.version_discard', recordType: 'policy', recordId: policy.id,
      summary: `${version.status === 'draft' ? 'Draft' : 'In-review'} version ${version.version} of ${label(policy)} discarded`,
      before: { version: Number(version.version), status: version.status, change_summary: version.change_summary, body: version.body },
    });
    return { ok: true, status: (await db.one<Row>('select status from policies where id = $1', [policy.id]))?.status ?? policy.status };
  });

  ctx.app.post('/api/policies/:id/versions/:vid/submit', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    if (version.status !== 'draft') ctx.fail(409, 'not_draft', 'Only a draft version can be sent for review.');
    const row = (await db.one<Row>(
      `update policy_versions set status = 'in_review', updated_at = now(), updated_by = $2 where id = $1 returning *`, [version.id, req.user!.id],
    ))!;
    await syncPolicyStatus(ctx, policy.id, req.user!.id);
    await ctx.audit(req, {
      action: 'policy.version_submit', recordType: 'policy', recordId: policy.id,
      summary: `Version ${version.version} of ${label(policy)} sent for review`, before: { status: 'draft' }, after: { status: 'in_review' },
    });
    return versionView(row);
  });

  ctx.app.post('/api/policies/:id/versions/:vid/approve', { preHandler: ctx.requirePerm('policies.approve') }, async (req) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This policy is retired.');
    if (!['draft', 'in_review'].includes(version.status)) ctx.fail(409, 'not_open', 'This version has already been approved.');
    if (version.created_by && version.created_by === req.user!.id) {
      ctx.fail(403, 'own_version', 'You wrote this version, so someone else must approve it.');
    }
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const approvedOn = text(b.approved_on) ?? localDate();
    const effectiveOn = text(b.effective_on);
    if (!isDate(approvedOn)) fields.approved_on = 'Approval date must be a date (YYYY-MM-DD).';
    if (effectiveOn !== null && !isDate(effectiveOn)) fields.effective_on = 'Effective date must be a date (YYYY-MM-DD).';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const approver = text(b.approved_by_name) ?? text(policy.approver_name) ?? req.user!.displayName;
    const row = (await db.one<Row>(
      `update policy_versions set status = 'approved', approved_by = $2, approved_by_name = $3, approved_on = $4, effective_on = $5,
         updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [version.id, req.user!.id, approver, approvedOn, effectiveOn],
    ))!;
    await syncPolicyStatus(ctx, policy.id, req.user!.id);
    await ctx.audit(req, {
      action: 'policy.version_approve', recordType: 'policy', recordId: policy.id,
      summary: `Version ${version.version} of ${label(policy)} approved by ${approver}`,
      before: { status: version.status }, after: { status: 'approved', approved_by_name: approver, approved_on: approvedOn, effective_on: effectiveOn },
    });
    return versionView(row);
  });

  ctx.app.post('/api/policies/:id/versions/:vid/publish', { preHandler: ctx.requirePerm('policies.approve') }, async (req) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    const effectiveOn = text(((req.body ?? {}) as Row).effective_on);
    if (effectiveOn !== null && !isDate(effectiveOn)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { effective_on: 'Effective date must be a date (YYYY-MM-DD).' });
    }
    const result = await publishVersion(ctx, req, policy, version, { effective_on: effectiveOn });
    return { version: versionView(result.version), requested: result.requested, roster_requested: result.roster_requested ?? 0, due_on: result.due_on, status: result.policy.status };
  });

  ctx.app.post('/api/policies/:id/retire', { preHandler: ctx.requirePerm('policies.approve') }, async (req) => {
    const policy = await needPolicy(req);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This policy is already retired.');
    await db.query(`update policies set status = 'retired', updated_at = now(), updated_by = $2 where id = $1`, [policy.id, req.user!.id]);
    const closed = await db.query<Row>(
      `update policy_acknowledgements set superseded_at = now() where policy_id = $1 and acknowledged_at is null and superseded_at is null returning id`,
      [policy.id],
    );
    // Roster people's requests close too (E29-09).
    closed.push(...await db.query<Row>(
      `update policy_person_acknowledgements set superseded_at = now() where policy_id = $1 and acknowledged_at is null and superseded_at is null returning id`,
      [policy.id],
    ));
    await ctx.audit(req, {
      action: 'policy.retire', recordType: 'policy', recordId: policy.id,
      summary: `${label(policy)} retired; ${closed.length} outstanding acknowledgment request${closed.length === 1 ? '' : 's'} closed`,
      before: { status: policy.status }, after: { status: 'retired' },
    });
    return { ok: true, status: 'retired', closed: closed.length };
  });
}
