import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import {
  DEFAULT_APPROVAL_RULES, DEFAULT_QUESTIONNAIRE, DEFAULT_TRANSITIONS, type ApprovalRule, type Questionnaire,
} from './rules.ts';

export type Req = FastifyRequest | null;

export const SETTING_QUESTIONNAIRE = 'changes.questionnaire';
export const SETTING_RULES = 'changes.approval_rules';
export const AFFECTS = 'affects';

/**
 * Values the module itself sets on read-only change fields (status, approvals, review)
 * during a user's request. The resource engine drops read-only fields from user input, so
 * the hooks pick them up from here; the change is still validated, audited and attributed
 * to the user.
 */
const forced = new WeakMap<object, Row>();

export function takeForced(req: Req): Row | undefined {
  if (!req) return undefined;
  const patch = forced.get(req);
  forced.delete(req);
  return patch;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Helpers shared by the parts of the change service. */
export function makeBase(ctx: ModuleContext) {
  const { db } = ctx;

  function checker(body: Row | undefined, partial: boolean) {
    const errors: Record<string, string> = {};
    const out: Row = {};
    const raw = (name: string, label: string, required: boolean): unknown => {
      let v = body?.[name];
      if (typeof v === 'string') v = v.trim();
      if (v === undefined) {
        if (!partial && required) errors[name] = `${label} is required.`;
        return undefined;
      }
      if (v === null || v === '') {
        if (required) errors[name] = `${label} is required.`; else out[name] = null;
        return undefined;
      }
      return v;
    };
    return {
      out,
      errors,
      text(name: string, label: string, required = false) {
        const v = raw(name, label, required);
        if (v !== undefined) out[name] = String(v);
      },
      date(name: string, label: string, required = false) {
        const v = raw(name, label, required);
        if (v === undefined) return;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(String(v)))) out[name] = String(v);
        else errors[name] = `${label} must be a date (YYYY-MM-DD).`;
      },
      datetime(name: string, label: string, required = false) {
        const v = raw(name, label, required);
        if (v === undefined) return;
        const d = v instanceof Date ? v : new Date(String(v));
        if (Number.isNaN(d.getTime())) errors[name] = `${label} must be a date and time.`;
        else out[name] = d.toISOString();
      },
      int(name: string, label: string, min: number, max: number, required = false) {
        const v = raw(name, label, required);
        if (v === undefined) return;
        const n = Number(v);
        if (Number.isInteger(n) && n >= min && n <= max) out[name] = n;
        else errors[name] = `${label} must be a whole number from ${min} to ${max}.`;
      },
      oneOf(name: string, label: string, allowed: string[], required = false) {
        const v = raw(name, label, required);
        if (v === undefined) return;
        if (allowed.includes(String(v))) out[name] = String(v);
        else errors[name] = `${label}: "${v}" is not an allowed value.`;
      },
      uuid(name: string, label: string) {
        const v = raw(name, label, false);
        if (v === undefined) return;
        if (UUID_RE.test(String(v))) out[name] = String(v); else errors[name] = `${label} is not a valid reference.`;
      },
      bool(name: string, label: string) {
        const v = raw(name, label, false);
        if (v === undefined) return;
        if (typeof v === 'boolean') out[name] = v;
        else if (v === 'true' || v === 'false') out[name] = v === 'true';
        else errors[name] = `${label} must be yes or no.`;
      },
      finish(): Row {
        if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
        return out;
      },
    };
  }

  function sqlParts(data: Row, startAt = 1) {
    const cols: string[] = [];
    const marks: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (!IDENT.test(k)) throw new Error(`Bad column name: ${k}`);
      const isJson = typeof v === 'object' && v !== null && !(v instanceof Date);
      cols.push(k);
      params.push(isJson ? JSON.stringify(v) : v);
      marks.push(`$${startAt + params.length - 1}${isJson ? '::jsonb' : ''}`);
    }
    return { cols, marks, params };
  }

  /** Table names come from this module only, never from a request. */
  async function insertRow(table: string, data: Row): Promise<Row> {
    const { cols, marks, params } = sqlParts(data);
    return (await db.one<Row>(`insert into ${table} (${cols.join(', ')}) values (${marks.join(', ')}) returning *`, params))!;
  }

  async function updateRow(table: string, id: string, data: Row, req: Req): Promise<Row> {
    const { cols, marks, params } = sqlParts(data, 3);
    const sets = cols.map((c, i) => `${c} = ${marks[i]}`);
    return (await db.one<Row>(
      `update ${table} set ${[...sets, 'updated_at = now()', 'updated_by = $2'].join(', ')} where id = $1 returning *`,
      [id, req?.user?.id ?? null, ...params],
    ))!;
  }

  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

  /** Keeps only the keys whose value differs from the existing row. */
  function diff(existing: Row, patch: Row) {
    const before: Row = {};
    const after: Row = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && !same(existing[k], v)) {
        before[k] = existing[k] ?? null;
        after[k] = v;
      }
    }
    return { before, after, changed: Object.keys(after).length > 0 };
  }

  const actorName = (req: Req) => req?.user?.displayName ?? 'System';
  const changeLabel = (c: Row) => [c.ref, c.title].filter(Boolean).join(' ');

  async function needChange(id: string, req: Req): Promise<Row> {
    return (await ctx.resources.find('change', id, req?.user)) ?? ctx.fail(404, 'not_found', 'Change not found.');
  }

  /** Sets read-only change fields on behalf of the module; see `forced` above. */
  async function setFields(req: Req, id: string, patch: Row): Promise<Row> {
    if (!req) return ctx.resources.update('change', id, patch, null);
    forced.set(req, patch);
    try {
      return await ctx.resources.update('change', id, {}, req);
    } finally {
      forced.delete(req);
    }
  }

  /** Creates a change with read-only fields set by the module (a standard change from a template). */
  async function createWith(req: Req, data: Row, system: Row): Promise<Row> {
    if (!req) return ctx.resources.create('change', { ...data, ...system }, null);
    forced.set(req, system);
    try {
      return await ctx.resources.create('change', data, req);
    } finally {
      forced.delete(req);
    }
  }

  // ---------- settings ----------

  async function questionnaire(): Promise<Questionnaire> {
    return ctx.settings.get<Questionnaire>(SETTING_QUESTIONNAIRE, DEFAULT_QUESTIONNAIRE);
  }

  async function approvalRules(): Promise<ApprovalRule[]> {
    return ctx.settings.get<ApprovalRule[]>(SETTING_RULES, DEFAULT_APPROVAL_RULES);
  }

  /** Allowed moves, from each status value's `meta.next` with the built-in table as the fallback. */
  async function transitions(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = { ...DEFAULT_TRANSITIONS };
    for (const v of await ctx.lookups.values('change_status')) {
      const next = v.meta?.next;
      if (Array.isArray(next)) out[v.value] = next.map(String);
      else out[v.value] ??= [];
    }
    return out;
  }

  async function lookupLabel(list: string, value: unknown): Promise<string> {
    return (await ctx.lookups.values(list)).find((v) => v.value === value)?.label ?? String(value ?? '');
  }

  // ---------- affected systems (generic links with the relation "affects") ----------

  /** Systems each change affects: its main system plus any linked with "affects". */
  async function systemsOf(changes: Row[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>(changes.map((c) => [c.id, c.system_id ? [c.system_id] : []]));
    if (!changes.length) return out;
    const links = await db.query<{ from_id: string; to_id: string }>(
      `select from_id, to_id from record_links
       where from_type = 'change' and to_type = 'system' and relation = $2 and from_id = any($1::uuid[])`,
      [changes.map((c) => c.id), AFFECTS],
    );
    for (const l of links) {
      const list = out.get(l.from_id)!;
      if (!list.includes(l.to_id)) list.push(l.to_id);
    }
    return out;
  }

  /** Keeps the "affects" link of the main system or asset in step with the field. */
  async function syncPrimaryLink(req: Req, changeId: string, toType: string, before: string | null, after: string | null) {
    if (before === after) return;
    const field = toType === 'system' ? 'main system' : `main ${toType}`;
    if (before) {
      const removed = await db.query(
        `delete from record_links where from_type = 'change' and from_id = $1 and to_type = $2 and to_id = $3 and relation = $4 returning id`,
        [changeId, toType, before, AFFECTS]);
      if (removed.length) {
        await ctx.audit(req, {
          action: 'link.remove', recordType: 'change', recordId: changeId,
          summary: `Link to ${toType} (${AFFECTS}) removed with the change of ${field}`,
          before: { to_type: toType, to_id: before, relation: AFFECTS },
        });
      }
    }
    if (after) {
      const added = await db.query(
        `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('change', $1, $2, $3, $4, $5)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing returning id`,
        [changeId, toType, after, AFFECTS, req?.user?.id ?? null]);
      if (added.length) {
        await ctx.audit(req, {
          action: 'link.add', recordType: 'change', recordId: changeId,
          summary: `Linked to ${toType} (${AFFECTS}) as the ${field}`,
          after: { to_type: toType, to_id: after, relation: AFFECTS },
        });
      }
    }
  }

  async function systemNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ctx.resources.get('system')) return out;
    for (const id of new Set(ids)) out.set(id, (await ctx.resources.labelFor('system', id)) ?? 'Unknown system');
    return out;
  }

  return {
    checker, insertRow, updateRow, diff, same, actorName, changeLabel, needChange, setFields, createWith,
    questionnaire, approvalRules, transitions, lookupLabel, systemsOf, syncPrimaryLink, systemNames,
  };
}

export type Base = ReturnType<typeof makeBase>;
