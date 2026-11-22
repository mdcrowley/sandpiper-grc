import type { FastifyInstance } from 'fastify';
import type { ResourceRegistry } from './module.ts';

// Taggable record types (wave 13, E37-01): the record types that can carry an asset tag value. A
// module registers its own types in `register` with `defineTaggable(ctx.app, {...})`, so the tags
// module (modules/tags) never needs to know inventory or fleet, and a later module adds its own
// type without core changes. (The file is not `core/tags.ts`: that one holds the free-text labels
// any record can carry, `/api/tags`, which are a different thing.)
//
// The tags module reads the registry with `taggables(app, resources)`: a type that is not loaded,
// or whose area is switched off, is left out (`resources.get` answers undefined for it), so its
// tag values answer as unknown.

export interface TaggableIdentifier {
  /** A text field of the record type that identifies one record exactly (serial number, fleet number). */
  field: string;
  /** How the tag card says what matched, for example "Serial number". */
  label: string;
}

export interface TaggableDef {
  /** The record type, for example `asset`. */
  type: string;
  /**
   * The text field holding the record's current tag value (its primary active value in
   * `tag_assignments`): `tag` for assets, `tag_number` for vehicles, sites and systems.
   */
  field: string;
  /** Other identifiers looked up exactly when no tag value matches (spec §4.2 rule 5). May be empty. */
  identifiers: TaggableIdentifier[];
  /**
   * The `ref` field naming the site the record is at (assets `site_id`, vehicles `depot_id`), `'id'`
   * when the record is itself a site, or null when it has none (systems). Used by inventory counts
   * (the expected list) and the tag card's location.
   */
  siteField: string | null;
  /** A free-text location field, when the type has one (assets `location`). */
  locationField?: string;
  /** The lookup field shown as the record's status on the tag card and offered by quick updates. */
  statusField?: string;
  /** Person fields shown as owner or assignee on the tag card and offered by quick updates, in order. */
  peopleFields?: string[];
  /** A few type-specific fields for the tag card summary (spec §4.3), in order. */
  facts?: string[];
  /** Fields the tag card's "Quick updates" may change (each must be an editable field of the type). */
  quickFields?: string[];
}

const TYPE_RE = /^[a-z][a-z0-9_]*$/;
const registries = new WeakMap<FastifyInstance, Map<string, TaggableDef>>();

function registryOf(app: FastifyInstance): Map<string, TaggableDef> {
  let map = registries.get(app);
  if (!map) registries.set(app, (map = new Map()));
  return map;
}

/** Adds a taggable type. Throws on a malformed or duplicate type, so a clash shows at start-up. */
export function defineTaggable(app: FastifyInstance, def: TaggableDef): void {
  if (!TYPE_RE.test(def.type)) throw new Error(`Taggable type "${def.type}" must be a record type key (lowercase, digits and underscores).`);
  if (!TYPE_RE.test(def.field)) throw new Error(`Taggable ${def.type} has a malformed tag field "${def.field}".`);
  for (const i of def.identifiers) if (!TYPE_RE.test(i.field)) throw new Error(`Taggable ${def.type} has a malformed identifier field "${i.field}".`);
  const map = registryOf(app);
  if (map.has(def.type)) throw new Error(`Taggable type ${def.type} is defined twice.`);
  map.set(def.type, Object.freeze({ ...def, identifiers: [...def.identifiers] }));
}

/**
 * The taggable types in use now, sorted by type: their record type is loaded and switched on.
 * Pass `ctx.resources` (whose `get` hides switched-off types).
 */
export function taggables(app: FastifyInstance, resources: Pick<ResourceRegistry, 'get'>): TaggableDef[] {
  return [...registryOf(app).values()]
    .filter((d) => resources.get(d.type))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** One taggable type in use now, or undefined (not taggable, not loaded or switched off). */
export function taggable(app: FastifyInstance, resources: Pick<ResourceRegistry, 'get'>, type: string): TaggableDef | undefined {
  const def = registryOf(app).get(type);
  return def && resources.get(type) ? def : undefined;
}

/** Every registered taggable type, switched on or not (for retention, holds and administrators). */
export function allTaggables(app: FastifyInstance): TaggableDef[] {
  return [...registryOf(app).values()].sort((a, b) => a.type.localeCompare(b.type));
}
