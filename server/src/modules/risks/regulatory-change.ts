import type { ModuleContext } from '../../core/module.ts';

// Regulatory change intake (E30, GP-08). Wave 10 step 0 stub, owned by the COMPLIANCE agent:
// it will define the `regulatory_change` record type and its routes.

/** Registers the regulatory-change record type and routes. Called from risks/index.ts `register`, after the obligations. */
export async function registerRegulatoryChanges(_ctx: ModuleContext): Promise<void> {
  // Nothing yet.
}
