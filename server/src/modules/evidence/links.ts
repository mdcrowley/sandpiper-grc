// Evidence links (E45-06): one evidence record used by many records, or by parts of them (parts.ts).
//
// Rules
// - Reading: the caller must see the record (its module's view permission and the restricted-record
//   rules). Evidence the caller may not see (restricted, outside a scoped department, or no
//   `evidence.view`) is not listed, but counted (`hidden`): restriction hides detail, never counts.
// - Linking and unlinking change what the record shows as its evidence, so they need edit permission
//   on that record's module, or the part's own rule (a document request's assignee, parts.ts); and the
//   caller must see the evidence record.
// - A link is unique per evidence record, record and part; linking again changes its relation and note.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { evidencePart, PART_RE, splitPart } from './parts.ts';
import { expiringDays } from './settings.ts';

export const EVIDENCE_TYPE = 'evidence_record';

/**
 * The record types the library offers to link to, and on which host pages show an Evidence tab. Any
 * other record type can be linked through the API; these are the ones the compliance work uses.
 */
export const LINK_TYPES = [
  'control', 'control_test', 'obligation', 'audit_engagement', 'audit_request', 'audit_finding', 'compliance_review',
  'review_deficiency', 'funding_award', 'funding_certification', 'cap', 'action', 'framework_outcome', 'policy', 'risk',
  'evidence_item',
];

export interface Target { def: ResourceDef; row: Row; label: string; ref: string | null }

const labelOf = (def: ResourceDef, row: Row) => String(row[def.titleField] ?? def.label);

/** A record the caller may see, or undefined (never says which). */
export async function findTarget(ctx: ModuleContext, user: SessionUser | null | undefined, type: unknown, id: unknown): Promise<Target | undefined> {
  if (typeof type !== 'string' || typeof id !== 'string' || !UUID_RE.test(id) || type === EVIDENCE_TYPE) return undefined;
  const def = ctx.resources.get(type);
  if (!def || !ctx.can(user ?? null, `${def.module}.view`)) return undefined;
  if (def.restricted === true && !ctx.can(user ?? null, 'security.view')) return undefined;
  const row = await ctx.resources.find(type, id, user ?? null);
  if (!row) return undefined;
  return { def, row, label: labelOf(def, row), ref: def.ref ? (row[def.ref.field] ?? null) : null };
}

/** An evidence record the caller may see, or undefined. */
export async function findEvidence(ctx: ModuleContext, user: SessionUser | null | undefined, id: unknown): Promise<Row | undefined> {
  if (typeof id !== 'string' || !UUID_RE.test(id) || !ctx.can(user ?? null, 'evidence.view')) return undefined;
  return ctx.resources.find(EVIDENCE_TYPE, id, user ?? null);
}

/** Whether the caller may link evidence to this record (or this part of it). */
export async function mayLinkTo(ctx: ModuleContext, req: FastifyRequest, target: Target, part: string): Promise<boolean> {
  if (ctx.can(req.user, `${target.def.module}.edit`)) return true;
  const p = splitPart(part);
  const def = p && evidencePart(ctx.app, target.def.type, p.prefix);
  return Boolean(def?.mayLink && await def.mayLink(req, target.row.id, p!.key));
}

/** Refuses a change to a part's evidence while the module that owns the part says it is locked (E45-19). */
export async function checkPartOpen(ctx: ModuleContext, target: Target, part: string): Promise<void> {
  if (!part) return;
  const p = splitPart(part);
  const def = p && evidencePart(ctx.app, target.def.type, p.prefix);
  const why = def?.mayChange ? await def.mayChange(ctx.db, target.row.id, p!.key) : null;
  if (why) ctx.fail(409, 'part_locked', why);
}

/** Checks a part key against the module that owns it; its name, or a validation error. */
export async function checkPart(ctx: ModuleContext, target: Target, part: string): Promise<string | null> {
  if (!part) return null;
  const p = splitPart(part);
  const def = p && evidencePart(ctx.app, target.def.type, p.prefix);
  const name = def ? await def.describe(ctx.db, target.row.id, p!.key) : null;
  if (!name) ctx.fail(400, 'validation', 'Check the highlighted fields.', { part: `This ${target.def.label.toLowerCase()} has no such part.` });
  return name;
}

/** The evidence state shown everywhere: no expiry, current, expiring (within `days`), expired. */
export function stateOf(validUntil: unknown, today: string, days = 30): 'none' | 'current' | 'expiring' | 'expired' {
  if (!validUntil) return 'none';
  const v = (validUntil instanceof Date ? validUntil.toISOString() : String(validUntil)).slice(0, 10);
  if (v < today) return 'expired';
  return v <= addDays(today, days) ? 'expiring' : 'current';
}

/** How many files an evidence record holds (0 when the attachments module is not loaded). */
export const filesSql = (ctx: ModuleContext, alias = 'e') => (ctx.app.hasDecorator('attachmentStores')
  ? `(select count(*)::int from attachments a where a.record_type = '${EVIDENCE_TYPE}' and a.record_id = ${alias}.id and a.deleted_at is null)`
  : '0');

