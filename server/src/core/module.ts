import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
  /**
   * Permission modules of switched-off areas (core/features.ts), set when the user is loaded:
   * `can()` answers false for them whatever the grants, `*` included.
   */
  off?: string[];
  /**
   * Permission modules for which one of the person's roles is scoped to their departments or sites
   * (E41-01, core/scope.ts), set when the user is loaded. Unset (a user built by hand): the scope
   * rule is worked out in SQL for every scoped type.
   */
  scoped?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionHash: string | null;
    /** Set when the request was made with a personal access token (core/tokens.ts) rather than a session. */
    apiToken: { id: string; name: string } | null;
  }
  interface FastifyContextConfig {
    /** Route needs no session (sign-in, setup, health). */
    public?: boolean;
  }
}

export type FieldType =
  | 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'datetime'
  | 'boolean' | 'lookup' | 'user' | 'ref' | 'json';

export interface FieldDef {
  label: string;
  type: FieldType;
  required?: boolean;
  readOnly?: boolean;
  /** The mobile app (E38-07) offers this field on its phone edit form (spec §5.4). */
  mobileEditable?: boolean;
  /** Lookup list key, for type 'lookup'. */
  list?: string;
  /** Target record type, for type 'ref'. */
  to?: string;
  default?: unknown;
  /**
   * Whether the field holds personal data, which anonymizing a record at the end of its retention
   * period replaces (E14-19, core/retention.ts). Default: true for `user` and `longtext` fields and
   * for text fields named like an email address, a phone number or a person's name; false otherwise.
   */
  personal?: boolean;
  /** True for a field an administrator defined (core/customfields.ts). Its name is `cf_<key>`. */
  custom?: boolean;
  /** Custom fields: a value is a list of lookup values (multi select). */
  multiple?: boolean;
  /** Custom fields: help text, form section and position within it. */
  help?: string;
  section?: string;
  position?: number;
}

export type Row = Record<string, any>;

/** See ResourceDef.rowRule. */
export interface RowRule {
  /**
   * The SQL condition a row must meet for `user` to see it; `col(name)` gives a column of the row
   * (with the caller's table alias). Called synchronously for every query, so it must not need the
   * database to be built: read settings inside the SQL. Return 'true' when the user sees every row.
   * The system (no user) always sees every row.
   */
  where: (user: SessionUser, col: (name: string) => string) => string;
  /**
   * Figures (GET <path>/stats). 'filter': the caller's own rule applies (personal items, such as
   * saved reports). 'mask': every row counts for everyone, but rows matching `hidden` are never
   * matched, grouped or labeled by their details, as restricted records are.
   */
  figures: 'filter' | 'mask';
  /** With figures 'mask': the rows some people may not see (boolean SQL, never null). */
  hidden?: (col: (name: string) => string) => string;
}

/**
 * E41-01: where a record belongs, for role grants scoped to a person's departments or sites
 * (core/scope.ts). Each is a column of the row holding a department id (core `departments`) or a
 * site id (`sites`), or a SQL expression of the row (built with `col`) giving that uuid.
 */
export interface ResourceScope {
  department?: string | ((col: (name: string) => string) => string);
  site?: string | ((col: (name: string) => string) => string);
}

