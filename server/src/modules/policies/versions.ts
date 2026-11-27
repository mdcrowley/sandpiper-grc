// Document versions and the document life cycle: write, send for review, approve, publish (take
// effect, now or on a future date), make obsolete. E43 adds version labels, adoption records
// (approval body and reference), file versions (the original PDF is the text), minor versions, the
// dates a version stopped being in force, and data load of whole version histories.
import type { FastifyRequest } from 'fastify';
import { actorOf, asDataLoad, dataLoadFor, onBehalfOf } from '../../core/dataload.ts';
import { featureState, rolesShown } from '../../core/features.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { readableSql, tablesFor, type AccessTables } from './access.ts';
import { audienceUserIds, bodyHash, publishVersion, syncPolicyStatus } from './acknowledgments.ts';
import { isDate, localDate } from './dates.ts';
import { renderPolicyMarkdown } from './markdown.ts';
import { refreshSearchText } from './search.ts';
import { cycleOf } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 200_000;
export const VERSION_STATUSES = ['draft', 'in_review', 'approved', 'published', 'superseded', 'withdrawn'] as const;
/** Versions a reader (no edit or approve permission) may see. */
export const READER_STATUSES = ['published', 'superseded', 'withdrawn'];

const text = (v: unknown, max = 500): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};
const ymd = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export const versionView = (v: Row, withBody = true) => ({
  id: v.id, policy_id: v.policy_id, version: Number(v.version), version_label: v.version_label ?? null, status: v.status,
  change_summary: v.change_summary, approved_by_name: v.approved_by_name, approved_on: v.approved_on,
  effective_on: v.effective_on, published_at: v.published_at, superseded_on: v.superseded_on ?? null, withdrawn_on: v.withdrawn_on ?? null,
  approval_body: v.approval_body ?? null, approval_reference: v.approval_reference ?? null, minor: v.minor === true,
  content_kind: v.content_kind ?? 'markdown', source_attachment_id: v.source_attachment_id ?? null,
  rendition_attachment_id: v.rendition_attachment_id ?? null, conversion: v.conversion ?? null, body_sha256: v.body_sha256 ?? null,
  scheduled: v.scheduled === true, reviewed_no_change_on: v.reviewed_no_change_on ?? null,
  created_at: v.created_at, updated_at: v.updated_at,
  author_name: v.author_name ?? null, created_by: v.created_by ?? null,
  ...(withBody ? { body: v.body, body_html: renderPolicyMarkdown(v.body) } : {}),
});

const label = (p: Row) => [p.doc_number ?? p.ref, p.title].filter(Boolean).join(' ');

/**
 * Runs a hand-written save as a data load when this request is one (E18-70, core/dataload.ts): an
 * administrator (or their token) while data load mode is on. Nothing the work causes is sent.
 */
export async function asLoadIfLoading<T>(ctx: ModuleContext, req: FastifyRequest, fn: (load: boolean) => Promise<T>): Promise<T> {
  const load = await dataLoadFor(ctx.db, req, ctx.audit);
  if (!load) return fn(false);
  req.dataLoad = true;
  return asDataLoad(() => fn(true));
}

