import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from './db.ts';
import { fail } from './errors.ts';
import type { ResourceDef, ResourceRegistry, Row } from './module.ts';

/**
 * Feature switches (E14-28): optional parts of the application ("areas") that an administrator
 * switches on or off under Administration > Features. The `features` setting holds one boolean per
 * area; an area that is missing from it takes its default (on, except the self-service portal), so
 * an upgrade never makes something disappear.
 *
 * A switched-off area behaves as if its module were not installed, for everyone, administrators
 * and tokens included. Its data is kept; switching it back on restores everything. This file is the
 * one place that says what each area covers:
 *  - `permissions`: permission modules that nobody holds while the area is off (`can()` answers
 *    false, even for `*`), so menus, pages, record links, dashboards and MCP tools disappear;
 *  - `types`: record types hidden besides those whose permission module is off (security incidents
 *    use the shared `security` module, which also governs restricted records, so they are listed);
 *  - `modules`: server module folders whose routes answer 404 "switched off";
 *  - `jobs`: prefixes of the background job types that are skipped while it is off.
 * Inventory, the action tracker, notifications, attachments, administration, the Overview and Help
 * are not areas: they are always on.
 */
export interface Area {
  key: string;
  label: string;
  description: string;
  permissions: string[];
  types?: string[];
  modules: string[];
  jobs: string[];
  /** Areas that must be on for this one to be on. */
  requires?: string[];
  /** On when an administrator has never set it. */
  defaultOn: boolean;
}

export const AREAS: Area[] = [
  {
    key: 'tickets', label: 'Service desk', defaultOn: true,
    description: 'Tickets, problems, the knowledge base and the service catalog.',
    permissions: ['tickets', 'knowledge'], modules: ['tickets'], jobs: ['tickets.'],
  },
  {
    key: 'portal', label: 'Self-service portal', defaultOn: false, requires: ['tickets'],
    description: 'Simpler pages where anyone in the organization submits and tracks their own requests. Switch it on together with the Requester role.',
    // The portal module answers "switched off" (404 `portal_off`) itself and keeps its settings page
    // working while off, as it always has; its permissions stay so a Requester role can be prepared first.
    permissions: [], modules: [], jobs: ['portal.'],
  },
  {
    key: 'changes', label: 'Change enablement', defaultOn: true,
    description: 'Change requests, approvals, the change calendar and post-implementation reviews.',
    permissions: ['changes'], modules: ['changes'], jobs: ['changes.'],
  },
  {
    key: 'vendors', label: 'Vendors and contracts', defaultOn: true,
    description: 'Vendors, contracts, renewals and vendor evidence.',
    permissions: ['vendors', 'contracts'], modules: ['vendors'], jobs: ['vendors.'],
  },
  {
    key: 'frameworks', label: 'Framework outcomes', defaultOn: true,
    description: 'Cybersecurity framework outcomes, assessments and target profiles.',
    permissions: ['frameworks'], modules: ['frameworks'], jobs: ['frameworks.'],
  },
  {
    key: 'risks', label: 'Risks and obligations', defaultOn: true,
    description: 'The risk register, risk reviews and acceptances, and compliance obligations. The action tracker stays on.',
    // The risks folder also holds the action tracker, which stays on: its routes are not switched off wholesale.
    permissions: ['risks', 'obligations'], modules: [], jobs: ['risks.', 'obligations.'],
  },
  {
    key: 'secincidents', label: 'Security incidents', defaultOn: true,
    description: 'Security incidents, their notification clocks and notification tasks.',
    permissions: [], types: ['security_incident', 'notification_task'], modules: ['secincidents'], jobs: ['secincidents.'],
  },
  {
    key: 'policies', label: 'Policies and exceptions', defaultOn: true,
    description: 'Policies, attestations and policy exceptions.',
    permissions: ['policies', 'exceptions'], modules: ['policies'], jobs: ['policies.'],
  },
  {
    key: 'training', label: 'Training and exercises', defaultOn: true,
    description: 'Training courses, assignments and exercises.',
    permissions: ['training', 'exercises'], modules: ['training'], jobs: ['training.'],
  },
  {
    key: 'vulnerabilities', label: 'Vulnerabilities', defaultOn: true,
    description: 'Vulnerability records, scanner imports and remediation deadlines.',
    permissions: ['vulnerabilities'], modules: ['vulnerabilities'], jobs: ['vulnerabilities.'],
  },
  {
    key: 'projects', label: 'Projects', defaultOn: true,
    description: 'Projects, the portfolio and project reminders.',
    permissions: ['projects'], modules: ['projects'], jobs: ['projects.'],
  },
  {
    key: 'reports', label: 'Dashboards and reports', defaultOn: true,
    description: 'Saved dashboards, the report catalog, scheduled reports and report packs. The Overview page and its figures stay.',
    // `dashboards.view` also opens the Overview's figures, which stay: saved dashboards are hidden by type.
    permissions: ['reports'], types: ['dashboard'], modules: ['reports'], jobs: ['reports.'],
  },
  {
    key: 'fleet', label: 'Fleet and services', defaultOn: true,
    description: 'Vehicles, the services (routes and lines) they run, and which systems each depends on.',
    permissions: ['fleet'], modules: ['fleet'], jobs: ['fleet.'],
  },
  {
    key: 'safety', label: 'Safety management', defaultOn: true,
    description: 'Hazards, safety events, safety performance indicators and safety reporting from the portal.',
    permissions: ['safety'], modules: ['safety'], jobs: ['safety.'],
  },
];

