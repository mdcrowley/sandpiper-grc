import type { RouteDoc } from '../../module.ts';
import { paging, q, route } from './helpers.ts';

const N = 'Notifications';
const OWN = 'Needs only a signed-in person; works on the caller\'s own notifications.';
const KINDS = "[{ value: string, label: string, color: string, description: string, enabled: boolean, channel: 'app' | 'email' | 'both' | 'none' }]";
const PREFS = `{ kinds: ${KINDS}, dailyDigest: boolean, emailAvailable: boolean, emailAddress: email | null, digestHour: integer }`;

/** Descriptions of the notifications module's hand-written routes (server/src/modules/notifications). */
export const DOCS: RouteDoc[] = [
  route('GET', '/api/notifications', 'Your notifications, newest first', {
    tag: N,
    description: `${OWN} A notification about a record the caller can no longer open is returned with \`unavailable: true\` and without the record's details.`,
    query: { ...paging, unread: q('boolean', 'true for unread notifications only.') },
    response: `{ rows: [{ id: uuid, kind: string, title: string, body: string | null, route: string | null, record_type: string | null, record_id: uuid | null, created_at: datetime, read_at: datetime | null, unavailable: boolean }],
      total: integer, page: integer, pageSize: integer, unread: integer }`,
  }),
  route('GET', '/api/notifications/unread-count', 'How many of your notifications are unread', {
    tag: N, description: OWN, response: '{ unread: integer }',
  }),
  route('POST', '/api/notifications/read-all', 'Mark all your notifications read', {
    tag: N, description: `${OWN} Not audited.`, response: '{ ok: boolean, marked: integer, unread: integer }',
  }),
  route('POST', '/api/notifications/:id/read', 'Mark one of your notifications read', {
    tag: N, description: `${OWN} Someone else's notification answers 404. Not audited.`,
    response: '{ ok: boolean, id: uuid, read_at: datetime, unread: integer }',
  }),
  route('GET', '/api/notifications/preferences', 'Your notification preferences', {
    tag: N, description: OWN, response: PREFS,
  }),
  route('PATCH', '/api/notifications/preferences', 'Change your notification preferences', {
    tag: N,
    description: `${OWN} \`kinds\` switches kinds on or off; \`channels\` chooses where each kind is delivered. Unknown kinds or values answer 400 \`validation\`. Audited when something changes.`,
    body: "{ kinds?: { [kind]: boolean }, channels?: { [kind]: 'app' | 'email' | 'both' | 'none' }, dailyDigest?: boolean }",
    response: PREFS,
  }),
];
