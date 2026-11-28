// Checklists: the items of a template, and the answers given on an audit or an inspection, saved
// one item at a time as they are given (E24-04, E24-06). Completing an inspection works out its
// result and score and raises a finding for each item not met.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays } from './dates.ts';
import { workpaperRefs } from './time.ts';
import {
  CHECKLIST_ANSWERS, completionProblem, findingRatingOf, liveItems, scoreChecklist, SIGNATURE_NAME_MAX, type AnswerOf,
} from '../../../../shared/inspection-rules.ts';

export const ANSWERS = CHECKLIST_ANSWERS;
/**
 * The shared evidence library's record type (module `evidence`, E45-06). Evidence records are linked to a
 * workpaper step through the library's own links (`evidence_links`, part `step:<item id>` of the
 * audit, registered in workpapers.ts) and to a finding before its verification; while the library is
 * not installed or switched off, steps and verifications use files only.
 */
export const EVIDENCE_TYPE = 'evidence_record';
/** Inspection statuses that end it without a result: answers and completion are refused (a missed one may still be done late). */
export const CANCELED_STATUSES = ['canceled', 'cancelled'];
const MAX_ITEMS = 300;
/** Days a finding raised by an inspection gives for the response. */
export const FINDING_RESPONSE_DAYS = 30;

type Parent = 'audit_engagement' | 'inspection';

export interface ChecklistItem {
  id: string; section: string | null; prompt: string; guidance: string | null; sort: number;
  critical: boolean; photo_required: boolean; removed: boolean;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The rules' view of stored answers (shared/inspection-rules.ts, which the mobile app's runner uses too). */
export const answerOfMap = (answers: Map<string, Row>): AnswerOf => (id) => {
  const a = answers.get(id);
  return a ? { answer: a.answer, photos: Array.isArray(a.attachment_ids) ? a.attachment_ids.length : 0 } : undefined;
};

/** Result and score from the answers: any critical item not met fails; any other item not met gives findings. */
export function scoreOf(items: ChecklistItem[], answers: Map<string, Row>): { result: string; score_pct: number | null; failed: ChecklistItem[] } {
  return scoreChecklist(items, answerOfMap(answers));
}

