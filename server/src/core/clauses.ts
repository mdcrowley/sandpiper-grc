import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from './db.ts';
import type { ModuleContext, Row } from './module.ts';
import { notePermission } from './permission-use.ts';

// The clause-checklist engine (wave 11 contract C4, E35-05 and E27-11). A clause set is a lookup list
// of clauses (the organization's own, edited under Administration > Lookups) checked against one
// record, the scope (today a contract), optionally per sub-key (the funding award a funder-required
// clause belongs to). Each check records a status from the set's status list, the clause text as
// found and a note, in the core table `clause_checks` (migration 026). A module defines its sets in
// `register` with `defineClauseSet(ctx.app, {...})`, then reads and writes through `getChecklist` and
// `saveChecklist`; its routes keep their own shapes and permission checks.

export interface ClauseSetDef {
  /** Stable key stored on every row: `security_terms`, `funder_clauses`. */
  key: string;
  /** Shown to people: "Security terms". */
  label: string;
  /** The lookup list of clauses (value = clause key, label, meta.description). */
  list: string;
  /** The lookup list of statuses a check may take. */
  statusList: string;
  /** The record type the checklist is about, for example `contract`. */
  scopeType: string;
  /** What a sub-key names, when the set has one (for example `funding_award`: one checklist per award). */
  subKey?: string;
  /** Permission needed to read the checklist (the module's routes check it; noted for the role editor). */
  permission: string;
  /** The audit action of a change, for example `contract.clause_check`. */
  auditAction: string;
  /** The audit summary of one changed clause. */
  describe(change: { clause: string; status: string | null; scope: Row | undefined; subKey: string }): string | Promise<string>;
}

/** One clause of a checklist, assessed or not. */
export interface ChecklistRow {
  clause_key: string;
  label: string;
  description: string | null;
  status: string | null;
  clause_text: string | null;
  note: string | null;
  updated_at: string | null;
}

/** What `saveChecklist` takes per clause: a field left out keeps its stored value. */
export interface ClauseCheckInput {
  clause_key: string;
  status?: string | null;
  clause_text?: string | null;
  note?: string | null;
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const registries = new WeakMap<FastifyInstance, Map<string, ClauseSetDef>>();

function registryOf(app: FastifyInstance): Map<string, ClauseSetDef> {
  let map = registries.get(app);
  if (!map) registries.set(app, (map = new Map()));
  return map;
}

/** Adds a clause set. Throws on a malformed or duplicate key, so a clash shows at start-up. */
export function defineClauseSet(app: FastifyInstance, def: ClauseSetDef): void {
  if (!KEY_RE.test(def.key)) throw new Error(`Clause set key "${def.key}" must be lowercase letters, digits and underscores.`);
  if (!def.list || !def.statusList || !def.scopeType) throw new Error(`Clause set ${def.key} must name its clause list, status list and scope type.`);
  if (!/^[a-z_]+\.[a-z]+$/.test(def.permission)) throw new Error(`Clause set ${def.key} has a malformed permission "${def.permission}".`);
  const map = registryOf(app);
  if (map.has(def.key)) throw new Error(`Clause set ${def.key} is defined twice.`);
  notePermission(def.permission);
  map.set(def.key, def);
}

/** The set, or undefined when no module defined it. */
export function clauseSet(app: FastifyInstance, key: string): ClauseSetDef | undefined {
  return registryOf(app).get(key);
}

/** Every defined set, sorted by key. */
export function clauseSets(app: FastifyInstance): ClauseSetDef[] {
  return [...registryOf(app).values()].sort((a, b) => a.key.localeCompare(b.key));
}

function needSet(ctx: ModuleContext, key: string): ClauseSetDef {
  const def = clauseSet(ctx.app, key);
  if (!def) throw new Error(`Unknown clause set "${key}".`);
  return def;
}

const clean = (v: unknown, max = 4000): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
};

/**
 * Stored check rows of a set, for summaries that read many scopes at once (the terms matrix, the
 * vendor overview). `scopeIds` narrows them; `subKey` too (undefined = every sub-key).
 */
export async function checksOf(
  db: Queryable, setKey: string, opts: { scopeIds?: string[]; subKey?: string } = {},
): Promise<Row[]> {
  return db.query<Row>(
    `select scope_type, scope_id, sub_key, clause_key, status, clause_text, note, updated_at from clause_checks
     where set_key = $1 and deleted_at is null and ($2::uuid[] is null or scope_id = any($2::uuid[])) and ($3::text is null or sub_key = $3)`,
    [setKey, opts.scopeIds ?? null, opts.subKey ?? null],
  );
}

