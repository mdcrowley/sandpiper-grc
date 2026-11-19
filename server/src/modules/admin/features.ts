import { AREAS, dependencyProblems, dependents, effectiveFeatures } from '../../core/features.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { adminRoute, body, invalid, sensitive } from './shared.ts';

/**
 * Administration > Features (E14-28): one switch per optional area of the application. What each
 * area covers, and how a switched-off area is hidden everywhere, is in core/features.ts.
 */

/** Validation of the `features` setting: known areas, each on or off. */
export function checkFeatures(v: unknown): { value: unknown } | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Feature switches must be on or off.';
  for (const [k, on] of Object.entries(v)) {
    if (!AREAS.some((a) => a.key === k)) return `Unknown feature: ${k}.`;
    if (typeof on !== 'boolean') return 'Feature switches must be on or off.';
  }
  return { value: v };
}

/** The first inconsistency in a whole set of switches (an area on while one it needs is off), or null. */
export function featureChangeProblem(on: Record<string, boolean>): string | null {
  return Object.values(dependencyProblems(on))[0] ?? null;
}

const label = (key: string) => AREAS.find((a) => a.key === key)?.label ?? key;
const list = (keys: string[]) => keys.map(label).join(', ');

export function registerFeatures(ctx: ModuleContext) {
  const read = async () => {
    const on = effectiveFeatures(await ctx.settings.get('features', null));
    return {
      areas: AREAS.map((a) => ({
        key: a.key, label: a.label, description: a.description, on: on[a.key], defaultOn: a.defaultOn,
        requires: a.requires ?? [], requiredBy: dependents(a.key),
      })),
      // AI assistant access keeps its own switch (Administration > AI assistant access).
      assistant: { enabled: (await ctx.settings.get('mcp.enabled', false)) === true },
    };
  };

  adminRoute(ctx, 'GET', '/api/admin/features', read);
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/features', tag: 'Settings', permission: 'admin.administer',
    summary: 'The optional parts of the application and whether each is on',
    response: '{ areas: [{ key, label, description, on, defaultOn, requires: [key], requiredBy: [key] }], assistant: { enabled } }',
  });

  adminRoute(ctx, 'PATCH', '/api/admin/features', async (req) => {
    const b = body(req);
    const wanted = (b.features ?? b) as Row;
    const checked = checkFeatures(wanted);
    if (typeof checked === 'string') invalid({ features: checked });
    const before = effectiveFeatures(await ctx.settings.get('features', null));
    const next = { ...before, ...(wanted as Record<string, boolean>) };
    const problems = dependencyProblems(next);
    if (Object.keys(problems).length) invalid(problems);
    const off = AREAS.filter((a) => before[a.key] && !next[a.key]).map((a) => a.key);
    const on = AREAS.filter((a) => !before[a.key] && next[a.key]).map((a) => a.key);
    if (off.length || on.length) {
      await sensitive(ctx, req, 'switching parts of the application on or off');
      // ctx.settings.set records the setting change (before and after) and applies it at once.
      await ctx.settings.set('features', next, req);
      await ctx.audit(req, {
        action: 'features.change', recordType: 'setting', recordId: 'features',
        summary: [off.length ? `Switched off: ${list(off)}` : '', on.length ? `Switched on: ${list(on)}` : ''].filter(Boolean).join('. '),
        before: { off: AREAS.filter((a) => !before[a.key]).map((a) => a.key) },
        after: { off: AREAS.filter((a) => !next[a.key]).map((a) => a.key) },
      });
    }
    return { ...(await read()), switchedOff: off, switchedOn: on };
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/admin/features', tag: 'Settings', permission: 'admin.administer',
    summary: 'Switch parts of the application on or off',
    description: 'Needs a recent password confirmation (403 `reauth_required` otherwise). Refused (400) when an area would be on while one it needs is off. Data is kept; switching an area back on restores it. Session only in practice: a token cannot pass the confirmation.',
    body: '{ features: { <area>: boolean } }',
    response: '{ areas, assistant, switchedOff: [key], switchedOn: [key] }',
  });
}
