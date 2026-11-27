import { actorOf } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import { TIME_ZONE } from '../../core/timezone.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { Base, Req } from './base.ts';
import { AFFECTS } from './base.ts';
import { LIVE_STATUSES, SETTLED_STATUSES } from './rules.ts';
// Whole months on a wall-clock reading kept as UTC fields (31 Jan + 1 month = 28/29 Feb).
import { addMonthsToInstant as addMonths } from '../../../../shared/dates.ts';

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

const jsonList = (v: unknown): string[] => {
  const x = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v;
  return Array.isArray(x) ? x.map(String) : [];
};

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
/** How the clocks of `zone` read an instant, as a Date whose UTC fields are that reading ("wall time"). */
function toWall(at: Date, zone: string): Date {
  let f = zoneFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    zoneFormats.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second), at.getUTCMilliseconds()));
}
/** The instant at which the clocks of `zone` read this wall time (a time skipped by a clock change moves forward). */
function fromWall(wall: Date, zone: string): Date {
  let guess = wall.getTime();
  for (let i = 0; i < 3; i++) {
    const diff = wall.getTime() - toWall(new Date(guess), zone).getTime();
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/**
 * The windows of a blackout period that overlap [from, to): the period itself, or each
 * weekly or monthly repeat of it up to its "repeat until" date (inclusive).
 *
 * Repeats keep the organization's wall-clock times (OP-07): a Saturday 22:00 to 02:00 period stays
 * 22:00 to 02:00 after daylight saving time starts or ends, and "repeat until" is the last local
 * day on which a repeat may start.
 */
export function blackoutWindows(b: Row, from: Date, to: Date, zone: string = TIME_ZONE): { start: Date; end: Date }[] {
  const start = new Date(b.starts_at);
  const end = new Date(b.ends_at);
  const repeat = String(b.repeat ?? 'none');
  const untilDay = b.repeat_until instanceof Date ? b.repeat_until.toISOString().slice(0, 10) : b.repeat_until ? String(b.repeat_until).slice(0, 10) : null;
  const wallStart = toWall(start, zone);
  const wallLength = toWall(end, zone).getTime() - wallStart.getTime();
  const out: { start: Date; end: Date }[] = [];
  for (let i = 0; i < 1000; i++) {
    let s: Date;
    let e: Date;
    if (i === 0) {
      [s, e] = [start, end];
    } else if (repeat === 'weekly' || repeat === 'monthly') {
      const ws = repeat === 'weekly' ? new Date(wallStart.getTime() + i * 7 * 86_400_000) : addMonths(wallStart, i);
      if (untilDay && ws.toISOString().slice(0, 10) > untilDay) break;
      s = fromWall(ws, zone);
      e = fromWall(new Date(ws.getTime() + wallLength), zone);
    } else {
      break;
    }
    if (s >= to) break;
    if (e > from) out.push({ start: s, end: e });
  }
  return out;
}

/** Whether a blackout period applies to a change on these systems: one for all systems, or one naming any of them. */
export function blackoutApplies(b: Row, systemIds: string[]): boolean {
  const scope = jsonList(b.system_ids);
  return !scope.length || scope.some((s) => systemIds.includes(s));
}

/** Conflict detection: blackout periods and other live changes on a shared system. */
export function makeConflicts(ctx: ModuleContext, base: Base) {
  const { db } = ctx;

  /** Blackout periods with at least one window inside [from, to). */
  async function blackoutsIn(from: Date, to: Date): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select * from change_blackouts where deleted_at is null and starts_at < $2
         and (ends_at > $1 or coalesce(repeat, 'none') <> 'none')
       order by starts_at`,
      [from.toISOString(), to.toISOString()]);
    return rows.filter((b) => blackoutWindows(b, from, to).length > 0);
  }

  /** Everything that clashes with a planned window. Pure detection: no acknowledgments. */
  async function detect(input: { id?: string | null; start: Date; end: Date; systemIds: string[] }): Promise<Conflict[]> {
    const out: Conflict[] = [];
    const systemIds = input.systemIds.filter((s) => UUID_RE.test(s));
    for (const b of await blackoutsIn(input.start, input.end)) {
      if (!blackoutApplies(b, systemIds)) continue;
      const w = blackoutWindows(b, input.start, input.end)[0];
      if (!w) continue;
      const scope = jsonList(b.system_ids).filter((s) => systemIds.includes(s));
      const names = await base.systemNames(scope);
      out.push({
        key: `blackout:${b.id}`, kind: 'blackout',
        summary: `Falls in the blackout period "${b.name}"${b.reason ? ` (${b.reason})` : ''}${scope.length ? ` for ${scope.map((s) => names.get(s) ?? 'a system').join(', ')}` : ''}`,
        starts_at: w.start.toISOString(), ends_at: w.end.toISOString(),
        record: { id: b.id, ref: null, title: b.name, status: null },
        shared_systems: scope.map((id) => ({ id, label: names.get(id) ?? 'System' })), acknowledged: null,
      });
    }

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

  /** Conflicts of a saved change, each with its acknowledgment if one holds for the current window. */
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
        acknowledged_by: actorOf(req).id, acknowledged_by_name: base.actorName(req),
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
  /**
   * Changes and blackout periods in a date range, for the calendar. With `systemId`, only the
   * changes that affect that system (main system or an "affects" link) and the blackout periods
   * that apply to it.
   */
  async function calendar(fromRaw: unknown, toRaw: unknown, systemIdRaw?: unknown) {
    const from = new Date(String(fromRaw ?? ''));
    const to = new Date(String(toRaw ?? ''));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      ctx.fail(400, 'validation', 'Give a valid date range: "from" and "to".');
    }
    if (to.getTime() - from.getTime() > 100 * 86400000) ctx.fail(400, 'validation', 'The calendar shows at most 100 days at a time.');
    const systemId = typeof systemIdRaw === 'string' && systemIdRaw !== '' ? systemIdRaw : null;
    if (systemId && !UUID_RE.test(systemId)) ctx.fail(400, 'validation', 'The system is not a valid reference.');
    const rows = await db.query<Row>(
      `select c.id, c.ref, c.title, c.change_type, c.status, c.risk_level, c.system_id, c.assignee_id,
              c.planned_start, c.planned_end, u.display_name as assignee
       from changes c left join users u on u.id = c.assignee_id
       where c.deleted_at is null and c.planned_start < $2 and c.planned_end > $1
         and c.status <> all($3::text[])
         and ($4::uuid is null or c.system_id = $4::uuid or exists (
           select 1 from record_links l where l.from_type = 'change' and l.from_id = c.id
             and l.to_type = 'system' and l.relation = $5 and l.to_id = $4::uuid))
       order by c.planned_start, c.ref limit 500`,
      [from.toISOString(), to.toISOString(), ['rejected', 'cancelled'], systemId, AFFECTS]);
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
    // One entry per window, so a repeating period shows on each day it applies.
    const blackouts: Row[] = [];
    for (const b of await blackoutsIn(from, to)) {
      if (systemId && !blackoutApplies(b, [systemId])) continue;
      const scope = jsonList(b.system_ids);
      const names = await base.systemNames(scope);
      for (const w of blackoutWindows(b, from, to)) {
        blackouts.push({
          id: b.id, name: b.name, reason: b.reason, repeat: b.repeat ?? 'none',
          starts_at: w.start.toISOString(), ends_at: w.end.toISOString(),
          systems: scope.map((id) => ({ id, label: names.get(id) ?? 'System' })),
        });
      }
    }
    blackouts.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return {
      from: from.toISOString(), to: to.toISOString(), changes, blackouts,
      system: systemId ? { id: systemId, label: (await base.systemNames([systemId])).get(systemId) ?? 'System' } : null,
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
