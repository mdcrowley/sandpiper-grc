import type { ZodRawShape } from 'zod';
import type { ModuleContext, SessionUser } from '../../core/module.ts';
import { ToolError, type Caller } from './caller.ts';

/** Who is calling: worked out from the bearer token by GET /api/mcp/session on every request. */
export interface Session {
  user: { id: string; username: string; displayName: string; email: string; roles: string[] };
  /** Effective permissions: the token's scopes and the owner's grants in common. */
  permissions: string[];
  token: { id: string; name: string };
  /** The token's scopes as stored. */
  scopes: string[];
  /** Tools chosen for this caller by the administrator, their roles and the token (null = every tool). */
  tools?: string[] | null;
  /** How the token was issued: a personal access token, or an OAuth sign-in by a remote connector. */
  kind?: 'token' | 'oauth';
  /**
   * Data load mode (E18-70, core/dataload.ts): whether it is on, until when, and whether this caller's
   * saves are loads (the owner holds admin.administer and AI assistant write access is on).
   */
  dataLoad?: { on: boolean; until: string | null; allowed: boolean };
}

export interface FieldMeta { label: string; type: string; required?: boolean; readOnly?: boolean; list?: string; to?: string; custom?: boolean }
export interface TypeMeta {
  type: string; label: string; plural: string; module: string; path: string; route: string;
  titleField: string; refField?: string; restricted: boolean | 'flag'; fields: Record<string, FieldMeta>;
}
export interface Meta { resources: Record<string, TypeMeta>; lookups: Record<string, { value: string; label: string }[]> }

/** What a tool may use while it runs. */
export interface ToolContext {
  ctx: ModuleContext;
  api: Caller;
  session: Session;
  /** The application's address as the caller reached it, for links back to records. */
  baseUrl: string;
  can(perm: string): boolean;
  meta(): Promise<Meta>;
  /** A record type by key, label or plural (any case); refuses types the person cannot see. */
  typeOf(name: string): Promise<TypeMeta>;
  /** One record by id or reference (TKT-00012), as the REST API returns it. */
  record(type: TypeMeta, idOrRef: string): Promise<Record<string, any>>;
  link(route: string, id?: string): string;
  /**
   * Reports how far a long-running tool has come (E21-20). Sends an MCP progress notification when
   * the client asked for them (a progressToken on the call); otherwise does nothing.
   */
  progress(done: number, total?: number, message?: string): Promise<void>;
}

export interface ToolResult {
  /** A short, readable summary for the assistant to quote or reason over. */
  text: string;
  /** The same answer as structured data. */
  data: Record<string, unknown>;
  /** Write tools: the change, for the audit event naming the token. */
  audit?: { recordType: string; recordId: string; summary: string };
}

/** What decides whether a tool is offered to this caller at all. */
export interface Availability {
  can(perm: string): boolean;
  /** The record type exists here and the caller may view it (restricted types need security.view). */
  sees(type: string): boolean;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  /** Creates or changes records: offered only when write access is on and the token can write. */
  write?: boolean;
  /** Offered only while data load mode is on and this caller's saves are loads (E18-70). */
  dataLoadOnly?: boolean;
  /** Added to the description while this caller's saves are loads (E18-70). */
  dataLoadNote?: string;
  /** Repeating the call with the same input has no further effect. */
  idempotent?: boolean;
  /** Short group name for the administrators' screen. */
  group: 'Records' | 'Changes' | 'Work and insight';
  available?(a: Availability): boolean;
  input: ZodRawShape;
  run(args: any, t: ToolContext): Promise<ToolResult>;
}

