import type { FastifyRequest } from 'fastify';
import { clauseSet, defineClauseSet, getChecklist, saveChecklist, type ChecklistRow } from '../../core/clauses.ts';
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

/** The set key of the contract security terms in the clause-checklist engine (contract C4). */
export const SECURITY_TERMS = 'security_terms';

/** Puts the security terms on the shared clause-checklist engine. Called from the module's `register`. */
export function registerSecurityTerms(ctx: ModuleContext): void {
  if (clauseSet(ctx.app, SECURITY_TERMS)) return;
  defineClauseSet(ctx.app, {
    key: SECURITY_TERMS, label: 'Security terms', list: 'contract_clause', statusList: 'clause_status', scopeType: 'contract',
    permission: 'contracts.view', auditAction: 'contract.clause_check',
    describe: ({ clause, status, scope }) =>
      `Security term "${clause}" ${status ? `marked ${status}` : 'updated'} on ${scope?.ref ?? scope?.title ?? 'a contract'}`,
  });
}

/** Creates or updates one checklist row through the engine, which audits the change against the contract. */
export async function saveClauseCheck(
  ctx: ModuleContext, req: FastifyRequest | null, contract: Row, clauseKey: string, input: ClauseInput,
): Promise<{ changed: boolean }> {
  const clauses = await ctx.lookups.values('contract_clause');
  if (!clauses.some((c) => c.value === clauseKey)) ctx.fail(404, 'unknown_clause', `Unknown clause "${clauseKey}".`);
  const { changed } = await saveChecklist(ctx, SECURITY_TERMS, contract.id, '', [{ clause_key: clauseKey, ...input }], req);
  return { changed: changed > 0 };
}

/** A contract's full checklist: one entry per clause in the list, assessed or not. */
export async function contractChecklist(ctx: ModuleContext, contractId: string): Promise<ChecklistRow[]> {
  return getChecklist(ctx, SECURITY_TERMS, contractId);
}