const day = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

/** Evidence linked to one record (all parts, or one part), with the count of what the caller may not see. */
export async function evidenceFor(ctx: ModuleContext, user: SessionUser | null | undefined, target: Target, part?: string | null) {
  const params: unknown[] = [target.def.type, target.row.id];
  let partSql = '';
  if (part !== undefined && part !== null) { params.push(part); partSql = ' and l.part = $3'; }
  const visible = ctx.can(user ?? null, 'evidence.view') ? ctx.resources.visibleWhere(EVIDENCE_TYPE, user, 'e') : 'false';
  const rows = await ctx.db.query<Row>(
    `select l.id as link_id, l.part, l.relation, l.note, l.created_at as linked_at, e.id, e.ref, e.title, e.source, e.url, e.document_id,
            e.valid_until, e.collected_on, e.period_start, e.period_end, e.owner_id, e.restricted, u.display_name as owner_name,
            (${visible}) as visible,
            ${filesSql(ctx)} as files
     from evidence_links l join evidence_records e on e.id = l.evidence_id and e.deleted_at is null
     left join users u on u.id = e.owner_id
     where l.record_type = $1 and l.record_id = $2${partSql}
     order by l.part, lower(e.title), e.id`, params);
  const today = todayInZone();
  const window = await expiringDays(ctx);
  const names = await partNames(ctx, target, rows.map((r) => r.part));
  return {
    rows: rows.filter((r) => r.visible).map((r) => ({
      link_id: r.link_id, part: r.part, part_label: r.part ? names.get(r.part) ?? r.part : null, relation: r.relation, note: r.note, linked_at: r.linked_at,
      evidence: {
        id: r.id, ref: r.ref, title: r.title, source: r.source, url: r.url, document_id: r.document_id, owner_id: r.owner_id, owner_name: r.owner_name,
        valid_until: day(r.valid_until), collected_on: day(r.collected_on), period_start: day(r.period_start), period_end: day(r.period_end),
        files: Number(r.files), state: stateOf(r.valid_until, today, window), restricted: r.restricted === true,
      },
    })),
    // Counted for everyone, listed only for those who may see them.
    hidden: rows.filter((r) => !r.visible).length,
    total: rows.length,
  };
}

async function partNames(ctx: ModuleContext, target: Target, parts: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byPrefix = new Map<string, Set<string>>();
  for (const part of new Set(parts.filter(Boolean))) {
    const p = splitPart(part);
    if (!p) continue;
    if (!byPrefix.has(p.prefix)) byPrefix.set(p.prefix, new Set());
    byPrefix.get(p.prefix)!.add(p.key);
  }
  for (const [prefix, keys] of byPrefix) {
    const def = evidencePart(ctx.app, target.def.type, prefix);
    if (!def) continue;
    const named = def.names ? await def.names(ctx.db, target.row.id) : null;
    for (const key of keys) {
      const name = named ? named.get(key) ?? null : await def.describe(ctx.db, target.row.id, key);
      if (name) out.set(`${prefix}:${key}`, `${def.label}: ${name}`);
    }
  }
  return out;
}

/** The records one evidence record is used by, as the caller may see them. */
export async function usedBy(ctx: ModuleContext, user: SessionUser | null | undefined, evidenceId: string) {
  const links = await ctx.db.query<Row>(
    'select id, record_type, record_id::text as record_id, part, relation, note, created_at from evidence_links where evidence_id = $1 order by created_at', [evidenceId]);
  const rows: Row[] = [];
  let hidden = 0;
  let total = 0;
  const byType = new Map<string, Row[]>();
  for (const l of links) byType.set(l.record_type, [...(byType.get(l.record_type) ?? []), l]);
  for (const [type, list] of byType) {
    // A type whose module is not loaded or is switched off is left out, as if it were not installed.
    const def = ctx.resources.get(type);
    if (!def) continue;
    const ids = list.map((l) => l.record_id);
    // Counted for everyone: every link to a record that still exists.
    const existing = new Set((await ctx.db.query<Row>(
      `select id::text as id from ${def.table} where id = any($1::uuid[]) and deleted_at is null`, [ids])).map((r) => r.id));
    const live = list.filter((l) => existing.has(l.record_id));
    total += live.length;
    const allowed = ctx.can(user ?? null, `${def.module}.view`) && !(def.restricted === true && !ctx.can(user ?? null, 'security.view'));
    if (!allowed) { hidden += live.length; continue; }
    const found = await ctx.db.query<Row>(
      `select * from ${def.table} where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(type, user)}`, [ids]);
    const byId = new Map(found.map((r) => [String(r.id), r]));
    for (const l of live) {
      const row = byId.get(l.record_id);
      if (!row) { hidden += 1; continue; }
      const target: Target = { def, row, label: labelOf(def, row), ref: def.ref ? (row[def.ref.field] ?? null) : null };
      const names = l.part ? await partNames(ctx, target, [l.part]) : new Map<string, string>();
      rows.push({
        link_id: l.id, record_type: type, type_label: def.label, record_id: l.record_id, ref: target.ref, label: target.label,
        route: `${def.route}/${l.record_id}`, part: l.part, part_label: l.part ? names.get(l.part) ?? l.part : null,
        relation: l.relation, note: l.note, linked_at: l.created_at,
      });
    }
  }
  rows.sort((a, b) => String(a.type_label).localeCompare(String(b.type_label)) || String(a.label).localeCompare(String(b.label)));
  return { rows, hidden, total };
}

