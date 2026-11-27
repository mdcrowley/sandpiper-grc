// The evidence record type (E45-06): `evidence_record`, EVD- numbers, under /evidence-library.
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { EVIDENCE_TYPE } from './links.ts';
import { defineEvidencePart } from './parts.ts';
import { expiringDays } from './settings.ts';

const day = (v: unknown) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const URL_RE = /^https?:\/\/[^\s<>"]{1,2000}$/i;

export function registerEvidenceRecords(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function rules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    const source = merged.source ?? 'file';
    if ('url' in patch && patch.url) {
      patch.url = String(patch.url).trim();
      if (!URL_RE.test(patch.url)) errors.url = 'Give a web address that starts with https:// or http://.';
    }
    if (source === 'link' && !merged.url) errors.url = 'Give the address where the evidence is kept.';
    if (source === 'document' && !merged.document_id) errors.document_id = 'Choose the document of the document library.';
    const collected = day(merged.collected_on);
    const valid = day(merged.valid_until);
    if (collected && valid && valid < collected) errors.valid_until = 'Valid until cannot be before the date it was collected.';
    const start = day(merged.period_start);
    const end = day(merged.period_end);
    if (start && end && end < start) errors.period_end = 'The period cannot end before it starts.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    // A new record is owned by the person who files it, unless they name someone else.
    if (!existing && !merged.owner_id && req) patch.owner_id = actorOf(req).id;
    // A new expiry date is a new occasion for the reminders.
    if (existing && 'valid_until' in patch && day(patch.valid_until) !== day(existing.valid_until)) patch.reminded_for = null;
    return patch;
  }

  ctx.defineResource({
    type: EVIDENCE_TYPE, table: 'evidence_records', module: 'evidence', label: 'Evidence record', plural: 'Evidence records',
    path: '/api/evidence-library', route: '/evidence-library', titleField: 'title',
    ref: { field: 'ref', prefix: 'EVD-' },
    restricted: 'flag',
    scope: { department: 'department_id' },
    evidence: true,
    searchable: ['title', 'description', 'notes'],
    defaultSort: { field: 'updated_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      description: { label: 'What it shows', type: 'longtext', personal: false },
      owner_id: { label: 'Owner', type: 'user' },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      source: { label: 'Source', type: 'lookup', list: 'evidence_source', default: 'file' },
      url: { label: 'Link', type: 'text', personal: false },
      document_id: { label: 'Document', type: 'ref', to: 'policy' },
      period_start: { label: 'Period covered from', type: 'date' },
      period_end: { label: 'Period covered to', type: 'date' },
      collected_on: { label: 'Collected on', type: 'date' },
      valid_until: { label: 'Valid until', type: 'date' },
      restricted: { label: 'Restricted', type: 'boolean', default: false },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => rules(req, null, data),
      beforeUpdate: (req, existing, patch) => rules(req, existing, patch),
    },
  });

  // ---------- figures: the same for every viewer ----------

  app.get('/api/evidence-library/summary', { preHandler: ctx.requirePerm('evidence.view') }, async () => {
    const today = todayInZone();
    const window = await expiringDays(ctx);
    const r = (await db.one<Row>(
      `select count(*)::int as total,
              count(*) filter (where valid_until is null)::int as no_expiry,
              count(*) filter (where valid_until < $1::date)::int as expired,
              count(*) filter (where valid_until >= $1::date and valid_until <= $2::date)::int as expiring,
              count(*) filter (where valid_until > $2::date)::int as current,
              count(*) filter (where not exists (select 1 from evidence_links l where l.evidence_id = e.id))::int as unused,
              count(*) filter (where restricted)::int as restricted
       from evidence_records e where deleted_at is null`, [today, addDays(today, window)]))!;
    const links = (await db.one<Row>(
      `select count(*)::int as n from evidence_links l join evidence_records e on e.id = l.evidence_id where e.deleted_at is null`))!;
    return { today, expiring_days: window, ...r, links: Number(links.n) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/evidence-library/summary', tag: 'Evidence', permission: 'evidence.view',
    summary: 'Figures of the evidence library, the same for every viewer: totals by expiry state, records used by nothing, links',
    response: '{ today, expiring_days, total, no_expiry, expired, expiring, current, unused, restricted, links }',
  });

  // ---------- an obligation's periods are parts evidence can be linked to ----------

  defineEvidencePart(app, {
    recordType: 'obligation', prefix: 'period', label: 'Period',
    describe: async (q, recordId, key) => {
      if (!ctx.resources.get('obligation') || !/^[0-9a-f-]{36}$/i.test(key)) return null;
      const p = await q.one<Row>(
        'select period_start::text as s, period_end::text as e from obligation_periods where id = $1 and obligation_id = $2', [key, recordId]).catch(() => undefined);
      return p ? `${p.s} to ${p.e}` : null;
    },
  });
}
