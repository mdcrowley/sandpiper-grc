import type { FastifyRequest } from 'fastify';
import type { WebAuthnDeps } from './routes.ts';

/**
 * E02-17: how the second factor is enforced on a NEW installation, chosen in the setup wizard.
 * Called by POST /api/setup (core/auth.ts) after the first administrator is created, and only
 * then, so an existing installation keeps whatever it has.
 *
 * `secondFactor` in the setup body:
 *   `required` - sets `auth.mfa_enforcement` to `required`. The roles that carry "requires second
 *                factor" (Administrator and Security lead by default) must enroll before they can work;
 *                the first administrator is taken straight to enrollment.
 *   `notice`   - leaves the setting at its fallback, `notice` (a reminder only).
 * The wizard sends `required` unless the person chooses otherwise. A setup call that names neither
 * (a script) gets `required` too (E02-19): only an explicit `notice` leaves it as a reminder.
 */
export async function applySetupSecondFactor(deps: WebAuthnDeps, req: FastifyRequest, choice: unknown): Promise<'required' | 'notice'> {
  if (choice === 'notice') return 'notice';
  await deps.settings.set('auth.mfa_enforcement', 'required', req);
  await deps.audit(req, {
    action: 'setup.second_factor', recordType: 'setting', recordId: 'auth.mfa_enforcement',
    summary: 'Second factor required for administrators and security leads from the start (chosen in the setup wizard)',
  });
  return 'required';
}
