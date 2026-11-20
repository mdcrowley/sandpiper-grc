import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

const A = 'Attachments';
const FILE = `{ id: uuid, record_type: string, record_id: uuid, file_name: string, extension: string, type_group: string, content_type: string, size_bytes: integer, sha256: string,
  kind: 'file' | 'evidence', description: string | null, collected_on: date | null, expires_on: date | null, scan_status: string, scan_engine: string | null,
  uploaded_by: uuid, uploaded_by_name: string, uploaded_at: datetime, updated_at: datetime }`;
const VIEW = 'Needs view permission on the record the file belongs to (`<module>.view`; `security.view` as well for restricted records). A record the caller may not see answers 404.';
const EDIT = 'Needs view permission on the record the file belongs to and `<module>.edit` for its module (403 otherwise); a record or file the caller may not see answers 404.';
const SETTINGS = '{ maxBytes: integer, allowedExtensions: [string] }';

/** Descriptions of the attachments module's hand-written routes (server/src/modules/attachments). */
export const DOCS: RouteDoc[] = [
  route('GET', '/api/attachments/config', 'Upload limits, allowed file types and the malware scanner in use', {
    tag: A, description: 'Needs only a signed-in person.',
    response: "{ maxBytes: integer, allowedExtensions: [string], scanner: string, whenUnavailable: 'refuse' | 'accept', canAdminister: boolean }",
  }),
  route('PATCH', '/api/attachments/settings', 'Change the upload size limit and allowed file types', {
    tag: A, permission: 'admin.administer',
    description: 'Programs and scripts can never be allowed. Adding a file type needs a recent identity confirmation (403 `reauth_required`; never with an API token). Invalid input answers 400 `validation`. Stored as settings, which are audited.',
    body: '{ maxMb?: integer "Megabytes", allowedExtensions?: [string] | string }',
    response: SETTINGS,
  }),
  route('GET', '/api/attachments', 'Files on one record, newest first', {
    tag: A, description: VIEW,
    query: { record_type: 'Record type, for example ticket.', record_id: q('uuid', 'The record.') },
    response: `{ rows: [${FILE}], canEdit: boolean, today: date }`,
  }),
  route('GET', '/api/attachments/evidence-expiring', 'Evidence files expired or expiring soon, across the records you may see', {
    tag: A, description: 'Needs only a signed-in person; files on records the caller may not see are left out.',
    query: { days: q('integer', 'Look ahead this many days, 1 to 730 (default 90).') },
    response: `{ today: date, days: integer, rows: [{ id: uuid, record_type: string, record_id: uuid, file_name: string, expires_on: date, days_left: integer, expired: boolean, record_label: string, record_type_label: string, record_route: string, ... }] }`,
  }),
  route('PUT', '/api/attachments/upload', 'Upload a file to a record', {
    tag: A,
    description: `${EDIT} Send the bytes as the body with content type application/octet-stream. Refusals are audited: 415 \`type_not_allowed\`, \`unsupported_media_type\` or a content mismatch, 413 \`too_large\`, 400 \`empty_file\`, 422 \`malware\`, 503 \`scan_failed\` or \`storage_unavailable\`. When the scanner is unavailable and the policy accepts, the file is marked not scanned and \`scan_warning\` is set.`,
    query: {
      record_type: 'Record type, for example ticket.', record_id: q('uuid', 'The record.'), name: 'File name, with its extension.',
      kind: "'file' (default) or 'evidence'.", description: 'Optional description, up to 2,000 characters.',
      collected_on: q('date', 'Evidence only: when collected (default today; not in the future).'), expires_on: q('date', 'Evidence only: when it expires.'),
    },
    body: 'binary',
    response: `{ id: uuid, file_name: string, size_bytes: integer, sha256: string, kind: 'file' | 'evidence', scan_status: string, scan_warning?: string, ... }`,
    status: 201,
  }),
  route('GET', '/api/attachments/:id/download', 'Download a file', {
    tag: A,
    description: `${VIEW} The checksum is verified before sending: 500 \`integrity\` or \`file_missing\` (audited) when it fails, 503 \`storage_unavailable\` when the store cannot be reached. Downloads from restricted records are audited.`,
    file: 'application/octet-stream',
  }),
  route('PATCH', '/api/attachments/:id', 'Change a file\'s kind, description or evidence dates', {
    tag: A,
    description: `${EDIT} Evidence dates are cleared when the kind is file. Invalid input answers 400 \`validation\`. Audited when something changes.`,
    body: "{ kind?: 'file' | 'evidence', description?: string | null, collected_on?: date | null, expires_on?: date | null }",
    response: FILE,
  }),
  route('DELETE', '/api/attachments/:id', 'Remove a file', {
    tag: A,
    description: `${EDIT} The stored bytes are kept for the purge period, during which an administrator can restore the file. Audited.`,
    response: '{ ok: boolean }',
  }),
];