export function registerVersionRoutes(ctx: ModuleContext, tables: AccessTables = tablesFor(ctx)) {
  const { db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function needPolicy(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('policy', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Document not found.');
  }
  async function needVersion(policy: Row, vid: unknown): Promise<Row> {
    const row = typeof vid === 'string' && UUID.test(vid)
      ? await db.one<Row>('select * from policy_versions where id = $1 and policy_id = $2', [vid, policy.id])
      : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Version not found.');
  }
  /** People who write or approve documents see every version; readers see only what has been published. */
  const seesDrafts = (req: FastifyRequest) => ctx.can(req.user, 'policies.edit') || ctx.can(req.user, 'policies.approve');

  /** A file attached to this document (attachments module), or a validation error on `field`. */
  async function attachmentOf(policy: Row, id: unknown, field: string): Promise<string | null> {
    if (id === undefined || id === null || id === '') return null;
    const ok = typeof id === 'string' && UUID.test(id) && !!ctx.app.hasDecorator('attachmentStores') && await db.one(
      `select 1 from attachments where id = $1 and record_type = 'policy' and record_id = $2 and deleted_at is null`, [id, policy.id]);
    if (!ok) invalid({ [field]: 'Choose a file attached to this document.' });
    return String(id);
  }

  /**
   * The text and details of a version from a request body. `create`: a new version; `update`: an
   * edited draft (only the keys given). A file version (content_kind 'file') needs its original and
   * may have no text; a Markdown version needs text.
   */
  async function versionInput(req: FastifyRequest, policy: Row, b: Row, mode: 'create' | 'update', existing?: Row): Promise<Row> {
    const out: Row = {};
    const fields: Record<string, string> = {};
    if (b.content_kind !== undefined) {
      if (!['markdown', 'file'].includes(String(b.content_kind))) fields.content_kind = 'Choose Markdown text or a file.';
      else out.content_kind = String(b.content_kind);
    }
    // An upload (developer B's chunked uploads) becomes a file on this document first.
    if (b.source_upload_id !== undefined && b.source_upload_id !== null && b.source_upload_id !== '') {
      const claim = (ctx.app as unknown as { claimUpload?: (r: FastifyRequest, id: string, to: { recordType: string; recordId: string }) => Promise<{ attachment_id: string }> }).claimUpload;
      if (typeof claim !== 'function') invalid({ source_upload_id: 'Uploads in parts are not available. Attach the file to the document instead.' });
      b = { ...b, attachment_id: (await claim!(req, String(b.source_upload_id), { recordType: 'policy', recordId: String(policy.id) })).attachment_id };
    }
    if (b.attachment_id !== undefined) out.source_attachment_id = await attachmentOf(policy, b.attachment_id, 'attachment_id');
    if (b.rendition_attachment_id !== undefined) out.rendition_attachment_id = await attachmentOf(policy, b.rendition_attachment_id, 'rendition_attachment_id');
    // A Word original converted to Markdown by developer B's converter.
    if (b.convert === true) {
      const convert = (ctx.app as unknown as { convertDocument?: (r: FastifyRequest, o: { attachmentId: string; recordType: string; recordId: string }) => Promise<{ markdown: string; report: unknown }> }).convertDocument;
      if (typeof convert !== 'function') ctx.fail(501, 'convert_unavailable', 'Converting Word files is not available in this installation.');
      const source = out.source_attachment_id ?? existing?.source_attachment_id;
      if (!source) invalid({ attachment_id: 'Choose the Word file to convert.' });
      const result = await convert!(req, { attachmentId: String(source), recordType: 'policy', recordId: String(policy.id) });
      b = { ...b, body: result.markdown };
      out.conversion = result.report ?? null;
      out.content_kind = 'markdown';
    }
    const kind = out.content_kind ?? existing?.content_kind ?? 'markdown';
    if (b.body !== undefined || mode === 'create') {
      const body = typeof b.body === 'string' ? b.body : '';
      if (body.length > MAX_BODY) fields.body = 'The text is too long.';
      else if (!body.trim() && kind === 'markdown') fields.body = 'Write the document text.';
      else out.body = body;
    }
    if (kind === 'markdown' && mode === 'update' && !fields.body && !String(out.body ?? existing?.body ?? '').trim()) fields.body = 'Write the document text.';
    if (kind === 'file' && !(out.source_attachment_id ?? existing?.source_attachment_id)) {
      fields.attachment_id = 'Attach the file that is this version (for example its PDF).';
    }
    if (b.change_summary !== undefined) out.change_summary = text(b.change_summary, 4000);
    if (b.version_label !== undefined) out.version_label = text(b.version_label, 60);
    if (b.approval_body !== undefined) out.approval_body = text(b.approval_body, 200);
    if (b.approval_reference !== undefined) out.approval_reference = text(b.approval_reference, 200);
    if (b.minor !== undefined) out.minor = b.minor === true;
    if (b.conversion !== undefined && b.convert !== true) {
      if (b.conversion !== null && (typeof b.conversion !== 'object' || JSON.stringify(b.conversion).length > 100_000)) fields.conversion = 'The conversion report is not valid.';
      else out.conversion = b.conversion;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  ctx.app.post('/api/policies/preview', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const body = (req.body as Row | null)?.body;
    return { html: renderPolicyMarkdown(typeof body === 'string' ? body.slice(0, MAX_BODY) : '') };
  });

  ctx.app.get('/api/policies/audience-options', { preHandler: ctx.requirePerm('policies.view') }, async () => ({
    // Roles of switched-off areas are not offered (E18-64).
    roles: rolesShown(await featureState(db), await db.query<Row & { key: string }>('select key, name, enabled from roles order by name')),
    departments: await db.query<Row>('select id, name from departments where deleted_at is null order by lower(name)'),
    // Positions of the roster (people module, E29-09), for roster audiences; empty without it.
    positions: ctx.resources.get('position')
      ? await db.query<Row>('select id, name, active from positions where deleted_at is null order by lower(name)') : [],
    // Distribution groups (E43), for the access editor.
    groups: await db.query<Row>('select id, name from document_groups where deleted_at is null order by lower(name)'),
  }));

  /** How many people would be asked to acknowledge if a version were published now. */
  ctx.app.get('/api/policies/:id/audience', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await needPolicy(req);
    const count = policy.ack_required === false ? 0 : (await audienceUserIds(ctx, policy)).length;
    return { count, ack_days: Number(policy.ack_days), ack_required: policy.ack_required !== false };
  });

  ctx.app.get('/api/policies/:id/versions', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await needPolicy(req);
    const rows = await db.query<Row>(
      `select v.*, u.display_name as author_name,
              (select max(r.reviewed_on) from policy_plan_reviews r where r.version_id = v.id and r.kind = 'periodic' and r.result = 'no_change')::text as reviewed_no_change_on
       from policy_versions v left join users u on u.id = v.created_by
       where v.policy_id = $1 order by v.version desc`, [policy.id],
    );
    return rows.filter((v) => seesDrafts(req) || READER_STATUSES.includes(v.status)).map((v) => versionView(v));
  });

  // ---------- a new version ----------

  /** A historical version in data load mode: its number, status and dates are kept as given. */
  async function loadVersion(req: FastifyRequest, policy: Row, b: Row, data: Row): Promise<Row> {
    const fields: Record<string, string> = {};
    const status = b.status === undefined || b.status === null ? 'draft' : String(b.status);
    if (!(VERSION_STATUSES as readonly string[]).includes(status)) fields.status = 'Choose a version status.';
    const dates: Row = {};
    for (const k of ['approved_on', 'effective_on', 'superseded_on', 'withdrawn_on']) {
      const v = text(b[k]);
      if (v !== null && !isDate(v)) fields[k] = 'Enter a date (YYYY-MM-DD).';
      dates[k] = v;
    }
    const publishedAt = text(b.published_at);
    if (publishedAt !== null && Number.isNaN(Date.parse(publishedAt))) fields.published_at = 'Enter a date and time.';
    const createdAt = text(b.created_at);
    if (createdAt !== null && Number.isNaN(Date.parse(createdAt))) fields.created_at = 'Enter a date and time.';
    let n: number | null = null;
    if (b.version !== undefined && b.version !== null && b.version !== '') {
      n = Number(b.version);
      if (!Number.isInteger(n) || n < 1 || n > 100_000) fields.version = 'The version number must be a whole number from 1.';
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (['published', 'superseded', 'withdrawn'].includes(status) && !dates.effective_on) dates.effective_on = dates.approved_on ?? (publishedAt ? publishedAt.slice(0, 10) : null);
    const inForce = ['published', 'superseded', 'withdrawn'].includes(status);
    return db.tx(async (tx) => {
      await tx.query('select id from policies where id = $1 for update', [policy.id]);
      const number = n ?? (await tx.one<{ n: number }>('select coalesce(max(version), 0)::int + 1 as n from policy_versions where policy_id = $1', [policy.id]))!.n;
      if (await tx.one('select 1 from policy_versions where policy_id = $1 and version = $2', [policy.id, number])) {
        ctx.fail(409, 'version_exists', `Version ${number} of this document already exists.`);
      }
      let finalStatus = status;
      if (status === 'published') {
        // One effective version at a time: the one that took effect later stays effective.
        const other = await tx.one<Row>(`select * from policy_versions where policy_id = $1 and status = 'published'`, [policy.id]);
        if (other) {
          const otherDate = ymd(other.effective_on) ?? '';
          const mine = dates.effective_on ?? '';
          const newer = mine > otherDate || (mine === otherDate && number > Number(other.version));
          if (newer) {
            await tx.query(`update policy_versions set status = 'superseded', superseded_on = coalesce(superseded_on, $2::date), updated_at = now() where id = $1`,
              [other.id, dates.effective_on]);
          } else {
            finalStatus = 'superseded';
            dates.superseded_on = dates.superseded_on ?? (otherDate || null);
          }
        }
      }
      const row = (await tx.one<Row>(
        `insert into policy_versions (policy_id, version, body, change_summary, status, version_label, approval_body, approval_reference,
           approved_by_name, approved_on, effective_on, superseded_on, withdrawn_on, published_at, content_kind, source_attachment_id,
           rendition_attachment_id, conversion, minor, body_sha256, created_at, created_by, updated_at, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12::date,$13::date,$14::timestamptz,$15,$16,$17,$18::jsonb,$19,$20,
           coalesce($21::timestamptz, now()),$22,coalesce($21::timestamptz, now()),$22) returning *`,
        [policy.id, number, data.body ?? '', data.change_summary ?? null, finalStatus, data.version_label ?? null, data.approval_body ?? null,
          data.approval_reference ?? null, text(b.approved_by_name, 200), dates.approved_on, dates.effective_on, dates.superseded_on, dates.withdrawn_on,
          publishedAt ?? (inForce && dates.effective_on ? `${dates.effective_on}T12:00:00Z` : null), data.content_kind ?? 'markdown',
          data.source_attachment_id ?? null, data.rendition_attachment_id ?? null, data.conversion === undefined ? null : JSON.stringify(data.conversion),
          data.minor === true, ['draft', 'in_review'].includes(finalStatus) ? null : bodyHash(data.body ?? ''),
          createdAt, UUID.test(String(b.created_by ?? '')) ? b.created_by : actorOf(req).id ?? req.user!.id],
      ))!;
      // A superseded version stopped being in force when the next one took effect: worked out when no
      // date was given, and corrected when a version loaded later took effect before the date held.
      await tx.query(
        `update policy_versions v set superseded_on = x.next
         from (select v2.id, (select min(n.effective_on) from policy_versions n where n.policy_id = v2.policy_id and n.id <> v2.id
                 and n.status in ('published', 'superseded', 'withdrawn') and n.effective_on > v2.effective_on) as next
               from policy_versions v2 where v2.policy_id = $1) x
         where v.id = x.id and v.status = 'superseded' and v.effective_on is not null and x.next is not null
           and (v.superseded_on is null or v.superseded_on > x.next)`, [policy.id]);
      return row;
    });
  }

  /** After a load: the document follows its newest version (obsolete when that one was withdrawn). */
  async function settleLoaded(req: FastifyRequest, policy: Row): Promise<void> {
    const versions = await db.query<Row>(
      `select * from policy_versions where policy_id = $1 and status in ('published', 'superseded', 'withdrawn')
       order by effective_on desc nulls last, version desc`, [policy.id]);
    const newest = versions[0];
    const published = versions.find((v) => v.status === 'published');
    if (newest?.status === 'withdrawn' && !published && policy.status !== 'retired') {
      await db.query(`update policies set status = 'retired', retired_on = coalesce(retired_on, $2::date), current_version = $3, updated_at = now(), updated_by = $4 where id = $1`,
        [policy.id, ymd(newest.withdrawn_on) ?? localDate(), Number(newest.version), req.user!.id]);
    } else {
      await syncPolicyStatus(ctx, policy.id, req.user!.id);
    }
    if (published) {
      const months = await cycleOf(ctx, policy);
      if (months) {
        await db.query(
          `update policies p set review_date = greatest(coalesce(p.last_reviewed_on, v.effective_on), v.effective_on) + make_interval(months => $3::int)
           from policy_versions v where p.id = $1 and v.id = $2 and v.effective_on is not null
             and (p.review_date is null or p.review_date < (v.effective_on + make_interval(months => $3::int))::date)`,
          [policy.id, published.id, months]);
      }
    }
    await refreshSearchText(ctx, policy.id);
  }

  ctx.app.post('/api/policies/:id/versions', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => asLoadIfLoading(ctx, req, async (load) => {
    const policy = await needPolicy(req);
    const b = (req.body ?? {}) as Row;
    if (policy.status === 'retired' && !load) ctx.fail(409, 'retired', 'This document is obsolete. It cannot have a new version.');
    const data = await versionInput(req, policy, b, 'create');
    if (load) {
      const row = await loadVersion(req, policy, b, data);
      await settleLoaded(req, policy);
      await ctx.audit(req, {
        action: 'policy.version_load', recordType: 'policy', recordId: policy.id,
        summary: `Version ${row.version}${row.version_label ? ` (${row.version_label})` : ''} of ${label(policy)} loaded as ${row.status}`,
        after: { version: Number(row.version), status: row.status, version_label: row.version_label, approved_on: row.approved_on, effective_on: row.effective_on, superseded_on: row.superseded_on, withdrawn_on: row.withdrawn_on },
      });
      reply.code(201);
      return versionView(row);
    }
    // One request at a time per document (BS-8): the row is locked while the open-version check
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
          `insert into policy_versions (policy_id, version, body, change_summary, version_label, approval_body, approval_reference, content_kind,
             source_attachment_id, rendition_attachment_id, conversion, minor, created_by, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13) returning *`,
          [policy.id, n, data.body ?? '', data.change_summary ?? null, data.version_label ?? null, data.approval_body ?? null, data.approval_reference ?? null,
            data.content_kind ?? 'markdown', data.source_attachment_id ?? null, data.rendition_attachment_id ?? null,
            data.conversion === undefined ? null : JSON.stringify(data.conversion), data.minor === true, req.user!.id],
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
      summary: `Version ${next} of ${label(policy)} drafted`,
      after: { version: next, change_summary: row.change_summary, version_label: row.version_label, content_kind: row.content_kind, source_attachment_id: row.source_attachment_id },
    });
    reply.code(201);
    return versionView(row);
  }));

  ctx.app.patch('/api/policies/:id/versions/:vid', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    if (version.status !== 'draft') ctx.fail(409, 'not_draft', 'Only a draft version can be edited. Start a new version instead.');
    const data = await versionInput(req, policy, (req.body ?? {}) as Row, 'update', version);
    const keys = Object.keys(data).filter((k) => JSON.stringify(data[k] ?? null) !== JSON.stringify(version[k] ?? null));
    if (!keys.length) return versionView(version);
    const sets = keys.map((k, i) => `${k} = $${i + 3}${k === 'conversion' ? '::jsonb' : ''}`);
    const row = (await db.one<Row>(
      `update policy_versions set ${sets.join(', ')}, updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [version.id, req.user!.id, ...keys.map((k) => (k === 'conversion' ? (data[k] === null ? null : JSON.stringify(data[k])) : data[k]))],
    ))!;
    const brief = (v: Row) => Object.fromEntries(keys.map((k) => [k === 'body' ? 'body_length' : k, k === 'body' ? String(v.body ?? '').length : k === 'conversion' ? '(report)' : v[k]]));
    await ctx.audit(req, {
      action: 'policy.version_update', recordType: 'policy', recordId: policy.id,
      summary: `Draft version ${version.version} of ${label(policy)} edited`,
      before: { change_summary: version.change_summary, body_length: String(version.body ?? '').length, ...brief(version) },
      after: { change_summary: row.change_summary, body_length: String(row.body ?? '').length, ...brief(row) },
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

  ctx.app.post('/api/policies/:id/versions/:vid/approve', { preHandler: ctx.requirePerm('policies.approve') }, async (req) => asLoadIfLoading(ctx, req, async (load) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This document is obsolete.');
    if (!['draft', 'in_review'].includes(version.status)) ctx.fail(409, 'not_open', 'This version has already been approved.');
    // Segregation of duties; a data load records history as it happened.
    if (!load && version.created_by && version.created_by === req.user!.id) {
      ctx.fail(403, 'own_version', 'You wrote this version, so someone else must approve it.');
    }
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const approvedOn = text(b.approved_on) ?? localDate();
    const effectiveOn = text(b.effective_on);
    if (!isDate(approvedOn)) fields.approved_on = 'Approval date must be a date (YYYY-MM-DD).';
    if (effectiveOn !== null && !isDate(effectiveOn)) fields.effective_on = 'Effective date must be a date (YYYY-MM-DD).';
    if (version.content_kind === 'file' && !version.source_attachment_id) fields.attachment_id = 'Attach the file that is this version first.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    // E18-94: in a load that names a person, they are the approver (unless a name is given).
    const approver = text(b.approved_by_name) ?? onBehalfOf(req)?.name ?? text(policy.approver_name) ?? actorOf(req).name ?? req.user!.displayName;
    const approvalBody = b.approval_body !== undefined ? text(b.approval_body, 200) : version.approval_body ?? null;
    const approvalRef = b.approval_reference !== undefined ? text(b.approval_reference, 200) : version.approval_reference ?? null;
    const versionLabel = b.version_label !== undefined ? text(b.version_label, 60) : version.version_label ?? null;
    const row = (await db.one<Row>(
      `update policy_versions set status = 'approved', approved_by = $2, approved_by_name = $3, approved_on = $4, effective_on = $5,
         approval_body = $6, approval_reference = $7, version_label = $8, body_sha256 = $9, updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [version.id, actorOf(req).id, approver, approvedOn, effectiveOn, approvalBody, approvalRef, versionLabel, bodyHash(version.body)],
    ))!;
    await syncPolicyStatus(ctx, policy.id, req.user!.id);
    await ctx.audit(req, {
      action: 'policy.version_approve', recordType: 'policy', recordId: policy.id,
      summary: `Version ${version.version} of ${label(policy)} approved by ${approver}${approvalBody ? ` (${[approvalBody, approvalRef].filter(Boolean).join(', ')})` : ''}`,
      before: { status: version.status },
      after: { status: 'approved', approved_by_name: approver, approved_on: approvedOn, effective_on: effectiveOn, approval_body: approvalBody, approval_reference: approvalRef, body_sha256: row.body_sha256 },
    });
    return versionView(row);
  }));

  ctx.app.post('/api/policies/:id/versions/:vid/publish', { preHandler: ctx.requirePerm('policies.approve') }, async (req) => asLoadIfLoading(ctx, req, async (load) => {
    const policy = await needPolicy(req);
    const version = await needVersion(policy, (req.params as Row).vid);
    const b = (req.body ?? {}) as Row;
    const effectiveOn = text(b.effective_on) ?? (version.effective_on ? ymd(version.effective_on) : null);
    if (effectiveOn !== null && !isDate(effectiveOn)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { effective_on: 'Effective date must be a date (YYYY-MM-DD).' });
    }
    if (b.minor !== undefined && typeof b.minor !== 'boolean') invalid({ minor: 'Choose yes or no.' });
    const today = localDate();
    // A future effective date: the version waits, approved; the daily job publishes it on the day,
    // and the version before it stays in force until then.
    if (!load && effectiveOn && effectiveOn > today) {
      if (policy.status === 'retired') ctx.fail(409, 'retired', 'This document is obsolete. It cannot be published.');
      if (version.status !== 'approved') ctx.fail(409, 'not_approved', 'Only an approved version can be published.');
      const row = (await db.one<Row>(
        `update policy_versions set scheduled = true, effective_on = $2, minor = coalesce($3, minor), updated_at = now(), updated_by = $4 where id = $1 returning *`,
        [version.id, effectiveOn, typeof b.minor === 'boolean' ? b.minor : null, req.user!.id]))!;
      await ctx.audit(req, {
        action: 'policy.publish_scheduled', recordType: 'policy', recordId: policy.id,
        summary: `Version ${version.version} of ${label(policy)} approved to take effect on ${effectiveOn}`,
        after: { version: Number(version.version), effective_on: effectiveOn, minor: row.minor },
      });
      return { version: versionView(row), requested: 0, roster_requested: 0, due_on: null, status: policy.status, scheduled: true };
    }
    if (typeof b.minor === 'boolean' && b.minor) {
      await ctx.audit(req, { action: 'policy.minor_version', recordType: 'policy', recordId: policy.id, summary: `Version ${version.version} of ${label(policy)} marked minor: no new acknowledgment requests` });
    }
    const result = await publishVersion(ctx, req, policy, version, {
      effective_on: effectiveOn, minor: typeof b.minor === 'boolean' ? b.minor : undefined, load,
      published_at: load ? text(b.published_at) : null,
    });
    return { version: versionView(result.version), requested: result.requested, roster_requested: result.roster_requested ?? 0, due_on: result.due_on, status: result.policy.status, scheduled: false };
  }));

  // ---------- make obsolete (retire) ----------

  ctx.app.post('/api/policies/:id/retire', { preHandler: ctx.requirePerm('policies.approve') }, async (req) => asLoadIfLoading(ctx, req, async (load) => {
    const policy = await needPolicy(req);
    if (policy.status === 'retired') ctx.fail(409, 'retired', 'This document is already obsolete.');
    const b = (req.body ?? {}) as Row;
    return retireDocument(ctx, tables, req, policy, { reason: b.reason, replaced_by_id: b.replaced_by_id, retired_on: b.retired_on, load });
  }));
}