export const fail = (message: string, code = 'invalid_input', fields?: Record<string, string>): never => {
  throw new ToolError(message, code, 400, fields);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** Builds the ToolContext for one MCP request. */
export function makeToolContext(ctx: ModuleContext, api: Caller, session: Session, baseUrl: string): ToolContext {
  let meta: Promise<Meta> | null = null;
  const user = { ...session.user, permissions: session.permissions } as SessionUser;
  const t: ToolContext = {
    ctx, api, session, baseUrl,
    can: (perm) => ctx.can(user, perm),
    meta: () => (meta ??= api.get<Meta>('/api/meta')),
    async typeOf(name) {
      const wanted = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      const all = Object.values((await t.meta()).resources);
      const found = all.find((r) => r.type === wanted || r.type === wanted.replace(/ /g, '_')
        || r.label.toLowerCase() === wanted || r.plural.toLowerCase() === wanted);
      if (!found) {
        fail(`"${name}" is not a record type you can see. Use list_record_types for the choices. Some: ${all.slice(0, 12).map((r) => r.type).join(', ')}.`, 'unknown_type');
      }
      return found!;
    },
    async record(type, idOrRef) {
      const key = String(idOrRef ?? '').trim();
      if (!key) fail('Give the record id or its reference.');
      if (isUuid(key)) return api.get(`${type.path}/${key}`);
      if (!type.refField) fail(`${type.plural} have no reference numbers: give the record id.`);
      if (key.includes(',')) fail('A reference has no commas in it.');
      const found = await api.get<{ rows: any[] }>(`${type.path}?f.${type.refField}=${encodeURIComponent([...new Set([key, key.toUpperCase()])].join(','))}&pageSize=2`);
      const row = found.rows.find((r) => String(r[type.refField!]).toLowerCase() === key.toLowerCase());
      if (!row) throw new ToolError(`No ${type.label.toLowerCase()} ${key} that you can see.`, 'not_found', 404);
      return row;
    },
    link: (route, id) => `${baseUrl}${route}${id ? `/${id}` : ''}`,
    progress: async () => undefined,
  };
  return t;
}

// ---------- presenting records ----------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A field's value as a person would read it: lookup, user and record labels instead of codes and ids. */
export function display(row: Record<string, any>, field: string, f: FieldMeta | undefined, max = 300): unknown {
  const raw = row[field];
  if (raw === null || raw === undefined || raw === '') return null;
  const label = row._display?.[field];
  if (label !== undefined && label !== null) return label;
  if (f?.type === 'boolean') return raw ? 'Yes' : 'No';
  if (typeof raw === 'string') return clip(raw, max);
  if (f?.type === 'json') return clip(JSON.stringify(raw), max);
  return raw;
}

const PREFERRED = ['status', 'priority', 'severity', 'risk_level', 'rating', 'residual_rating', 'stage', 'owner_id', 'assignee_id', 'lead_id',
  'due_on', 'due_at', 'resolve_due_at', 'review_date', 'notice_date', 'end_date', 'vendor_id', 'system_id', 'department'];

/** The fields shown for each row of a list when the caller does not choose: short, informative ones. */
export function defaultColumns(type: TypeMeta): string[] {
  const out = PREFERRED.filter((f) => type.fields[f]);
  return out.slice(0, 7);
}

/** A record trimmed to the fields asked for, with labels, plus where to open it. */
export function presentRow(t: ToolContext, type: TypeMeta, row: Record<string, any>, fields: string[], max = 300) {
  const out: Record<string, unknown> = { id: row.id };
  if (type.refField) out.ref = row[type.refField] ?? null;
  out.title = row[type.titleField] ?? null;
  for (const f of fields) {
    if (f === type.titleField || f === type.refField || f === 'id') continue;
    out[f] = f === 'created_at' || f === 'updated_at' ? row[f] ?? null : display(row, f, type.fields[f], max);
  }
  out.url = t.link(type.route, row.id);
  return out;
}

/** One line for a list: "TKT-00012 Printer jammed (status: Open; assignee: Sam)". */
export function rowLine(type: TypeMeta, r: Record<string, unknown>): string {
  const extras = Object.entries(r)
    .filter(([k, v]) => !['id', 'ref', 'title', 'url'].includes(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${type.fields[k]?.label ?? k}: ${String(v)}`);
  return `- ${r.ref ? `${r.ref} ` : ''}${r.title ?? '(untitled)'}${extras.length ? ` (${extras.join('; ')})` : ''}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
