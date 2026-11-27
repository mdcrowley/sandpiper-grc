// Workpapers (E45-15, wave 25): each item of an audit's checklist is a program step. Besides the result
// and what was found (checklists.ts), a step is signed by its preparer and then by a reviewer, who
// must be someone else. The reviewer may raise review notes, which send the step back: the preparer's
// sign-off is withdrawn and only the preparer clears each note, with a response, before signing again.
// An administrator (admin.administer) may clear a note whose preparer has left. A reviewed step is locked. An audit closes only when every worked step is reviewed and no note is
// open (report.ts `closingProblems`).
//
// Who signs is `actorOf(req)` (core/dataload.ts): in data load mode an administrator may name the
// person who prepared or reviewed a past step, and give the date, and the separation of duties is
// checked against the people named.
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { Db } from '../../core/db.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { defineEvidencePart } from '../evidence/parts.ts';
import type { ChecklistItem } from './checklists.ts';

type Helpers = {
  itemsFor: (templateId: string | null, parent?: { type: 'audit_engagement' | 'inspection'; id: string }) => Promise<ChecklistItem[]>;
  checklistView: (type: 'audit_engagement' | 'inspection', parent: Row, templateId: string | null, req: FastifyRequest) => Promise<Row>;
};

const short = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s);

/** Whether two signers are the same person: by account, or by the name a data load gave. */
export function samePerson(a: { id: string | null; name: string | null }, b: { id: unknown; name: unknown }): boolean {
  if (a.id && b.id) return a.id === String(b.id);
  return Boolean(a.name && b.name && a.name.trim().toLowerCase() === String(b.name).trim().toLowerCase());
}

/** The time a sign-off is recorded at: now, or in data load mode the time given. */
function stampOf(ctx: ModuleContext, req: FastifyRequest, raw: unknown, field: string): string {
  if (raw === undefined || raw === null || raw === '') return new Date().toISOString();
  if (!isDataLoad(req)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: 'The time is now; another time can be given only in data load mode.' });
  const t = Date.parse(String(raw));
  if (Number.isNaN(t) || t > Date.now() + 60_000) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: 'Give a date or time, not in the future.' });
  return new Date(t).toISOString();
}

