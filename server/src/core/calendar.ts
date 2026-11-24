import type { FastifyInstance } from 'fastify';
import type { ModuleContext, ResourceRegistry, SessionUser } from './module.ts';
import { UUID_RE } from './errors.ts';
import { AREAS } from './features.ts';
import { notePermission } from './permission-use.ts';
import { can } from './services.ts';

// Calendar source registry (wave 11, contract C3): dated work that modules offer to a person's
// calendar feed (E36-03), so the feed never needs another module's tables. A module defines its
// sources in `register` with `defineCalendarSource(ctx.app, {...})`; the feed lists those a person
// may use with `calendarSources(app, resources, user)`.
//
// Unlike a metric, a source is a list, not a figure: `events` returns only what that person may see
// (`visibleWhere(type, user)` in every query) and is involved in (owner, assignee, member), never
// every record of the type. A source tied to a record type is left out while that type is not loaded
// or its area is switched off, and for a person without its permission.

export interface CalendarEvent {
  /** Stable and unique across sources, for example `actions.due:<id>`; the feed adds its domain. */
  uid: string;
  title: string;
  /** A date (`YYYY-MM-DD`, with `allDay`) or an ISO date and time. */
  start: string;
  end?: string;
  allDay: boolean;
  /** The record's page in the application, for example `/actions/<id>`. */
  url: string;
  recordType: string;
  recordId: string;
  /** The person the dated work is for (owner, assignee, tester, signer, holder), when there is one (E41-03). */
  personId?: string | null;
  /** The record's reference, for example `REQ-0012`, when it has one. */
  ref?: string | null;
}

/**
 * Whose work a source returns (E41-03). Without a scope, the person asking: what they are involved
 * in. With one, `person` is another user's id, or null for everyone's that the asker may see. Only a
 * source with `anyone: true` takes a scope; the compliance calendar asks the others for the asker's own.
 */
export interface CalendarScope { person: string | null }

export interface CalendarSource {
  /** `<module>.<name>`, for example `actions.due`. Unique per application. */
  key: string;
  /** What a person picks when choosing the feed's sources, for example "My actions due". */
  label: string;
  /** The record type the events are about: skipped while it is not loaded or switched off. */
  recordType: string;
  /** Permission the person needs, for example `actions.view`. */
  permission: string;
  /**
   * Work the person does by a date (a request to answer, a test to run, a period to attest), not only a
   * date to know about: My work (web, app and assistant) lists it, overdue items included (E41-03).
   */
  work?: boolean;
  /** Takes a `scope` (another person, or everyone): the compliance calendar can show anyone's items. */
  anyone?: boolean;
  /**
   * Offered to a person without `permission` too, because each item is theirs by name (E41-02: the
   * reviewer named for a system in an access review). `events` must then return only items that name
   * the asker, with nothing about records they are not named on; such a source never takes a scope
   * (`anyone` is refused). Its record type must still be loaded and on, and `checkedEvents` still checks
   * every record with `visibleWhere`.
   */
  named?: boolean;
  /** Short name of one kind of item, for My work and the compliance calendar ("Evidence requests"). Defaults to `label`. */
  kind?: string;
  /**
   * Events between `from` and `to` (`YYYY-MM-DD`, both included) that `user` may see and is involved
   * in, or (with `scope`, for a source with `anyone`) that `user` may see and are for `scope.person`
   * (anyone's when null). Overdue work has a start before today: an open item stays until it is done.
   */
  events(ctx: ModuleContext, user: SessionUser, from: string, to: string, scope?: CalendarScope): Promise<CalendarEvent[]>;
}

/** The user a source should match for `scope`: the asker without one, else the scope's person (null: everyone). */
export const whoFor = (user: SessionUser, scope?: CalendarScope): string | null => (scope === undefined ? user.id : scope.person);

const KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const registries = new WeakMap<FastifyInstance, Map<string, CalendarSource>>();

function registryOf(app: FastifyInstance): Map<string, CalendarSource> {
  let map = registries.get(app);
  if (!map) registries.set(app, (map = new Map()));
  return map;
}

