import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerEvidenceFiles } from './files.ts';
import { registerEvidenceRecords } from './records.ts';
import { registerEvidenceLinks } from './routes.ts';
import { registerEvidenceReminders } from './reminders.ts';
import { seedEvidence } from './seed.ts';

/**
 * Evidence library (E45-06). An evidence record (EVD-) is filed once, with its owner, department, the
 * period it covers, when it was collected and until when it is valid, and its source: files (the
 * attachments module), a link, or a controlled document of the document library. It is then linked
 * to the records it supports, or to parts of them (a funder review's areas and document requests, an
 * obligation's periods), so one document serves a control, an obligation, a funder review and an
 * audit at once. Owners are reminded before evidence lapses. Restricted evidence and evidence outside
 * a scoped person's departments are hidden from lists but still counted. Vendor evidence items
 * (vendors module) stay where they are and can be linked like any other record.
 * Permission module `evidence`; feature area `evidence`.
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'evidence' };
  await ctx.lookups.ensure('evidence_source', [
    { value: 'file', label: 'Files', sort: 10 },
    { value: 'link', label: 'Link', sort: 20 },
    { value: 'document', label: 'Document', sort: 30 },
  ], own);
  await ctx.lookups.ensure('evidence_relation', [
    { value: 'supports', label: 'Supports', sort: 10 },
    { value: 'demonstrates', label: 'Shows it is met', sort: 20 },
    { value: 'responds', label: 'Answers the request', sort: 30 },
    { value: 'reference', label: 'For reference', sort: 40 },
  ], own);
}

async function register(ctx: ModuleContext) {
  registerEvidenceRecords(ctx);
  registerEvidenceLinks(ctx);
  registerEvidenceFiles(ctx);
  await registerEvidenceReminders(ctx);
}

const mod: ModuleDef = {
  key: 'evidence',
  seedDefaults,
  register,
  seed: seedEvidence,
};
export default mod;