export function registerWorkpapers(ctx: ModuleContext, h: Helpers) {
  const { app, db } = ctx;
  const edit = { preHandler: ctx.requirePerm('audits.edit') };

  // Evidence library records link to a step as a part of the audit (`step:<item id>`). A step that is
  // reviewed, or an audit that is closed, has no part to link to, so the library refuses new links.
  const stepsOf = async (d: Db, auditId: string) => d.query<Row>(
    `select i.id, i.prompt, r.reviewed_at, a.status from audits a
     join checklist_template_items i on i.template_id = a.template_id
     left join checklist_responses r on r.parent_type = 'audit_engagement' and r.parent_id = a.id and r.item_id = i.id
     where a.id = $1 and a.deleted_at is null and (i.deleted_at is null or r.item_id is not null) order by i.sort`, [auditId]);
  defineEvidencePart(app, {
    recordType: 'audit_engagement', prefix: 'step', label: 'Workpaper step',
    async describe(d, auditId, key) {
      if (!UUID_RE.test(key)) return null;
      const s = (await stepsOf(d, auditId)).find((x) => x.id === key);
      return s && !s.reviewed_at && !['closed', 'canceled'].includes(String(s.status)) ? short(String(s.prompt)) : null;
    },
    async names(d, auditId) {
      return new Map((await stepsOf(d, auditId)).map((x) => [String(x.id), short(String(x.prompt))]));
    },
    // A reviewed step keeps the evidence it was reviewed with: no new links, and none removed (E45-19).
    async mayChange(d, auditId, key) {
      if (!UUID_RE.test(key)) return null;
      const s = (await stepsOf(d, auditId)).find((x) => x.id === key);
      return s?.reviewed_at ? 'This workpaper step has been reviewed, so the evidence it was reviewed with cannot change.' : null;
    },
  });

  async function stepOf(req: FastifyRequest): Promise<{ audit: Row; item: ChecklistItem; response: Row | undefined }> {
    const p = req.params as Row;
    const audit = (await ctx.resources.find('audit_engagement', String(p.id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Audit not found.');
    if (['closed', 'canceled'].includes(String(audit.status))) ctx.fail(409, 'audit_closed', 'The audit is closed, so its workpapers cannot be changed.');
    const itemId = String(p.itemId ?? '');
    const item = UUID_RE.test(itemId) ? (await h.itemsFor(audit.template_id ?? null, { type: 'audit_engagement', id: audit.id })).find((i) => i.id === itemId) : undefined;
    if (!item) ctx.fail(404, 'not_found', 'That step is not on this audit\'s checklist.');
    const response = await db.one<Row>(
      `select * from checklist_responses where parent_type = 'audit_engagement' and parent_id = $1 and item_id = $2`, [audit.id, itemId]);
    return { audit, item: item!, response };
  }

  const openNotes = async (auditId: string, itemId: string) => Number((await db.one<Row>(
    `select count(*)::int as n from workpaper_review_notes where parent_type = 'audit_engagement' and parent_id = $1 and item_id = $2 and cleared_at is null`,
    [auditId, itemId]))?.n ?? 0);

  const answer = async (audit: Row, req: FastifyRequest) => h.checklistView('audit_engagement', audit, audit.template_id ?? null, req);

  // ---------- preparer sign-off ----------
  app.post('/api/audits/:id/steps/:itemId/prepare', edit, async (req) => {
    const { audit, item, response } = await stepOf(req);
    if (response?.reviewed_at) ctx.fail(409, 'step_reviewed', 'This step has been reviewed, so it is locked.');
    if (!response || (!response.result && !response.answer)) ctx.fail(400, 'validation', 'Record the step\'s result before signing it.', { result: 'Choose a result first.' });
    if (await openNotes(audit.id, item.id)) ctx.fail(409, 'open_notes', 'Clear the open review notes on this step before signing it again.');
    const by = actorOf(req);
    const at = stampOf(ctx, req, ((req.body ?? {}) as Row).prepared_at, 'prepared_at');
    await db.query(
      `update checklist_responses set prepared_by = $3, prepared_by_name = $4, prepared_at = $5 where parent_type = 'audit_engagement' and parent_id = $1 and item_id = $2`,
      [audit.id, item.id, by.id, by.name, at]);
    await ctx.audit(req, {
      action: 'audit_engagement.step_prepared', recordType: 'audit_engagement', recordId: audit.id,
      summary: `Workpaper step signed by its preparer ${by.name ?? ''}: ${short(item.prompt)}`.replace(/\s+/g, ' '), after: { item_id: item.id, prepared_at: at },
    });
    return answer(audit, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/:id/steps/:itemId/prepare', tag: 'Audits', permission: 'audits.edit',
    summary: 'Sign a workpaper step as its preparer (needs a result, and no open review note)',
    description: '409 `step_reviewed` when it is locked, `open_notes` while a review note is open, `audit_closed`. In data load mode `prepared_at` may give the time and `on_behalf_of` the preparer.',
    body: '{ prepared_at? (data load only) }', response: 'the audit\'s checklist, as GET /api/audits/:id/checklist',
  });

  // ---------- reviewer sign-off ----------
  app.post('/api/audits/:id/steps/:itemId/review', edit, async (req) => {
    const { audit, item, response } = await stepOf(req);
    if (response?.reviewed_at) ctx.fail(409, 'step_reviewed', 'This step has already been reviewed.');
    if (!response?.prepared_at) ctx.fail(409, 'not_prepared', 'The preparer signs the step before it is reviewed.');
    const by = actorOf(req);
    if (samePerson(by, { id: response!.prepared_by, name: response!.prepared_by_name })) {
      ctx.fail(403, 'not_independent', 'A step is reviewed by someone other than its preparer.');
    }
    if (await openNotes(audit.id, item.id)) ctx.fail(409, 'open_notes', 'The step still has open review notes.');
    const at = stampOf(ctx, req, ((req.body ?? {}) as Row).reviewed_at, 'reviewed_at');
    if (Date.parse(at) < Date.parse(String(response!.prepared_at instanceof Date ? response!.prepared_at.toISOString() : response!.prepared_at))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { reviewed_at: 'A step is reviewed after it was prepared.' });
    }
    await db.query(
      `update checklist_responses set reviewed_by = $3, reviewed_by_name = $4, reviewed_at = $5 where parent_type = 'audit_engagement' and parent_id = $1 and item_id = $2`,
      [audit.id, item.id, by.id, by.name, at]);
    await ctx.audit(req, {
      action: 'audit_engagement.step_reviewed', recordType: 'audit_engagement', recordId: audit.id,
      summary: `Workpaper step reviewed and locked by ${by.name ?? ''}: ${short(item.prompt)}`.replace(/\s+/g, ' '), after: { item_id: item.id, reviewed_at: at },
    });
    return answer(audit, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/:id/steps/:itemId/review', tag: 'Audits', permission: 'audits.edit',
    summary: 'Sign a prepared workpaper step as its reviewer (someone other than the preparer); the step is then locked',
    description: '409 `not_prepared`, `open_notes`, `step_reviewed` or `audit_closed`; 403 `not_independent` when the reviewer prepared it. In data load mode `reviewed_at` and `on_behalf_of` name a past review.',
    body: '{ reviewed_at? (data load only) }', response: 'the audit\'s checklist',
  });

  // ---------- review notes ----------
  app.post('/api/audits/:id/steps/:itemId/notes', edit, async (req, reply) => {
    const { audit, item, response } = await stepOf(req);
    if (response?.reviewed_at) ctx.fail(409, 'step_reviewed', 'This step has been reviewed, so it is locked.');
    if (!response?.prepared_at) ctx.fail(409, 'not_prepared', 'Review notes are raised on a step its preparer has signed.');
    const by = actorOf(req);
    if (samePerson(by, { id: response!.prepared_by, name: response!.prepared_by_name })) {
      ctx.fail(403, 'not_independent', 'Review notes are raised by a reviewer, not by the step\'s preparer.');
    }
    const note = String(((req.body ?? {}) as Row).note ?? '').trim().slice(0, 4000);
    if (!note) ctx.fail(400, 'validation', 'Check the highlighted fields.', { note: 'Write the review note.' });
    const row = await db.tx(async (tx) => {
      const n = (await tx.one<Row>(
        `insert into workpaper_review_notes (parent_type, parent_id, item_id, note, raised_by, raised_by_name, addressed_to, addressed_to_name)
         values ('audit_engagement', $1, $2, $3, $4, $5, $6, $7) returning id`,
        [audit.id, item.id, note, by.id, by.name, response!.prepared_by ?? null, response!.prepared_by_name ?? null]))!;
      // The note sends the step back to its preparer.
      await tx.query(
        `update checklist_responses set prepared_by = null, prepared_by_name = null, prepared_at = null where parent_type = 'audit_engagement' and parent_id = $1 and item_id = $2`,
        [audit.id, item.id]);
      return n;
    });
    await ctx.audit(req, {
      action: 'audit_engagement.review_note', recordType: 'audit_engagement', recordId: audit.id,
      summary: `Review note raised on workpaper step: ${short(item.prompt)}`, after: { item_id: item.id, note_id: row.id, note },
    });
    if (response!.prepared_by && ctx.app.hasDecorator('notify')) {
      await ctx.app.notify({
        userIds: [response!.prepared_by], kind: 'audits', route: `/audits/engagements/${audit.id}?tab=checklist`,
        title: `Review note on your workpaper: ${audit.ref}`, body: short(item.prompt), once: `workpaper_note:${row.id}`,
      });
    }
    reply.code(201);
    return answer(audit, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/:id/steps/:itemId/notes', tag: 'Audits', permission: 'audits.edit',
    summary: 'Raise a review note on a prepared workpaper step: the preparer\'s sign-off is withdrawn until they clear the note and sign again',
    body: '{ note }', response: 'the audit\'s checklist',
  });

  app.post('/api/audits/:id/steps/:itemId/notes/:noteId/clear', edit, async (req) => {
    const { audit, item } = await stepOf(req);
    const noteId = String((req.params as Row).noteId ?? '');
    const n = UUID_RE.test(noteId) ? await db.one<Row>(
      `select * from workpaper_review_notes where id = $1 and parent_type = 'audit_engagement' and parent_id = $2 and item_id = $3`, [noteId, audit.id, item.id]) : undefined;
    if (!n) ctx.fail(404, 'not_found', 'Review note not found.');
    if (n!.cleared_at) ctx.fail(409, 'cleared', 'This review note has already been cleared.');
    const by = actorOf(req);
    const addressed = n!.addressed_to || n!.addressed_to_name;
    if (addressed && !samePerson(by, { id: n!.addressed_to, name: n!.addressed_to_name }) && !ctx.can(req.user, 'admin.administer')) {
      ctx.fail(403, 'not_preparer', 'Only the step\'s preparer clears a review note.');
    }
    const answerText = String(((req.body ?? {}) as Row).response ?? '').trim().slice(0, 4000);
    if (!answerText) ctx.fail(400, 'validation', 'Check the highlighted fields.', { response: 'Say how the note was dealt with.' });
    await db.query(
      `update workpaper_review_notes set response = $2, cleared_by = $3, cleared_by_name = $4, cleared_at = now() where id = $1`,
      [n!.id, answerText, by.id, by.name]);
    await ctx.audit(req, {
      action: 'audit_engagement.review_note_cleared', recordType: 'audit_engagement', recordId: audit.id,
      summary: `Review note cleared on workpaper step: ${short(item.prompt)}`, after: { note_id: n!.id, response: answerText },
    });
    return answer(audit, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audits/:id/steps/:itemId/notes/:noteId/clear', tag: 'Audits', permission: 'audits.edit',
    summary: 'Clear a review note with a response (only the step\'s preparer, or an administrator when the preparer has left)',
    body: '{ response }', response: 'the audit\'s checklist',
  });

  // ---------- where the audit stands ----------
  app.get('/api/audits/:id/workpaper-status', { preHandler: ctx.requirePerm('audits.view') }, async (req) => {
    const audit = (await ctx.resources.find('audit_engagement', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Audit not found.');
    return workpaperStatus(ctx, audit);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/:id/workpaper-status', tag: 'Audits', permission: 'audits.view',
    summary: 'Where the audit\'s workpapers, control tests and finding verifications stand',
    response: '{ steps: { total, worked, prepared, reviewed }, open_notes, control_tests: { total, unreviewed } | null, findings: { total, awaiting_verification, verification_overdue, closed } }',
  });
}

/** Counts for the audit page and the closing checks (figures: every record counts). */
export async function workpaperStatus(ctx: ModuleContext, audit: Row): Promise<Row> {
  const { db } = ctx;
  const today = dayInZone();
  const steps = (await db.one<Row>(
    `select count(*) filter (where r.answer is not null or r.result is not null)::int as worked,
            count(*) filter (where r.prepared_at is not null)::int as prepared,
            count(*) filter (where r.reviewed_at is not null)::int as reviewed
     from checklist_responses r join checklist_template_items i on i.id = r.item_id
     where r.parent_type = 'audit_engagement' and r.parent_id = $1`, [audit.id]))!;
  const total = audit.template_id ? Number((await db.one<Row>(
    'select count(*)::int as n from checklist_template_items where template_id = $1 and deleted_at is null', [audit.template_id]))?.n ?? 0) : 0;
  const notes = Number((await db.one<Row>(
    `select count(*)::int as n from workpaper_review_notes where parent_type = 'audit_engagement' and parent_id = $1 and cleared_at is null`, [audit.id]))?.n ?? 0);
  let tests: Row | null = null;
  if (ctx.resources.get('control_test')) {
    const final = (await ctx.lookups.values('control_test_status')).filter((v) => v.meta?.final === true).map((v) => v.value);
    tests = (await db.one<Row>(
      `select count(*)::int as total, count(*) filter (where not (coalesce(status, '') = any($2::text[])) and reviewed_on is null)::int as unreviewed
       from control_tests where deleted_at is null and audit_id = $1`, [audit.id, final.length ? final : ['reviewed']]))!;
  }
  const findings = (await db.one<Row>(
    `select count(*)::int as total,
            count(*) filter (where status = 'awaiting_verification')::int as awaiting_verification,
            count(*) filter (where status <> 'closed' and verified_on is null and verification_due < $2::date)::int as verification_overdue,
            count(*) filter (where status = 'closed')::int as closed
     from audit_findings where deleted_at is null and source_type = 'audit_engagement' and source_id = $1`, [audit.id, today]))!;
  return {
    steps: { total, worked: Number(steps.worked), prepared: Number(steps.prepared), reviewed: Number(steps.reviewed) },
    open_notes: notes,
    control_tests: tests ? { total: Number(tests.total), unreviewed: Number(tests.unreviewed) } : null,
    findings: { total: Number(findings.total), awaiting_verification: Number(findings.awaiting_verification), verification_overdue: Number(findings.verification_overdue), closed: Number(findings.closed) },
  };
}
