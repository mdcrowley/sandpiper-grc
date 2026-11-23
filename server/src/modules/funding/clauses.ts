import type { FastifyRequest } from 'fastify';
import { checksOf, clauseSet, defineClauseSet, saveChecklist } from '../../core/clauses.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';
import { cleanText } from './shared.ts';
import { FUNDED_BY } from './awards.ts';

/**
 * Funder-required contract clauses (E27-08): for a contract paid for by an award, a checklist of the
 * clauses the funder requires, per award. The clause list (`funding_clause`) is the organization's
 * own, edited under Administration > Lists; a few neutral examples ship with the application.
 * Stored by the shared clause-checklist engine (core/clauses.ts, contract C4, E35-05 and E27-11) as
 * the set `funder_clauses`, one checklist per award (the sub-key is the award id), beside the
 * contract security terms (set `security_terms`, vendors module).
 */

export const FUNDER_CLAUSES = 'funder_clauses';

export const DEFAULT_FUNDING_CLAUSES: LookupValue[] = [
  { value: 'access_to_records', label: 'Access to records', sort: 10, meta: { description: 'The funder and its auditors may inspect the contractor\'s records about the contract.' } },
  { value: 'record_retention', label: 'Record retention', sort: 20, meta: { description: 'Contract records are kept for the period the award requires.' } },
  { value: 'termination', label: 'Termination', sort: 30, meta: { description: 'The organization may end the contract for cause or for convenience.' } },
  { value: 'excluded_parties', label: 'Excluded parties', sort: 40, meta: { description: 'The contractor states it is not barred from publicly funded work, and checks its subcontractors.' } },
  { value: 'conflict_of_interest', label: 'Conflict of interest', sort: 50, meta: { description: 'No one with a conflict of interest takes part in awarding or running the contract.' } },
  { value: 'flow_down', label: 'Flow-down to subcontracts', sort: 60, meta: { description: 'The required clauses are passed on to subcontracts.' } },
  { value: 'funder_acknowledgment', label: 'Funder acknowledgment', sort: 70, meta: { description: 'Publications and signs about the work name the funder as the award asks.' } },
];

export const FUNDING_CLAUSE_STATUSES: LookupValue[] = [
  { value: 'present', label: 'Present', color: 'green', sort: 10 },
  { value: 'partial', label: 'Partial', color: 'amber', sort: 20 },
  { value: 'absent', label: 'Absent', color: 'red', sort: 30 },
  { value: 'not_required', label: 'Not required', color: 'gray', sort: 40 },
];

export function registerClauses(ctx: ModuleContext) {
  const { db, app } = ctx;

  if (!clauseSet(app, FUNDER_CLAUSES)) {
    defineClauseSet(app, {
      key: FUNDER_CLAUSES, label: 'Funder-required clauses', list: 'funding_clause', statusList: 'funding_clause_status',
      scopeType: 'contract', subKey: 'funding_award', permission: 'funding.view', auditAction: 'contract.funding_clause',
      async describe({ clause, status, scope, subKey }) {
        const award = UUID_RE.test(subKey) ? await db.one<Row>('select ref from funding_awards where id = $1', [subKey]) : undefined;
        return `Funder clause "${clause}" for ${award?.ref ?? 'an award'} ${status ? `marked ${status.replace('_', ' ')}` : 'cleared'} on ${scope?.ref ?? scope?.title ?? 'a contract'}`;
      },
    });
  }

  /** The contract, when contracts are installed and the reader may see it (404 otherwise). */
  async function needContract(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).contractId ?? '');
    if (!ctx.resources.get('contract') || !UUID_RE.test(id) || !ctx.can(req.user, 'contracts.view')) ctx.fail(404, 'not_found', 'Contract not found.');
    return (await ctx.resources.find('contract', id, req.user)) ?? ctx.fail(404, 'not_found', 'Contract not found.');
  }

  /** Awards the contract is linked to as "funded by", and any award it already has clause rows for. */
  async function awardsFor(contractId: string, user: FastifyRequest['user']): Promise<Row[]> {
    return db.query<Row>(
      `select a.id, a.ref, a.title, a.funder_name from funding_awards a
       where a.deleted_at is null and ${ctx.resources.visibleWhere('funding_award', user, 'a')} and (
         exists (select 1 from record_links l where l.from_type = 'contract' and l.from_id = $1 and l.to_type = 'funding_award' and l.to_id = a.id and l.relation = $2)
         or exists (select 1 from clause_checks c where c.set_key = $3 and c.scope_type = 'contract' and c.scope_id = $1 and c.sub_key = a.id::text and c.deleted_at is null))
       order by a.ref`, [contractId, FUNDED_BY, FUNDER_CLAUSES]);
  }

  app.get('/api/funding/contracts/:contractId/clauses', { preHandler: ctx.requirePerm('funding.view') }, async (req) => {
    const contract = await needContract(req);
    const clauses = await ctx.lookups.values('funding_clause');
    const awards = await awardsFor(contract.id, req.user);
    const rows = await checksOf(db, FUNDER_CLAUSES, { scopeIds: [contract.id] });
    return {
      clauses: clauses.map((c) => ({ key: c.value, label: c.label, description: (c.meta as Row | undefined)?.description ?? null })),
      awards: awards.map((a) => ({
        ...a,
        checklist: clauses.map((c) => {
          const r = rows.find((x) => x.sub_key === a.id && x.clause_key === c.value);
          return { clause_key: c.value, status: r?.status ?? null, note: r?.note ?? null, updated_at: r?.updated_at ?? null };
        }),
      })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding/contracts/:contractId/clauses', tag: 'Funding', permission: 'funding.view',
    summary: 'The funder-required clause checklist of a contract, per award that funds it (also needs contracts.view)',
    response: '{ clauses: [{ key, label, description }], awards: [{ id, ref, title, funder_name, checklist: [{ clause_key, status, note, updated_at }] }] }',
  });

  app.put('/api/funding/contracts/:contractId/clauses', { preHandler: ctx.requirePerm('funding.edit') }, async (req) => {
    const contract = await needContract(req);
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const awardId = String(b.award_id ?? '');
    const award = UUID_RE.test(awardId) ? await ctx.resources.find('funding_award', awardId, req.user) : undefined;
    if (!award) errors.award_id = 'Choose an award.';
    const clause = (await ctx.lookups.values('funding_clause')).find((c) => c.value === b.clause_key);
    if (!clause) errors.clause_key = 'Choose a clause from the list.';
    const status = b.status === null || b.status === '' || b.status === undefined ? null : String(b.status);
    if (status && !(await ctx.lookups.values('funding_clause_status')).some((s) => s.value === status)) {
      errors.status = 'Choose a status from the list.';
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const note = cleanText(b.note, 2000);
    const { checklist } = await saveChecklist(ctx, FUNDER_CLAUSES, contract.id, award!.id, [{ clause_key: clause!.value, status, note }], req);
    const row = checklist.find((c) => c.clause_key === clause!.value)!;
    return { contract_id: contract.id, award_id: award!.id, clause_key: row.clause_key, status: row.status, note: row.note, updated_at: row.updated_at };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/funding/contracts/:contractId/clauses', tag: 'Funding', permission: 'funding.edit',
    summary: 'Record whether a contract has one funder-required clause for one award (also needs contracts.view)',
    body: '{ award_id: uuid, clause_key: string, status: "present" | "partial" | "absent" | "not_required" | null, note?: string }',
    response: '{ contract_id, award_id, clause_key, status, note, updated_at }',
  });
}
