// Approval kinds: how a module hands its own approvals to the shared approval workflows (E14-06,
// wave 7: E03-22, E04-24, E05-13, E08-23, E11-25). A module declares a kind for one of its record
// types (what starts it, what approval and rejection mean for the record) and starts it from its
// own routes; the workflows module routes the steps, notifies, escalates and records decisions,
// then calls the module back. The workflows module registers last (modules register in key order),
// so a module only declares its kind here and reaches the engine at request time.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from './db.ts';
import type { Row } from './module.ts';

/** A running or finished approval of one kind on one record, as a module sees it. */
export interface ApprovalInstance {
  id: string;
  kind: string;
  definitionId: string;
  name: string;
  recordType: string;
  recordId: string;
  status: 'running' | 'approved' | 'rejected' | 'canceled';
  requestedBy: string | null;
  note: string | null;
  /** What the module stored when it started the approval (for example the requested expiry). */
  data: Row;
  startedAt: string;
  finishedAt: string | null;
}

export interface DecisionEvent {
  instance: ApprovalInstance;
  decision: 'approved' | 'rejected';
  userId: string;
  userName: string;
  /** The approver a stand-in decided for (E14-32), or null. */
  onBehalfOf: string | null;
  onBehalfOfName: string | null;
  comment: string | null;
  /** Approvals given so far across the whole workflow, and the step's outcome after this decision. */
  approvals: number;
  stepOutcome: 'approved' | 'rejected' | 'pending';
  req: FastifyRequest | null;
}

export interface FinishEvent {
  instance: ApprovalInstance;
  outcome: 'approved' | 'rejected' | 'canceled';
  /** Who made the last decision (the final approval, or the rejection); null when canceled. */
  approverId: string | null;
  approverName: string | null;
  /** The approver a stand-in decided for (E14-32), and their name. */
  onBehalfOf: string | null;
  onBehalfOfName: string | null;
  /** The rejection comment, or why it was canceled. */
  comment: string | null;
  /** True when the module itself canceled it (through `cancel`): the module already knows. */
  byModule: boolean;
  req: FastifyRequest | null;
}

/** What a kind's one-time `install` may do: add workflows and take over approvals already waiting. */
export interface InstallHelpers {
  db: Queryable;
  /** Whether any workflow of this kind was ever defined (removed ones count, so defaults are not added back). */
  hasDefinitions(): Promise<boolean>;
  /** Adds a workflow of this kind (same shape as POST /api/workflows/definitions, without record_type); answers its id. */
  define(def: Row): Promise<string>;
  /**
   * Takes over an approval that was already waiting when the module moved to workflows: a running
   * workflow at step `position` (default 0) with these approvers, needing `required` approvals,
   * with the decisions already given. Skipped (null) when one of this kind already runs on the record.
   */
  adopt(input: {
    definitionId: string; recordId: string; requestedBy: string | null; startedAt?: string | null; note?: string | null; data?: Row;
    approvers: string[]; required: number; position?: number;
    decisions?: { userId: string; decision: 'approved' | 'rejected'; comment?: string | null; at?: string | null }[];
  }): Promise<string | null>;
  /** Active people holding a permission (switched-off areas applied). */
  usersWith(permission: string): Promise<string[]>;
  /** Active workflows of this kind (for example to adopt waiting approvals onto). */
  definitions(): Promise<{ id: string; name: string; description: string | null }[]>;
}

