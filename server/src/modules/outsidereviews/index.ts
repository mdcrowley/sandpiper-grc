import { addStateGrant, requireSecondFactorWhen } from '../../core/auth.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { confineReviewerAccounts } from '../../core/reviewers.ts';
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
 *
 * Core keeps the rest fail-closed (core/reviewers.ts): a reviewer account never holds a role or a
 * permission anywhere a person is loaded, roles cannot be given to it, and while this module is not
 * loaded such an account cannot sign in at all.
 */

/** Setting: an outside reviewer must set up a second factor at their first sign-in (default on). */
export const REQUIRE_2FA = 'outsidereviews.require_2fa';

async function register(ctx: ModuleContext) {
  const isReviewer = makeReviewerCheck(ctx.db);
  installReviewerGate(ctx.app, isReviewer);
  confineReviewerAccounts(ctx.db);
  // A reviewer works from outside the organization's network: a second factor before anything else.
  requireSecondFactorWhen(ctx.db, async (userId) =>
    (await isReviewer(userId)) && (await ctx.settings.get<boolean>(REQUIRE_2FA, true)) !== false);
  // The web app shows a reviewer its own layout (no shell, no menus): App.tsx reads this grant.
  addStateGrant(ctx.app, async (user) => ((await isReviewer(user.id)) ? [REVIEWER_GRANT] : []));
  const access = makeAccess(ctx);
  registerRoutes(ctx, access, isReviewer);
  // Accounts whose last invitation ended are disabled and signed out (also done at once on revoking).
  // Roles are refused for these accounts everywhere they can be given; the sweep also takes off any
  // that got there another way.
  await scheduleWork(ctx, 'outsidereviews.expire', () => access.sweep(), { every: 6 * 3_600_000, firstRunInMs: 90_000 });
}

const mod: ModuleDef = { key: 'outsidereviews', register };
export default mod;
