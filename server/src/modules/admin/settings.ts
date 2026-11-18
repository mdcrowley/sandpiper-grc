import { DEFAULT_APP_NAME } from '../../core/config.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { adminRoute, body, idParam, invalid } from './shared.ts';

type Check = (v: unknown) => { value: unknown } | string;

const bool: Check = (v) => (typeof v === 'boolean' ? { value: v } : 'Choose on or off.');
const int = (min: number, max: number, what: string): Check => (v) =>
  (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
    ? { value: v } : `${what} must be a whole number from ${min} to ${max}.`);

/** Feature switches an administrator may set. Everything is off until switched on. */
export const FEATURE_KEYS = ['portal'];

/** The settings an administrator may change here, with defaults (matching the core fallbacks) and validation. */
export const SETTINGS: Record<string, { fallback: unknown; check: Check }> = {
  'app.name': {
    fallback: DEFAULT_APP_NAME,
    check: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 60
      ? { value: v.trim() } : 'Enter a name of 1 to 60 characters.'),
  },
  pilot_mode: { fallback: true, check: bool },
  features: {
    fallback: { portal: false },
    check: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Feature switches must be on or off.';
      for (const [k, on] of Object.entries(v)) {
        if (!FEATURE_KEYS.includes(k)) return `Unknown feature: ${k}.`;
        if (typeof on !== 'boolean') return 'Feature switches must be on or off.';
      }
      return { value: v };
    },
  },
  // NIST SP 800-63B: the floor never drops below 12.
  'auth.password_min_length': { fallback: 14, check: int(12, 128, 'Minimum password length') },
  'auth.password_history': { fallback: 5, check: int(0, 24, 'Password history') },
  'auth.idle_minutes': { fallback: 30, check: int(5, 480, 'Idle time-out') },
  'auth.mfa_required_for_all': { fallback: false, check: bool },
};

export function registerSettings(ctx: ModuleContext) {
  const { db } = ctx;

  const read = async () => {
    const values: Row = {};
    for (const [key, spec] of Object.entries(SETTINGS)) values[key] = await ctx.settings.get(key, spec.fallback);
    values.features = { ...(SETTINGS.features.fallback as object), ...values.features };
    return { values, featureKeys: FEATURE_KEYS };
  };

  adminRoute(ctx, 'GET', '/api/admin/settings', read);

  adminRoute(ctx, 'PATCH', '/api/admin/settings', async (req) => {
    const b = body(req);
    const fields: Record<string, string> = {};
    const clean: Row = {};
    for (const [key, raw] of Object.entries(b)) {
      const spec = SETTINGS[key];
      if (!spec) { fields[key] = 'This setting cannot be changed here.'; continue; }
      const res = spec.check(raw);
      if (typeof res === 'string') fields[key] = res;
      else clean[key] = res.value;
    }
    if (Object.keys(fields).length) invalid(fields);
    const current = (await read()).values;
    if (clean.features) clean.features = { ...current.features, ...clean.features };
    for (const [key, value] of Object.entries(clean)) {
      // ctx.settings.set writes the audit event (setting.change) with before and after.
      if (JSON.stringify(current[key]) !== JSON.stringify(value)) await ctx.settings.set(key, value, req);
    }
    return read();
  });

  // ---------- departments ----------

  const DEPT_SELECT = `
    select d.id, d.name, d.created_at, d.updated_at,
      (select count(*)::int from users u where u.department_id = d.id and u.deleted_at is null) as members
    from departments d where d.deleted_at is null`;

  const cleanName = async (raw: unknown, exceptId = '') => {
    const name = String(raw ?? '').trim();
    if (!name || name.length > 80) invalid({ name: 'Enter a name of up to 80 characters.' });
    if (await db.one('select 1 from departments where lower(name) = lower($1) and deleted_at is null and id::text <> $2', [name, exceptId])) {
      invalid({ name: 'A department with that name already exists.' });
    }
    return name;
  };

  adminRoute(ctx, 'GET', '/api/admin/departments', async () => db.query(`${DEPT_SELECT} order by lower(d.name)`));

  adminRoute(ctx, 'POST', '/api/admin/departments', async (req, reply) => {
    const name = await cleanName(body(req).name);
    // The name column is unique, so a removed department with the same name is brought back.
    const row = await db.one<Row>(
      `insert into departments (name, created_by, updated_by) values ($1, $2, $2)
       on conflict (name) do update set deleted_at = null, updated_at = now(), updated_by = excluded.updated_by returning id`,
      [name, req.user!.id],
    );
    await ctx.audit(req, { action: 'department.create', recordType: 'department', recordId: row!.id, summary: `Department "${name}" added`, after: { name } });
    reply.code(201);
    return db.one(`${DEPT_SELECT} and d.id = $1`, [row!.id]);
  });

  adminRoute(ctx, 'PATCH', '/api/admin/departments/:id', async (req) => {
    const id = idParam(req, 'Department');
    const before = await db.one<Row>('select id, name from departments where id = $1 and deleted_at is null', [id]);
    if (!before) ctx.fail(404, 'not_found', 'Department not found.');
    const name = await cleanName(body(req).name, id);
    if (await db.one('select 1 from departments where name = $1 and id <> $2', [name, id])) {
      invalid({ name: 'A removed department has that name. Add it again instead.' });
    }
    await db.query('update departments set name = $2, updated_at = now(), updated_by = $3 where id = $1', [id, name, req.user!.id]);
    if (name !== before!.name) {
      await ctx.audit(req, {
        action: 'department.update', recordType: 'department', recordId: id,
        summary: `Department "${before!.name}" renamed to "${name}"`, before: { name: before!.name }, after: { name },
      });
    }
    return db.one(`${DEPT_SELECT} and d.id = $1`, [id]);
  });

  adminRoute(ctx, 'DELETE', '/api/admin/departments/:id', async (req) => {
    const id = idParam(req, 'Department');
    const row = await db.one<Row>(
      'update departments set deleted_at = now(), updated_by = $2 where id = $1 and deleted_at is null returning name', [id, req.user!.id],
    );
    if (!row) ctx.fail(404, 'not_found', 'Department not found.');
    const moved = await db.query('update users set department_id = null where department_id = $1 returning 1', [id]);
    await ctx.audit(req, {
      action: 'department.delete', recordType: 'department', recordId: id,
      summary: `Department "${row!.name}" removed (${moved.length} user(s) left without a department)`, before: { name: row!.name },
    });
    return { ok: true };
  });
}
