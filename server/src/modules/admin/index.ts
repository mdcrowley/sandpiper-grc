import type { ModuleDef } from '../../core/module.ts';
import { registerAccount } from './account.ts';
import { describeAdminRoutes } from './docs.ts';
import { registerFeatures } from './features.ts';
import { registerDataLoad } from './dataload.ts';
import { registerOrganization } from './organization.ts';
import { registerProviders } from './providers.ts';
import { registerRoles } from './roles.ts';
import { registerSettings } from './settings.ts';
import { registerSso } from './sso.ts';
import { registerUpdates } from './updates.ts';
import { registerUsers } from './users.ts';

/**
 * Administration: users and one-time links, second factor, roles, departments, settings, sign-in
 * providers (single sign-on), linked identities and the break-glass account.
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
    registerOrganization(ctx); // Administration > Organization: details, logos, colors (core/organization.ts)
    registerFeatures(ctx); // Administration > Features (core/features.ts)
    registerDataLoad(ctx); // data load mode and the Data loads page (E18-70, core/dataload.ts)
    // Single sign-on (server/src/core/identity): sign-in providers, linking, break-glass.
    registerSso(ctx);
    registerProviders(ctx);
    registerUpdates(ctx); // Administration > About: version and the update check (E42-06)
    describeAdminRoutes(ctx);
  },
};
export default mod;
