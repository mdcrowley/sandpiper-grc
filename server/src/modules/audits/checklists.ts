// Checklists: the items of a template, and the answers given on an audit or an inspection, saved
// one item at a time as they are given (E24-04, E24-06). Completing an inspection works out its
// result and score and raises a finding for each item not met.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays } from './dates.ts';

export const ANSWERS = ['yes', 'no', 'na'] as const;
const MAX_ITEMS = 300;
/** Days a finding raised by an inspection gives for the response. */
export const FINDING_RESPONSE_DAYS = 30;

type Parent = 'audit_engagement' | 'inspection';

export interface ChecklistItem {
  id: string; section: string | null; prompt: string; guidance: string | null; sort: number;
  critical: boolean; photo_required: boolean; removed: boolean;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Result and score from the answers: any critical item not met fails; any other item not met gives findings. */
export function scoreOf(items: ChecklistItem[], answers: Map<string, Row>): { result: string; score_pct: number | null; failed: ChecklistItem[] } {
  let yes = 0;
  let no = 0;
  const failed: ChecklistItem[] = [];
  for (const i of items) {
    const a = answers.get(i.id)?.answer;
    if (a === 'yes') yes += 1;
    if (a === 'no') { no += 1; failed.push(i); }
  }
  const score_pct = yes + no ? Math.round((yes / (yes + no)) * 1000) / 10 : null;
  const result = failed.some((i) => i.critical) ? 'fail' : failed.length ? 'pass_with_findings' : 'pass';
  return { result, score_pct, failed };
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
      `select r.item_id, r.answer, r.note, r.attachment_ids, r.answered_at, u.display_name as answered_by_name
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
    const answered = items.filter((i) => answers.get(i.id)?.answer).length;
    return {
      template, items, responses, answered, total: items.length,
      can_answer: ctx.can(req.user, 'audits.edit'),
    };
  }

  /** Saves answers given one or several at a time. Attachments named must already be on the parent record. */
  async function saveAnswers(type: Parent, parent: Row, templateId: string | null, body: Row, req: FastifyRequest): Promise<number> {
    const list: Row[] = Array.isArray(body.responses) ? body.responses : body.item_id ? [body] : [];
    if (!list.length) invalid({ responses: 'Give at least one answer.' });
    if (list.length > MAX_ITEMS) invalid({ responses: `At most ${MAX_ITEMS} answers at a time.` });
    const items = new Map((await itemsFor(templateId)).map((i) => [i.id, i]));
    const clean: Row[] = [];
    for (const [n, r] of list.entries()) {
      const key = `responses.${n}`;
      const itemId = String(r?.item_id ?? '');
      if (!items.has(itemId)) invalid({ [key]: 'That checklist item is not on this checklist.' });
      const answer = r.answer === null || r.answer === '' || r.answer === undefined ? null : String(r.answer);
      if (answer !== null && !(ANSWERS as readonly string[]).includes(answer)) invalid({ [key]: 'Answer yes, no or not applicable.' });
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
      clean.push({ item_id: itemId, answer, note: r.note === undefined ? undefined : text(r.note, 4000) || null, attachment_ids: ids });
    }
    await db.tx(async (tx) => {
      for (const r of clean) {
        await tx.query(
          `insert into checklist_responses (parent_type, parent_id, item_id, answer, note, attachment_ids, answered_by, answered_at)
           values ($1,$2,$3,$4,$5,coalesce($6::jsonb, '[]'::jsonb),$7, now())
           on conflict (parent_type, parent_id, item_id) do update set answer = excluded.answer,
             note = case when $8 then excluded.note else checklist_responses.note end,
             attachment_ids = case when $6::jsonb is null then checklist_responses.attachment_ids else excluded.attachment_ids end,
             answered_by = excluded.answered_by, answered_at = now()`,
          [type, parent.id, r.item_id, r.answer, r.note ?? null, r.attachment_ids ? JSON.stringify(r.attachment_ids) : null, req.user!.id, r.note !== undefined],
        );
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
    summary: 'Save answers on the audit\'s checklist (one or several items; yes, no or not applicable, with a note and photos)',
    body: '{ responses: [{ item_id, answer: "yes" | "no" | "na" | null, note?, attachment_ids? }] } or one { item_id, answer, note?, attachment_ids? }',
    response: '{ saved, template, items, responses, answered, total, can_answer }',
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
    const saved = await saveAnswers('inspection', ins, ins.template_id, (req.body ?? {}) as Row, req);
    if (ins.status !== 'in_progress' || !ins.inspector_id) {
      await ctx.resources.update('inspection', ins.id, { status: 'in_progress', ...(ins.inspector_id ? {} : { inspector_id: req.user!.id }) }, null);
    }
    return { saved };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/inspections/:id/responses', tag: 'Audits', permission: 'audits.edit',
    summary: 'Save answers on an inspection as they are given; the inspection becomes In progress',
    description: 'A missed inspection can still be carried out late. 409 `inspection_complete` once completed.',
    body: '{ responses: [{ item_id, answer: "yes" | "no" | "na" | null, note?, attachment_ids? }] } or one { item_id, answer, note?, attachment_ids? }',
    response: '{ saved }',
  });

  app.post('/api/inspections/:id/complete', edit, async (req) => {
    const ins = await need('inspection', req, 'Inspection');
    if (ins.status === 'complete') ctx.fail(409, 'inspection_complete', 'The inspection is already complete.');
    const body = (req.body ?? {}) as Row;
    const items = await itemsFor(ins.template_id, { type: 'inspection', id: ins.id });
    const answers = await answersFor('inspection', ins.id);
    const live = items.filter((i) => !i.removed || answers.get(i.id)?.answer);
    const missing = live.filter((i) => !answers.get(i.id)?.answer);
    if (missing.length) ctx.fail(400, 'incomplete', `Answer every item first: ${missing.length} still open.`, { items: missing.map((i) => i.prompt).slice(0, 5).join('; ') });
    const noPhoto = live.filter((i) => i.photo_required && answers.get(i.id)?.answer !== 'na' && !(answers.get(i.id)?.attachment_ids ?? []).length);
    if (noPhoto.length) ctx.fail(400, 'photo_required', `Add a photo to every item that needs one: ${noPhoto.map((i) => i.prompt).slice(0, 3).join('; ')}.`);
    const { result, score_pct, failed } = scoreOf(live, answers);
    const today = dayInZone();
    const updated = await ctx.resources.update('inspection', ins.id, {
      status: 'complete', result, score_pct, performed_on: today,
      ...(ins.inspector_id ? {} : { inspector_id: req.user!.id }),
      ...(typeof body.notes === 'string' && body.notes.trim() ? { notes: body.notes.trim().slice(0, 4000) } : {}),
    }, null);
    await ctx.audit(req, {
      action: 'inspection.complete', recordType: 'inspection', recordId: ins.id,
      summary: `Inspection ${ins.ref} completed: ${result.replace(/_/g, ' ')}${score_pct === null ? '' : ` (${score_pct}%)`}`,
      after: { result, score_pct, performed_on: today },
    });
    // Each item not met becomes a finding, unless the inspector chose otherwise.
    const findings: Row[] = [];
    if (body.raise_findings !== false) {
      for (const i of failed) {
        const a = answers.get(i.id)!;
        findings.push(await ctx.resources.create('audit_finding', {
          title: i.prompt.slice(0, 200), source_type: 'inspection', source_id: ins.id,
          rating: i.critical ? 'major_nonconformity' : 'minor_nonconformity', criteria: i.prompt,
          condition: a.note || `Not met at inspection ${ins.ref}${ins.target_label ? ` of ${ins.target_label}` : ''}.`,
          response_due: addDays(today, FINDING_RESPONSE_DAYS), response_owner_id: ins.inspector_id ?? req.user!.id,
        }, req));
        await db.query('update audit_findings set item_id = $2 where id = $1', [findings.at(-1)!.id, i.id]);
      }
    }
    return { inspection: updated, findings: findings.map((f) => ({ id: f.id, ref: f.ref, title: f.title, rating: f.rating })) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/inspections/:id/complete', tag: 'Audits', permission: 'audits.edit',
    summary: 'Complete an inspection: works out the result and score, and raises a finding for each item not met',
    description: 'Every item must be answered, and items that need a photo must have one unless not applicable. Result: Fail when a critical item is not met, Pass with findings when another item is not met, otherwise Pass. Score: items met out of items answered yes or no.',
    body: '{ raise_findings?: boolean (default true), notes?: string }', response: '{ inspection, findings: [{ id, ref, title, rating }] }',
  });

  return { itemsFor, answersFor };
}
