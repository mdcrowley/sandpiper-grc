import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionHash: string | null;
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
  searchable?: string[];
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

export interface SeedOptions {
  profile: 'pilot' | 'dev';
  seedDir: string;
  /**
   * The organisation profile: `<seedDir>/organisation.json` when it exists, else {}.
   * It holds everything specific to one organisation (see examples/organisation.example.json),
   * so that nothing organisation-specific lives in code. Core applies `appName` and `lookups`;
   * modules read their own sections (for example `obligations`, `notificationRules`).
   */
  organisation?: Row;
}

export interface ResourceRegistry {
  get(type: string): ResourceDef | undefined;
  all(): ResourceDef[];
  /** Display label for one record, or null when missing. Does not check permissions. */
  labelFor(type: string, id: string): Promise<string | null>;
  /** Row if it exists and `user` may see it (null user = system), else undefined. */
  find(type: string, id: string, user?: SessionUser | null): Promise<Row | undefined>;
  /** Validated create with auto-number, hooks and audit. `req` null = system actor (seeding, automation). */
  create(type: string, data: Row, req?: FastifyRequest | null): Promise<Row>;
  /** Validated partial update with hooks and audit. */
  update(type: string, id: string, patch: Row, req?: FastifyRequest | null): Promise<Row>;
}

export interface ModuleContext {
  app: FastifyInstance;
  db: Db;
  requirePerm(perm: string): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  can(user: SessionUser | null, perm: string): boolean;
  audit(req: FastifyRequest | null, ev: AuditInput): Promise<void>;
  lookups: {
    /** Adds missing values; never overwrites values an administrator has edited. */
    ensure(list: string, values: LookupValue[]): Promise<void>;
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
}

export interface ModuleDef {
  key: string;
  seedDefaults?(ctx: ModuleContext): Promise<void>;
  register?(ctx: ModuleContext): Promise<void>;
  seed?(ctx: ModuleContext, opts: SeedOptions): Promise<void | string>;
}
