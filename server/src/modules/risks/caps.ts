import type { ModuleContext } from '../../core/module.ts';

// Corrective action plans (E23, GP-02). Wave 10 step 0 stub, owned by the CAP agent: it will
// define the `cap` record type (contract C1), action verification (C2), the `cap_approval` and
// `action_extension` approval kinds, the CAP routes and the CAP metrics (C3).

/** Registers CAP record types and routes. Called from risks/index.ts `register`, after the action resource. */
export async function registerCaps(_ctx: ModuleContext): Promise<void> {
  // Nothing yet.
}

/** CAP lists and default settings. Called from risks/index.ts `seedDefaults`; must stay idempotent. */
export async function seedCapDefaults(_ctx: ModuleContext): Promise<void> {
  // Nothing yet.
}