export const AREA_KEYS = AREAS.map((a) => a.key);

/** The defaults: every area on except the portal. */
export const FEATURE_DEFAULTS: Record<string, boolean> = Object.fromEntries(AREAS.map((a) => [a.key, a.defaultOn]));

/** The stored setting merged over the defaults (unknown keys dropped). */
export function effectiveFeatures(stored: unknown): Record<string, boolean> {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Row : {};
  return Object.fromEntries(AREAS.map((a) => [a.key, typeof s[a.key] === 'boolean' ? s[a.key] as boolean : a.defaultOn]));
}

/** A message for each area that is on while an area it needs is off; empty when consistent. */
export function dependencyProblems(on: Record<string, boolean>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of AREAS) {
    if (!on[a.key]) continue;
    const missing = (a.requires ?? []).filter((r) => !on[r]);
    if (missing.length) {
      const names = missing.map((m) => AREAS.find((x) => x.key === m)!.label.toLowerCase()).join(' and ');
      out[a.key] = `${a.label} needs ${names}. Switch ${missing.length > 1 ? 'them' : 'it'} on first, or switch ${a.label.toLowerCase()} off too.`;
    }
  }
  return out;
}

/** Areas that need `key` (directly or not). */
export function dependents(key: string): string[] {
  const out = new Set<string>();
  const walk = (k: string) => {
    for (const a of AREAS) if (a.requires?.includes(k) && !out.has(a.key)) { out.add(a.key); walk(a.key); }
  };
  walk(key);
  return [...out];
}

export interface FeatureState {
  on: Record<string, boolean>;
  /** Switched-off areas. */
  off: Area[];
  /** Permission modules nobody holds. */
  offPermissions: Set<string>;
  /** Record types hidden besides those of an off permission module. */
  offTypes: Set<string>;
  /** Server module folders whose routes answer 404. */
  offModules: Set<string>;
  offJobs: string[];
}

export function stateFrom(on: Record<string, boolean>): FeatureState {
  const off = AREAS.filter((a) => !on[a.key]);
  return {
    on, off,
    offPermissions: new Set(off.flatMap((a) => a.permissions)),
    offTypes: new Set(off.flatMap((a) => a.types ?? [])),
    offModules: new Set(off.flatMap((a) => a.modules)),
    offJobs: off.flatMap((a) => a.jobs),
  };
}

const ALL_ON = stateFrom(effectiveFeatures({}));

/** How long one process trusts what it read; a change made in this process applies at once. */
const TTL_MS = 5_000;
const cache = new WeakMap<object, { state: FeatureState; at: number; loading?: Promise<FeatureState> }>();

/** The current switches for this database (cached for a few seconds). */
export async function featureState(db: Queryable): Promise<FeatureState> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.state;
  if (hit?.loading) return hit.loading;
  const loading = (async () => {
    let stored: unknown = null;
    try {
      stored = (await db.one<{ value: unknown }>(`select value from settings where key = 'features'`))?.value ?? null;
    } catch { /* settings table not created yet (very first start) */ }
    const state = stateFrom(effectiveFeatures(stored));
    cache.set(db, { state, at: Date.now() });
    return state;
  })();
  cache.set(db, { state: hit?.state ?? ALL_ON, at: hit?.at ?? 0, loading });
  return loading;
}

/** The last state read for this database, without waiting (everything on before the first read). */
export function knownFeatureState(db: object): FeatureState {
  return cache.get(db)?.state ?? ALL_ON;
}

