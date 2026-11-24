import { addStateGrant } from '../../core/auth.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { makeAccess } from './access.ts';
import { installReviewerGate, makeReviewerCheck, REVIEWER_GRANT } from './gate.ts';
import { registerRoutes } from './routes.ts';

/**
 * Outside reviewers (E41-09): a workspace for people outside the organization (an external
 * auditor, a funder's reviewer), each invited by email to one audit engagement or funder compliance
 * review until an end date. Their account is an ordinary one (the same sign-in, password, lockout,
 * session and second-factor rules) with no roles, and the server confines it to its own reviews and
 * its own sign-in security (gate.ts): nothing else in the application answers it. What they see of
 * a review (subjects.ts): the record, its requests, the evidence files and its findings.
 *
 * Not a feature area of its own: each kind follows its record type's area, so audit invitations
 * are hidden and inert while Audits and inspections is off, and review invitations while Funding
 * is. The confinement itself never switches off.
 */

async function register(ctx: ModuleContext) {
  const isReviewer = makeReviewerCheck(ctx.db);
  installReviewerGate(ctx.app, isReviewer);
  // The web app shows a reviewer its own layout (no shell, no menus): App.tsx reads this grant.
  addStateGrant(ctx.app, async (user) => ((await isReviewer(user.id)) ? [REVIEWER_GRANT] : []));
  const access = makeAccess(ctx);
  registerRoutes(ctx, access, isReviewer);
  // Accounts whose last invitation ended are disabled and signed out (also done at once on revoking).
  await scheduleWork(ctx, 'outsidereviews.expire', () => access.sweep(), { every: 6 * 3_600_000, firstRunInMs: 90_000 });
}

const mod: ModuleDef = { key: 'outsidereviews', register };
export default mod;
