import type { RouteDoc } from '../../module.ts';
import { route } from './helpers.ts';

const T = 'API tokens';
const CHANGED = '{ id: uuid, name: string, prefix: string, scopes: [string], expires_at: datetime, created_at: datetime, allowed_sources: [string] }';
const RULES = 'Needs a recent password confirmation (403 `reauth_required`); never with a token. `allowedSources` is a list (or a comma- or space-separated string) of up to 20 IPv4 or IPv6 addresses and CIDR ranges; an empty list allows any address again. 400 `validation` with `fields.allowedSources` for a list that is not valid; 404 for a token that has expired or been revoked. Audited as `token.update` with the lists before and after.';

/** Descriptions of core's token routes added after core/apidocs.ts (E02-18): changing a token's source addresses. */
export const DOCS: RouteDoc[] = [
  route('PATCH', '/api/me/tokens/:id', 'Change where one of your API tokens may be used from', {
    tag: T, description: `Session only. ${RULES}`,
    body: '{ allowedSources: [string] }', response: CHANGED,
  }),
  route('PATCH', '/api/admin/tokens/:id', "Change where anyone's API token may be used from", {
    tag: T, permission: 'admin.administer', description: RULES,
    body: '{ allowedSources: [string] }', response: CHANGED,
  }),
];