/** Forget the cached state (called when the `features` setting is written). */
export function invalidateFeatures(db: object): void {
  cache.delete(db);
}

/** Whether a permission belongs to a switched-off area. */
export const permissionOff = (state: FeatureState, perm: string) => state.offPermissions.has(perm.split('.')[0]);

/** Whether a record type belongs to a switched-off area. */
export const typeOff = (state: FeatureState, def: ResourceDef) => state.offPermissions.has(def.module) || state.offTypes.has(def.type);

/** Whether background work of this job type belongs to a switched-off area. */
export const jobOff = (state: FeatureState, type: string) => state.offJobs.some((p) => type.startsWith(p));

export const SWITCHED_OFF = 'This part of the application is switched off. An administrator can switch it on under Administration > Features.';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The module folder that registered the route (set by the feature gate). */
    grcModule?: string;
  }
}

/**
 * The server side of the switches, installed by app.ts:
 *  - remembers which module registered each route (`during(key, fn)` around a module's register());
 *  - answers 404 `switched_off` for a route of a switched-off module, for a generated route of a
 *    switched-off record type, and for a core route asked about such a type (`:type`, `type`,
 *    `record_type`, `from_type`, `to_type`);
 *  - once the application is ready, hides switched-off record types from the resource registry
 *    (`get` answers undefined and `all` leaves them out), so every list of types (metadata, search,
 *    OpenAPI, report catalog, imports, webhooks, custom fields, MCP) and every module guard
 *    `ctx.resources.get(type)` treat them as not installed. Core's own engine is unaffected.
 */
export function makeFeatureGate(app: FastifyInstance, db: Queryable) {
  let current: string | undefined;
  let registry: ResourceRegistry | null = null;
  let baseGet: ResourceRegistry['get'] = () => undefined;
  let baseAll: ResourceRegistry['all'] = () => [];
  let active = false;
  const routeModules = new Map<string, string>();

  app.addHook('onRoute', (r) => {
    if (!current || !r.url?.startsWith('/api/')) return;
    routeModules.set(r.url, current);
    r.config = { ...(r.config ?? {}), grcModule: current } as typeof r.config;
  });

  const known = () => knownFeatureState(db);
  const isTypeOff = (type: unknown) => {
    if (typeof type !== 'string') return false;
    const def = baseGet(type);
    return Boolean(def && typeOff(known(), def));
  };

  /** Whether a route is switched off (also used to cut the OpenAPI document down). */
  function routeOff(url: string, module?: string): boolean {
    const s = known();
    if (!s.off.length) return false;
    if (module && s.offModules.has(module)) return true;
    return baseAll().some((d) => typeOff(s, d) && (url === d.path || url.startsWith(`${d.path}/`)));
  }

  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (!req.url.startsWith('/api/')) return;
    const s = await featureState(db);
    if (!s.off.length) return;
    const module = req.routeOptions?.config?.grcModule;
    const url = req.routeOptions?.url ?? '';
    if (routeOff(url, module)) fail(404, 'switched_off', SWITCHED_OFF);
    if (module) return; // a module's own route reads its parameters its own way
    const p = (req.params ?? {}) as Row;
    const q = (req.query ?? {}) as Row;
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Row;
    for (const t of [p.type, q.type, q.record_type, b.record_type, b.from_type, b.to_type]) {
      if (isTypeOff(t)) fail(404, 'switched_off', SWITCHED_OFF);
    }
  });

  return {
    /** Runs a module's register() with its routes marked as belonging to it. */
    async during<T>(module: string, fn: () => Promise<T> | T): Promise<T> {
      current = module;
      try { return await fn(); } finally { current = undefined; }
    },
    /** Hides switched-off record types from the registry, from the moment the application is ready. */
    attach(reg: ResourceRegistry) {
      registry = reg;
      baseGet = reg.get.bind(reg);
      baseAll = reg.all.bind(reg);
      reg.get = (type) => {
        const def = baseGet(type);
        return def && active && typeOff(known(), def) ? undefined : def;
      };
      reg.all = () => (active ? baseAll().filter((d) => !typeOff(known(), d)) : baseAll());
    },
    /** Start hiding (after every module has registered, so registration sees every type). */
    activate() { active = Boolean(registry); },
    routeOff,
    /** The module folder that registered a route url, if a module did. */
    moduleOf: (url: string) => routeModules.get(url),
    state: () => featureState(db),
    known,
  };
}

export type FeatureGate = ReturnType<typeof makeFeatureGate>;
