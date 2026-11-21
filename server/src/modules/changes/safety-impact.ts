import type { ModuleContext } from '../../core/module.ts';

/**
 * Safety risk management on changes (E25-11). A change that affects safety (`safety_impact`, set
 * from the risk questionnaire's safety question or by hand while a draft) needs at least one hazard
 * linked to it with the relation `safety_assessment` (contract C7, generic record links) before it is
 * submitted for approval, scheduled or started (workflow.ts). Its routes are served by the safety module
 * (safety/change-assessment.ts), so they follow that area. The hazard log belongs to the safety
 * module: everything here is skipped while that module is not loaded or its area is switched off.
 */

export const RELATION = 'safety_assessment';

/** Hazards linked to a change as its safety assessment (either direction), not deleted. */
export async function safetyAssessments(ctx: Pick<ModuleContext, 'db'>, changeId: string): Promise<number> {
  const r = await ctx.db.one<{ c: number }>(
    `select count(distinct h.id)::int as c from record_links l join hazards h on h.deleted_at is null
       and ((l.from_type = 'change' and l.from_id = $1 and l.to_type = 'hazard' and h.id = l.to_id)
         or (l.to_type = 'change' and l.to_id = $1 and l.from_type = 'hazard' and h.id = l.from_id))
     where l.relation = $2`, [changeId, RELATION]);
  return r?.c ?? 0;
}
