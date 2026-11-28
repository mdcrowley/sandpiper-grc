import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerCertificates } from './certificates.ts';
import { registerClaims } from './claims.ts';
import { registerFigures } from './figures.ts';
import { ensureInsuranceLists } from './lists.ts';
import { registerPolicies } from './policies.ts';
import { registerInsuranceDaily } from './reminders.ts';
import { seedInsurance } from './seed.ts';

/**
 * Insurance (wave 26): the organization's insurance program.
 *  - Policies (IPL-): line of coverage, carrier or risk pool (a vendor, or by name), policy number, term,
 *    premium, limits, deductible and retention, sublimits, named insureds, the assets, vehicles, sites and
 *    systems covered, and the conditions and warranties the organization must keep meeting, each tracked
 *    by a control where there is one. Renewal: a renewal status and application due date with reminders,
 *    and Renew, which starts the next term; when the new term is in force the old one is closed.
 *  - Certificates of insurance (COI-) from vendors and contractors, checked against the insurance each
 *    contract requires (minimum limits per line, additional insured, waiver of subrogation); shortfalls,
 *    missing and expired certificates are flagged; expiry reminders.
 *  - Claims (ICL-), restricted one by one, with reserves, payments and recoveries.
 * Figures, a renewal calendar, metrics and My work entries. Permission module `insurance`; feature area
 * `insurance` (on by default; only administrators and the Risk and insurance coordinator role hold its permissions).
 */

async function register(ctx: ModuleContext) {
  registerPolicies(ctx);
  const checks = registerCertificates(ctx);
  registerClaims(ctx);
  registerFigures(ctx);
  await registerInsuranceDaily(ctx, checks);
}

const mod: ModuleDef = {
  key: 'insurance',
  seedDefaults: ensureInsuranceLists,
  register,
  seed: seedInsurance,
};
export default mod;
