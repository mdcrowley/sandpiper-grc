import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

// E45-01: risks are restricted one by one (the `restricted` flag), not as a whole type. Seeing a risk
// needs `risks.view`; seeing a restricted one (cybersecurity risks by default) needs `security.view`
// as well. Figures (counts, the heat map, the report's levels) count every risk for everyone; where
// a figure lists risks, a restricted risk the caller may not see is shown as "Restricted risk", with
// its rating but without its reference, title or owner (see "Figures" in docs/security.md).

export const MASKED_TITLE = 'Restricted risk';

/** Whether this person sees restricted risks. */
export const seesRestricted = (ctx: ModuleContext, user: SessionUser | null | undefined) => !user || ctx.can(user, 'security.view');

/**
 * A function that masks one row of a figure for this person: a restricted risk they may not see keeps
 * its id (so counts and cells still add up) and its ratings, and loses its words and people.
 * The row must carry `restricted`.
 */
export function riskMasker(ctx: ModuleContext, user: SessionUser | null | undefined) {
  const sees = seesRestricted(ctx, user);
  return <T extends Row>(r: T): T => {
    if (sees || !r.restricted) return { ...r, restricted: Boolean(r.restricted), masked: false };
    return { ...r, ref: null, title: MASKED_TITLE, owner_name: null, owner_id: null, restricted: true, masked: true };
  };
}
