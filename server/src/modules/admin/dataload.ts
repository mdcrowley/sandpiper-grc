// Data load mode (E18-70, core/dataload.ts): the switch on Administration > Settings, the Data loads
// page that lists what each load created and undoes it, and the one delete route a token may use
// (the MCP tool delete_record), for records a load created, while the mode is on.
import type { FastifyRequest } from 'fastify';
import { asDataLoad, DATA_LOAD_DEFAULT_DAYS, DATA_LOAD_KEY, DATA_LOAD_MAX_DAYS, dataLoadFor, mayLoad, readDataLoad, resolvePerson, wasLoaded } from '../../core/dataload.ts';
import { ApiError, UUID_RE } from '../../core/errors.ts';
import { assertNotHeld } from '../../core/holds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { TIME_ZONE } from '../../core/timezone.ts';
import { adminRoute, body, invalid, sensitive } from './shared.ts';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** How files a load added are listed in data_load_records (attachments/loaded.ts, E45-52). */
const LOADED_FILES = 'attachment';

/**
 * Records a load lists one by one that are not record types of their own (E43-18: document versions),
 * each listed and undone by its module through the shared `loadedParts` decorator.
 */
interface LoadedPart {
  label: string;
  list(ids: string[]): Promise<{ id: string; label: string; route: string | null; gone: boolean }[]>;
  undo(req: FastifyRequest, id: string): Promise<'deleted' | 'missing' | 'held'>;
}

