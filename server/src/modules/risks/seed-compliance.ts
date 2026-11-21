import type { ModuleContext, SeedOptions } from '../../core/module.ts';

// Sample obligation periods, regulatory changes, appetite, KRIs and parent risks (E30-09).
// Wave 10 step 0 stub, owned by the COMPLIANCE agent.

/**
 * Seeds the compliance samples. Called from seed.ts `seedRisksModule` after the obligations and
 * the CAP samples; returns a short summary for the seed log, or null when it added nothing.
 */
export async function seedCompliance(_ctx: ModuleContext, _opts: SeedOptions): Promise<string | null> {
  return null;
}
