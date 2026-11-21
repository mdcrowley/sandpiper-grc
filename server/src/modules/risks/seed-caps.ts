import type { ModuleContext, SeedOptions } from '../../core/module.ts';

// Sample corrective action plans (E23-10). Wave 10 step 0 stub, owned by the CAP agent.

/**
 * Seeds sample CAPs. Called from seed.ts `seedRisksModule` after the sample risks; returns a
 * short summary for the seed log, or null when it added nothing worth reporting.
 */
export async function seedCaps(_ctx: ModuleContext, _opts: SeedOptions): Promise<string | null> {
  return null;
}
