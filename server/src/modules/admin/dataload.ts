// Data load mode (E18-70, core/dataload.ts): the switch on Administration > Settings, the Data loads
// page that lists what each load created and undoes it, and the one delete route a token may use
// (the MCP tool delete_record), for records a load created, while the mode is on.
import type { FastifyRequest } from 'fastify';
import { asDataLoad, DATA_LOAD_DEFAULT_DAYS, DATA_LOAD_KEY, DATA_LOAD_MAX_DAYS, dataLoadFor, mayLoad, readDataLoad, resolvePerson, wasLoaded } from '../../core/dataload.ts';
import { ApiError, UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { TIME_ZONE } from '../../core/timezone.ts';
import { adminRoute, body, invalid, sensitive } from './shared.ts';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerDataLoad(ctx: ModuleContext): void {
  const { db } = ctx;
  const state = () => readDataLoad(db, ctx.audit);
  const sessionOnly = (req: FastifyRequest) => {
    if (req.apiToken) ctx.fail(403, 'token_not_allowed', 'This cannot be done with an API token. Sign in to do it.');
  };

  /** The mode, who switched it on, and the loads by day (organization time zone) and record type. */
  adminRoute(ctx, 'GET', '/api/admin/data-load', async () => {
    const s = await state();
    const by = s.startedBy ? await db.one<{ name: string }>('select display_name as name from users where id = $1', [s.startedBy]) : undefined;
    const rows = await db.query<Row>(
      `select to_char(l.loaded_at at time zone $1, 'YYYY-MM-DD') as day, l.record_type,
              count(*)::int as records, count(*) filter (where l.deleted_at is null)::int as remaining,
              min(l.loaded_at) as first_at, max(l.loaded_at) as last_at,
              string_agg(distinct coalesce(u.display_name, 'System'), ', ') as people,
              string_agg(distinct l.token_name, ', ') as tokens,
              string_agg(distinct l.on_behalf_name, ', ') as on_behalf
       from data_load_records l left join users u on u.id = l.loaded_by
       group by 1, 2 order by 1 desc, 2`, [TIME_ZONE]);
    const loads = rows.map((r): Row => {
      const def = ctx.resources.get(r.record_type);
      return { ...r, label: def?.plural ?? r.record_type, route: def?.route ?? null, installed: !!def };
    }).filter((r) => r.installed || r.remaining > 0);
    // Work written on behalf of other people (E18-71), from the audit log: records, comments, files,
    // links and decisions alike, by day (organization time zone), person named and the real actor.
    const behalf = await db.query<Row>(
      `select to_char(at at time zone $1, 'YYYY-MM-DD') as day, on_behalf_name as person, coalesce(actor_name, 'System') as loaded_by,
              string_agg(distinct token_name, ', ') as tokens, count(*)::int as events
       from audit_events where on_behalf_name is not null
       group by 1, 2, 3 order by 1 desc, 2 limit 500`, [TIME_ZONE]);
    return {
      ...s, startedByName: by?.name ?? null, maxDays: DATA_LOAD_MAX_DAYS, defaultDays: DATA_LOAD_DEFAULT_DAYS,
      mcpWriteEnabled: (await ctx.settings.get<unknown>('mcp.write_enabled', false)) === true,
      loads, onBehalf: behalf,
    };
  });

  /**
   * Works out a person a load would name (E18-71), the same way `on_behalf_of` does: for the AI
   * assistant tools and for checking a name before loading. Only while the caller's saves are loads.
   */
  ctx.app.post('/api/data-load/person', async (req) => {
    if (!mayLoad(req)) ctx.fail(403, 'forbidden', 'Only an administrator can name other people in a data load.');
    if (!(await dataLoadFor(db, req, ctx.audit))) {
      ctx.fail(409, 'data_load_off', 'Data load mode is off (or AI assistant write access is off), so nobody else can be named.');
    }
    const p = await resolvePerson(db, body(req).person, 'person');
    return { kind: p.kind, user_id: p.userId, person_id: p.personId, name: p.name };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/data-load/person', permission: 'admin.administer', tag: 'Administration',
    summary: 'Work out the person a data load names as an author (on_behalf_of), while the mode is on',
    body: '{ person: string | { user } | { person } | { name } }', response: '{ kind: user | person | name, user_id, person_id, name }',
    description: 'A string is a user id, username or email (disabled accounts too), else a roster person id, reference, email or employee number; "user:", "person:" and "name:" prefixes ask for one kind. 400 with a field error when nobody matches; 409 data_load_off when the mode is off.',
  });

  /** Switch on until a time at most 30 days ahead (recent password confirmation), or off. */
  adminRoute(ctx, 'POST', '/api/admin/data-load', async (req) => {
    sessionOnly(req);
    const b = body(req);
    if (typeof b.on !== 'boolean') invalid({ on: 'Choose on or off.' });
    const before = await state();
    if (!b.on) {
      if (!before.on) return { ...before };
      await db.query('delete from settings where key = $1', [DATA_LOAD_KEY]);
      await ctx.audit(req, { action: 'data_load.stop', recordType: 'setting', recordId: DATA_LOAD_KEY, summary: 'Data load mode switched off', before, after: null });
      return { ...(await state()) };
    }
    let until: Date;
    if (b.until !== undefined && b.until !== null && b.until !== '') {
      until = new Date(String(b.until));
      if (Number.isNaN(until.getTime())) invalid({ until: 'Choose a date and time.' });
    } else {
      const days = b.days === undefined ? DATA_LOAD_DEFAULT_DAYS : Number(b.days);
      if (!Number.isFinite(days) || days <= 0) invalid({ until: 'Choose when data load mode ends.' });
      until = new Date(Date.now() + days * 86_400_000);
    }
    if (until.getTime() <= Date.now() + 60_000) invalid({ until: 'The end must be in the future.' });
    if (until.getTime() > Date.now() + DATA_LOAD_MAX_DAYS * 86_400_000 + 60_000) invalid({ until: `Data load mode lasts at most ${DATA_LOAD_MAX_DAYS} days.` });
    await sensitive(ctx, req, 'switching data load mode on');
    const value = { until: until.toISOString(), startedAt: before.startedAt ?? new Date().toISOString(), startedBy: before.startedBy ?? req.user!.id };
    await db.query(
      `insert into settings (key, value, updated_by) values ($1, $2::jsonb, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
      [DATA_LOAD_KEY, JSON.stringify(value), req.user!.id]);
    await ctx.audit(req, {
      action: before.on ? 'data_load.extend' : 'data_load.start', recordType: 'setting', recordId: DATA_LOAD_KEY,
      summary: before.on ? `Data load mode now ends ${value.until}` : `Data load mode switched on until ${value.until}`, before: before.on ? before : null, after: value,
    });
    return { ...(await state()) };
  });

  /**
   * Undoes one load: soft-deletes every record of one type that data load mode created on one day
   * (recent password confirmation). Records under a legal hold, and records already deleted, stay.
   */
  adminRoute(ctx, 'POST', '/api/admin/data-load/undo', async (req) => {
    sessionOnly(req);
    const b = body(req);
    const def = typeof b.type === 'string' ? ctx.resources.get(b.type) : undefined;
    const fields: Record<string, string> = {};
    if (!def) fields.type = 'Choose a record type.';
    if (typeof b.day !== 'string' || !DAY_RE.test(b.day)) fields.day = 'Choose a day (YYYY-MM-DD).';
    if (Object.keys(fields).length) invalid(fields);
    await sensitive(ctx, req, 'deleting the records a data load created');
    const ids = (await db.query<{ record_id: string }>(
      `select record_id from data_load_records
       where record_type = $1 and deleted_at is null and to_char(loaded_at at time zone $3, 'YYYY-MM-DD') = $2 order by id`,
      [def!.type, b.day, TIME_ZONE])).map((r) => r.record_id);
    let deleted = 0;
    const held: string[] = [];
    let missing = 0;
    // Undoing is quiet like the load itself: no webhooks or notifications about history going away.
    req.dataLoad = true;
    await asDataLoad(async () => {
      for (const id of ids) {
        try {
          await ctx.resources.remove!(def!.type, id, req, { summary: '(undoing a data load)' });
          deleted += 1;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'on_hold') held.push(id);
          else if (err instanceof ApiError && err.code === 'not_found') missing += 1;
          else throw err;
        }
      }
    });
    await ctx.audit(req, {
      action: 'data_load.undo', recordType: def!.type,
      summary: `Data load of ${b.day} undone: ${deleted} ${def!.plural.toLowerCase()} deleted${held.length ? `, ${held.length} kept under a legal hold` : ''}${missing ? `, ${missing} not found` : ''}`,
      after: { day: b.day, type: def!.type, deleted, held: held.length, missing },
    });
    return { deleted, held: held.length, missing };
  });

  /**
   * Deletes one record a load created, while data load mode is on (the MCP tool delete_record). A
   * token may use it when its owner holds admin.administer; refused under a legal hold.
   */
  ctx.app.delete('/api/data-load/records/:type/:id', async (req) => {
    const { type, id } = req.params as Row;
    if (!mayLoad(req)) ctx.fail(403, 'forbidden', 'Only an administrator can delete loaded records.');
    if (!(await dataLoadFor(db, req, ctx.audit))) {
      ctx.fail(409, 'data_load_off', 'Data load mode is off (or AI assistant write access is off), so loaded records cannot be deleted this way.');
    }
    const def = ctx.resources.get(String(type));
    if (!def || !UUID_RE.test(String(id)) || !(await wasLoaded(db, def.type, String(id)))) {
      ctx.fail(404, 'not_found', 'No record created in data load mode with that id.');
    }
    const row = await ctx.resources.remove!(def!.type, String(id), req, { summary: '(created in data load mode)' });
    return { ok: true, type: def!.type, id: row.id, ref: def!.ref ? row[def!.ref.field] ?? null : null };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/data-load/records/:type/:id', permission: 'admin.administer', tag: 'Administration',
    summary: 'Delete one record created in data load mode, while the mode is on (soft delete; refused under a legal hold)',
    description: 'For administrators and their API and AI assistant tokens (the owner must hold admin.administer; an assistant token also needs AI assistant write access). 409 data_load_off when the mode is off, 404 when the record was not created by a load, 409 on_hold under a legal hold.',
  });
}
