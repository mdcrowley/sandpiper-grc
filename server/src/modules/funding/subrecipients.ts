import type { ModuleContext, SeedOptions } from '../../core/module.ts';

// Sub-recipients and their monitoring (E35-07, E27-11). Wave 11 step 0 stub, owned by the vendor
// lifecycle work: it will define the `subrecipient` record type, the monitoring routes and the
// `funding.subrecipients` reminders (tables in `funding/migrations/002_subrecipients_and_clause_engine.sql`).

/** Registers the sub-recipient record type and routes. Called from funding/index.ts `register`. */
export async function registerSubrecipients(_ctx: ModuleContext): Promise<void> {
  // Nothing yet.
}

/**
 * Seeds sample sub-recipients. Called from seed.ts `seedFunding` after the sample awards; returns a
 * short summary for the seed log, or null when it added nothing worth reporting.
 */
export async function seedSubrecipients(_ctx: ModuleContext, _opts: SeedOptions): Promise<string | null> {
  return null;
}
