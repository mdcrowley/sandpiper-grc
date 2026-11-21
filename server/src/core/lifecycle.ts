// Allowed status changes and required fields, kept as data per record type (E14-31).
//
// Each record type with a status field (a `lookup` field named `status`, or `stage`) has a
// lifecycle: which moves between the values of its status list are allowed (a new record "moves"
// from the empty status ''), which fields must be filled in before a record may have a status, and
// who may move a record to a status. The rules live in `lifecycle_rules` (core migration 015). A
// type with no row follows its defaults, which allow every move and require nothing: exactly how
// every type behaved before, so an upgrade changes nothing.
//
// The resource engine (core/resource.ts) checks the rules on every save a person makes, through
// forms, the API, bulk edit, imports and AI assistants, before the module's own hooks run. A
// module's own lifecycle rules (in code) still apply after this check: the data can only restrict,
// never allow what a module refuses. System work (seeding, automation; no request) is not checked.
//
// The rules are stored as moves that are NOT allowed, so a status added to the list later can be
// reached from every status and left to every status until an administrator says otherwise (the
// page marks it as new, from `known`), and a status taken off the list breaks no record: a record
// still holding it may move anywhere, and rules naming it are simply not used.
import type { FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import type { FieldDef, LookupValue, ResourceDef, Row, SessionUser } from './module.ts';
import { can } from './services.ts';

/** Who may move a record to one status: anyone holding `permission`, or anyone in one of `roles`. */
export interface LifecycleWho { permission: string | null; roles: string[] }

export interface LifecycleRules {
  field: string;
  /** Moves that are not allowed, as [from, to]; from '' is a new record. */
  blocked: [string, string][];
  /** Fields that must be filled in before a record may have the status. */
  required: Record<string, string[]>;
  /** Who may move a record to the status (no entry: anyone who may edit the record). */
  who: Record<string, LifecycleWho>;
  /** The statuses of the list when the rules were last saved (empty for the defaults). */
  known: string[];
  /** Moves that wait for an approval workflow (E14-37), as [from, to, workflow id]. */
  approvals: [string, string, string][];
  /** False: the shipped defaults (no row stored). */
  customized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** The empty status: the "from" of a new record. */
export const NEW = '';

/** Field names a lifecycle may be about, in order of preference. */
const STATUS_FIELDS = ['status', 'stage'];

/**
 * The status field of a record type, or null when it has none. A type whose `status` is set by the
 * application (read-only) but which has another editable status field uses that one (a project's
 * gate-driven `stage` is read-only, its `status` is not).
 */
export function lifecycleField(def: ResourceDef): string | null {
  const candidates = STATUS_FIELDS.filter((n) => def.fields[n]?.type === 'lookup' && def.fields[n].list && !def.fields[n].multiple);
  return candidates.find((n) => !def.fields[n].readOnly) ?? candidates[0] ?? null;
}

/** Whether the application alone sets the status (the field is read-only): the rules are not editable. */
export function lifecycleManaged(def: ResourceDef, field = lifecycleField(def)): boolean {
  return Boolean(field && def.fields[field]?.readOnly);
}

/** Field types that a rule may require (a yes/no field is never empty). */
export function requirable(name: string, f: FieldDef, statusField: string): boolean {
  return name !== statusField && !f.readOnly && f.type !== 'boolean';
}

/**
 * What each module's own lifecycle rules do, in code, shown on the Lifecycles page as "Set by the
 * application". The data rules add to these and can never loosen them.
 */
export const APPLICATION_RULES: Record<string, string[]> = {
  ticket: [
    'A resolved status, and a closed one other than Canceled, needs a resolution code (unless the status is marked as needing none in Lists).',
    'While a catalog request waits for approval or was refused, only the statuses allowed before approval can be chosen.',
    'Response, resolution, closing and pause times are recorded by themselves; a pause moves the due times.',
    'A reply from the requester moves "Waiting for requester" back to work; the portal reopens a resolved request within the reopen period.',
  ],
  asset: [
    'Disposed needs the disposal approval (who approved it and when; with funder interest on, the funder\'s reference; with routed requests only, an approved request), and records the disposal date.',
    'Checking an asset out sets In use and is refused for a retired or disposed asset.',
  ],
  change: [
    'A change moves only through its own steps (submit, approve, schedule, start, complete, review, close, cancel), following the moves set on each value of the change status list.',
    'Each step checks what it needs: plans and risk to submit, approvals and no clashes to schedule or start, an outcome to complete, the review to close. Closed and canceled changes cannot be edited.',
  ],
  risk: [
    'Accepted needs a current risk acceptance, recorded by someone who may approve risks; a lapsed acceptance moves the risk to the review status.',
  ],
  action: [
    'A done status records the completion date, cleared when the action is reopened.',
    'People an action is shared with may change only its status and notes.',
  ],
  security_incident: [
    'Each status has a stage (reported, declared, contained, closed) set in Lists; reaching a stage records its time, and declaring starts the notification clocks.',
    'Closing sets the post-incident review due date. Lists keeps at least one status for each of before declaration, declared and closed.',
  ],
  notification_task: [
    'Done needs who was notified and how, records who completed it and when, and cannot then be deleted.',
  ],
  policy: [
    'A policy\'s status follows its versions (submit for review, approve, publish) and the Retire action; it cannot be set by hand.',
  ],
  policy_exception: [
    'Approved and Rejected need permission to approve exceptions; Approved also needs a future expiry date.',
    'Expired is set only by the daily check. Leaving Approved, other than to Withdrawn, needs permission to approve exceptions.',
  ],
  vulnerability: [
    'A status marked for acceptance in Lists needs an approved exception or a justification and an approver; one marked for a reason needs the false-positive reason.',
    'A closed status sets the closed flag, and a fixed one records the fixed date. An import reopens a fixed finding seen again.',
  ],
  project: [
    'The stage moves only through gate decisions and roll-back; Completed is set when the last gate is approved, and a canceled project cannot change stage.',
  ],
  vehicle: [
    'A vehicle cannot move to a retired status while equipment is installed on it.',
  ],
  safety_event: [
    'A final status needs a root cause and no open corrective actions, and records the closing date.',
  ],
};

export function defaultRules(field: string): LifecycleRules {
  return { field, blocked: [], required: {}, who: {}, known: [], approvals: [], customized: false, updatedAt: null, updatedBy: null };
}

/** A status move held until an approval workflow approves it (E14-37). */
export interface HeldMove { field: string; from: string; to: string; workflowId: string }

/** The move a record is waiting to make, as the workflows module reports it. */
export interface PendingMove { field: string; from: string; to: string; workflow: string; instanceId: string }

/**
 * Holds status moves for approval (E14-37). Set by the workflows module; without it (a server
 * loading only some modules) moves that name a workflow are made at once, as before.
 */
export interface MoveHolder {
  /** The move a record is waiting to make, or null. */
  pending(type: string, id: string): Promise<PendingMove | null>;
  /** The workflow, when it can hold moves of the type now (active, of that type, not a module's own approval). */
  usable(type: string, workflowId: string, row?: Row): Promise<{ id: string; name: string } | null>;
  /** Starts the workflow on the record; approval makes the move, rejection or cancel leaves it. */
  hold(def: ResourceDef, record: Row, move: HeldMove, req: FastifyRequest): Promise<void>;
  /** Workflows an administrator may name for moves of a type (its own, not a module's approval kind). */
  choices(type: string): Promise<{ id: string; name: string; active: boolean }[]>;
}

/** The workflow a move waits for, or null. */
export const approvalFor = (rules: Pick<LifecycleRules, 'approvals'>, from: string, to: string): string | null =>
  rules.approvals.find(([a, b]) => a === from && b === to)?.[2] ?? null;

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);

const RULES_TTL_MS = 5_000;

interface Deps {
  db: Db;
  lookups: { values(list: string): Promise<LookupValue[]> };
  /** All custom field definitions of a type, as `cf_<key>` → FieldDef. */
  customDefs(type: string): Promise<Record<string, FieldDef>>;
}

export type Lifecycles = ReturnType<typeof makeLifecycles>;

export function makeLifecycles({ db, lookups, customDefs }: Deps) {
  /** Rules by type, read at most every five seconds (several server processes may share a database). */
  let cache: { at: number; rows: Map<string, LifecycleRules> } | null = null;
  /** Holds moves for approval (E14-37); set by the workflows module. */
  let holder: MoveHolder | null = null;

  async function stored(): Promise<Map<string, LifecycleRules>> {
    if (cache && Date.now() - cache.at < RULES_TTL_MS) return cache.rows;
    const rows = await db.query<Row>('select record_type, field, blocked, required, who, known, approvals, updated_at, updated_by from lifecycle_rules');
    const map = new Map<string, LifecycleRules>();
    for (const r of rows) {
      map.set(r.record_type, {
        field: r.field,
        blocked: Array.isArray(r.blocked) ? r.blocked.filter((p: unknown) => Array.isArray(p) && p.length === 2).map((p: unknown[]) => [String(p[0]), String(p[1])] as [string, string]) : [],
        required: r.required && typeof r.required === 'object' ? r.required : {},
        who: r.who && typeof r.who === 'object' ? r.who : {},
        known: Array.isArray(r.known) ? r.known.map(String) : [],
        approvals: Array.isArray(r.approvals)
          ? r.approvals.filter((p: unknown) => Array.isArray(p) && p.length === 3).map((p: unknown[]) => [String(p[0]), String(p[1]), String(p[2])] as [string, string, string])
          : [],
        customized: true,
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at ?? null,
        updatedBy: r.updated_by ?? null,
      });
    }
    cache = { at: Date.now(), rows: map };
    return map;
  }

  /** The rules of a type (its defaults when none are stored, or when they are about another field). */
  async function rulesFor(def: ResourceDef): Promise<LifecycleRules | null> {
    const field = lifecycleField(def);
    if (!field) return null;
    const r = (await stored()).get(def.type);
    return r && r.field === field ? r : defaultRules(field);
  }

  /** Whether a person may move a record to `to` under `who` (no entry: anyone). */
  function mayMoveTo(rules: LifecycleRules, to: string, user: SessionUser | null): boolean {
    const w = rules.who[to];
    if (!w || (!w.permission && !w.roles?.length)) return true;
    if (!user) return false;
    return Boolean(w.permission && can(user, w.permission)) || (w.roles ?? []).some((r) => user.roles.includes(r));
  }

  /**
   * Checks one save against the type's rules and returns the problems by field (empty when it may
   * go ahead). `data` is the validated input (built-in fields and `cf_<key>` custom fields);
   * `existing` is the stored row on an update, null on a create.
   */
  async function check(def: ResourceDef, existing: Row | null, data: Row, req: FastifyRequest | null): Promise<Record<string, string>> {
    if (!req) return {}; // system work (seeding, automation) follows the module's own rules only
    const rules = await rulesFor(def);
    if (!rules) return {};
    const field = rules.field;
    const f = def.fields[field];
    // A move waiting for approval (E14-37): the other fields stay editable; the status does not
    // change again until the approval ends. Checked even when the rules were since restored.
    if (existing && holder && field in data && (data[field] ?? null) !== (existing[field] ?? null)) {
      const pending = await holder.pending(def.type, existing.id);
      if (pending) {
        const statuses = await lookups.values(f.list!);
        const label = statuses.find((s) => s.value === pending.to)?.label ?? pending.to;
        return { [field]: `This ${def.label.toLowerCase()} is waiting for approval to move to "${label}" ("${pending.workflow}"). Its ${f.label.toLowerCase()} can change again once that approval ends, or when the request is canceled.` };
      }
    }
    if (!rules.customized) return {};
    const statuses = await lookups.values(f.list!);
    const labelOf = (v: string) => statuses.find((s) => s.value === v)?.label ?? v;
    const current = existing ? (existing[field] ?? null) as string | null : NEW;
    const moving = existing ? field in data && (data[field] ?? null) !== current : true;
    const target = (moving ? data[field] : current) ?? null;
    const errors: Record<string, string> = {};
    if (target === null || target === NEW) return errors;
    const known = (v: string | null) => v === NEW || statuses.some((s) => s.value === v);

    if (moving) {
      const waitsFor = existing && current !== null && known(current) ? approvalFor(rules, current, target) : null;
      // A record holding a status since taken off the list may move anywhere.
      if (current !== null && known(current) && rules.blocked.some(([a, b]) => a === current && b === target)) {
        const allowed = statuses.filter((s) => s.value !== current && !rules.blocked.some(([a, b]) => a === current && b === s.value)).map((s) => `"${s.label}"`);
        errors[field] = current === NEW
          ? `A new ${def.label.toLowerCase()} cannot start as "${labelOf(target)}".${allowed.length ? ` It may start as ${allowed.join(', ')}.` : ''}`
          : `${f.label} cannot move from "${labelOf(current)}" to "${labelOf(target)}".${allowed.length ? ` It may move to ${allowed.join(', ')}.` : ''}`;
      } else if (!mayMoveTo(rules, target, req.user)) {
        const roles = new Map((await db.query<{ key: string; name: string }>('select key, name from roles where key = any($1::text[])', [rules.who[target]?.roles ?? []])).map((r) => [r.key, r.name]));
        errors[field] = `You may not set ${f.label.toLowerCase()} to "${labelOf(target)}". ${whoText(rules.who[target], (k) => roles.get(k) ?? k)}`;
      } else if (waitsFor && holder && !(await holder.usable(def.type, waitsFor))) {
        errors[field] = `Moving from "${labelOf(current!)}" to "${labelOf(target)}" needs an approval workflow that is no longer active. An administrator should choose another one under Administration > Lifecycles.`;
      }
    }

    // Fields required for the status: on a move, all of them must be filled in (stored or sent);
    // otherwise, one of them may not be emptied while the record has the status.
    const needed = known(target) ? rules.required[target] ?? [] : []; // a retired status asks for nothing
    if (needed.length) {
      const custom = await customDefs(def.type);
      for (const name of needed) {
        const fd = def.fields[name] ?? custom[name];
        if (!fd) continue; // a field since removed or switched off
        const sent = name in data;
        if (!moving && !sent) continue;
        const value = sent ? data[name]
          : name.startsWith('cf_') ? (existing?.custom as Row | undefined)?.[name.slice(3)] : existing?.[name];
        if (isEmpty(value)) errors[name] = `${fd.label} is required when ${f.label.toLowerCase()} is "${labelOf(target)}".`;
      }
    }
    return errors;
  }

  /** The fields a rule may require: built-in ones a person can fill in, and the custom fields. */
  async function requirableFields(def: ResourceDef, field: string): Promise<{ name: string; label: string; custom: boolean }[]> {
    const custom = await customDefs(def.type);
    return [...Object.entries(def.fields), ...Object.entries(custom)]
      .filter(([name, f]) => requirable(name, f, field))
      .map(([name, f]) => ({ name, label: f.label, custom: Boolean(f.custom) }));
  }

  /**
   * The move a person's save makes that must wait for an approval workflow (E14-37), or null. Called
   * by the resource engine after `check` passed: the engine then saves the other fields, leaves the
   * status as it was and calls `hold`. A new record never waits (it has no status to stay in).
   */
  async function held(def: ResourceDef, existing: Row | null, data: Row, req: FastifyRequest | null): Promise<HeldMove | null> {
    if (!req || !existing || !holder) return null;
    const rules = await rulesFor(def);
    if (!rules?.customized || !rules.approvals.length) return null;
    const field = rules.field;
    const from = (existing[field] ?? null) as string | null;
    const to = (data[field] ?? null) as string | null;
    if (!(field in data) || from === null || to === null || from === to) return null;
    const workflowId = approvalFor(rules, from, to);
    // The workflow must be active, and its own conditions must hold for the record as it would be.
    if (!workflowId || !(await holder.usable(def.type, workflowId, { ...existing, ...data }))) return null;
    return { field, from, to, workflowId };
  }


  return {
    rulesFor,
    check,
    held,
    mayMoveTo,
    requirableFields,
    /** The workflows module holds moves for approval (E14-37). */
    setHolder(h: MoveHolder | null) { holder = h; },
    get holder(): MoveHolder | null { return holder; },
    /** Starts the approval a held move waits for (the resource engine calls it after saving the rest). */
    async hold(def: ResourceDef, record: Row, move: HeldMove, req: FastifyRequest): Promise<void> {
      if (holder) await holder.hold(def, record, move, req);
    },
    /** Stores a type's rules (replacing any before). */
    async store(type: string, rules: Pick<LifecycleRules, 'field' | 'blocked' | 'required' | 'who' | 'known'> & { approvals?: LifecycleRules['approvals'] }, userId: string | null): Promise<void> {
      await db.query(
        `insert into lifecycle_rules (record_type, field, blocked, required, who, known, approvals, updated_at, updated_by)
         values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $8::jsonb, now(), $7)
         on conflict (record_type) do update set field = excluded.field, blocked = excluded.blocked, required = excluded.required,
           who = excluded.who, known = excluded.known, approvals = excluded.approvals, updated_at = now(), updated_by = excluded.updated_by`,
        [type, rules.field, JSON.stringify(rules.blocked), JSON.stringify(rules.required), JSON.stringify(rules.who), JSON.stringify(rules.known), userId,
          JSON.stringify(rules.approvals ?? [])],
      );
      cache = null;
    },
    /** Back to the defaults: the stored rules are removed. */
    async remove(type: string): Promise<boolean> {
      const gone = await db.query('delete from lifecycle_rules where record_type = $1 returning record_type', [type]);
      cache = null;
      return gone.length > 0;
    },
    /** Forget the cached rules (after a change in this process). */
    invalidate() { cache = null; },
    /**
     * The lifecycle of a type as the web app needs it in /api/meta, for one person: the status
     * field, whether the application sets it, the moves that are not allowed, the fields required
     * per status, and the statuses this person may not move a record to.
     */
    async metaFor(def: ResourceDef, user: SessionUser | null) {
      const rules = await rulesFor(def);
      if (!rules) return undefined;
      const denied = Object.keys(rules.who).filter((to) => !mayMoveTo(rules, to, user));
      // Moves that wait for approval (E14-37), so a form can say so: [from, to] only (no workflow ids).
      const approvals = holder ? rules.approvals.map(([a, b]) => [a, b] as [string, string]) : [];
      return { field: rules.field, managed: lifecycleManaged(def, rules.field), blocked: rules.blocked, required: rules.required, denied, approvals };
    },
  };
}

/** "Only people with … may do this." for a refused move. */
export function whoText(w: LifecycleWho | undefined, roleLabel: (key: string) => string = (k) => k): string {
  if (!w) return '';
  const parts: string[] = [];
  if (w.permission) parts.push(`people with the permission ${w.permission}`);
  if (w.roles?.length) parts.push(`the role${w.roles.length > 1 ? 's' : ''} ${w.roles.map(roleLabel).join(', ')}`);
  return parts.length ? `Only ${parts.join(' or ')} may do this.` : '';
}
