// Sign-in policy hooks. Core sign-in (core/auth.ts) asks these before and after it creates a
// session, so that rules kept elsewhere (single sign-on: "local passwords off", a person limited
// to chosen providers, the break-glass alarm) apply to every way of signing in.
// With nothing registered every sign-in is allowed and nothing extra happens.
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface SignInAttempt {
  userId: string;
  /** `local` for a password (and passkey) sign-in, otherwise the provider's key. */
  method: string;
}

/** What a provider sign-in adds about the session (E02-22, E02-23). */
export interface ProviderSessionFacts {
  /** The provider showed a multi-factor sign-in that this provider is trusted for. */
  mfa: boolean;
  /** The provider's session id, for back-channel sign-out. */
  sid: string | null;
  /** The ID token, kept encrypted only when signing out at the provider is on. */
  idToken: string | null;
}

export interface SignInPolicy {
  /** A reason to refuse (recorded in the audit log; the person sees the usual generic message), or null. */
  check?(attempt: SignInAttempt): Promise<string | null>;
  /** After the session exists: record how it was made, raise alarms. `sessionToken` is the raw cookie value. */
  after?(req: FastifyRequest, attempt: SignInAttempt & { sessionToken: string; provider?: ProviderSessionFacts }): Promise<void>;
  /** True when this session's own sign-in satisfied the second factor (a trusted provider's multi-factor sign-in). */
  sessionSecondFactor?(sessionHash: string): Promise<boolean>;
  /** Where to send the browser after signing out here (the provider's sign-out page), or null. Called before the session is deleted. */
  signOutRedirect?(req: FastifyRequest, sessionHash: string): Promise<string | null>;
}

const policies = new WeakMap<FastifyInstance, SignInPolicy[]>();

export function addSignInPolicy(app: FastifyInstance, policy: SignInPolicy): void {
  const list = policies.get(app) ?? [];
  list.push(policy);
  policies.set(app, list);
}

/** The first refusal reason from any policy, or null when the sign-in may go ahead. */
export async function checkSignIn(app: FastifyInstance, attempt: SignInAttempt): Promise<string | null> {
  for (const p of policies.get(app) ?? []) {
    const reason = await p.check?.(attempt);
    if (reason) return reason;
  }
  return null;
}

export async function afterSignIn(
  app: FastifyInstance, req: FastifyRequest, attempt: SignInAttempt & { sessionToken: string; provider?: ProviderSessionFacts },
): Promise<void> {
  for (const p of policies.get(app) ?? []) await p.after?.(req, attempt);
}

/** True when any policy says the session's sign-in already proved a second factor. */
export async function sessionSecondFactor(app: FastifyInstance, sessionHash: string | null | undefined): Promise<boolean> {
  if (!sessionHash) return false;
  for (const p of policies.get(app) ?? []) if (await p.sessionSecondFactor?.(sessionHash)) return true;
  return false;
}

/** The first sign-out redirect any policy offers for this session, or null. */
export async function signOutRedirect(app: FastifyInstance, req: FastifyRequest, sessionHash: string): Promise<string | null> {
  for (const p of policies.get(app) ?? []) {
    const url = await p.signOutRedirect?.(req, sessionHash);
    if (url) return url;
  }
  return null;
}
