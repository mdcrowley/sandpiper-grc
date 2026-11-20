import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { ResourceRegistry, RouteDoc } from './module.ts';

/**
 * Which permissions this server actually checks (E18-44), so the role editor can grey out the
 * combinations of area and action that nothing checks: granting one would do nothing.
 *
 * Collected, not hand-kept:
 * - every permission a route requires with `requirePerm` (noted when the route is registered);
 * - every permission a route description names (`describeRoute` and the central tables in
 *   `core/api/docs`): a hand-written route that checks with `ctx.can` inside its handler names
 *   that permission in its description, and every route must be described;
 * - for every record type loaded, the generated routes' `<module>.view`, `create`, `edit`, `delete`
 *   and `export` (and `security.view` for restricted types), plus the few actions a record type's
 *   hooks check on those same routes (`HOOK_CHECKS`).
 *
 * `permission-use.test.ts` scans the server's source for permissions named in `can(...)`,
 * `requirePerm(...)` and `permission:` and fails when one of them is missing here.
 */

const PERMISSION_RE = /^[a-z_]+\.[a-z_]+$/;
const noted = new Set<string>();

/** Records that something checks `perm` (a plain `<module>.<action>`; anything else is ignored). */
export function notePermission(perm: string | undefined): void {
  if (perm && PERMISSION_RE.test(perm)) noted.add(perm);
}

/**
 * Actions checked by a record type's hooks on its generated routes, by permission module: they
 * have no route of their own to be described by. Listed when a record type of that module is loaded.
 */
export const HOOK_CHECKS: Record<string, string[]> = {
  exceptions: ['approve'], // policies/exceptions.ts: approving an exception, and changing an approved one
};

/** The actions every generated record-type route set checks. */
export const RESOURCE_ACTIONS = ['view', 'create', 'edit', 'delete', 'export'] as const;

/**
 * Every permission checked, sorted. Record types of a switched-off area are left out by the registry;
 * the role editor shows such an area as switched off rather than unchecked.
 */
export function checkedPermissions(registry: Pick<ResourceRegistry, 'all'>): string[] {
  const out = new Set(noted);
  for (const def of registry.all()) {
    for (const a of [...RESOURCE_ACTIONS, ...(HOOK_CHECKS[def.module] ?? [])]) out.add(`${def.module}.${a}`);
    if (def.restricted) out.add('security.view');
  }
  return [...out].sort();
}

export function registerPermissionUse(deps: {
  app: FastifyInstance; registry: ResourceRegistry; describeRoute: (doc: RouteDoc) => void;
  requirePerm: (perm: string) => preHandlerAsyncHookHandler;
}) {
  const { app, registry, describeRoute, requirePerm } = deps;
  app.get('/api/admin/permissions/checked', { preHandler: requirePerm('admin.administer') }, async () => ({
    checked: checkedPermissions(registry),
  }));
  describeRoute({
    method: 'GET', path: '/api/admin/permissions/checked', tag: 'Administration', permission: 'admin.administer',
    summary: 'Permissions this server checks',
    description: 'Every `<area>.<action>` that some route or record type of this installation checks. The role editor greys out the other combinations: granting one would have no effect.',
    response: '{ checked: [string] "Sorted, for example assets.view" }',
  });
}
