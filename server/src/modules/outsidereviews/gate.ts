// The confinement of outside reviewer accounts (E41-09).
//
// An outside reviewer's account reaches nothing but its own reviews and its own sign-in security:
// every other API route answers 404 for it, whatever roles the account holds and however the
// request is authenticated (session or token). The check runs on every request, after the session
// is read (core/auth.ts) and before any route, so lists, record pages, search, pickers, exports,
// imports, attachments, the assistant's routes, the mobile app's routes and every route added later
// are out of reach without anyone having to remember them. Public routes are left alone: anyone can
// call them signed out.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { routePattern } from '../../core/api/versioning.ts';
import { MFA_ENROLLMENT_ROUTES } from '../../core/auth.ts';
import type { Db } from '../../core/db.ts';
import { fail } from '../../core/errors.ts';

/** The grant listed in /api/auth/state for a reviewer account, so the web app shows the reviewer's own layout. */
export const REVIEWER_GRANT = 'outsidereviews.reviewer';

/** Route patterns a reviewer account may call (any method): its account security, preferences and reviews. */
export const REVIEWER_ROUTES: ReadonlySet<string> = new Set([
  ...MFA_ENROLLMENT_ROUTES,
  '/api/auth/sessions/:id', '/api/auth/sessions/end-others',
  '/api/auth/totp/disable', '/api/auth/totp/recovery-codes',
  '/api/auth/webauthn/credentials/:cid', '/api/auth/webauthn/confirm/options',
  '/api/me/preferences', '/api/me/preferences/:key',
  '/api/outside-review', '/api/outside-review/:grantId', '/api/outside-review/:grantId/files/:fileId',
]);

/**
 * Whether an account is an outside reviewer's. That never changes for an account (accounts are
 * marked when they are created by an invitation, and staff accounts can never be invited), so the
 * answer is kept in memory once known: one query per account per process.
 */
export function makeReviewerCheck(db: Db) {
  const known = new Map<string, boolean>();
  return async function isReviewer(userId: string): Promise<boolean> {
    const hit = known.get(userId);
    if (hit !== undefined) return hit;
    const yes = Boolean(await db.one('select 1 from outside_reviewers where user_id = $1', [userId]));
    if (known.size > 20_000) known.clear();
    known.set(userId, yes);
    return yes;
  };
}

/** Installs the confinement. Added after core's session hook, so `req.user` is known. */
export function installReviewerGate(app: FastifyInstance, isReviewer: (userId: string) => Promise<boolean>) {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (!req.user) return;
    if (!(await isReviewer(req.user.id))) return;
    // Whatever roles the account was given, it holds no permission on the routes it may reach.
    req.user = { ...req.user, roles: [], permissions: [], scoped: [] };
    if (req.routeOptions?.config?.public === true) return;
    if (REVIEWER_ROUTES.has(routePattern(req))) return;
    fail(404, 'not_found', 'Not found.');
  });
}
