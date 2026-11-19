import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { ResourceDef, Row } from './module.ts';
import type { makeResources } from './resource.ts';
import { can, type makeAudit } from './services.ts';

/**
 * Shared list views (E01-24).
 *
 * A person's own saved views are a preference (`views:<type>` in /api/me/preferences). A view can
 * also be shared with everyone who can see that list: it is then a row here, readable by anyone
 * with view permission on the record type, and changed or removed only by the person who shared it
 * or an administrator. Adding, changing and removing one is audited, because other people see it.
 *
 * A view holds a search, filters and a sort, never rows: whoever opens it sees only the records
 * their own permissions allow. Labels of picked people and records are not kept (the browser looks
 * them up through the permission-checked label routes), so a shared view cannot carry the name of a
 * record a colleague may not see.
 */
export const VIEW_NAME_MAX = 60;
export const SHARED_VIEWS_PER_TYPE = 100;
const VIEW_MAX_BYTES = 16 * 1024;
const FILTER_KEY_RE = /^[a-z_][a-z0-9_]*(\.(gt|lt|null|all))?$/;
const SORT_RE = /^[a-z_][a-z0-9_]*$/;

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  res: ReturnType<typeof makeResources>;
}

export interface ViewBody { q: string; sort: string; dir: 'asc' | 'desc'; filters: Record<string, string[]> }

const invalid = (fields: Record<string, string>): never => fail(400, 'validation', 'Check the highlighted fields.', fields);

/** Checks and normalizes a view: search, sort and filters only (labels and anything else are dropped). */
export function cleanView(raw: unknown): ViewBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid({ view: 'Send the view as { q, sort, dir, filters }.' });
  const v = raw as Row;
  const q = String(v.q ?? '').trim().slice(0, 200);
  const sort = String(v.sort ?? '');
  if (sort && !SORT_RE.test(sort)) invalid({ view: 'The sort field is not a field name.' });
  const filters: Record<string, string[]> = {};
  if (v.filters !== undefined && v.filters !== null) {
    if (typeof v.filters !== 'object' || Array.isArray(v.filters)) invalid({ view: 'Filters are { <field>: [values] }.' });
    for (const [key, values] of Object.entries(v.filters as Row)) {
      if (!FILTER_KEY_RE.test(key)) invalid({ view: `"${key.slice(0, 40)}" is not a filter.` });
      const list = (Array.isArray(values) ? values : [values]).map((x) => String(x ?? '').slice(0, 200)).filter(Boolean);
      if (list.length > 100) invalid({ view: 'A filter may hold at most 100 values.' });
      if (list.length) filters[key] = list;
    }
  }
  const out: ViewBody = { q, sort, dir: sort && v.dir === 'desc' ? 'desc' : 'asc', filters };
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > VIEW_MAX_BYTES) invalid({ view: 'This view is too large to share.' });
  return out;
}

