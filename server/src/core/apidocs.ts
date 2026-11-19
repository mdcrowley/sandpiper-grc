import { MODULE_DOCS } from './api/docs/index.ts';
import { TRANSFER_DOCS } from './export/docs.ts';
import { describeWebAuthnRoutes } from './webauthn/apidocs.ts';
import type { RouteDoc } from './module.ts';
import type { OpenApi } from './openapi.ts';

/**
 * Descriptions of core's own hand-written routes for the OpenAPI document. A test fails when a
 * core route is registered without an entry here, so add one with every new route.
 */
type Extra = Omit<RouteDoc, 'method' | 'path' | 'summary'>;
const record = { record_type: 'Record type key, for example `ticket`.', record_id: 'The record\'s id.' };
const A = 'admin.administer';

const DOCS: [RouteDoc['method'], string, string, Extra?][] = [
  // ---- session and account ----
  ['GET', '/api/health', 'Liveness check', { tag: 'Session', public: true, response: '{ ok: true }' }],
  ['GET', '/api/auth/state', 'Who is signed in, their permissions, and application settings a client needs', { tag: 'Session', public: true, response: '{ appName, timeZone, currency, setupRequired, user, permissions, features, pilot, mfaEnrollmentRequired, mfaEnrollmentBlocked, mfaGraceEndsAt, mfaEnforcement }. With a token, `permissions` are the token\'s.' }],
  ['POST', '/api/setup', 'Create the first administrator (only while no user can sign in)', { tag: 'Session', public: true, body: '{ username, email, displayName, password }' }],
  ['POST', '/api/auth/login', 'Sign in and receive the session cookie', { tag: 'Session', public: true, body: '{ username, password, totp? }' }],
  ['POST', '/api/auth/logout', 'Sign out', { tag: 'Session', public: true }],
  ['POST', '/api/auth/change-password', 'Change your own password', { tag: 'Session', body: '{ currentPassword, newPassword }', description: 'Session only: not callable with a token.' }],
  ['POST', '/api/auth/confirm', 'Prove your password again before a sensitive action', { tag: 'Session', body: '{ password }', response: '{ ok, minutes }', description: 'Session only: not callable with a token.' }],
  ['GET', '/api/users/options', 'People for a user picker', { tag: 'People', query: { q: 'Part of a name or username (first 25 matches).', ids: 'Comma-separated user ids: returns exactly those people, with no limit of 25.' }, response: '[{ id, label }]' }],
  ['GET', '/api/users/labels', 'Names for user ids, including people since disabled or removed', { tag: 'People', query: { ids: 'Comma-separated user ids (at most 500).' }, response: '[{ id, label, active }]' }],

  // ---- personal access tokens ----
  ['GET', '/api/me/tokens', 'Your API tokens', { tag: 'API tokens', response: '{ tokens: [{ id, name, prefix, scopes, expires_at, last_used_at, last_used_ip, created_at, revoked_at, active }], maxDays, grants, scopeFamilies: [{ scope, description }] }', description: 'Session only. `scopeFamilies` are the capability scopes (not permissions) you may add, such as `mcp.use`.' }],
  ['POST', '/api/me/tokens', 'Create an API token (the token is in this answer and never shown again)', { tag: 'API tokens', body: '{ name, scopes: ["tickets.view", "assets.*", "mcp.use"], expiresInDays | expiresAt }', response: '{ id, name, prefix, scopes, expires_at, created_at, token }', description: 'Session only, with a recent password confirmation (403 `reauth_required` otherwise). Scopes must be permissions you hold, or capability scopes you are allowed (`scopeFamilies` of GET /api/me/tokens).' }],
  ['DELETE', '/api/me/tokens/:id', 'Revoke one of your API tokens', { tag: 'API tokens', description: 'Session only.' }],
  ['GET', '/api/admin/tokens', 'Every person\'s API tokens', { tag: 'API tokens', permission: A, query: { user_id: 'Only this person\'s tokens.' }, response: '{ tokens: [{ ..., userId, userName, username }] }' }],
  ['DELETE', '/api/admin/tokens/:id', 'Revoke anyone\'s API token', { tag: 'API tokens', permission: A }],

  // ---- metadata, pickers, search ----
  ['GET', '/api/meta', 'Record types the caller may view (with fields, custom fields included) and the lists they may read', { tag: 'Metadata', response: '{ resources: { [type]: { type, label, plural, module, path, route, titleField, refField, restricted, fields, search } }, lookups: { [list]: [{ value, label, color, sort }] } }' }],
  ['GET', '/api/openapi.json', 'This document, cut down to what the caller may use', { tag: 'Metadata' }],
  ['GET', '/api/records/lookup', 'Records for a record picker', { tag: 'Records', query: { type: 'Record type key.', q: 'Part of the title or reference.' }, response: '[{ id, label, ref }]' }],
  ['POST', '/api/records/labels', 'Labels for record ids', { tag: 'Records', body: '{ records: { [type]: [id, ...] } } (at most 1000 ids)', response: '{ [type]: { [id]: { label, ref, route } } }. Ids the caller may not see are left out.' }],
  ['GET', '/api/search', 'Search every record type the caller may view, with comments and attached file names', { tag: 'Records', query: { q: 'At least two characters. Full text from three.' }, response: '[{ type, typeLabel, id, label, ref, route, rank, matched: "record" | "comment" | "attachment", snippet, snippetParts: [{ text, match }] }], best first.' }],

  // ---- on any record ----
  ['GET', '/api/comments', 'Comments on a record', { tag: 'On any record', query: record }],
  ['POST', '/api/comments', 'Add a comment (watchers are notified)', { tag: 'On any record', body: '{ record_type, record_id, body, internal? }' }],
  ['GET', '/api/links', 'Records linked to a record, in both directions', { tag: 'On any record', query: record }],
  ['POST', '/api/links', 'Link two records (needs edit on the first, view on the second)', { tag: 'On any record', body: '{ from_type, from_id, to_type, to_id, relation? }' }],
  ['DELETE', '/api/links/:id', 'Remove a link', { tag: 'On any record' }],
  ['GET', '/api/history', 'Audit events for one record', { tag: 'On any record', query: record, response: '[{ id, at, actor_id, actor_name, action, summary, before, after, token_name }]' }],
  ['GET', '/api/tags', 'Tags on a record', { tag: 'On any record', query: record, response: '{ tags: [string] }' }],
  ['PUT', '/api/tags', 'Replace a record\'s tags (needs edit on the record)', { tag: 'On any record', body: '{ record_type, record_id, tags: [string] }', response: '{ tags }' }],
  ['POST', '/api/tags', 'Add one tag', { tag: 'On any record', body: '{ record_type, record_id, tag }', response: '{ tags }' }],
  ['DELETE', '/api/tags', 'Remove one tag', { tag: 'On any record', query: { ...record, tag: 'The tag to remove.' }, response: '{ tags }' }],
  ['GET', '/api/tags/options', 'Tags in use on a record type, most used first', { tag: 'On any record', query: { record_type: record.record_type, q: 'Part of a tag.' }, response: '[{ tag, count }], counting only records the caller may see.' }],
  ['POST', '/api/admin/tags/rename', 'Rename a tag on one record type, merging into an existing tag of that name', { tag: 'On any record', permission: A, body: '{ record_type, from, to }', response: '{ ok, changed }' }],
  ['GET', '/api/watchers', 'Who watches a record, and whether the caller does', { tag: 'On any record', query: record, response: '{ watching, count, watchers: [{ id, label }] }' }],
  ['POST', '/api/watchers', 'Start watching a record (notified of comments and status changes)', { tag: 'On any record', body: '{ record_type, record_id }' }],
  ['DELETE', '/api/watchers', 'Stop watching a record', { tag: 'On any record', query: record }],
  ['GET', '/api/me/watching', 'The records the caller watches', { tag: 'On any record', response: '[{ type, typeLabel, id, label, ref, route, since }]' }],

  // ---- preferences ----
  ['GET', '/api/me/preferences', 'All of your preferences', { tag: 'Preferences', query: { prefix: 'Only keys beginning with this.' }, response: '{ [key]: value }' }],
  ['GET', '/api/me/preferences/:key', 'One preference (value null when never set)', { tag: 'Preferences', response: '{ key, value, updatedAt }' }],
  ['PUT', '/api/me/preferences/:key', 'Store a preference (any JSON up to 32 KB; null removes it)', { tag: 'Preferences', body: '{ value }', response: '{ key, value, updatedAt }' }],
  ['DELETE', '/api/me/preferences/:key', 'Remove a preference', { tag: 'Preferences' }],

  // ---- audit and lists ----
  ['GET', '/api/audit', 'Search the audit log', { tag: 'Audit', permission: 'audit.view', query: { q: 'Text in the summary, actor or action.', action: 'Exact action.', record_type: 'Record type.', record_id: 'Record id.', actor_id: 'User id.', from: 'Date or date and time.', to: 'Date or date and time.', page: 'Page number.', pageSize: 'Rows a page (max 500).', format: '`csv` exports instead.' }, response: '{ rows, total, page, pageSize }' }],
  ['GET', '/api/lookups', 'Every configurable list with its number of values', { tag: 'Lists', permission: A }],
  ['GET', '/api/lookups/:list', 'The values of one list the caller may read', { tag: 'Lists', response: '[{ id, list_key, value, label, color, sort, active, meta }]' }],
  ['POST', '/api/lookups', 'Add a value to a list', { tag: 'Lists', permission: A, body: '{ list_key, value, label, color?, sort?, meta? }' }],
  ['PATCH', '/api/lookups/:id', 'Change a list value', { tag: 'Lists', permission: A, body: '{ label?, color?, sort?, active?, meta? }' }],
  ['DELETE', '/api/lookups/:id', 'Retire a list value (kept, so existing records keep their meaning)', { tag: 'Lists', permission: A }],

  // ---- custom fields ----
  ['GET', '/api/admin/custom-fields', 'Custom field definitions, inactive ones included', { tag: 'Custom fields', permission: A, query: { record_type: 'Only this record type.' }, response: '{ fields: [{ id, record_type, key, name, label, type, required, list_key, ref_type, section, position, help, active, field }], types, recordTypes }' }],
  ['POST', '/api/admin/custom-fields', 'Add a custom field to a record type', { tag: 'Custom fields', permission: A, body: '{ record_type, label, type: text|longtext|number|currency|date|boolean|select|multiselect|user|ref, key?, required?, options?: [{ value?, label, color? }], list?, to?, section?, position?, help? }' }],
  ['PATCH', '/api/admin/custom-fields/:id', 'Change a custom field (not its key or type); `active: false` hides it and keeps its values', { tag: 'Custom fields', permission: A, body: '{ label?, required?, section?, position?, help?, active?, options? }' }],
  ['DELETE', '/api/admin/custom-fields/:id', 'Switch a custom field off (its values are kept)', { tag: 'Custom fields', permission: A }],

  // ---- webhooks ----
  ['GET', '/api/admin/webhooks', 'Webhook subscriptions, with whether outbound connections are on and the allow-list', { tag: 'Webhooks', permission: A, response: '{ webhooks: [{ id, name, url, events, active, include_restricted, pending, failed_recently, last_delivered_at, ... }], outboundEnabled, allowedHosts, retryMinutes, recordTypes, actions }' }],
  ['POST', '/api/admin/webhooks', 'Add a webhook (the secret is in this answer and never shown again)', { tag: 'Webhooks', permission: A, body: '{ name, url, events: ["ticket.create", "risk.*", "*"], active?, includeRestricted?, secret? }', description: 'Needs a recent password confirmation. `includeRestricted` needs `security.view`.' }],
  ['PATCH', '/api/admin/webhooks/:id', 'Change a webhook', { tag: 'Webhooks', permission: A, body: '{ name?, url?, events?, active?, includeRestricted? }' }],
  ['DELETE', '/api/admin/webhooks/:id', 'Remove a webhook; its waiting deliveries are canceled', { tag: 'Webhooks', permission: A }],
  ['POST', '/api/admin/webhooks/:id/rotate-secret', 'Replace the signing secret (shown once)', { tag: 'Webhooks', permission: A, response: '{ ok, secret }' }],
  ['POST', '/api/admin/webhooks/:id/test', 'Send a test delivery now', { tag: 'Webhooks', permission: A, response: '{ id, event, status, attempts, response_status, last_error, ... }' }],
  ['GET', '/api/admin/webhooks/:id/deliveries', 'The delivery log of one webhook', { tag: 'Webhooks', permission: A, query: { status: 'pending, delivered, failed or blocked.', page: 'Page number.', pageSize: 'Rows a page (max 200).' }, response: '{ rows, total, page, pageSize }' }],
  ['POST', '/api/admin/webhook-deliveries/:id/retry', 'Queue a failed or blocked delivery again', { tag: 'Webhooks', permission: A }],

  // ---- retention ----
  ['GET', '/api/admin/retention', 'The retention period of every record type', { tag: 'Retention', permission: A, response: '{ types: [{ type, label, plural, restricted, periodMonths, category, basis, active, notes, updatedAt, pendingReviews }], categories, bases }' }],
  ['PUT', '/api/admin/retention/:type', 'Set the retention period of one record type', { tag: 'Retention', permission: A, body: '{ periodMonths, category?, basis?: "updated_at" | "created_at", active?, notes? }' }],
  ['POST', '/api/admin/retention/sweep', 'Run the daily retention check now (flags records; never deletes)', { tag: 'Retention', permission: A, response: '{ flagged, byType }' }],
  ['GET', '/api/admin/retention/reviews', 'Records flagged for review', { tag: 'Retention', permission: A, query: { status: 'pending (default), extended or deleted.', record_type: 'Only this record type.', page: 'Page number.', pageSize: 'Rows a page (max 200).' }, response: '{ rows: [{ id, record_type, typeLabel, record_id, label, ref, route, flagged_at, basis_at, status, extended_until, reason, decided_at, decided_by_name }], total, page, pageSize }' }],
  ['POST', '/api/admin/retention/reviews/:id/extend', 'Keep a flagged record for longer', { tag: 'Retention', permission: A, body: '{ reason, until: "YYYY-MM-DD" | months }' }],
  ['POST', '/api/admin/retention/reviews/:id/delete', 'Remove a flagged record for good', { tag: 'Retention', permission: A, body: '{ reason, confirm: true }', description: 'Needs a recent password confirmation. Refused with 409 `has_attachments` while the record has files.' }],
];

export function registerApiDocs(openapi: OpenApi): void {
  for (const [method, path, summary, extra] of DOCS) openapi.describe({ method, path, summary, ...extra });
  // Record fact sheets and the generic import (core/export, core/import).
  for (const doc of TRANSFER_DOCS) openapi.describe(doc);
  // Passkeys and security keys (core/webauthn).
  describeWebAuthnRoutes(openapi);
  // The modules' hand-written routes (core/api/docs); a module's own describeRoute replaces these.
  for (const docs of Object.values(MODULE_DOCS)) for (const doc of docs) openapi.describe(doc);
}
