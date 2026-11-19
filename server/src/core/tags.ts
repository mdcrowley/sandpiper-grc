import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { fail } from './errors.ts';
import type { Row } from './module.ts';
import { normalizeTag, type makeResources } from './resource.ts';
import { requirePerm, type makeAudit, type makeLookups } from './services.ts';

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  lookups: ReturnType<typeof makeLookups>;
  res: ReturnType<typeof makeResources>;
}

const MAX_TAGS = 30;

/**
 * Tags (E14-08) and watchers (E14-09): generic, like comments and links. Both follow the record:
 * reading needs view on it, changing its tags needs edit, and a record the caller cannot see
 * answers 404 exactly as a missing one does.
 */
export function registerTagsAndWatchers({ app, db, audit, lookups, res }: Deps) {
  const { visibleRecord, visibilitySql, mayAccess, registry, labelsFor } = res;

  const tagsOf = async (type: string, id: string) =>
    (await db.query<{ tag: string }>('select tag from record_tags where record_type = $1 and record_id = $2 order by tag', [type, id])).map((r) => r.tag);

  const cleanTags = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) fail(400, 'validation', 'Check the highlighted fields.', { tags: 'Send a list of tags.' });
    const tags = [...new Set((raw as unknown[]).map(normalizeTag).filter(Boolean))];
    if (tags.length > MAX_TAGS) fail(400, 'validation', 'Check the highlighted fields.', { tags: `A record can have at most ${MAX_TAGS} tags.` });
    return tags;
  };

  async function setTags(req: any, type: string, id: string, label: string, next: string[]) {
    const before = await tagsOf(type, id);
    const added = next.filter((t) => !before.includes(t));
    const removed = before.filter((t) => !next.includes(t));
    if (!added.length && !removed.length) return before;
    if (removed.length) await db.query('delete from record_tags where record_type = $1 and record_id = $2 and tag = any($3::text[])', [type, id, removed]);
    for (const t of added) {
      await db.query('insert into record_tags (record_type, record_id, tag, created_by) values ($1,$2,$3,$4) on conflict do nothing', [type, id, t, req.user.id]);
    }
    await audit(req, {
      action: 'tag.change', recordType: type, recordId: id,
      summary: `Tags changed on ${label.toLowerCase()}:${added.length ? ` added ${added.join(', ')}` : ''}${added.length && removed.length ? ';' : ''}${removed.length ? ` removed ${removed.join(', ')}` : ''}`,
      before: { tags: before }, after: { tags: [...next].sort() },
    });
    return tagsOf(type, id);
  }

  app.get('/api/tags', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    return { tags: await tagsOf(record_type, record_id) };
  });

  // Replaces the record's tags.
  app.put('/api/tags', async (req) => {
    const b = (req.body ?? {}) as Row;
    const { def } = await visibleRecord(req, b.record_type, b.record_id, 'edit');
    return { tags: await setTags(req, b.record_type, b.record_id, def.label, cleanTags(b.tags)) };
  });

  app.post('/api/tags', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const { def } = await visibleRecord(req, b.record_type, b.record_id, 'edit');
    const tag = normalizeTag(b.tag);
    if (!tag) fail(400, 'validation', 'Check the highlighted fields.', { tag: 'Type a tag first.' });
    const tags = await setTags(req, b.record_type, b.record_id, def.label, cleanTags([...(await tagsOf(b.record_type, b.record_id)), tag]));
    reply.code(201);
    return { tags };
  });

  app.delete('/api/tags', async (req) => {
    const q = req.query as Record<string, string>;
    const { def } = await visibleRecord(req, q.record_type, q.record_id, 'edit');
    const tag = normalizeTag(q.tag);
    return { tags: await setTags(req, q.record_type, q.record_id, def.label, (await tagsOf(q.record_type, q.record_id)).filter((t) => t !== tag)) };
  });

  // The tags in use on one record type, most used first, counting only records the caller may see.
  app.get('/api/tags/options', async (req) => {
    const { record_type, q = '' } = req.query as Record<string, string>;
    const def = registry.get(record_type);
    if (!def || !mayAccess(req.user, def, 'view')) return [];
    return db.query(
      `select rt.tag, count(*)::int as count from record_tags rt join ${def.table} t on t.id = rt.record_id
       where rt.record_type = $1 and t.deleted_at is null and ${visibilitySql(def, req.user, 't')} and rt.tag like $2
       group by rt.tag order by count(*) desc, rt.tag limit 200`,
      [def.type, `%${normalizeTag(q).replace(/[%_\\]/g, '\\$&')}%`],
    );
  });

  // Rename a tag on one record type; when the new name already exists the two are merged.
  app.post('/api/admin/tags/rename', { preHandler: requirePerm('admin.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const from = normalizeTag(b.from);
    const to = normalizeTag(b.to);
    const fields: Record<string, string> = {};
    if (!registry.get(b.record_type)) fields.record_type = 'Choose a record type.';
    if (!from) fields.from = 'Choose the tag to rename.';
    if (!to) fields.to = 'Type the new name.';
    if (Object.keys(fields).length) fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (from === to) return { ok: true, changed: 0 };
    const changed = await db.tx(async (tx) => {
      await tx.query(
        `insert into record_tags (record_type, record_id, tag, created_at, created_by)
         select record_type, record_id, $3, created_at, created_by from record_tags where record_type = $1 and tag = $2
         on conflict do nothing`, [b.record_type, from, to]);
      return (await tx.query('delete from record_tags where record_type = $1 and tag = $2 returning 1', [b.record_type, from])).length;
    });
    await audit(req, {
      action: 'tag.rename', recordType: 'tag', recordId: `${b.record_type}:${to}`,
      summary: `Tag "${from}" renamed to "${to}" on ${changed} ${b.record_type} record(s)`, before: { tag: from }, after: { tag: to },
    });
    return { ok: true, changed };
  });

  // ---------- watchers ----------

  const watchersOf = (type: string, id: string) =>
    db.query<{ id: string; label: string }>(
      `select u.id, u.display_name as label from record_watchers w join users u on u.id = w.user_id
       where w.record_type = $1 and w.record_id = $2 and u.deleted_at is null and u.status = 'active' order by u.display_name`, [type, id]);

  const watchState = async (req: any, type: string, id: string) => {
    const watchers = await watchersOf(type, id);
    return { watching: watchers.some((w) => w.id === req.user.id), count: watchers.length, watchers };
  };

  app.get('/api/watchers', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    return watchState(req, record_type, record_id);
  });

  // Watch a record yourself. Only someone who can see the record can watch it.
  app.post('/api/watchers', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const { def } = await visibleRecord(req, b.record_type, b.record_id);
    const added = await db.query(
      'insert into record_watchers (record_type, record_id, user_id) values ($1,$2,$3) on conflict do nothing returning 1', [b.record_type, b.record_id, req.user!.id]);
    if (added.length) await audit(req, { action: 'watch.add', recordType: b.record_type, recordId: b.record_id, summary: `Started watching this ${def.label.toLowerCase()}` });
    reply.code(201);
    return watchState(req, b.record_type, b.record_id);
  });

  app.delete('/api/watchers', async (req) => {
    const q = req.query as Record<string, string>;
    // No visibility check: a person who has lost access to a record can still stop watching it.
    const removed = await db.query(
      'delete from record_watchers where record_type = $1 and record_id::text = $2 and user_id = $3 returning 1', [String(q.record_type ?? ''), String(q.record_id ?? ''), req.user!.id]);
    if (removed.length) await audit(req, { action: 'watch.remove', recordType: q.record_type, recordId: q.record_id, summary: 'Stopped watching this record' });
    return { watching: false };
  });

  // The records I watch, leaving out any I can no longer see.
  app.get('/api/me/watching', async (req) => {
    const rows = await db.query<{ record_type: string; record_id: string; created_at: string }>(
      'select record_type, record_id, created_at from record_watchers where user_id = $1 order by created_at desc limit 500', [req.user!.id]);
    const out: unknown[] = [];
    for (const type of new Set(rows.map((r) => r.record_type))) {
      const def = registry.get(type);
      if (!def || !mayAccess(req.user, def, 'view')) continue;
      const mine = rows.filter((r) => r.record_type === type);
      const labels = await labelsFor(type, mine.map((r) => r.record_id), req.user);
      const live = new Set((await db.query<{ id: string }>(
        `select id from ${def.table} where id = any($1::uuid[]) and deleted_at is null`, [mine.map((r) => r.record_id)])).map((r) => r.id));
      for (const r of mine) {
        const l = labels.get(r.record_id);
        if (!l || l.hidden || !live.has(r.record_id)) continue;
        out.push({ type, typeLabel: def.label, id: r.record_id, label: l.label, ref: l.ref, route: def.route, since: r.created_at });
      }
    }
    return out;
  });

  /**
   * Tells the watchers of a record about something (not the person who did it). Needs the
   * notifications module; `app.notify` itself skips anyone who may no longer see the record.
   */
  async function notifyWatchers(type: string, id: string, title: string, actorId?: string | null, body?: string): Promise<void> {
    if (!app.hasDecorator('notify')) return;
    const rows = await db.query<{ user_id: string }>('select user_id from record_watchers where record_type = $1 and record_id = $2', [type, id]);
    const userIds = rows.map((r) => r.user_id).filter((u) => u !== actorId);
    if (!userIds.length) return;
    // Uses the kind `watch` when the notifications module's list has it (so people can switch it off), else `general`.
    const kind = (await lookups.values('notification_kind')).some((k) => k.value === 'watch') ? 'watch' : 'general';
    await (app as any).notify({ userIds, kind, title, body, recordType: type, recordId: id });
  }

  // Status changes reach the watchers.
  res.onChange(async ({ action, def, row, after, req }) => {
    if (action !== 'update' || !after || !('status' in after)) return;
    const f = def.fields.status;
    const shown = f?.type === 'lookup' ? (await lookups.values(f.list!)).find((v) => v.value === row.status)?.label ?? row.status : row.status;
    await notifyWatchers(def.type, row.id, `${def.label} ${res.labelOf(def, row)}: status is now ${shown}`, req?.user?.id);
  });

  return { notifyWatchers };
}
