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
  searchable?: string[];
  /**
   * Files attached to these records are evidence (E14-18): the record page's Attachments tab records
   * new files as evidence, with a collection date and an optional expiry date. Default: true for the
   * evidence-bearing types core knows (EVIDENCE_TYPES in core/resource.ts), false for the rest.
   */
  evidence?: boolean;
  defaultSort?: { field: string; dir: 'asc' | 'desc' };
  fields: Record<string, FieldDef>;
  hooks?: {
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
  update(type: string, id: string, patch: Row, req?: FastifyRequest | null): Promise<Row>;
  /**
   * SQL condition (no parameters) that is true for the rows of `type` that `user` may see under the
   * restricted-record rules. Hand-written queries over a resource table must include it:
   * `where deleted_at is null and ${ctx.resources.visibleWhere('action', req.user)}`.
   * `alias` is the table alias used in the query, if any. Unknown type: 'false'.
   */
  visibleWhere(type: string, user: SessionUser | null | undefined, alias?: string): string;
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