export function registerDataLoad(ctx: ModuleContext): void {
  const { db } = ctx;
  if (!ctx.app.hasDecorator('loadedParts')) ctx.app.decorate('loadedParts', new Map<string, LoadedPart>());
  const parts = () => (ctx.app as unknown as { loadedParts: Map<string, LoadedPart> }).loadedParts;
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
      // Files added by a load (E45-52) are listed as `attachment`: not a record type of their own.
      if (r.record_type === LOADED_FILES) return { ...r, label: 'Files', route: null, installed: true };
      // Parts a module lists one by one (E43-18): each can be undone alone.
      const part = parts().get(r.record_type);
      if (part) return { ...r, label: part.label, route: null, installed: true, itemized: true };
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
   * Undoes the files a load added on one day (E45-52): each is removed as Remove on its record does
   * (soft delete, bytes kept for the purge period); files of a record under a legal hold stay.
   */
  const undoFiles = async (req: FastifyRequest, day: string) => {
    const rows = await db.query<Row>(
      `select a.id, a.record_type, a.record_id, a.file_name, a.deleted_at from data_load_records l
       left join attachments a on a.id = l.record_id
       where l.record_type = $1 and l.deleted_at is null and to_char(l.loaded_at at time zone $3, 'YYYY-MM-DD') = $2 order by l.id`,
      [LOADED_FILES, day, TIME_ZONE]);
    let deleted = 0;
    let missing = 0;
    const held: string[] = [];
    for (const a of rows) {
      if (!a.id || a.deleted_at) { missing += 1; continue; }
      try {
        await assertNotHeld(db, a.record_type, a.record_id, 'remove_file');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'on_hold') { held.push(a.id); continue; }
        throw err;
      }
      await db.query(`update attachments set deleted_at = now(), removed_reason = 'removed', updated_at = now(), updated_by = $2 where id = $1 and deleted_at is null`, [a.id, req.user!.id]);
      await db.query('update data_load_records set deleted_at = now(), deleted_by = $3 where record_type = $1 and record_id = $2 and deleted_at is null', [LOADED_FILES, a.id, req.user!.id]);
      await ctx.audit(req, {
        action: 'attachment.delete', recordType: a.record_type, recordId: a.record_id,
        summary: `File removed: ${a.file_name} (undoing a data load)`, before: { attachment_id: a.id, file_name: a.file_name },
      });
      deleted += 1;
    }
    await ctx.audit(req, {
      action: 'data_load.undo', recordType: LOADED_FILES,
      summary: `Data load of ${day} undone: ${deleted} files removed${held.length ? `, ${held.length} kept under a legal hold` : ''}${missing ? `, ${missing} not found` : ''}`,
      after: { day, type: LOADED_FILES, deleted, held: held.length, missing },
    });
    return { deleted, held: held.length, missing };
  };

  /** Undoes one listed part (E43-18) and marks it undone in data_load_records. */
  const undoPart = async (req: FastifyRequest, type: string, part: LoadedPart, id: string) => {
    const result = await part.undo(req, id);
    if (result !== 'held') {
      await db.query('update data_load_records set deleted_at = now(), deleted_by = $3 where record_type = $1 and record_id = $2 and deleted_at is null', [type, id, req.user!.id]);
    }
    return result;
  };

  /** The records of one load listed one by one, for the types a module lists that way (E43-18). */
  adminRoute(ctx, 'GET', '/api/admin/data-load/records', async (req) => {
    const q = (req.query ?? {}) as Row;
    const part = typeof q.type === 'string' ? parts().get(q.type) : undefined;
    const fields: Record<string, string> = {};
    if (!part) fields.type = 'Choose a record type listed one by one.';
    if (typeof q.day !== 'string' || !DAY_RE.test(q.day)) fields.day = 'Choose a day (YYYY-MM-DD).';
    if (Object.keys(fields).length) invalid(fields);
    const rows = await db.query<Row>(
      `select record_id, deleted_at, loaded_at from data_load_records
       where record_type = $1 and to_char(loaded_at at time zone $3, 'YYYY-MM-DD') = $2 order by id limit 1000`, [q.type, q.day, TIME_ZONE]);
    const listed = await part!.list(rows.map((r) => String(r.record_id)));
    const byId = new Map(listed.map((l) => [l.id, l]));
    return {
      type: q.type, day: q.day, label: part!.label,
      rows: rows.map((r) => {
        const l = byId.get(String(r.record_id));
        return { id: r.record_id, label: l?.label ?? String(r.record_id), route: l?.route ?? null, loaded_at: r.loaded_at, undone: Boolean(r.deleted_at) || Boolean(l?.gone) };
      }),
    };
  });

  /** Undoes one record of a load that is listed one by one (E43-18; recent password confirmation). */
  adminRoute(ctx, 'POST', '/api/admin/data-load/undo-one', async (req) => {
    sessionOnly(req);
    const b = body(req);
    const part = typeof b.type === 'string' ? parts().get(b.type) : undefined;
    const fields: Record<string, string> = {};
    if (!part) fields.type = 'Choose a record type listed one by one.';
    if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) fields.id = 'Choose a loaded record.';
    if (Object.keys(fields).length) invalid(fields);
    if (!(await db.one('select 1 from data_load_records where record_type = $1 and record_id = $2 and deleted_at is null', [b.type, b.id]))) {
      ctx.fail(404, 'not_found', 'No record of a data load with that id, or it was already undone.');
    }
    await sensitive(ctx, req, 'deleting a record a data load created');
    req.dataLoad = true;
    const result = await asDataLoad(() => undoPart(req, String(b.type), part!, String(b.id)));
    if (result === 'held') ctx.fail(409, 'on_hold', 'The record is under a legal hold, so it is kept.');
    return { result };
  });

  /**
   * Undoes one load: soft-deletes every record of one type that data load mode created on one day
   * (recent password confirmation). Records under a legal hold, and records already deleted, stay.
   */
  adminRoute(ctx, 'POST', '/api/admin/data-load/undo', async (req) => {
    sessionOnly(req);
    const b = body(req);
    const files = b.type === LOADED_FILES;
    const part = typeof b.type === 'string' ? parts().get(b.type) : undefined;
    const def = typeof b.type === 'string' && !files && !part ? ctx.resources.get(b.type) : undefined;
    const fields: Record<string, string> = {};
    if (!def && !files && !part) fields.type = 'Choose a record type.';
    if (typeof b.day !== 'string' || !DAY_RE.test(b.day)) fields.day = 'Choose a day (YYYY-MM-DD).';
    if (Object.keys(fields).length) invalid(fields);
    await sensitive(ctx, req, 'deleting the records a data load created');
    if (files) return undoFiles(req, b.day);
    if (part) {
      const ids = (await db.query<{ record_id: string }>(
        `select record_id from data_load_records
         where record_type = $1 and deleted_at is null and to_char(loaded_at at time zone $3, 'YYYY-MM-DD') = $2 order by id desc`,
        [b.type, b.day, TIME_ZONE])).map((r) => r.record_id);
      const count = { deleted: 0, held: 0, missing: 0 };
      req.dataLoad = true;
      await asDataLoad(async () => { for (const id of ids) count[await undoPart(req, String(b.type), part, id)] += 1; });
      await ctx.audit(req, {
        action: 'data_load.undo', recordType: String(b.type),
        summary: `Data load of ${b.day} undone: ${count.deleted} ${part.label.toLowerCase()} removed${count.held ? `, ${count.held} kept under a legal hold` : ''}${count.missing ? `, ${count.missing} not found` : ''}`,
        after: { day: b.day, type: b.type, ...count },
      });
      return count;
    }
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
