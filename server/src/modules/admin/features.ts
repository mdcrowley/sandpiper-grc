import {
  AREAS, dependencyProblems, dependents, effectiveFeatures, effectiveOptions, invalidateFeatures, OPTION_NAME_MAX, OPTIONS,
  type OptionState,
} from '../../core/features.ts';
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

/**
 * Checks a change to the options within areas (E18-28): `{ <option>: { on?: boolean, name?: string } }`.
 * Returns the problems by option key, or the next stored value.
 */
export function checkOptions(wanted: unknown, current: Record<string, OptionState>): { errors: Record<string, string> } | { next: Record<string, OptionState> } {
  if (!wanted || typeof wanted !== 'object' || Array.isArray(wanted)) return { errors: { options: 'Options must be a list of option settings.' } };
  const errors: Record<string, string> = {};
  const next: Record<string, OptionState> = { ...current };
  for (const [key, v] of Object.entries(wanted as Row)) {
    const o = OPTIONS.find((x) => x.key === key);
    if (!o) { errors[`options.${key}`] = `Unknown option: ${key}.`; continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors[`options.${key}`] = 'Give the option as { on, name }.'; continue; }
    const { on, name } = v as Row;
    if (on !== undefined && typeof on !== 'boolean') { errors[`options.${key}`] = 'An option is on or off.'; continue; }
    let n = next[key].name;
    if (name !== undefined) {
      if (!o.name) { errors[`options.${key}`] = 'This option has no name to change.'; continue; }
      // An empty name goes back to the default.
      const s = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : null;
      if (s === null || s.length > OPTION_NAME_MAX || /[\p{Cc}<>]/u.test(s)) {
        errors[`options.${key}`] = `Enter a name of up to ${OPTION_NAME_MAX} characters, without < or >.`;
        continue;
      }
      n = s || o.name.default;
    }
    next[key] = { on: on ?? next[key].on, name: n };
  }
  return Object.keys(errors).length ? { errors } : { next };
}

const label = (key: string) => AREAS.find((a) => a.key === key)?.label ?? key;
const list = (keys: string[]) => keys.map(label).join(', ');

export function registerFeatures(ctx: ModuleContext) {
  const storedOptions = async () => effectiveOptions(await ctx.settings.get('feature_options', null));
  const readOptions = async () => {
    const st = await storedOptions();
    return OPTIONS.map((o) => ({
      key: o.key, area: o.area, group: o.area ? AREAS.find((a) => a.key === o.area)?.label ?? o.area : o.group ?? '',
      label: o.label, description: o.description, on: st[o.key].on, defaultOn: o.defaultOn,
      name: o.name ? st[o.key].name : null, defaultName: o.name?.default ?? null, nameHint: o.name?.hint ?? null,
    }));
  };
  const read = async () => {
    const on = effectiveFeatures(await ctx.settings.get('features', null));
    return {
      areas: AREAS.map((a) => ({
        key: a.key, label: a.label, description: a.description, on: on[a.key], defaultOn: a.defaultOn,
        requires: a.requires ?? [], requiredBy: dependents(a.key),
      })),
      // Options within areas (E18-28); `area` null for a part that is always on.
      options: await readOptions(),
      // AI assistant access keeps its own switch (Administration > AI assistant access).
      assistant: { enabled: (await ctx.settings.get('mcp.enabled', false)) === true },
    };
  };

  adminRoute(ctx, 'GET', '/api/admin/features', read);
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/features', tag: 'Settings', permission: 'admin.administer',
    summary: 'The optional parts of the application and whether each is on',
    response: '{ areas: [{ key, label, description, on, defaultOn, requires: [key], requiredBy: [key] }], options: [{ key, area, group, label, description, on, defaultOn, name, defaultName, nameHint }], assistant: { enabled } }',
  });

  adminRoute(ctx, 'PATCH', '/api/admin/features', async (req) => {
    const b = body(req);
    let optionsChanged: string[] = [];
    if (b.options !== undefined) {
      const before = await storedOptions();
      const checked = checkOptions(b.options, before);
      if ('errors' in checked) invalid(checked.errors);
      const next = (checked as { next: Record<string, OptionState> }).next;
      optionsChanged = OPTIONS.filter((o) => before[o.key].on !== next[o.key].on || before[o.key].name !== next[o.key].name).map((o) => o.key);
      if (optionsChanged.length) {
        await sensitive(ctx, req, 'changing options of the application');
        await ctx.settings.set('feature_options', Object.fromEntries(OPTIONS.map((o) => [o.key, next[o.key]])), req);
        invalidateFeatures(ctx.db); // apply at once in this process
        const describe = (k: string) => {
          const o = OPTIONS.find((x) => x.key === k)!;
          const parts = [];
          if (before[k].on !== next[k].on) parts.push(next[k].on ? 'switched on' : 'switched off');
          if (before[k].name !== next[k].name) parts.push(`renamed "${next[k].name}"`);
          return `${o.label}: ${parts.join(', ')}`;
        };
        await ctx.audit(req, {
          action: 'features.option_change', recordType: 'setting', recordId: 'feature_options',
          summary: optionsChanged.map(describe).join('. '),
          before: Object.fromEntries(optionsChanged.map((k) => [k, before[k]])),
          after: Object.fromEntries(optionsChanged.map((k) => [k, next[k]])),
        });
      }
      if (b.features === undefined) return { ...(await read()), switchedOff: [], switchedOn: [], optionsChanged };
    }
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
    return { ...(await read()), switchedOff: off, switchedOn: on, optionsChanged };
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/admin/features', tag: 'Settings', permission: 'admin.administer',
    summary: 'Switch parts of the application, or options within them, on or off',
    description: 'Needs a recent password confirmation (403 `reauth_required` otherwise). Refused (400) when an area would be on while one it needs is off. Data is kept; switching an area back on restores it. `options` switches an option within an area and may rename it (an empty name restores the default); the fields of an option that is off disappear from forms, lists, exports, imports, reports, the API description and MCP tools, and its rule stops applying. Session only in practice: a token cannot pass the confirmation.',
    body: '{ features?: { <area>: boolean }, options?: { <option>: { on?: boolean, name?: string } } }',
    response: '{ areas, options, assistant, switchedOff: [key], switchedOn: [key], optionsChanged: [key] }',
  });
}