/** Stores a link after the caller's rights were checked. Returns the link and whether it is new. */
export async function storeLink(ctx: ModuleContext, req: FastifyRequest | null, evidence: Row, target: Target, input: { part?: string; relation?: string; note?: string | null }) {
  const part = input.part ?? '';
  const relation = input.relation ?? 'supports';
  const before = await ctx.db.one<Row>('select * from evidence_links where evidence_id = $1 and record_type = $2 and record_id = $3 and part = $4',
    [evidence.id, target.def.type, target.row.id, part]);
  const row = (await ctx.db.one<Row>(
    `insert into evidence_links (evidence_id, record_type, record_id, part, relation, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (evidence_id, record_type, record_id, part) do update set relation = excluded.relation, note = excluded.note returning *`,
    [evidence.id, target.def.type, target.row.id, part, relation, input.note ?? null, actorOf(req).id]))!;
  const what = `${evidence.ref ?? ''} ${evidence.title}`.trim();
  const where = `${target.def.label.toLowerCase()} ${[target.ref, target.label].filter(Boolean).join(' ')}${part ? ` (${part})` : ''}`;
  // One event on each side, so both histories say it.
  for (const [type, id, summary] of [
    [EVIDENCE_TYPE, evidence.id, `Evidence ${before ? 'link changed' : 'linked'}: used by ${where}`],
    [target.def.type, target.row.id, `Evidence ${before ? 'link changed' : 'linked'}: ${what}${part ? ` (${part})` : ''}`],
  ] as const) {
    await ctx.audit(req, {
      action: before ? 'evidence.link_update' : 'evidence.link', recordType: type, recordId: id, summary,
      before: before ? { relation: before.relation, note: before.note } : undefined,
      after: { evidence_id: evidence.id, record_type: target.def.type, record_id: target.row.id, part, relation, note: input.note ?? null },
    });
  }
  return { row, created: !before };
}

export async function removeLink(ctx: ModuleContext, req: FastifyRequest | null, link: Row, evidence: Row, target: Target) {
  await ctx.db.query('delete from evidence_links where id = $1', [link.id]);
  const what = `${evidence.ref ?? ''} ${evidence.title}`.trim();
  const where = `${target.def.label.toLowerCase()} ${[target.ref, target.label].filter(Boolean).join(' ')}`;
  for (const [type, id, summary] of [
    [EVIDENCE_TYPE, evidence.id, `Evidence link removed: no longer used by ${where}${link.part ? ` (${link.part})` : ''}`],
    [target.def.type, target.row.id, `Evidence link removed: ${what}${link.part ? ` (${link.part})` : ''}`],
  ] as const) {
    await ctx.audit(req, {
      action: 'evidence.unlink', recordType: type, recordId: id, summary,
      before: { evidence_id: evidence.id, record_type: target.def.type, record_id: target.row.id, part: link.part, relation: link.relation },
    });
  }
}

/**
 * Copies the evidence links of one record (or part) to another (a funder review carried forward:
 * the same evidence records are used again, nothing is uploaded twice). System work after the
 * caller's own checks; returns how many links were added.
 */
export async function copyLinks(ctx: ModuleContext, from: { type: string; id: string; part?: string }, to: { type: string; id: string; part?: string }, userId: string | null): Promise<number> {
  if (!ctx.resources.get(EVIDENCE_TYPE)) return 0;
  const params: unknown[] = [from.type, from.id, to.type, to.id, userId];
  let partSql = '';
  if (from.part !== undefined) { params.push(from.part, to.part ?? from.part); partSql = ' and l.part = $6'; }
  const added = await ctx.db.query<Row>(
    `insert into evidence_links (evidence_id, record_type, record_id, part, relation, note, created_by)
     select l.evidence_id, $3, $4, ${from.part !== undefined ? '$7' : 'l.part'}, l.relation, l.note, $5
     from evidence_links l join evidence_records e on e.id = l.evidence_id and e.deleted_at is null
     where l.record_type = $1 and l.record_id = $2${partSql}
     on conflict (evidence_id, record_type, record_id, part) do nothing returning id`, params);
  return added.length;
}

export const validPart = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' || PART_RE.test(s) ? s : '\u0000';
};
