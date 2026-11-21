import type { FastifyInstance } from 'fastify';
import type { ModuleContext, ResourceRegistry, SessionUser } from './module.ts';
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
}

export interface CalendarSource {
  /** `<module>.<name>`, for example `actions.due`. Unique per application. */
  key: string;
  /** What a person picks when choosing the feed's sources, for example "My actions due". */
  label: string;
  /** The record type the events are about: skipped while it is not loaded or switched off. */
  recordType: string;
  /** Permission the person needs, for example `actions.view`. */
  permission: string;
  /** Events between `from` and `to` (`YYYY-MM-DD`, both included) that `user` may see and is involved in. */
  events(ctx: ModuleContext, user: SessionUser, from: string, to: string): Promise<CalendarEvent[]>;
}

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
  notePermission(src.permission); // the role editor greys out what nothing checks
  map.set(src.key, src);
}

/**
 * The sources `user` may use now, sorted by key: their record type is loaded and switched on
 * (`resources.get` answers undefined otherwise) and the user holds their permission (which is false
 * for a switched-off area's permissions).
 */
export function calendarSources(app: FastifyInstance, resources: Pick<ResourceRegistry, 'get'>, user: SessionUser | null): CalendarSource[] {
  return [...registryOf(app).values()]
    .filter((s) => resources.get(s.recordType) && can(user, s.permission))
    .sort((a, b) => a.key.localeCompare(b.key));
}