export interface ResourceDef {
  type: string;
  table: string;
  module: string;
  label: string;
  plural: string;
  path: string;
  route: string;
  titleField: string;
  ref?: { field: string; prefix: string };
  /** true: whole type needs security.view. 'flag': rows with restricted = true need it. */
  restricted?: boolean | 'flag';
  /**
   * Rows inherit their `restricted` flag from the record they arose from: `typeField` holds that
   * record's type and `idField` its id. Needs `restricted: 'flag'` and a boolean `restricted`
   * column. Core sets the flag on create, when the source fields change, and when the source
   * record's own restriction changes; people who cannot see the source cannot point a row at it.
   */
  restrictedFrom?: { typeField: string; idField: string };
  /**
   * A per-row rule beyond the restricted flag: who may see which rows (knowledge articles for IT
   * agents only, privately shared reports). It is part of the visibility rule itself
   * (`visibleWhere`, `find`, labels), so every reader follows it whatever the route: lists, search,
   * pickers, history, comments, links, tags, files, fact sheets, exports and reports.
   */
  rowRule?: RowRule;
  /**
   * The department or site a record belongs to (E41-01). A role whose grants for this type's
   * permission module are scoped to the person's departments or sites (Administration > Roles)
   * then sees only the records of those departments or sites (and those below them), and the
   * records the person created. Part of the visibility rule, like `rowRule`; figures are unchanged.
   */
  scope?: ResourceScope;
  /**
   * A directory every signed-in person may pick from and read the names of (departments): record
   * pickers, labels and links do not need view permission on its module. Its own list and record
   * pages still do.
   */
  directory?: boolean;
  /**
   * E41-06: the type's table is a view of one shared table that shows the rows where `column` holds
   * `value` (registers an administrator defines, modules/registers). The search trigger then sits on
   * the shared table and indexes only those rows.
   */
  partition?: { column: string; value: string };
  searchable?: string[];
  /**
   * Files attached to these records are evidence (E14-18): the record page's Attachments tab records
   * new files as evidence, with a collection date and an optional expiry date. Default: true for the
   * evidence-bearing types core knows (EVIDENCE_TYPES in core/resource.ts), false for the rest.
   */
  evidence?: boolean;
  defaultSort?: { field: string; dir: 'asc' | 'desc' };
  fields: Record<string, FieldDef>;
  /**
   * SQL condition (no parameters, columns unqualified) a record must meet to be offered in record
   * pickers (`GET /api/records/lookup`), for example `active` (E39: an inactive vehicle model is not
   * offered for new vehicles). Stored values are unaffected.
   */
  pickerWhere?: string;
  /**
   * Required fields the `prepare` hook fills from another field, by field: `{ mode: 'model_id' }` (E39:
   * a new vehicle takes its mode from its vehicle model). An import may leave such a field unmapped
   * when the other field is mapped; the save itself still requires a value.
   */
  filledBy?: Record<string, string>;
  hooks?: {
    /**
     * Runs before validation on the raw input of a create (`existing` null) or update, and may add or
     * change fields; what it returns is validated like the caller's own input, so lifecycle rules and
     * lookups apply to it (E39-02: a vehicle or asset takes its model's values).
     */
    prepare?: (req: FastifyRequest | null, input: Row, existing: Row | null) => Promise<Row> | Row;
    beforeCreate?: (req: FastifyRequest | null, data: Row) => Promise<Row> | Row;
    beforeUpdate?: (req: FastifyRequest | null, existing: Row, patch: Row) => Promise<Row> | Row;
    afterCreate?: (req: FastifyRequest | null, row: Row) => Promise<void> | void;
    afterUpdate?: (req: FastifyRequest | null, before: Row, after: Row) => Promise<void> | void;
  };
}

