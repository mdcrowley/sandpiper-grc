// OpenAPI descriptions of the export and import routes (core/export, core/import), for
// core/apidocs.ts: `for (const d of TRANSFER_DOCS) openapi.describe(d);`.
import type { RouteDoc } from '../module.ts';

const file = '{ fileName, content (base64 of a .csv or .xlsx file, at most 5 MB) | text (CSV), sheet?, delimiter? }';

export const TRANSFER_DOCS: RouteDoc[] = [
  {
    method: 'GET', path: '/api/records/:type/:id/pdf', tag: 'Records', summary: 'One record as a PDF fact sheet (fields, tags, recent history)',
    description: 'Needs `<module>.export` on the record type. Audited; a restricted record is watermarked.', response: 'application/pdf',
  },
  {
    method: 'GET', path: '/api/import/:type/fields', tag: 'Import', summary: 'Fields that can be imported into a record type, keys that find existing records, and the limits',
    description: 'Needs `<module>.create` or `<module>.edit`.', response: '{ type, label, plural, route, fields: [{ name, label, type, required, list?, to?, multiple?, custom? }], matchKeys: [{ name, label }], modes, limits }',
  },
  {
    method: 'GET', path: '/api/import/:type/template', tag: 'Import', summary: 'A CSV template with one column per importable field',
    description: 'Needs `<module>.create` or `<module>.edit`.', response: 'text/csv',
  },
  {
    method: 'POST', path: '/api/import/:type/read', tag: 'Import', summary: 'Read a CSV or XLSX file: sheets, headers, sample rows and a suggested column mapping',
    body: file, response: '{ ...fields, kind, sheets, sheet, headers, sample, rowCount, suggested: { header: field } }',
  },
  {
    method: 'POST', path: '/api/import/:type', tag: 'Import', summary: 'Check (dryRun, the default) or import a CSV or XLSX file into a record type',
    description: 'mode `create` needs `<module>.create`, `update` needs `<module>.edit`, `upsert` both; restricted types also `security.view`. Each record is created or updated through the resource engine (validation, hooks, audit); a real run also writes one `<type>.import` audit event.',
    body: `${file.slice(0, -2)}, mapping: { header: field }, mode: create | update | upsert, matchKey?, valueMap?: { field: { fileValue: storedValue } }, dryRun? }`,
    response: '{ dryRun, mode, matchKey, total, created, updated, skipped, errors, duplicates, rows: [{ line, action, errors, reason?, id?, label?, key? }], unmatched: { field: [values] } }',
  },
  {
    method: 'GET', path: '/api/import/history', tag: 'Import', summary: 'Past imports of a record type, newest first (from the audit log)',
    query: { type: 'Record type key.' }, response: '[{ id, at, by, summary, file, mode, total, created, updated, skipped, errors }]',
  },
];
