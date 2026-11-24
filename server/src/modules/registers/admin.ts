// Administration > Registers (E41-06): defining, changing and removing registers.
import type { FastifyRequest } from 'fastify';
import { fail } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { adminRoute, body, invalid, sensitive } from '../admin/shared.ts';
import {
  areaOf, ICONS, KEY_RE, keyTaken, NAV_GROUPS, PREFIX_RE, statusList, typeOf, type RegisterRow, type Registers,
} from './definitions.ts';

const ADMIN = 'admin.administer';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'r_$1').slice(0, 30);
const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max + 1);
const EDITABLE = ['label', 'plural', 'description', 'prefix', 'nav_group', 'icon', 'title_label', 'evidence'] as const;

export interface RegisterInput {
  key?: string; label?: string; plural?: string; description?: string; prefix?: string;
  nav_group?: string; icon?: string; title_label?: string; evidence?: boolean;
}

/**
 * Checks a new register or a change to one; returns the values to store. `existing` is null for a
 * new register. Shared by the routes and the sample data.
 */
export async function checkRegister(ctx: ModuleContext, regs: Registers, b: Row, existing: RegisterRow | null): Promise<Partial<RegisterRow>> {
  const fields: Record<string, string> = {};
  const out: Partial<RegisterRow> = {};
  const has = (k: string) => existing === null || b[k] !== undefined;
  if (has('label')) {
    out.label = clean(b.label, 60);
    if (!out.label || out.label.length > 60 || /[<>]/.test(out.label)) fields.label = 'Enter what one record is called, up to 60 characters (for example "Lost property item").';
  }
  if (has('plural')) {
    out.plural = clean(b.plural, 60);
    if (!out.plural || out.plural.length > 60 || /[<>]/.test(out.plural)) fields.plural = 'Enter the register\'s name, up to 60 characters (for example "Lost property").';
  }
  if (has('description')) {
    out.description = String(b.description ?? '').trim().slice(0, 500);
  }
  if (has('title_label')) {
    out.title_label = clean(b.title_label ?? 'Title', 40) || 'Title';
    if (out.title_label.length > 40 || /[<>]/.test(out.title_label)) fields.title_label = 'Enter a name of up to 40 characters for the main field.';
  }
  if (has('nav_group')) {
    out.nav_group = String(b.nav_group ?? 'Governance');
    if (!NAV_GROUPS.includes(out.nav_group)) fields.nav_group = `Choose one of: ${NAV_GROUPS.join(', ')}.`;
  }
  if (has('icon')) {
    out.icon = String(b.icon ?? 'folder');
    if (!ICONS.includes(out.icon)) fields.icon = 'Choose one of the icons offered.';
  }
  if (has('evidence')) {
    if (b.evidence !== undefined && typeof b.evidence !== 'boolean') fields.evidence = 'Files are evidence, or not.';
    out.evidence = b.evidence === true;
  }
  if (existing === null) {
    const key = String(b.key ?? '').trim() || slug(out.plural ?? '');
    if (!KEY_RE.test(key)) fields.key = 'Use 2 to 30 lower-case letters, numbers and underscores, starting with a letter.';
    else {
      const taken = keyTaken(ctx, key);
      if (regs.rows.has(key) || await ctx.db.one('select 1 from register_definitions where key = $1', [key])) fields.key = 'There is already a register with that name.';
      else if (taken) fields.key = taken;
      else if ((await ctx.db.one<{ t: string | null }>('select to_regclass($1)::text as t', [typeOf(key)]))?.t) fields.key = 'That name is used by the database. Choose another.';
    }
    out.key = key;
  }
  if (has('prefix')) {
    const prefix = String(b.prefix ?? '').trim().toUpperCase();
    out.prefix = prefix && !prefix.endsWith('-') ? `${prefix}-` : prefix;
    if (!PREFIX_RE.test(out.prefix)) fields.prefix = 'Use 1 to 8 capital letters or digits, starting with a letter, for example "LP" (records are numbered LP-00001).';
    else {
      const used = ctx.resources.all().find((d) => d.ref?.prefix === out.prefix && d.module !== existing?.key)
        ?? [...regs.rows.values()].find((r) => r.prefix === out.prefix && r.key !== existing?.key);
      if (used) fields.prefix = 'Another kind of record is numbered with that prefix. Choose another.';
    }
  }
  if (Object.keys(fields).length) invalid(fields);
  return out;
}

