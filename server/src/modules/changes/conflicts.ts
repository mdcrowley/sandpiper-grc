import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { Base, Req } from './base.ts';
import { AFFECTS } from './base.ts';
import { LIVE_STATUSES, SETTLED_STATUSES } from './rules.ts';

export interface Conflict {
  /** `blackout:<id>` or `change:<id>`. */
  key: string;
  kind: 'blackout' | 'change';
  summary: string;
  starts_at: string;
  ends_at: string;
  /** The other record: a blackout period or a change. */
  record: { id: string; ref: string | null; title: string; status: string | null };
  shared_systems: { id: string; label: string }[];
  acknowledged: { reason: string; by: string | null; at: string } | null;
}

const iso = (v: unknown) => new Date(v as string | Date).toISOString();

/** Conflict detection: blackout periods and other live changes on a shared system. */
export function makeConflicts(ctx: ModuleContext, base: Base) {
  const { db } = ctx;

  /** Everything that clashes with a planned window. Pure detection: no acknowledgements. */
  async function detect(input: { id?: string | null; start: Date; end: Date; systemIds: string[] }): Promise<Conflict[]> {
    const out: Conflict[] = [];
    const blackouts = await db.query<Row>(
      `select * from change_blackouts where deleted_at is null and starts_at < $2 and ends_at > $1 order by starts_at`,
      [input.start.toISOString(), input.end.toISOString()]);
    for (const b of blackouts) {
      out.push({
        key: `blackout:${b.id}`, kind: 'blackout',
        summary: `Falls in the blackout period "${b.name}"${b.reason ? ` (${b.reason})` : ''}`,
        starts_at: iso(b.starts_at), ends_at: iso(b.ends_at),
        record: { id: b.id, ref: null, title: b.name, status: null },
        shared_systems: [], acknowledged: null,
      });
    }

    const systemIds = input.systemIds.filter((s) => UUID_RE.test(s));
    if (systemIds.length) {
      const others = await db.query<Row>(
        `select c.id, c.ref, c.title, c.status, c.system_id, c.planned_start, c.planned_end from changes c
         where c.deleted_at is null and c.status = any($3::text[])
           and c.planned_start < $2 and c.planned_end > $1
           and ($4::uuid is null or c.id <> $4::uuid)
           and (c.system_id = any($5::uuid[]) or exists (
             select 1 from record_links l where l.from_type = 'change' and l.from_id = c.id
               and l.to_type = 'system' and l.relation = $6 and l.to_id = any($5::uuid[])))
         order by c.planned_start`,
        [input.start.toISOString(), input.end.toISOString(), LIVE_STATUSES, input.id ?? null, systemIds, AFFECTS]);
      const theirs = await base.systemsOf(others);
      const names = await base.systemNames(systemIds);
      for (const o of others) {
        const shared = (theirs.get(o.id) ?? []).filter((s) => systemIds.includes(s));
        const labels = shared.map((id) => ({ id, label: names.get(id) ?? 'a shared system' }));
        out.push({
          key: `change:${o.id}`, kind: 'change',
          summary: `Overlaps ${[o.ref, o.title].filter(Boolean).join(' ')} on ${labels.map((l) => l.label).join(', ') || 'a shared system'}`,
          starts_at: iso(o.planned_start), ends_at: iso(o.planned_end),
          record: { id: o.id, ref: o.ref, title: o.title, status: o.status },
          shared_systems: labels, acknowledged: null,
        });
      }
    }
    return out;
  }

  /** Conflicts of a saved change, each with its acknowledgement if one holds for the current window. */
  async function conflictsFor(change: Row): Promise<Conflict[]> {
    if (!change.planned_start || !change.planned_end || SETTLED_STATUSES.includes(change.status)) return [];
    const start = new Date(change.planned_start);
    const end = new Date(change.planned_end);
    const systemIds = (await base.systemsOf([change])).get(change.id) ?? [];
    const found = await detect({ id: change.id, start, end, systemIds });
    if (!found.length) return found;
    const overrides = await db.query<Row>(
      'select * from change_conflict_overrides where change_id = $1 order by created_at desc', [change.id]);
    for (const c of found) {
      const o = overrides.find((x) => x.conflict_key === c.key
        && new Date(x.window_start).getTime() === start.getTime() && new Date(x.window_end).getTime() === end.getTime());
      if (o) c.acknowledged = { reason: o.reason, by: o.acknowledged_by_name, at: iso(o.created_at) };
    }
    return found;
  }

  /** Records that the conflicts are known and accepted, with the reason. Audited. */
  async function acknowledge(req: Req, change: Row, body: Row): Promise<Conflict[]> {
    const reason = String(body.reason ?? '').trim();
    if (!reason) ctx.fail(400, 'validation', 'Check the highlighted fields.', { reason: 'Give the reason for going ahead despite the conflict.' });
    const open = (await conflictsFor(change)).filter((c) => !c.acknowledged);
    const keys = Array.isArray(body.keys) && body.keys.length ? (body.keys as unknown[]).map(String) : open.map((c) => c.key);
    const chosen = open.filter((c) => keys.includes(c.key));
    if (!chosen.length) ctx.fail(409, 'no_conflict', 'There is no unacknowledged conflict to override.');
    for (const c of chosen) {
      await base.insertRow('change_conflict_overrides', {
        change_id: change.id, conflict_key: c.key, summary: c.summary, reason,
        window_start: new Date(change.planned_start).toISOString(), window_end: new Date(change.planned_end).toISOString(),
        acknowledged_by: req?.user?.id ?? null, acknowledged_by_name: base.actorName(req),
      });
      await ctx.audit(req, {
        action: 'change.conflict_override', recordType: 'change', recordId: change.id,
        summary: `Conflict acknowledged for ${base.changeLabel(change)}: ${c.summary}. Reason: ${reason}`,
        after: { conflict: c.key, kind: c.kind, summary: c.summary, reason },
      });
    }
    return conflictsFor(change);
  }

  /** Changes and blackout periods in a date range, for the calendar. */
  async function calendar(fromRaw: unknown, toRaw: unknown) {
    const from = new Date(String(fromRaw ?? ''));
    const to = new Date(String(toRaw ?? ''));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      ctx.fail(400, 'validation', 'Give a valid date range: "from" and "to".');
    }
    if (to.getTime() - from.getTime() > 100 * 86400000) ctx.fail(400, 'validation', 'The calendar shows at most 100 days at a time.');
    const rows = await db.query<Row>(
      `select c.id, c.ref, c.title, c.change_type, c.status, c.risk_level, c.system_id, c.assignee_id,
              c.planned_start, c.planned_end, u.display_name as assignee
       from changes c left join users u on u.id = c.assignee_id
       where c.deleted_at is null and c.planned_start < $2 and c.planned_end > $1
         and c.status <> all($3::text[])
       order by c.planned_start, c.ref limit 500`,
      [from.toISOString(), to.toISOString(), ['rejected', 'cancelled']]);
    const systems = await base.systemsOf(rows);
    const names = await base.systemNames([...systems.values()].flat());
    const changes = [];
    for (const r of rows) {
      const conflicts = await conflictsFor(r);
      changes.push({
        ...r,
        planned_start: iso(r.planned_start), planned_end: iso(r.planned_end),
        systems: (systems.get(r.id) ?? []).map((id) => ({ id, label: names.get(id) ?? 'System' })),
        conflicts,
        unacknowledged: conflicts.filter((c) => !c.acknowledged).length,
      });
    }
    const blackouts = await db.query<Row>(
      `select id, name, starts_at, ends_at, reason from change_blackouts
       where deleted_at is null and starts_at < $2 and ends_at > $1 order by starts_at`,
      [from.toISOString(), to.toISOString()]);
    return {
      from: from.toISOString(), to: to.toISOString(), changes,
      blackouts: blackouts.map((b) => ({ ...b, starts_at: iso(b.starts_at), ends_at: iso(b.ends_at) })),
    };
  }

  /** Live conflict check for a change that is still being written (the "New change" flow). */
  async function check(body: Row): Promise<Conflict[]> {
    const start = new Date(String(body.planned_start ?? ''));
    const end = new Date(String(body.planned_end ?? ''));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
    const systemIds = Array.isArray(body.system_ids) ? (body.system_ids as unknown[]).map(String) : [];
    const id = typeof body.exclude_id === 'string' && UUID_RE.test(body.exclude_id) ? body.exclude_id : null;
    return detect({ id, start, end, systemIds });
  }

  return { detect, conflictsFor, acknowledge, calendar, check };
}

export type Conflicts = ReturnType<typeof makeConflicts>;