/** The full checklist of one scope (and sub-key): one entry per clause in the set's list, assessed or not. */
export async function getChecklist(ctx: ModuleContext, setKey: string, scopeId: string, subKey = ''): Promise<ChecklistRow[]> {
  const def = needSet(ctx, setKey);
  const clauses = await ctx.lookups.values(def.list);
  const rows = await ctx.db.query<Row>(
    `select * from clause_checks where set_key = $1 and scope_type = $2 and scope_id = $3 and sub_key = $4 and deleted_at is null`,
    [def.key, def.scopeType, scopeId, subKey],
  );
  const byKey = new Map(rows.map((r) => [r.clause_key, r]));
  return clauses.map((c) => {
    const r = byKey.get(c.value);
    return {
      clause_key: c.value,
      label: c.label,
      description: ((c.meta as Row | undefined)?.description as string | undefined) ?? null,
      status: r?.status ?? null,
      clause_text: r?.clause_text ?? null,
      note: r?.note ?? null,
      updated_at: r?.updated_at ?? null,
    };
  });
}

/**
 * Creates or updates checks of one scope (and sub-key). Each row names its clause; a field left out
 * keeps its stored value. Validates every row first (400 `validation` naming the field), then writes
 * them in one transaction and audits each changed clause against the scope record. `req` null is
 * system work (seeding). Answers how many clauses changed and the checklist as it now stands.
 */
export async function saveChecklist(
  ctx: ModuleContext, setKey: string, scopeId: string, subKey: string | null | undefined, rows: ClauseCheckInput[], req: FastifyRequest | null,
): Promise<{ changed: number; checklist: ChecklistRow[] }> {
  const def = needSet(ctx, setKey);
  const sub = subKey ?? '';
  const clauses = await ctx.lookups.values(def.list);
  const statuses = (await ctx.lookups.values(def.statusList)).map((v) => v.value);
  for (const r of rows) {
    if (!clauses.some((c) => c.value === r.clause_key)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { clause_key: 'Choose a clause from the list.' });
    }
    const s = r.status === undefined ? undefined : clean(r.status);
    if (s && !statuses.includes(s)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: `Status: "${s}" is not an allowed value.` });
    }
  }
  const scope = await ctx.resources.find(def.scopeType, scopeId);
  const userId = req?.user?.id ?? null;
  const audits: { clause: Row; before: Row; after: Row; status: string | null }[] = [];
  await ctx.db.tx(async (tx) => {
    for (const r of rows) {
      const existing = await tx.one<Row>(
        `select * from clause_checks where set_key = $1 and scope_type = $2 and scope_id = $3 and sub_key = $4 and clause_key = $5 for update`,
        [def.key, def.scopeType, scopeId, sub, r.clause_key],
      );
      const next: Row = {
        status: existing?.status ?? null, clause_text: existing?.clause_text ?? null, note: existing?.note ?? null,
      };
      if (r.status !== undefined) next.status = clean(r.status);
      if (r.clause_text !== undefined) next.clause_text = clean(r.clause_text);
      if (r.note !== undefined) next.note = clean(r.note);
      const before: Row = {};
      const after: Row = {};
      for (const k of ['status', 'clause_text', 'note']) {
        if ((existing?.[k] ?? null) !== next[k]) { before[k] = existing?.[k] ?? null; after[k] = next[k]; }
      }
      if (existing && !Object.keys(after).length && !existing.deleted_at) continue;
      if (!existing && !Object.keys(after).length) continue; // nothing to record
      await tx.query(
        `insert into clause_checks (set_key, scope_type, scope_id, sub_key, clause_key, status, clause_text, note, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
         on conflict (set_key, scope_type, scope_id, sub_key, clause_key) do update
           set status = excluded.status, clause_text = excluded.clause_text, note = excluded.note,
               updated_at = now(), updated_by = excluded.updated_by, deleted_at = null`,
        [def.key, def.scopeType, scopeId, sub, r.clause_key, next.status, next.clause_text, next.note, userId],
      );
      audits.push({ clause: clauses.find((c) => c.value === r.clause_key)!, before, after, status: next.status });
    }
  });
  for (const a of audits) {
    await ctx.audit(req, {
      action: def.auditAction, recordType: def.scopeType, recordId: scopeId,
      summary: await def.describe({ clause: a.clause.label, status: a.status, scope, subKey: sub }),
      before: { set: def.key, clause: a.clause.value, ...(sub ? { sub_key: sub } : {}), ...a.before },
      after: { set: def.key, clause: a.clause.value, ...(sub ? { sub_key: sub } : {}), ...a.after },
    });
  }
  return { changed: audits.length, checklist: await getChecklist(ctx, setKey, scopeId, sub) };
}
