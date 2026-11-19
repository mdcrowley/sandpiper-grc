import type { ModuleDef } from '../../core/module.ts';
import { registerAccount } from './account.ts';
import { describeAdminRoutes } from './docs.ts';
import { registerRoles } from './roles.ts';
import { registerSettings } from './settings.ts';
import { registerUsers } from './users.ts';

/**
 * Administration: users and one-time links, second factor, roles, departments, settings.
 * API tokens, webhooks, custom fields, tags and retention are core services (server/src/core);
 * their settings are listed in `settings.ts`.
 * The audit search (`/api/audit`) and configurable lists (`/api/lookups`) are core routes;
 * this module supplies their screens on the web side.
 */
const mod: ModuleDef = {
  key: 'admin',
  async register(ctx) {
    registerAccount(ctx);
    registerUsers(ctx);
    registerRoles(ctx);
    registerSettings(ctx);
    describeAdminRoutes(ctx);
  },
};
export default mod;
