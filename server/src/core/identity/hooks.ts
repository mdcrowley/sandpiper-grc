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

export interface SignInPolicy {
  /** A reason to refuse (recorded in the audit log; the person sees the usual generic message), or null. */
  check?(attempt: SignInAttempt): Promise<string | null>;
  /** After the session exists: record how it was made, raise alarms. `sessionToken` is the raw cookie value. */
  after?(req: FastifyRequest, attempt: SignInAttempt & { sessionToken: string }): Promise<void>;
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

export async function afterSignIn(app: FastifyInstance, req: FastifyRequest, attempt: SignInAttempt & { sessionToken: string }): Promise<void> {
  for (const p of policies.get(app) ?? []) await p.after?.(req, attempt);
}