export function registerChecklists(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('audits.view') };
  const edit = { preHandler: ctx.requirePerm('audits.edit') };
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  let attachmentsTable: boolean | null = null;

  const need = async (type: string, req: FastifyRequest, label: string): Promise<Row> =>
    (await ctx.resources.find(type, String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', `${label} not found.`);

  /** The template's current items, plus removed ones this parent already answered (so its answers keep their question). */
  async function itemsFor(templateId: string | null, parent?: { type: Parent; id: string }): Promise<ChecklistItem[]> {
    if (!templateId) return [];
    const rows = await db.query<Row>(
      `select i.id, i.section, i.prompt, i.guidance, i.sort, i.critical, i.photo_required, (i.deleted_at is not null) as removed
       from checklist_template_items i
       where i.template_id = $1 and (i.deleted_at is null
         or ($2::text is not null and exists (select 1 from checklist_responses r where r.item_id = i.id and r.parent_type = $2 and r.parent_id::text = $3)))
       order by i.sort, i.created_at`,
      [templateId, parent?.type ?? null, parent?.id ?? null],
    );
    return rows as ChecklistItem[];
  }

  async function answersFor(type: Parent, id: string): Promise<Map<string, Row>> {
    const rows = await db.query<Row>(
      `select r.item_id, r.answer, r.note, r.attachment_ids, r.answered_at, u.display_name as answered_by_name,
              r.procedure, r.sample, r.result, r.prepared_by, r.prepared_by_name, r.prepared_at,
              r.reviewed_by, r.reviewed_by_name, r.reviewed_at
       from checklist_responses r left join users u on u.id = r.answered_by
       where r.parent_type = $1 and r.parent_id = $2`, [type, id]);
    return new Map(rows.map((r) => [r.item_id, r]));
  }

  async function checklistView(type: Parent, parent: Row, templateId: string | null, req: FastifyRequest) {
    const template = templateId
      ? await db.one<Row>('select id, name, kind, version, active from checklist_templates where id = $1 and deleted_at is null', [templateId])
      : null;
    const items = await itemsFor(template?.id ?? null, { type, id: parent.id });
    const answers = await answersFor(type, parent.id);
    const responses: Record<string, Row> = {};
    for (const [k, v] of answers) responses[k] = v;
    const answered = items.filter((i) => answers.get(i.id)?.answer || answers.get(i.id)?.result).length;
    const base = { template, items, responses, answered, total: items.length, can_answer: ctx.can(req.user, 'audits.edit') };
    if (type !== 'audit_engagement') return base;
    // Workpapers (E45-15): review notes and the evidence items linked, per step.
    const notes = await db.query<Row>(
      `select id, item_id, note, raised_by_name, raised_at, addressed_to, addressed_to_name, response, cleared_by_name, cleared_at
       from workpaper_review_notes where parent_type = $1 and parent_id = $2 order by raised_at`, [type, parent.id]);
    const evidence = await stepEvidence(parent.id, req);
    for (const r of Object.values(responses)) {
      r.notes = notes.filter((n) => n.item_id === r.item_id);
      r.evidence = evidence.rows.filter((e) => e.item_id === r.item_id);
      r.evidence_hidden = evidence.hidden.get(String(r.item_id)) ?? 0;
      r.locked = Boolean(r.reviewed_at);
    }
    const prepared = items.filter((i) => answers.get(i.id)?.prepared_at).length;
    const reviewed = items.filter((i) => answers.get(i.id)?.reviewed_at).length;
    // Workpaper reference numbers (E45-63): A.1, A.2, B.1 by section; the full one starts with the audit's reference.
    const refs = workpaperRefs(items);
    const numbered = items.map((i) => ({ ...i, wp_ref: refs.get(i.id) ?? null, wp_ref_full: refs.get(i.id) ? `${parent.ref ?? ''}/${refs.get(i.id)}` : null }));
    return {
      ...base, items: numbered, prepared, reviewed, open_notes: notes.filter((n) => !n.cleared_at).length,
      evidence_available: Boolean(ctx.resources.get(EVIDENCE_TYPE)),
      can_review: ctx.can(req.user, 'audits.edit'), me: actorOf(req).id,
    };
  }

  /**
   * Evidence records linked to the audit's steps (the library's links, part `step:<item id>`): those the
   * reader may see, and per step how many they may not (restriction hides detail, never counts).
   */
  async function stepEvidence(auditId: string, req: FastifyRequest): Promise<{ rows: Row[]; hidden: Map<string, number> }> {
    const def = ctx.resources.get(EVIDENCE_TYPE);
    const hidden = new Map<string, number>();
    if (!def) return { rows: [], hidden };
    const links = await db.query<Row>(
      `select l.id as link_id, l.evidence_id, substring(l.part from 6) as item_id, l.relation from evidence_links l
       where l.record_type = 'audit_engagement' and l.record_id = $1 and l.part like 'step:%' order by l.created_at`, [auditId]);
    const rows: Row[] = [];
    for (const l of links) {
      const found = ctx.can(req.user, `${def.module}.view`) ? await ctx.resources.find(EVIDENCE_TYPE, String(l.evidence_id), req.user) : undefined;
      if (!found) { hidden.set(l.item_id, (hidden.get(l.item_id) ?? 0) + 1); continue; }
      rows.push({
        link_id: l.link_id, item_id: l.item_id, id: l.evidence_id, relation: l.relation, ref: found.ref ?? null,
        label: String(found[def.titleField] ?? def.label), route: def.route ? `${def.route}/${l.evidence_id}` : null,
      });
    }
    return { rows, hidden };
  }

  /** Saves answers given one or several at a time. Attachments named must already be on the parent record. */
  async function saveAnswers(type: Parent, parent: Row, templateId: string | null, body: Row, req: FastifyRequest): Promise<number> {
    const list: Row[] = Array.isArray(body.responses) ? body.responses : body.item_id ? [body] : [];
    if (!list.length) invalid({ responses: 'Give at least one answer.' });
    if (list.length > MAX_ITEMS) invalid({ responses: `At most ${MAX_ITEMS} answers at a time.` });
    const items = new Map((await itemsFor(templateId)).map((i) => [i.id, i]));
    const workpaper = type === 'audit_engagement';
    const existing = workpaper ? await answersFor(type, parent.id) : new Map<string, Row>();
    const results = workpaper ? await ctx.lookups.values('workpaper_result') : [];
    const clean: Row[] = [];
    for (const [n, r] of list.entries()) {
      const key = `responses.${n}`;
      const itemId = String(r?.item_id ?? '');
      if (!items.has(itemId)) invalid({ [key]: 'That checklist item is not on this checklist.' });
      // A reviewed workpaper step is locked (E45-15).
      if (workpaper && existing.get(itemId)?.reviewed_at) ctx.fail(409, 'step_reviewed', `"${items.get(itemId)!.prompt.slice(0, 80)}" has been reviewed, so it is locked.`);
      let answer = r.answer === null || r.answer === '' || r.answer === undefined ? null : String(r.answer);
      if (answer !== null && !(ANSWERS as readonly string[]).includes(answer)) invalid({ [key]: 'Answer yes, no or not applicable.' });
      const wp: Row = {};
      if (workpaper) {
        for (const f of ['procedure', 'sample'] as const) if (r[f] !== undefined) wp[f] = text(r[f], 8000) || null;
        if (r.result !== undefined) {
          const result = r.result === null || r.result === '' ? null : String(r.result);
          const v = result ? results.find((x) => x.value === result) : null;
          if (result && !v) invalid({ [key]: 'Choose a result from the list.' });
          wp.result = result;
          // The result gives the answer counted in the report (met, not met, not applicable) unless one is given.
          if (r.answer === undefined) answer = v && typeof v.meta?.answer === 'string' && (ANSWERS as readonly string[]).includes(v.meta.answer) ? v.meta.answer : null;
        } else if (r.answer !== undefined) {
          wp.result = answer ? results.find((x) => x.meta?.answer === answer && x.meta?.default === true)?.value ?? results.find((x) => x.meta?.answer === answer)?.value ?? null : null;
        }
      }
      if (r.answer === undefined && r.result === undefined && workpaper) answer = existing.get(itemId)?.answer ?? null;
      let ids: string[] | undefined;
      if (r.attachment_ids !== undefined) {
        if (!Array.isArray(r.attachment_ids) || r.attachment_ids.length > 20 || r.attachment_ids.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))) {
          invalid({ [key]: 'Photos are given as a list of attached files.' });
        }
        ids = [...new Set(r.attachment_ids as string[])];
        if (ids.length) {
          attachmentsTable ??= Boolean(await db.one(`select 1 from information_schema.tables where table_name = 'attachments' limit 1`));
          const found = attachmentsTable
            ? await db.query<Row>(`select id from attachments where id = any($1::uuid[]) and record_type = $2 and record_id = $3 and deleted_at is null`, [ids, type, parent.id])
            : [];
          if (found.length !== ids.length) invalid({ [key]: `Attach the photo to this ${type === 'inspection' ? 'inspection' : 'audit'} first.` });
        }
      }
      clean.push({ item_id: itemId, answer, note: r.note === undefined ? undefined : text(r.note, 4000) || null, attachment_ids: ids, wp });
    }
    const by = actorOf(req);
    await db.tx(async (tx) => {
      for (const r of clean) {
        await tx.query(
          `insert into checklist_responses (parent_type, parent_id, item_id, answer, note, attachment_ids, answered_by, answered_at)
           values ($1,$2,$3,$4,$5,coalesce($6::jsonb, '[]'::jsonb),$7, now())
           on conflict (parent_type, parent_id, item_id) do update set answer = excluded.answer,
             note = case when $8 then excluded.note else checklist_responses.note end,
             attachment_ids = case when $6::jsonb is null then checklist_responses.attachment_ids else excluded.attachment_ids end,
             answered_by = excluded.answered_by, answered_at = now()`,
          [type, parent.id, r.item_id, r.answer, r.note ?? null, r.attachment_ids ? JSON.stringify(r.attachment_ids) : null, by.id, r.note !== undefined],
        );
        if (!workpaper) continue;
        const w = r.wp as Row;
        // Any change to a prepared step withdraws the preparer's sign-off: they sign again once it is right.
        await tx.query(
          `update checklist_responses set
             procedure = case when $4 then $5 else procedure end,
             sample = case when $6 then $7 else sample end,
             result = case when $8 then $9 else result end,
             prepared_by = null, prepared_by_name = null, prepared_at = null
           where parent_type = $1 and parent_id = $2 and item_id = $3`,
          [type, parent.id, r.item_id, 'procedure' in w, w.procedure ?? null, 'sample' in w, w.sample ?? null, 'result' in w, w.result ?? null]);
      }
    });
    await ctx.audit(req, {
      action: `${type}.checklist`, recordType: type, recordId: parent.id,
      summary: `Checklist answers saved on ${parent.ref ?? parent.title}: ${clean.map((r) => `${items.get(r.item_id)!.prompt.slice(0, 60)} = ${r.answer ?? 'cleared'}`).join('; ').slice(0, 900)}`,
      after: { answers: clean.map((r) => ({ item_id: r.item_id, answer: r.answer })) },
    });
    return clean.length;
  }

  // ---------- template items ----------

  app.get('/api/checklist-templates/:id/items', view, async (req) => {
    const t = await need('checklist_template', req, 'Checklist template');
    return { template: { id: t.id, name: t.name, kind: t.kind, version: t.version, active: t.active }, items: await itemsFor(t.id) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/checklist-templates/:id/items', tag: 'Audits', permission: 'audits.view',
    summary: 'The items of a checklist template, in order', response: '{ template, items: [{ id, section, prompt, guidance, sort, critical, photo_required }] }',
  });

  app.put('/api/checklist-templates/:id/items', edit, async (req) => {
    const t = await need('checklist_template', req, 'Checklist template');
    const body = (req.body ?? {}) as Row;
    if (!Array.isArray(body.items)) invalid({ items: 'Send the whole list of items.' });
    if (body.items.length > MAX_ITEMS) invalid({ items: `A checklist has at most ${MAX_ITEMS} items.` });
    const current = await itemsFor(t.id);
    const known = new Set(current.map((i) => i.id));
    const next: Row[] = [];
    const errors: Record<string, string> = {};
    for (const [n, raw] of (body.items as Row[]).entries()) {
      const id = raw?.id ? String(raw.id) : null;
      if (id && !known.has(id)) { errors[`items.${n}`] = 'That item is not on this checklist.'; continue; }
      const prompt = text(raw?.prompt, 1000);
      if (!prompt) { errors[`items.${n}`] = 'Every item needs a question or check.'; continue; }
      next.push({
        id, prompt, section: text(raw.section, 200) || null, guidance: text(raw.guidance, 4000) || null, sort: (n + 1) * 10,
        critical: raw.critical === true, photo_required: raw.photo_required === true,
      });
    }
    if (Object.keys(errors).length) invalid(errors);
    const same = (a: ChecklistItem, b: Row) => a.prompt === b.prompt && a.section === b.section && a.guidance === b.guidance
      && a.sort === b.sort && Boolean(a.critical) === b.critical && Boolean(a.photo_required) === b.photo_required;
    const kept = new Set(next.filter((i) => i.id).map((i) => i.id));
    const removed = current.filter((i) => !kept.has(i.id));
    const changed = next.filter((i) => !i.id || !same(current.find((c) => c.id === i.id)!, i));
    if (!removed.length && !changed.length) return { template: { id: t.id, version: t.version }, items: current, changed: false };
    await db.tx(async (tx) => {
      for (const i of removed) await tx.query('update checklist_template_items set deleted_at = now(), updated_by = $2 where id = $1', [i.id, req.user!.id]);
      for (const i of next) {
        if (i.id) {
          await tx.query(
            `update checklist_template_items set section = $2, prompt = $3, guidance = $4, sort = $5, critical = $6, photo_required = $7, updated_at = now(), updated_by = $8 where id = $1`,
            [i.id, i.section, i.prompt, i.guidance, i.sort, i.critical, i.photo_required, req.user!.id]);
        } else {
          await tx.query(
            `insert into checklist_template_items (template_id, section, prompt, guidance, sort, critical, photo_required, created_by, updated_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
            [t.id, i.section, i.prompt, i.guidance, i.sort, i.critical, i.photo_required, req.user!.id]);
        }
      }
    });
    // A checklist that has been used gets a new version, so answers given earlier read against the old one.
    const used = Boolean(await db.one(
      `select 1 from checklist_responses r join checklist_template_items i on i.id = r.item_id where i.template_id = $1 limit 1`, [t.id]));
    let version = Number(t.version ?? 1);
    if (used) {
      version += 1;
      await ctx.resources.update('checklist_template', t.id, { version }, null);
    }
    await ctx.audit(req, {
      action: 'checklist_template.items', recordType: 'checklist_template', recordId: t.id,
      summary: `Checklist items changed on ${t.name}: ${next.length} items (${changed.length} added or changed, ${removed.length} removed)${used ? `, now version ${version}` : ''}`,
      before: { items: current.map((i) => i.prompt) }, after: { items: next.map((i) => i.prompt) },
    });
    return { template: { id: t.id, version }, items: await itemsFor(t.id), changed: true };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/checklist-templates/:id/items', tag: 'Audits', permission: 'audits.edit',
    summary: 'Replace the items of a checklist template (in the order given); a template already used gets a new version',
    description: 'Items left out are marked removed, never deleted, so earlier answers keep their question. Audited.',
    body: '{ items: [{ id?, section?, prompt, guidance?, critical?, photo_required? }] }', response: '{ template: { id, version }, items, changed }',
  });

  // ---------- an audit's checklist ----------

  app.get('/api/audits/:id/checklist', view, async (req) => {
    const audit = await need('audit_engagement', req, 'Audit');
    return checklistView('audit_engagement', audit, audit.template_id ?? null, req);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audits/:id/checklist', tag: 'Audits', permission: 'audits.view',
    summary: 'The audit\'s checklist (its template\'s items) with the answers given so far',
    response: '{ template, items, responses: { [item_id]: { answer, note, attachment_ids, answered_by_name, answered_at } }, answered, total, can_answer }',
  });

  app.put('/api/audits/:id/checklist', edit, async (req) => {
    const audit = await need('audit_engagement', req, 'Audit');
    if (!audit.template_id) ctx.fail(409, 'no_checklist', 'Choose a checklist for the audit first.');
    if (['closed', 'canceled'].includes(String(audit.status))) ctx.fail(409, 'audit_closed', 'The audit is closed, so its checklist cannot be changed.');
    const saved = await saveAnswers('audit_engagement', audit, audit.template_id, (req.body ?? {}) as Row, req);
    return { saved, ...(await checklistView('audit_engagement', audit, audit.template_id, req)) };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/audits/:id/checklist', tag: 'Audits', permission: 'audits.edit',
    summary: 'Save workpaper steps on the audit\'s checklist (one or several items): procedure, sample, result, what was found, files and evidence items',
    description: 'A `result` (workpaper_result list) sets the answer counted in the report through its `meta.answer`; an `answer` alone (yes, no, na) still works. Any change withdraws the step\'s preparer sign-off; a reviewed step is locked (409 `step_reviewed`). Evidence library records are linked to a step with POST /api/evidence-links (part `step:<item_id>`) and listed here per step. Steps are signed with the routes under /api/audits/:id/steps.',
    body: '{ responses: [{ item_id, answer?: "yes" | "no" | "na" | null, result?, procedure?, sample?, note?, attachment_ids? }] } or one such object',
    response: '{ saved, template, items, responses: { [item_id]: { answer, result, procedure, sample, note, attachment_ids, evidence: [{ link_id, id, ref, label, route }], evidence_hidden, prepared_by_name, prepared_at, reviewed_by_name, reviewed_at, locked, notes } }, answered, prepared, reviewed, open_notes, total, can_answer, can_review }',
  });

  // ---------- an inspection's checklist ----------

  app.get('/api/inspections/:id/responses', view, async (req) => {
    const ins = await need('inspection', req, 'Inspection');
    return { inspection: { id: ins.id, ref: ins.ref, title: ins.title, status: ins.status, result: ins.result, score_pct: ins.score_pct, due_on: ins.due_on, target_label: ins.target_label }, ...(await checklistView('inspection', ins, ins.template_id, req)) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/inspections/:id/responses', tag: 'Audits', permission: 'audits.view',
    summary: 'An inspection\'s checklist with the answers given so far',
    response: '{ inspection, template, items, responses, answered, total, can_answer }',
  });

  app.put('/api/inspections/:id/responses', edit, async (req) => {
    const ins = await need('inspection', req, 'Inspection');
    if (ins.status === 'complete') ctx.fail(409, 'inspection_complete', 'The inspection is complete, so its answers cannot be changed.');
    if (CANCELED_STATUSES.includes(String(ins.status))) ctx.fail(409, 'inspection_canceled', 'The inspection was canceled, so it cannot be carried out.');
    const saved = await saveAnswers('inspection', ins, ins.template_id, (req.body ?? {}) as Row, req);
    if (ins.status !== 'in_progress' || !ins.inspector_id) {
      await ctx.resources.update('inspection', ins.id, { status: 'in_progress', ...(ins.inspector_id ? {} : { inspector_id: actorOf(req).id ?? req.user!.id }) }, null);
    }
    return { saved };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/inspections/:id/responses', tag: 'Audits', permission: 'audits.edit',
    summary: 'Save answers on an inspection as they are given; the inspection becomes In progress',
    description: 'A missed inspection can still be carried out late. 409 `inspection_complete` once completed, 409 `inspection_canceled` when canceled.',
    body: '{ responses: [{ item_id, answer: "yes" | "no" | "na" | null, note?, attachment_ids? }] } or one { item_id, answer, note?, attachment_ids? }',
    response: '{ saved }',
  });

  app.post('/api/inspections/:id/complete', edit, async (req) => {
    const ins = await need('inspection', req, 'Inspection');
    if (ins.status === 'complete') ctx.fail(409, 'inspection_complete', 'The inspection is already complete.');
    if (CANCELED_STATUSES.includes(String(ins.status))) ctx.fail(409, 'inspection_canceled', 'The inspection was canceled, so it cannot be completed.');
    const body = (req.body ?? {}) as Row;
    const items = await itemsFor(ins.template_id, { type: 'inspection', id: ins.id });
    const answers = await answersFor('inspection', ins.id);
    // The rules are shared with the mobile app's runner (shared/inspection-rules.ts).
    const answerOf = answerOfMap(answers);
    const problem = completionProblem(items, answerOf);
    if (problem) ctx.fail(400, problem.code, problem.message, problem.fields);
    const live = liveItems(items, answerOf);
    // The signature of completion (optional; the mobile app asks for it): the signer's name, and their
    // drawn signature already attached to this inspection.
    const signedBy = text(body.signed_by_name, SIGNATURE_NAME_MAX) || null;
    let signatureId: string | null = null;
    if (body.signature_attachment_id !== undefined && body.signature_attachment_id !== null && body.signature_attachment_id !== '') {
      signatureId = String(body.signature_attachment_id);
      attachmentsTable ??= Boolean(await db.one(`select 1 from information_schema.tables where table_name = 'attachments' limit 1`));
      const found = UUID_RE.test(signatureId) && attachmentsTable
        ? await db.one(`select 1 from attachments where id = $1 and record_type = 'inspection' and record_id = $2 and deleted_at is null`, [signatureId, ins.id])
        : undefined;
      if (!found) invalid({ signature_attachment_id: 'Attach the signature to this inspection first.' });
      if (!signedBy) invalid({ signed_by_name: 'Give the name of the person signing.' });
    }
    const { result, score_pct, failed } = scoreChecklist(live, answerOf);
    const today = dayInZone();
    const updated = await ctx.resources.update('inspection', ins.id, {
      status: 'complete', result, score_pct, performed_on: today,
      ...(ins.inspector_id ? {} : { inspector_id: actorOf(req).id ?? req.user!.id }),
      ...(typeof body.notes === 'string' && body.notes.trim() ? { notes: body.notes.trim().slice(0, 4000) } : {}),
      ...(signedBy ? { signed_by_name: signedBy, signed_at: new Date().toISOString() } : {}),
    }, null);
    await ctx.audit(req, {
      action: 'inspection.complete', recordType: 'inspection', recordId: ins.id,
      summary: `Inspection ${ins.ref} completed: ${result.replace(/_/g, ' ')}${score_pct === null ? '' : ` (${score_pct}%)`}${signedBy ? `, signed by ${signedBy}` : ''}`,
      after: { result, score_pct, performed_on: today, ...(signedBy ? { signed_by_name: signedBy, signature_attachment_id: signatureId } : {}) },
    });
    // Each item not met becomes a finding, unless the inspector chose otherwise.
    const findings: Row[] = [];
    if (body.raise_findings !== false) {
      for (const i of failed) {
        const a = answers.get(i.id)!;
        findings.push(await ctx.resources.create('audit_finding', {
          title: i.prompt.slice(0, 200), source_type: 'inspection', source_id: ins.id,
          rating: findingRatingOf(i), criteria: i.prompt,
          condition: a.note || `Not met at inspection ${ins.ref}${ins.target_label ? ` of ${ins.target_label}` : ''}.`,
          response_due: addDays(today, FINDING_RESPONSE_DAYS), response_owner_id: ins.inspector_id ?? actorOf(req).id ?? req.user!.id,
        }, req));
        await db.query('update audit_findings set item_id = $2 where id = $1', [findings.at(-1)!.id, i.id]);
      }
    }
    return { inspection: updated, findings: findings.map((f) => ({ id: f.id, ref: f.ref, title: f.title, rating: f.rating })) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/inspections/:id/complete', tag: 'Audits', permission: 'audits.edit',
    summary: 'Complete an inspection: works out the result and score, and raises a finding for each item not met',
    description: 'Every item must be answered, and items that need a photo must have one unless not applicable. Result: Fail when a critical item is not met, Pass with findings when another item is not met, otherwise Pass. Score: items met out of items answered yes or no. The rules are in shared/inspection-rules.ts, which the mobile app uses too. A signature of completion is optional: `signed_by_name`, with `signature_attachment_id` naming a drawing already attached to the inspection. 409 `inspection_canceled` when the inspection was canceled.',
    body: '{ raise_findings?: boolean (default true), notes?: string, signed_by_name?: string, signature_attachment_id?: string }', response: '{ inspection, findings: [{ id, ref, title, rating }] }',
  });

  return { itemsFor, answersFor, checklistView };
}