/**
 * Makes a document obsolete: withdraws its effective version (and cancels one waiting for its date),
 * closes open acknowledgment requests and records the reason, date and replacement. Children are
 * listed (those the person may read by name, the rest counted) so they can be re-parented.
 */
export async function retireDocument(
  ctx: ModuleContext, tables: AccessTables, req: FastifyRequest, policy: Row,
  input: { reason?: unknown; replaced_by_id?: unknown; retired_on?: unknown; load?: boolean },
): Promise<Row> {
  const { db } = ctx;
  const fields: Record<string, string> = {};
  const reason = text(input.reason, 2000);
  const retiredOn = text(input.retired_on) ?? localDate();
  if (!isDate(retiredOn)) fields.retired_on = 'Enter a date (YYYY-MM-DD).';
  let replacedBy: Row | undefined;
  if (input.replaced_by_id !== undefined && input.replaced_by_id !== null && input.replaced_by_id !== '') {
    replacedBy = typeof input.replaced_by_id === 'string' && UUID.test(input.replaced_by_id) && input.replaced_by_id !== policy.id
      ? await ctx.resources.find('policy', input.replaced_by_id, req.user) : undefined;
    if (!replacedBy) fields.replaced_by_id = 'Choose the document that replaces this one.';
    else if (replacedBy.status === 'retired') fields.replaced_by_id = 'The replacement is obsolete too. Choose a current document.';
  }
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  await db.query(
    `update policies set status = 'retired', retired_on = $3, retire_reason = $4, replaced_by_id = $5, updated_at = now(), updated_by = $2 where id = $1`,
    [policy.id, req.user!.id, retiredOn, reason, replacedBy?.id ?? null]);
  await db.query(
    `update policy_versions set status = 'withdrawn', withdrawn_on = coalesce(withdrawn_on, $2::date), updated_at = now(), updated_by = $3
     where policy_id = $1 and status = 'published'`, [policy.id, retiredOn, req.user!.id]);
  await db.query(`update policy_versions set scheduled = false where policy_id = $1 and scheduled`, [policy.id]);
  const closed = await db.query<Row>(
    `update policy_acknowledgements set superseded_at = now() where policy_id = $1 and acknowledged_at is null and superseded_at is null returning id`,
    [policy.id],
  );
  // Roster people's requests close too (E29-09).
  closed.push(...await db.query<Row>(
    `update policy_person_acknowledgements set superseded_at = now() where policy_id = $1 and acknowledged_at is null and superseded_at is null returning id`,
    [policy.id],
  ));
  // An obsolete document is not found by its words.
  await refreshSearchText(ctx, policy.id);
  const kids = await db.query<Row>(
    `select c.id, c.doc_number, c.title, c.status, coalesce(${readableSql(req.user, 'c', tables)}, false) as readable
     from policies c where c.parent_id = $1 and c.deleted_at is null and c.status <> 'retired' order by c.doc_number nulls last, c.title`, [policy.id]);
  const children = kids.filter((k) => k.readable).map(({ readable: _r, ...k }) => k);
  await ctx.audit(req, {
    action: 'policy.retire', recordType: 'policy', recordId: policy.id,
    summary: `${label(policy)} made obsolete on ${retiredOn}${replacedBy ? `, replaced by ${label(replacedBy)}` : ''}; ${closed.length} outstanding acknowledgment request${closed.length === 1 ? '' : 's'} closed${kids.length ? `; ${kids.length} document${kids.length === 1 ? '' : 's'} still under it` : ''}`,
    before: { status: policy.status }, after: { status: 'retired', retired_on: retiredOn, reason, replaced_by_id: replacedBy?.id ?? null },
  });
  void input.load;
  return { ok: true, status: 'retired', closed: closed.length, retired_on: retiredOn, children, hidden_children: kids.length - children.length };
}
