import type { ModuleContext } from '../../core/module.ts';

// Enterprise risk: appetite, key risk indicators and parent risks (E30, GP-18). Wave 10 step 0
// stub, owned by the COMPLIANCE agent.

/** Registers appetite, KRI and roll-up routes. Called from risks/index.ts `register`, after the obligations. */
export async function registerEnterpriseRisk(_ctx: ModuleContext): Promise<void> {
  // Nothing yet.
}

/** Enterprise-risk lists and default settings. Called from risks/index.ts `seedDefaults`; must stay idempotent. */
export async function seedEnterpriseDefaults(_ctx: ModuleContext): Promise<void> {
  // Nothing yet.
}