/** Adds a source. Throws on a malformed or duplicate key, so a clash shows at start-up. */
export function defineCalendarSource(app: FastifyInstance, src: CalendarSource): void {
  if (!KEY_RE.test(src.key)) throw new Error(`Calendar source key "${src.key}" must look like <module>.<name> (lowercase, digits and underscores).`);
  if (!src.recordType) throw new Error(`Calendar source ${src.key} must name its record type.`);
  if (!/^[a-z_]+\.[a-z]+$/.test(src.permission)) throw new Error(`Calendar source ${src.key} has a malformed permission "${src.permission}".`);
  const map = registryOf(app);
  if (map.has(src.key)) throw new Error(`Calendar source ${src.key} is defined twice.`);
  if (src.named && src.anyone) throw new Error(`Calendar source ${src.key} cannot be both named and for anyone.`);
  notePermission(src.permission); // the role editor greys out what nothing checks
  map.set(src.key, src);
}

/**
 * The sources `user` may use now, sorted by key: their record type is loaded and switched on
 * (`resources.get` answers undefined otherwise) and the user holds their permission (which is false
 * for a switched-off area's permissions), or the source is `named` (each item names the person).
 */
export function calendarSources(app: FastifyInstance, resources: Pick<ResourceRegistry, 'get'>, user: SessionUser | null): CalendarSource[] {
  return [...registryOf(app).values()]
    .filter((s) => resources.get(s.recordType) && (can(user, s.permission) || (s.named === true && !!user)))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** The area an item belongs to, for filters (E41-03): the feature area of its permission or record type, else the record type's own name. */
export function areaOf(src: CalendarSource, resources: Pick<ResourceRegistry, 'get'>): { key: string; label: string } {
  const module = src.permission.split('.')[0];
  const area = AREAS.find((a) => a.permissions.includes(module) || a.types?.includes(src.recordType));
  if (area) return { key: area.key, label: area.label };
  const def = resources.get(src.recordType);
  return { key: module, label: def?.plural ?? module };
}

export interface CheckedEvent {
  event: CalendarEvent;
  source: CalendarSource;
  /** A restricted record (only someone who may see restricted records gets it at all). */
  restricted: boolean;
}

/**
 * The events of `sources` for `user`, each record checked again (E36-03, E41-03): its type is loaded
 * and on, it is not deleted, and `visibleWhere(type, user)` admits it now, whatever the source did.
 * Duplicates (same uid) are dropped; a source that fails is logged and left out. `scope` is passed
 * only to sources with `anyone`; the others are asked for the asker's own work, or skipped when the
 * scope names someone else.
 */
export async function checkedEvents(ctx: ModuleContext, user: SessionUser, sources: CalendarSource[], from: string, to: string,
  scope?: CalendarScope): Promise<CheckedEvent[]> {
  const collected: { event: CalendarEvent; source: CalendarSource }[] = [];
  const own = scope === undefined || scope.person === user.id;
  for (const s of sources) {
    if (!s.anyone && !own) continue;
    try {
      const events = await (s.anyone && scope !== undefined ? s.events(ctx, user, from, to, scope) : s.events(ctx, user, from, to));
      for (const event of events) collected.push({ event, source: s });
    } catch (err) {
      // One source failing leaves the others.
      ctx.app.log.warn({ err, source: s.key }, 'calendar source failed');
    }
  }

  const byType = new Map<string, Set<string>>();
  for (const { event } of collected) {
    if (!UUID_RE.test(event.recordId)) continue;
    if (!byType.has(event.recordType)) byType.set(event.recordType, new Set());
    byType.get(event.recordType)!.add(event.recordId);
  }
  const visible = new Map<string, Map<string, boolean>>(); // type -> id -> restricted
  for (const [type, ids] of byType) {
    const def = ctx.resources.get(type);
    if (!def) continue;
    const flag = def.restricted === 'flag' ? 't.restricted' : def.restricted === true ? 'true' : 'false';
    const rows = await ctx.db.query<{ id: string; restricted: boolean }>(
      `select t.id, (${flag}) as restricted from ${def.table} t
        where t.id = any($1::uuid[]) and t.deleted_at is null and ${ctx.resources.visibleWhere(type, user, 't')}`,
      [[...ids]]);
    visible.set(type, new Map(rows.map((r) => [r.id, r.restricted === true])));
  }

  const out: CheckedEvent[] = [];
  const seen = new Set<string>();
  for (const { event, source } of collected) {
    const restricted = visible.get(event.recordType)?.get(event.recordId);
    if (restricted === undefined || seen.has(event.uid)) continue;
    seen.add(event.uid);
    out.push({ event, source, restricted });
  }
  return out;
}