/** Stores a new register and puts it into the running application. */
export async function createRegister(ctx: ModuleContext, regs: Registers, values: Partial<RegisterRow>, req: FastifyRequest | null): Promise<RegisterRow> {
  const r = (await ctx.db.one<RegisterRow>(
    `insert into register_definitions (key, label, plural, description, prefix, nav_group, icon, title_label, evidence, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning *`,
    [values.key, values.label, values.plural, values.description ?? '', values.prefix, values.nav_group ?? 'Governance', values.icon ?? 'folder',
      values.title_label ?? 'Title', values.evidence === true, req?.user?.id ?? null],
  ))!;
  const state = await regs.activate(r, true);
  await regs.noteChange();
  await ctx.audit(req, {
    action: 'register.create', recordType: 'register_definition', recordId: r.id,
    summary: `Register "${r.plural}" defined (records numbered ${r.prefix}00001; permissions ${r.key}.view, .create, .edit, .delete, .export)${state === 'waiting' ? '; waiting for the database owner' : ''}`,
    after: r,
  });
  return r;
}

export function registerAdminRoutes(ctx: ModuleContext, regs: Registers) {
  const { db } = ctx;

  const counts = async () => new Map((await db.query<{ k: string; n: number; live: number }>(
    'select register_key as k, count(*)::int as n, count(*) filter (where deleted_at is null)::int as live from register_records group by 1',
  )).map((r) => [r.k, r]));

  /** One register as Administration shows it; null while it is switched off (shown nowhere but Features). */
  async function shape(r: RegisterRow, n?: { n: number; live: number }) {
    const st = regs.state.get(r.key) ?? 'waiting';
    if (st === 'ready' && !ctx.resources.get(typeOf(r.key))) return null;
    const fields = st === 'ready' ? await db.query<Row>(
      `select key, label, type, required from custom_fields where record_type = $1 and active order by position, label`, [typeOf(r.key)]) : [];
    return {
      ...r, type: typeOf(r.key), area: areaOf(r.key), statusList: statusList(r.key), state: st, route: `/registers/${r.key}`,
      records: n?.live ?? 0, storedRecords: n?.n ?? 0, fields,
      permissions: ['view', 'create', 'edit', 'delete', 'export'].map((a) => `${r.key}.${a}`),
    };
  }

  async function one(key: string): Promise<RegisterRow> {
    await regs.sync();
    const r = regs.rows.get(key);
    if (!r || (regs.state.get(key) === 'ready' && !ctx.resources.get(typeOf(key)))) return fail(404, 'not_found', 'Register not found.');
    return r;
  }

  adminRoute(ctx, 'GET', '/api/admin/registers', async () => {
    await regs.sync();
    const n = await counts();
    const list = [];
    for (const r of [...regs.rows.values()].sort((a, b) => a.plural.localeCompare(b.plural))) {
      const s = await shape(r, n.get(r.key));
      if (s) list.push(s);
    }
    return { registers: list, navGroups: NAV_GROUPS, icons: ICONS, schemaChanges: await regs.mayChangeSchema() };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/registers', tag: 'Registers', permission: ADMIN,
    summary: 'The registers administrators have defined (switched-off ones left out)',
    response: '{ registers: [{ key, label, plural, description, prefix, nav_group, icon, title_label, evidence, type, area, statusList, state, route, records, fields, permissions }], navGroups, icons, schemaChanges }',
  });

  adminRoute(ctx, 'POST', '/api/admin/registers', async (req, reply) => {
    const values = await checkRegister(ctx, regs, body(req), null);
    const r = await createRegister(ctx, regs, values, req);
    reply.code(201);
    return shape(r, undefined);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/admin/registers', tag: 'Registers', permission: ADMIN,
    summary: 'Define a register: a new kind of record with its own numbering, permissions, status list and switch',
    description: 'The key (from the plural name when not given) becomes the permission module (`<key>.view` and so on), the record type `reg_<key>` and the address `/registers/<key>`; it cannot be changed. Fields are added as custom fields of the record type. With a least-privilege database account the register waits (state `waiting`) until `migrate` runs as the owner.',
    body: '{ key?, label, plural, description?, prefix, nav_group?, icon?, title_label?, evidence? }',
    response: 'The register',
  });

  adminRoute(ctx, 'GET', '/api/admin/registers/:key', async (req) => {
    const r = await one(String((req.params as Row).key));
    return shape(r, (await counts()).get(r.key));
  });
  ctx.describeRoute({ method: 'GET', path: '/api/admin/registers/:key', tag: 'Registers', permission: ADMIN, summary: 'One register', response: 'The register' });

  adminRoute(ctx, 'PATCH', '/api/admin/registers/:key', async (req) => {
    const before = await one(String((req.params as Row).key));
    const b = body(req);
    if (b.key !== undefined && b.key !== before.key) invalid({ key: 'The name in addresses and permissions cannot be changed.' });
    const values = await checkRegister(ctx, regs, b, before);
    const changed = EDITABLE.filter((k) => values[k] !== undefined && values[k] !== before[k]);
    if (!changed.length) return shape(before, (await counts()).get(before.key));
    const sets = changed.map((k, i) => `${k} = $${i + 2}`);
    const r = (await db.one<RegisterRow>(
      `update register_definitions set ${sets.join(', ')}, updated_at = now(), updated_by = $${changed.length + 2} where key = $1 returning *`,
      [before.key, ...changed.map((k) => values[k]), req.user!.id],
    ))!;
    await regs.activate(r, true);
    await regs.noteChange();
    await ctx.audit(req, {
      action: 'register.update', recordType: 'register_definition', recordId: r.id,
      summary: `Register "${r.plural}" changed (${changed.join(', ')})`,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, r[k]])),
    });
    return shape(r, (await counts()).get(r.key));
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/admin/registers/:key', tag: 'Registers', permission: ADMIN,
    summary: 'Change a register\'s names, numbering prefix, place in the menu, icon or main field name',
    description: 'A new prefix numbers new records only; existing references stay.',
    body: '{ label?, plural?, description?, prefix?, nav_group?, icon?, title_label?, evidence? }', response: 'The register',
  });

  adminRoute(ctx, 'DELETE', '/api/admin/registers/:key', async (req) => {
    const r = await one(String((req.params as Row).key));
    const n = (await counts()).get(r.key);
    if (n?.n) {
      fail(409, 'in_use', n.live
        ? `This register holds ${n.live} record${n.live === 1 ? '' : 's'}. Delete them first, or switch the register off under Administration > Features to keep them.`
        : 'This register still holds deleted records, kept until the retention schedule removes them. Switch the register off instead.');
    }
    await sensitive(ctx, req, `removing the register "${r.plural}"`);
    if (regs.state.get(r.key) !== 'waiting' && !(await regs.mayChangeSchema())) {
      fail(409, 'owner_needed', 'Removing a register changes the database, which this server\'s database account may not do. Switch it off under Administration > Features instead.');
    }
    const type = typeOf(r.key);
    regs.deactivate(r.key);
    await db.tx(async (tx) => {
      await tx.query('delete from register_definitions where key = $1', [r.key]);
      await tx.query('delete from custom_fields where record_type = $1', [type]);
      await tx.query('delete from lifecycle_rules where record_type = $1', [type]);
      await tx.query(`delete from role_permissions where permission like $1`, [`${r.key}.%`]);
      await tx.query(`delete from schema_requests where kind = 'register' and target = $1`, [r.key]);
    });
    ctx.app.lifecycles?.invalidate();
    await regs.dropSchema(r.key).catch((err) => console.error(`[registers] ${r.key}: the view could not be removed:`, err));
    // The stored feature switch of the register goes too, so it cannot come back with a new register of that name.
    const features = await ctx.settings.get<Row | null>('features', null);
    if (features && typeof features === 'object' && areaOf(r.key) in features) {
      const { [areaOf(r.key)]: _gone, ...rest } = features;
      await ctx.settings.set('features', rest, req);
    }
    await regs.noteChange();
    await ctx.audit(req, {
      action: 'register.delete', recordType: 'register_definition', recordId: r.id,
      summary: `Register "${r.plural}" removed, with its fields and the roles' ${r.key} permissions`, before: r,
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/admin/registers/:key', tag: 'Registers', permission: ADMIN,
    summary: 'Remove a register that holds no records',
    description: 'Needs a recent password confirmation. Refused (409 `in_use`) while the register holds records, deleted ones included: switch it off instead. Removes its fields, lifecycle rules and the roles\' grants of its permissions.',
    response: '{ ok: true }',
  });
}
