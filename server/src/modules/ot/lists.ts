import type { ModuleContext } from '../../core/module.ts';

/**
 * The zone and conduit security levels (E33-02). Generic words of our own, from accidental misuse up
 * to a well-resourced attacker; no standard's text. `meta.rank` orders the levels (higher is
 * stronger): a zone is below target when its achieved rank is lower than its target rank, or when it
 * has not been assessed. Administrators may rename the values under Administration > Lists.
 */
export async function seedOtLists(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('ot_security_level', [
    { value: 'level_1', label: 'Level 1 – casual or accidental', color: 'gray', sort: 10, meta: { rank: 1 } },
    { value: 'level_2', label: 'Level 2 – intentional, simple means', color: 'blue', sort: 20, meta: { rank: 2 } },
    { value: 'level_3', label: 'Level 3 – intentional, skilled and targeted', color: 'purple', sort: 30, meta: { rank: 3 } },
    { value: 'level_4', label: 'Level 4 – sophisticated, well-resourced attacker', color: 'red', sort: 40, meta: { rank: 4 } },
  ], { module: 'systems' });
}

/**
 * The value this module adds to a shared list (contract C8): actions raised on a zone or conduit are
 * filed under "OT security". Run from `register`, after every module's defaults, because the list
 * belongs to the risks module, which seeds after this one; added only when the list exists.
 */
export async function seedSharedValues(ctx: ModuleContext): Promise<void> {
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'ot', label: 'OT security', color: 'teal', sort: 152 }]);
  }
}

/** A security level's rank (1 to 4) from its list, or null when the value is empty or unknown. */
export async function rankOf(ctx: ModuleContext): Promise<(value: unknown) => number | null> {
  const values = await ctx.lookups.values('ot_security_level');
  const ranks = new Map(values.map((v, i) => [v.value, typeof v.meta?.rank === 'number' ? Number(v.meta.rank) : i + 1]));
  return (value) => (value === null || value === undefined || value === '' ? null : ranks.get(String(value)) ?? null);
}

/** Below target: achieved lower than the target, or not assessed at all. */
export function belowTarget(rank: (v: unknown) => number | null, target: unknown, achieved: unknown): boolean {
  const a = rank(achieved);
  if (a === null) return true;
  const t = rank(target);
  return t !== null && a < t;
}
