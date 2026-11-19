import type { FastifyRequest } from 'fastify';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';

/** Clauses of the contract security addendum. Stored as the `contract_clause` lookup list. */
export const DEFAULT_CLAUSES: LookupValue[] = [
  { value: 'independent_assurance', label: 'Independent assurance', sort: 10, meta: { description: 'An independent assurance report or certification, provided each year.' } },
  { value: 'mfa', label: 'Multi-factor sign-in', sort: 20, meta: { description: 'Multi-factor authentication for vendor staff and for the organization\'s users.' } },
  { value: 'breach_notice', label: 'Breach notice time', sort: 30, meta: { description: 'A fixed deadline for telling the organization about a security incident.' } },
  { value: 'data_ownership', label: 'Data ownership and return', sort: 40, meta: { description: 'The organization owns its data and gets it back, or has it destroyed, on exit.' } },
  { value: 'recovery_sla', label: 'Recovery times and service levels', sort: 50, meta: { description: 'Stated recovery time and recovery point, uptime and remedies.' } },
  { value: 'cyber_insurance', label: 'Cyber insurance', sort: 60, meta: { description: 'Cyber liability cover with stated limits.' } },
  { value: 'liability', label: 'Liability carve-out', sort: 70, meta: { description: 'Data breach and confidentiality losses sit outside the liability cap.' } },
  { value: 'subcontractors', label: 'Subcontractors', sort: 80, meta: { description: 'Subcontractors are disclosed and held to the same security terms.' } },
  { value: 'security_standard', label: 'Named security standard', sort: 90, meta: { description: 'The vendor commits to a named, recognized security standard.' } },
];

export const CLAUSE_STATUSES: LookupValue[] = [
  { value: 'present', label: 'Present', color: 'green', sort: 10 },
  { value: 'partial', label: 'Partial', color: 'amber', sort: 20 },
  { value: 'absent', label: 'Absent', color: 'red', sort: 30 },
];

export type ClauseStatus = 'present' | 'partial' | 'absent';

const SEVERITY: Record<string, number> = { present: 1, partial: 2, absent: 3 };

/** The worst status in a set (absent beats partial beats present); null when nothing is assessed. */
export function worstStatus(statuses: (string | null | undefined)[]): ClauseStatus | null {
  let worst: string | null = null;
  for (const s of statuses) {
    if (s && SEVERITY[s] && (!worst || SEVERITY[s] > SEVERITY[worst])) worst = s;
  }
  return worst as ClauseStatus | null;
}

const UNKNOWN = /^(not known|unknown|not read|not reviewed|not applicable|n\/a|to be confirmed|tbc)\b/i;
const NOTHING = /^(not stated|none|nothing|nil)\b/i;
const HEDGE = /\b(no|not|none|only|but|unless|except|excluded|excluding|partly|partial|unclear|illegible|unsigned|draft|to be (specified|agreed|confirmed)|web address|estimate)\b/i;

/**
 * Reads one free-text cell of a contract register into a checklist status.
 *  - says nothing is stated, or none            -> absent
 *  - a clear term                               -> present
 *  - hedged or incomplete                       -> partial
 *  - not known, not read, not applicable, blank -> null (not assessed; the text is still kept)
 */
export function classifyClauseText(text: string | null | undefined): ClauseStatus | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (UNKNOWN.test(t) || /\bnot known\.?$/i.test(t)) return null;
  if (NOTHING.test(t)) return 'absent';
  const sentences = t.split(/[.;]\s+/).filter((s) => s.trim() !== '');
  if (/^no\b/i.test(t) && sentences.length <= 1) return 'absent';
  if (/^no\s*[;,.]/i.test(t)) return 'absent';
  if (HEDGE.test(t)) return 'partial';
  return 'present';
}

export interface ClauseInput {
  status?: string | null;
  clause_text?: string | null;
  note?: string | null;
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Creates or updates one checklist row and audits the change against the contract. */
export async function saveClauseCheck(
  ctx: ModuleContext, req: FastifyRequest | null, contract: Row, clauseKey: string, input: ClauseInput,
): Promise<{ row: Row; changed: boolean }> {
  const clauses = await ctx.lookups.values('contract_clause');
  const clause = clauses.find((c) => c.value === clauseKey);
  if (!clause) ctx.fail(404, 'unknown_clause', `Unknown clause "${clauseKey}".`);
  const existing = await ctx.db.one<Row>(
    'select * from contract_clause_checks where contract_id = $1 and clause_key = $2', [contract.id, clauseKey],
  );
  const next: Row = {
    status: existing?.status ?? null, clause_text: existing?.clause_text ?? null, note: existing?.note ?? null,
  };
  if (input.status !== undefined) {
    const s = clean(input.status);
    const allowed = (await ctx.lookups.values('clause_status')).map((v) => v.value);
    if (s !== null && !allowed.includes(s)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: `Status: "${s}" is not an allowed value.` });
    }
    next.status = s;
  }
  if (input.clause_text !== undefined) next.clause_text = clean(input.clause_text);
  if (input.note !== undefined) next.note = clean(input.note);

  const before: Row = {};
  const after: Row = {};
  for (const k of ['status', 'clause_text', 'note']) {
    if ((existing?.[k] ?? null) !== next[k]) { before[k] = existing?.[k] ?? null; after[k] = next[k]; }
  }
  if (existing && !Object.keys(after).length) return { row: existing, changed: false };

  const userId = req?.user?.id ?? null;
  const row = (await ctx.db.one<Row>(
    `insert into contract_clause_checks (contract_id, clause_key, status, clause_text, note, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$6)
     on conflict (contract_id, clause_key) do update
       set status = excluded.status, clause_text = excluded.clause_text, note = excluded.note,
           updated_at = now(), updated_by = excluded.updated_by
     returning *`,
    [contract.id, clauseKey, next.status, next.clause_text, next.note, userId],
  ))!;
  if (Object.keys(after).length) {
    await ctx.audit(req, {
      action: 'contract.clause_check', recordType: 'contract', recordId: contract.id,
      summary: `Security term "${clause!.label}" ${next.status ? `marked ${next.status}` : 'updated'} on ${contract.ref ?? contract.title}`,
      before: { clause: clauseKey, ...before }, after: { clause: clauseKey, ...after },
    });
  }
  return { row, changed: true };
}

/** A contract's full checklist: one entry per clause in the list, assessed or not. */
export async function contractChecklist(ctx: ModuleContext, contractId: string): Promise<Row[]> {
  const clauses = await ctx.lookups.values('contract_clause');
  const rows = await ctx.db.query<Row>('select * from contract_clause_checks where contract_id = $1', [contractId]);
  const byKey = new Map(rows.map((r) => [r.clause_key, r]));
  return clauses.map((c) => {
    const r = byKey.get(c.value);
    return {
      clause_key: c.value,
      label: c.label,
      description: (c.meta as Record<string, unknown> | undefined)?.description ?? null,
      status: r?.status ?? null,
      clause_text: r?.clause_text ?? null,
      note: r?.note ?? null,
      updated_at: r?.updated_at ?? null,
    };
  });
}