export interface ApprovalKind {
  /** Stable key, stored on definitions and running workflows: `change_approval`. */
  key: string;
  recordType: string;
  /** Shown to administrators: "Change approval". */
  label: string;
  /** When the module starts it: "A change is submitted". */
  startsWhen: string;
  /** What the outcome does to the record: "Approved: the change becomes Approved; rejected: Rejected". */
  outcome: string;
  /** Where approval notifications send people (default: the record page). */
  route?: (recordId: string) => string;
  /** False when the module tells the requester the outcome itself, in its own words. */
  tellsRequester?: boolean;
  /** Approvers must also hold this permission (as the module required before), besides seeing the record. */
  approverPermission?: string;
  /**
   * Runs once per installation, after every module is registered: adds the kind's workflows (from
   * the module's own settings, which on a new installation are its defaults) and adopts approvals
   * that were waiting. Recorded in `workflow_kind_installs`, so it never runs twice.
   */
  install?(h: InstallHelpers): Promise<void>;
  /** After every decision (for progress shown on the record). Errors are logged, never thrown. */
  onDecision?(e: DecisionEvent): Promise<void>;
  /** When the workflow ends. A thrown error is kept as the workflow's outcome error and shown. */
  onFinish(e: FinishEvent): Promise<void>;
}

/** What the workflows module offers modules at request time. */
export interface ApprovalEngine {
  /**
   * Starts the kind's workflow on a record: `definitionId` when the module names one (a catalog
   * item, a gate template), otherwise the active workflow of the kind whose conditions hold with
   * the most conditions (ties: the oldest). Answers null when none applies (no approval needed).
   */
  start(kind: string, record: Row, opts: { requester: string | null; req: FastifyRequest | null; note?: string | null; data?: Row; definitionId?: string | null }): Promise<ApprovalInstance | null>;
  /** The newest workflow of the kind on the record (running or finished), or null. */
  latest(kind: string, recordId: string): Promise<ApprovalInstance | null>;
  /** The running workflow of the kind on the record, or null. */
  running(kind: string, recordId: string): Promise<ApprovalInstance | null>;
  /** Cancels the running workflow of the kind on the record, if any (the kind's onFinish gets `byModule`). */
  cancel(kind: string, recordId: string, reason: string, req: FastifyRequest | null): Promise<boolean>;
  /**
   * The signed-in person's decision on the running workflow's current step, for a module's own
   * older route (for example POST /api/changes/:id/approvals). Same rules as the Approvals page.
   * Without a request (seeding, imports), `opts.userId` names the person the system records it for.
   */
  decide(kind: string, recordId: string, req: FastifyRequest | null, decision: 'approved' | 'rejected', comment: string | null, opts?: { userId?: string; via?: string }): Promise<Row>;
  /** Records of the kind whose current step waits for this person's decision (stand-ins included). */
  waiting(kind: string, userId: string): Promise<string[]>;
  /** Active workflows of the kind, for a module's own picker (a catalog item, a gate template). */
  definitions(kind: string): Promise<{ id: string; name: string; description: string | null }[]>;
  /** Approvals given across the workflow, and whether the reader may decide its current step now. */
  progress(kind: string, recordId: string, userId: string | null): Promise<{ instance: ApprovalInstance | null; approvals: number; required: number; waitingFor: string[]; canDecide: boolean; stepId: string | null }>;
}

interface Registry { kinds: Map<string, ApprovalKind>; engine: ApprovalEngine | null }
const registries = new WeakMap<FastifyInstance, Registry>();

function registry(app: FastifyInstance): Registry {
  let r = registries.get(app);
  if (!r) { r = { kinds: new Map(), engine: null }; registries.set(app, r); }
  return r;
}

/** Declares a kind (call from the module's `register`). */
export function defineApprovalKind(app: FastifyInstance, kind: ApprovalKind): void {
  registry(app).kinds.set(kind.key, kind);
}

export const approvalKinds = (app: FastifyInstance): ApprovalKind[] => [...registry(app).kinds.values()];
export const approvalKind = (app: FastifyInstance, key: string | null | undefined): ApprovalKind | undefined => (key ? registry(app).kinds.get(key) : undefined);

/** Set by the workflows module. */
export function setApprovalEngine(app: FastifyInstance, engine: ApprovalEngine): void {
  registry(app).engine = engine;
}

/** The engine, or null when the workflows module is not loaded (a test loading only some modules). */
export const approvalEngine = (app: FastifyInstance): ApprovalEngine | null => registry(app).engine;
