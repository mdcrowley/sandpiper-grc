// Findings that are the same finding twice (E10-16). Migration 002 keyed existing findings by
// host (name and address reconciled), port and identifier but merged nothing, so findings
// recorded before then may now share one key. This lists them and lets an administrator of
// vulnerabilities merge each group into the finding they keep: comments, files, links, tags and
// watchers move across, the earliest first-seen and latest last-seen dates are kept, and the
// others are removed (soft-deleted) with an audit event on both sides naming the other.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { secured } from './policy.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE = 'vulnerability';
const day = (v: unknown) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);

export function registerDuplicates(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function tableExists(name: string): Promise<boolean> {
    return Boolean((await db.one<{ t: string | null }>('select to_regclass($1)::text as t', [name]))?.t);
  }

  /** Groups of findings that share host, port and identifier, each with what hangs off every finding. */
  async function groups(): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select v.id, v.ref, v.title, v.host_name, v.host_ip, v.port, v.port_key, v.host_key, v.finding_key, v.plugin_id, v.severity,
              v.status, v.closed, v.first_seen, v.last_seen, v.owner_id, u.display_name as owner_name, v.created_at,
              (select count(*)::int from comments c where c.record_type = '${TYPE}' and c.record_id = v.id) as comments
       from vulnerabilities v left join users u on u.id = v.owner_id
       where v.deleted_at is null and v.host_key <> '' and v.finding_key <> ''
         and (v.host_key, v.finding_key, v.port_key) in (
           select host_key, finding_key, port_key from vulnerabilities
           where deleted_at is null and host_key <> '' and finding_key <> ''
           group by host_key, finding_key, port_key having count(*) > 1)
       order by v.host_key, v.finding_key, v.port_key, v.closed, v.last_seen desc nulls last, v.created_at`);
    const files = await tableExists('attachments') && rows.length
      ? new Map((await db.query<{ record_id: string; c: number }>(
        `select record_id, count(*)::int as c from attachments where record_type = '${TYPE}' and deleted_at is null and record_id = any($1::uuid[]) group by record_id`,
        [rows.map((r) => r.id)])).map((r) => [r.record_id, r.c]))
      : new Map<string, number>();
    const statuses = await ctx.lookups.values('vulnerability_status');
    const out = new Map<string, Row>();
    for (const r of rows) {
      const key = `${r.host_key}|${r.finding_key}|${r.port_key}`;
      if (!out.has(key)) {
        out.set(key, { key, host: r.host_name || r.host_ip || r.host_key, port: r.port_key || null, finding: r.plugin_id || r.finding_key, title: r.title, findings: [] });
      }
      out.get(key)!.findings.push({
        id: r.id, ref: r.ref, title: r.title, host_name: r.host_name, host_ip: r.host_ip, port: r.port,
        severity: r.severity, status: r.status, status_label: statuses.find((s) => s.value === r.status)?.label ?? r.status,
        closed: r.closed, first_seen: day(r.first_seen), last_seen: day(r.last_seen), owner_name: r.owner_name ?? null,
        comments: r.comments, files: files.get(r.id) ?? 0,
      });
    }
    // The suggested finding to keep is listed first: an open one, then the one seen most recently.
    return [...out.values()];
  }

  app.get('/api/vulnerabilities/duplicates', { preHandler: secured(ctx, 'vulnerabilities.view') }, async (req) => {
    const list = await groups();
    return { groups: list, findings: list.reduce((n, g) => n + g.findings.length, 0), can_merge: ctx.can(req.user, 'vulnerabilities.administer') };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vulnerabilities/duplicates', tag: 'Vulnerabilities', permission: 'vulnerabilities.view',
    summary: 'Findings that share host, port and identifier: the duplicates left from before host and port matching',
    description: 'Also needs `security.view`. Each group lists its findings, the suggested one to keep first, with counts of comments and files.',
  });

  app.post('/api/vulnerabilities/duplicates/merge', { preHandler: secured(ctx, 'vulnerabilities.administer') }, async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Row;
    const keepId = String(b.keep_id ?? '');
    const mergeIds = Array.isArray(b.merge_ids) ? [...new Set((b.merge_ids as unknown[]).map(String))].filter((id) => id !== keepId) : [];
    if (!UUID.test(keepId) || !mergeIds.length || mergeIds.some((id) => !UUID.test(id))) {
      ctx.fail(400, 'validation', 'Name the finding to keep (keep_id) and at least one other to merge into it (merge_ids).');
    }
    const all = await db.query<Row>(
      'select * from vulnerabilities where id = any($1::uuid[]) and deleted_at is null', [[keepId, ...mergeIds]]);
    const keep = all.find((r) => r.id === keepId);
    if (!keep || all.length !== mergeIds.length + 1) ctx.fail(404, 'not_found', 'One of the findings was not found, or has been merged already.');
    const others = all.filter((r) => r.id !== keepId);
    if (others.some((r) => r.host_key !== keep!.host_key || r.finding_key !== keep!.finding_key || r.port_key !== keep!.port_key || !r.host_key || !r.finding_key)) {
      ctx.fail(400, 'not_duplicates', 'Only findings with the same host, port and identifier can be merged.');
    }
    const files = await tableExists('attachments');
    const moved = { comments: 0, files: 0, links: 0, tags: 0, watchers: 0 };
    await db.tx(async (tx) => {
      for (const o of others) {
        moved.comments += (await tx.query(`update comments set record_id = $2 where record_type = '${TYPE}' and record_id = $1 returning id`, [o.id, keep!.id])).length;
        if (files) moved.files += (await tx.query(`update attachments set record_id = $2 where record_type = '${TYPE}' and record_id = $1 returning id`, [o.id, keep!.id])).length;
        // Links in either direction, unless the kept finding already has the same link (or it would point at itself).
        moved.links += (await tx.query(
          `update record_links l set from_id = $2 where from_type = '${TYPE}' and from_id = $1
             and not (to_type = '${TYPE}' and to_id = $2)
             and not exists (select 1 from record_links x where x.from_type = l.from_type and x.from_id = $2 and x.to_type = l.to_type and x.to_id = l.to_id and x.relation = l.relation)
           returning id`, [o.id, keep!.id])).length;
        moved.links += (await tx.query(
          `update record_links l set to_id = $2 where to_type = '${TYPE}' and to_id = $1
             and not (from_type = '${TYPE}' and from_id = $2)
             and not exists (select 1 from record_links x where x.to_type = l.to_type and x.to_id = $2 and x.from_type = l.from_type and x.from_id = l.from_id and x.relation = l.relation)
           returning id`, [o.id, keep!.id])).length;
        await tx.query(`delete from record_links where (from_type = '${TYPE}' and from_id = $1) or (to_type = '${TYPE}' and to_id = $1)`, [o.id]);
        moved.tags += (await tx.query(
          `insert into record_tags (record_type, record_id, tag, created_by) select record_type, $2, tag, created_by from record_tags
           where record_type = '${TYPE}' and record_id = $1 on conflict do nothing returning tag`, [o.id, keep!.id])).length;
        moved.watchers += (await tx.query(
          `insert into record_watchers (record_type, record_id, user_id) select record_type, $2, user_id from record_watchers
           where record_type = '${TYPE}' and record_id = $1 on conflict do nothing returning user_id`, [o.id, keep!.id])).length;
        await tx.query('update vulnerabilities set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [o.id, req.user!.id]);
      }
    });
    // The kept finding spans every sighting of the finding.
    const firstSeen = [keep!, ...others].map((r) => day(r.first_seen)).filter(Boolean).sort()[0] ?? null;
    const lastSeen = [keep!, ...others].map((r) => day(r.last_seen)).filter(Boolean).sort().reverse()[0] ?? null;
    const patch: Row = {};
    if (firstSeen && firstSeen !== day(keep!.first_seen)) patch.first_seen = firstSeen;
    if (lastSeen && lastSeen !== day(keep!.last_seen)) patch.last_seen = lastSeen;
    if (Object.keys(patch).length) await ctx.resources.update(TYPE, keep!.id, patch, null);

    const refs = others.map((o) => o.ref ?? o.id);
    await ctx.audit(req, {
      action: 'vulnerability.merge', recordType: TYPE, recordId: keep!.id,
      summary: `Duplicate finding${others.length === 1 ? '' : 's'} ${refs.join(', ')} merged into ${keep!.ref}: ${moved.comments} comment(s), ${moved.files} file(s), ${moved.links} link(s) moved`,
      // The merged findings as they were, so their details stay in this finding's history.
      before: others.map((o) => ({
        id: o.id, ref: o.ref, title: o.title, status: o.status, host_name: o.host_name, host_ip: o.host_ip, port: o.port,
        first_seen: day(o.first_seen), last_seen: day(o.last_seen), owner_id: o.owner_id, remediation_notes: o.remediation_notes,
      })),
      after: { ...patch, moved },
    });
    for (const o of others) {
      await ctx.audit(req, {
        action: 'vulnerability.merged_into', recordType: TYPE, recordId: o.id,
        summary: `Merged into ${keep!.ref} as a duplicate (same host, port and identifier); this finding is removed`,
        after: { kept_id: keep!.id, kept_ref: keep!.ref },
      });
    }
    return { kept: { id: keep!.id, ref: keep!.ref }, merged: others.map((o) => ({ id: o.id, ref: o.ref })), moved, ...patch };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vulnerabilities/duplicates/merge', tag: 'Vulnerabilities', permission: 'vulnerabilities.administer',
    summary: 'Merge duplicate findings into the one kept (comments, files, links, tags and watchers move across)',
    description: 'Also needs `security.view`. The findings must share host, port and identifier. The others are removed, with an audit event on each naming the kept finding, and the kept finding takes the earliest first-seen and latest last-seen dates.',
    body: { type: 'object', required: ['keep_id', 'merge_ids'], properties: { keep_id: { type: 'string', format: 'uuid' }, merge_ids: { type: 'array', items: { type: 'string', format: 'uuid' } } } },
  });
}