export function registerSharedViews({ app, db, audit, res }: Deps) {
  const { registry, mayAccess, userNames } = res;

  /** The record type, when the caller may view it; otherwise a 404 as for an unknown type. */
  const typeFor = (req: FastifyRequest, type: unknown): ResourceDef => {
    const def = registry.get(String(type ?? ''));
    if (!def || !mayAccess(req.user, def, 'view')) fail(404, 'not_found', 'Unknown record type.');
    return def!;
  };
  const cleanName = (raw: unknown) => {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > VIEW_NAME_MAX) invalid({ name: `Give the view a name of at most ${VIEW_NAME_MAX} characters.` });
    return name;
  };
  const mayManage = (req: FastifyRequest, row: Row) => row.created_by === req.user!.id || can(req.user, 'admin.administer');
  const present = (req: FastifyRequest, row: Row, names: Map<string, string>) => ({
    id: row.id, recordType: row.record_type, name: row.name, view: row.view,
    createdBy: row.created_by ? { id: row.created_by, label: names.get(row.created_by) ?? 'Unknown user' } : null,
    mine: row.created_by === req.user!.id, canManage: mayManage(req, row),
    createdAt: row.created_at, updatedAt: row.updated_at,
  });
  const duplicate = async (type: string, name: string, except: string | null) =>
    db.one('select 1 from shared_views where record_type = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3::uuid)', [type, name, except]);

  /** One shared view the caller may see (the record type must be visible to them). */
  const viewOf = async (req: FastifyRequest) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>('select * from shared_views where id = $1', [id]) : undefined;
    const def = row ? registry.get(row.record_type) : undefined;
    if (!row || !def || !mayAccess(req.user, def, 'view')) fail(404, 'not_found', 'View not found.');
    return { row: row!, def: def! };
  };

  // The views shared on one record type's list.
  app.get('/api/views', async (req) => {
    const def = typeFor(req, (req.query as Row).record_type);
    const rows = await db.query<Row>('select * from shared_views where record_type = $1 order by lower(name)', [def.type]);
    const names = await userNames(rows.map((r) => r.created_by).filter(Boolean));
    return { views: rows.map((r) => present(req, r, names)) };
  });

  app.post('/api/views', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const def = typeFor(req, b.record_type);
    const name = cleanName(b.name);
    const view = cleanView(b.view);
    if (await duplicate(def.type, name, null)) fail(409, 'duplicate', `A shared view called "${name}" already exists on this list. Choose another name.`, { name: 'This name is taken.' });
    const count = (await db.one<{ c: number }>('select count(*)::int c from shared_views where record_type = $1', [def.type]))!.c;
    if (count >= SHARED_VIEWS_PER_TYPE) fail(409, 'too_many', `A list can have at most ${SHARED_VIEWS_PER_TYPE} shared views. Remove one first.`);
    const row = (await db.one<Row>(
      `insert into shared_views (record_type, name, view, created_by, updated_by) values ($1, $2, $3::jsonb, $4, $4) returning *`,
      [def.type, name, JSON.stringify(view), req.user!.id]))!;
    await audit(req, {
      action: 'view.share', recordType: 'shared_view', recordId: row.id,
      summary: `View "${name}" shared on the ${def.plural.toLowerCase()} list`, after: { record_type: def.type, name, view },
    });
    reply.code(201);
    return present(req, row, await userNames([req.user!.id]));
  });

  app.patch('/api/views/:id', async (req) => {
    const { row, def } = await viewOf(req);
    if (!mayManage(req, row)) fail(403, 'forbidden', 'Only the person who shared this view, or an administrator, can change it.');
    const b = (req.body ?? {}) as Row;
    const name = b.name === undefined ? row.name : cleanName(b.name);
    const view = b.view === undefined ? row.view : cleanView(b.view);
    if (name.toLowerCase() !== String(row.name).toLowerCase() && await duplicate(def.type, name, row.id)) {
      fail(409, 'duplicate', `A shared view called "${name}" already exists on this list. Choose another name.`, { name: 'This name is taken.' });
    }
    const next = (await db.one<Row>(
      'update shared_views set name = $2, view = $3::jsonb, updated_at = now(), updated_by = $4 where id = $1 returning *',
      [row.id, name, JSON.stringify(view), req.user!.id]))!;
    await audit(req, {
      action: 'view.update', recordType: 'shared_view', recordId: row.id,
      summary: `Shared view "${name}" on the ${def.plural.toLowerCase()} list changed`,
      before: { name: row.name, view: row.view }, after: { name, view },
    });
    return present(req, next, await userNames([next.created_by].filter(Boolean)));
  });

  app.delete('/api/views/:id', async (req) => {
    const { row, def } = await viewOf(req);
    if (!mayManage(req, row)) fail(403, 'forbidden', 'Only the person who shared this view, or an administrator, can remove it.');
    await db.query('delete from shared_views where id = $1', [row.id]);
    await audit(req, {
      action: 'view.unshare', recordType: 'shared_view', recordId: row.id,
      summary: `Shared view "${row.name}" removed from the ${def.plural.toLowerCase()} list`, before: { name: row.name, view: row.view },
    });
    return { ok: true };
  });
}
