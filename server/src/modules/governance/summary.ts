import type { ModuleContext } from '../../core/module.ts';

// Committee and meeting figures for the assistant tools (wave 11 contract C5). Step 0 stub, owned by
// the follow-ups work: it will add `GET /api/governance/summary` (meetings upcoming and held, minutes
// waiting, decisions by outcome; figures only, the same for everyone).

/** Registers the governance summary route. Called from governance/index.ts `register`. */
export function registerGovernanceSummary(_ctx: ModuleContext): void {
  // Nothing yet.
}