export interface AuditInput {
  action: string;
  recordType?: string;
  recordId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

export interface LookupValue {
  value: string;
  label: string;
  color?: string;
  sort?: number;
  meta?: Record<string, unknown>;
}

export interface LookupListOptions {
  /** Permission module that owns the list, e.g. 'tickets' or 'security'. */
  module?: string;
  /** Readable by every signed-in user. */
  public?: boolean;
}

export interface SeedOptions {
  profile: 'pilot' | 'dev';
  seedDir: string;
  /**
   * The organization profile: `<seedDir>/organization.json` when it exists, else {}.
   * It holds everything specific to one organization (see examples/organization.example.json),
   * so that nothing organization-specific lives in code. Core imports the organization's details
   * into the settings (`applyOrganizationProfile`, core/organization.ts) and applies `lookups`;
   * modules read their own sections (for example `obligations`, `notificationRules`).
   */
  organization?: Row;
}

/** Options for `ResourceRegistry.create`. */
export interface CreateOptions {
  /**
   * A person creates the record through a form that does not ask the administrator's custom fields
   * (the self-service portal): required custom fields are not enforced. Built-in required fields are.
   */
  skipCustomRequired?: boolean;
}

/** Options for `ResourceRegistry.update`. */
export interface UpdateOptions {
  /**
   * Where the change comes from when it is not the record's own form (E39-03: "vehicle model
   * Forty-foot bus"); the audit summary and history line end with "from <via>".
   */
  via?: string;
}

export interface ResourceRegistry {
  get(type: string): ResourceDef | undefined;
  all(): ResourceDef[];
  /** Display label for one record, or null when missing. Does not check permissions. */
  labelFor(type: string, id: string): Promise<string | null>;
  /** Row if it exists and `user` may see it (null user = system), else undefined. */
  find(type: string, id: string, user?: SessionUser | null): Promise<Row | undefined>;
  /** Validated create with auto-number, hooks and audit. `req` null = system actor (seeding, automation). */
  create(type: string, data: Row, req?: FastifyRequest | null, opts?: CreateOptions): Promise<Row>;
  /** Validated partial update with hooks and audit. */
  update(type: string, id: string, patch: Row, req?: FastifyRequest | null, opts?: UpdateOptions): Promise<Row>;
  /**
   * SQL condition (no parameters) that is true for the rows of `type` that `user` may see under the
   * restricted-record rules. Hand-written queries over a resource table must include it:
   * `where deleted_at is null and ${ctx.resources.visibleWhere('action', req.user)}`.
   * `alias` is the table alias used in the query, if any. Unknown type: 'false'.
   */
  visibleWhere(type: string, user: SessionUser | null | undefined, alias?: string): string;
  /**
   * Figures (counts and totals that are the same for everyone, docs/security.md): the rows of `type`
   * a figure for `user` counts. 'true' except for a type whose row rule applies to figures too
   * (ResourceDef.rowRule, figures 'filter'). Use it in place of `visibleWhere` in a figure.
   */
  figureWhere(type: string, user: SessionUser | null | undefined, alias?: string): string;
  /**
   * Figures: SQL true for the rows whose details (words and people) a figure must never match,
   * group or label: restricted rows, and rows a masking row rule hides from someone. null: none.
   */
  figureMask(type: string, alias?: string): string | null;
  /**
   * Subscribes to records created, updated, soft-deleted or purged through the resource engine
   * (the workflows module cancels the workflows of a deleted record). A failing listener never
   * fails the change.
   */
  onChange?(fn: (change: { action: 'create' | 'update' | 'delete' | 'purge'; def: ResourceDef; row: Row; req: FastifyRequest | null }) => Promise<void> | void): void;
}

/** The handlers of a record type's generated routes (list, stats, one, create, change, delete). */
export interface RecordRouteHandlers {
  list(req: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  stats(req: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  get(req: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  create(req: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  update(req: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  remove(req: FastifyRequest, reply: FastifyReply): Promise<unknown>;
}

/**
 * Record types added and removed while the application runs (E41-06: registers an administrator
 * defines), as `app.runtimeResources`. A type defined here gets no routes of its own (routes cannot be
 * added once the server listens): the module that defines it serves them through routes with a
 * parameter and calls `handlers(type)`. Everything else (metadata, search, history, attachments,
 * imports, exports, reports, lifecycles, feature switches) reads the registry and follows at once.
 */
export interface RuntimeResources {
  define(def: ResourceDef): void;
  remove(type: string): void;
  handlers(type: string): RecordRouteHandlers | undefined;
  /** (Re)builds the type's search trigger; call after defining a type once the application is ready. */
  refreshSearch(def: ResourceDef): Promise<void>;
}

/** A hand-written route described for the OpenAPI document (`GET /api/openapi.json`). */
export interface RouteDoc {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The route as registered, for example '/api/tickets/:id/sla'. */
  path: string;
  summary: string;
  description?: string;
  /** Group in the document; defaults to the first path segment after /api. */
  tag?: string;
  /** Permission needed. The route is left out of the document for callers who lack it. */
  permission?: string;
  /** No session or token needed. */
  public?: boolean;
  /** Query parameters: name -> description (or a JSON Schema with a description). */
  query?: Record<string, string | Record<string, unknown>>;
  /** JSON Schema of the request body, or a short description. */
  body?: Record<string, unknown> | string;
  /** JSON Schema of the 200/201 response, or a short description. */
  response?: Record<string, unknown> | string;
}
export interface ModuleContext {
  app: FastifyInstance;
  db: Db;
  /** Folder holding the database and stored files, or 'memory' in tests. */
  dataDir: string;
  requirePerm(perm: string): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  can(user: SessionUser | null, perm: string): boolean;
  audit(req: FastifyRequest | null, ev: AuditInput): Promise<void>;
  lookups: {
    /**
     * Adds missing values; never overwrites values an administrator has edited.
     * `opts.module` names the permission module that owns the list (for example 'security'):
     * people who hold `<module>.view` may read it. `opts.public` lets every signed-in user read it.
     * A list is also readable by anyone who may view a record type with a field that uses it, so
     * the option is only needed for lists used by hand-written routes and pages alone.
     * A list with neither can be read only by administrators.
     */
    ensure(list: string, values: LookupValue[], opts?: LookupListOptions): Promise<void>;
    values(list: string): Promise<LookupValue[]>;
  };
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set(key: string, value: unknown, req?: FastifyRequest | null): Promise<void>;
  };
  resources: ResourceRegistry;
  defineResource(def: ResourceDef): void;
  /** Parses a delimited seed file (first line = header) into objects keyed by header text. */
  readSeed(opts: SeedOptions, file: string, delimiter: string): Row[];
  fail(status: number, code: string, message: string, fields?: Record<string, string>): never;
  /**
   * Optional: describes a hand-written route for the OpenAPI document. Call it beside the route.
   * Routes that are not described still appear in the document, marked `x-undocumented`.
   */
  describeRoute(doc: RouteDoc): void;
}

export interface ModuleDef {
  key: string;
  seedDefaults?(ctx: ModuleContext): Promise<void>;
  register?(ctx: ModuleContext): Promise<void>;
  seed?(ctx: ModuleContext, opts: SeedOptions): Promise<void | string>;
}
