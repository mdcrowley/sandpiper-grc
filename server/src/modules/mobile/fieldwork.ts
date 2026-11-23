// Field work offline (wave 15, E38-11 and E38-12; spec §5.6): inspections, condition assessments and
// inventory counts done on the phone, without signal if need be, and sent through the outbox.
//
// Sync kinds (sync.ts `defineSyncKind`). Each is done through the application's own routes, in-process,
// as the person, exactly as the web does it, so the rules, permissions, restrictions, hooks and audit are
// the web's and a refusal comes back with the route's own reason (the app keeps it in Needs attention):
// - `inspection.answers`: PUT /api/inspections/:id/responses (answers saved, not completed);
// - `inspection.complete`: the same, then POST /api/inspections/:id/complete with the signature of
//   completion. A canceled or deleted inspection, or a removed permission, is refused there.
//   Photos are `attachment` items sent first (to the inspection); their clientIds are turned into the
//   attachment ids the answers name, added to the photos already on the server.
// - `condition.assess`: POST /api/condition-assessments (photos follow with `parent`).
// - `count.found`: POST /api/inventory-counts/:id/found. Finds from several phones merge there (one
//   atomic insert-or-update per find); a find of a record someone else found answers `already_found`.
//
// Package parts (package.ts `definePackagePart`), read through the same routes as the person:
// - `inspections`: assigned to me, not closed, due by the package's last day, with their checklists
//   and the answers already given;
// - `condition`: condition assessments due for what I look after, up to the package's last day;
// - `counts`: open inventory counts I may count (tags.count), with what each expects and what was found.
import type { FastifyInstance } from 'fastify';
import { calendarSources } from '../../core/calendar.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import type {
  PackageChecklistAnswer, PackageChecklistItem, PackageCondition, PackageCount, PackageCountItem, PackageInspection,
  SyncChecklistAnswer, SyncConditionAssess, SyncCountFound, SyncInspectionWork, SyncResult,
} from '../../../../shared/mobile-api.ts';
import { SIGNATURE_NAME_MAX } from '../../../../shared/inspection-rules.ts';
import { definePackagePart } from './package.ts';
import { defineSyncKind, type KindOutcome, type SyncEnv } from './sync.ts';

/** Inspections whose checklists a package carries at most. */
export const MAX_PACKAGE_INSPECTIONS = 50;
/** Open counts a package carries at most, and records of one count. */
export const MAX_PACKAGE_COUNTS = 20;
export const MAX_COUNT_ITEMS = 3000;
/** Answers one item may carry (an inspection's checklist has at most 300 items). */
const MAX_ANSWERS = 300;
const NOTE_MAX = 4000;
/** Inspection statuses that are over (besides any value marked closed): left out of the package. */
const DONE_STATUSES = ['complete', 'completed', 'missed', 'canceled', 'cancelled'];

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const fail = (status: number, code: string, message: string, fields?: Record<string, string>): KindOutcome => ({ status, body: { error: { code, message, fields } } });
const ok = (s: number) => s >= 200 && s < 300;

// ---------- inspections ----------

function checkInspection(payload: unknown, complete: boolean): Row | string {
  const p = (payload ?? {}) as Partial<SyncInspectionWork>;
  if (!isUuid(p.inspectionId)) return 'This inspection is incomplete: it names no inspection.';
  if (!Array.isArray(p.answers) || p.answers.length > MAX_ANSWERS) return `Send at most ${MAX_ANSWERS} answers.`;
  const answers: SyncChecklistAnswer[] = [];
  for (const a of p.answers as Partial<SyncChecklistAnswer>[]) {
    if (!a || !isUuid(a.itemId)) return 'An answer names no checklist item.';
    if (a.answer !== null && !['yes', 'no', 'na'].includes(String(a.answer))) return 'Answer yes, no or not applicable.';
    const photos = a.photos ?? [];
    if (!Array.isArray(photos) || photos.length > 20 || !photos.every(isUuid)) return 'The photos of an answer are not valid.';
    const clean: SyncChecklistAnswer = { itemId: a.itemId.toLowerCase(), answer: a.answer ?? null };
    if (a.note !== undefined) clean.note = typeof a.note === 'string' ? a.note.slice(0, NOTE_MAX) : null;
    if (photos.length) clean.photos = [...new Set(photos.map((x) => x.toLowerCase()))];
    answers.push(clean);
  }
  if (!complete && !answers.length) return 'There are no answers to save.';
  const out: Row = { inspectionId: p.inspectionId.toLowerCase(), answers };
  if (complete) {
    out.raiseFindings = p.raiseFindings !== false;
    if (typeof p.notes === 'string' && p.notes.trim()) out.notes = p.notes.trim().slice(0, NOTE_MAX);
    if (p.signature) {
      const name = typeof p.signature.name === 'string' ? p.signature.name.trim().slice(0, SIGNATURE_NAME_MAX) : '';
      if (!name) return 'The signature has no name.';
      if (p.signature.photo !== undefined && p.signature.photo !== null && !isUuid(p.signature.photo)) return 'The signature is not valid.';
      out.signature = { name, photo: p.signature.photo ? p.signature.photo.toLowerCase() : null };
    }
  }
  return out;
}

const photoMissing = () => fail(409, 'photo_missing',
  'A photo taken for this inspection has not arrived on the server. Send the photo first (Offline work), then send this again.');

/** Answers saved through PUT /api/inspections/:id/responses; photos resolved and added to those already there. */
async function saveInspectionAnswers(env: SyncEnv, p: Row): Promise<KindOutcome | null> {
  const answers = p.answers as SyncChecklistAnswer[];
  if (!answers.length) return null;
  const base = `/api/inspections/${p.inspectionId}`;
  const current = await env.call('GET', `${base}/responses`);
  if (!ok(current.status)) return current;
  const responses: Row[] = [];
  for (const a of answers) {
    const r: Row = { item_id: a.itemId, answer: a.answer };
    if (a.note !== undefined) r.note = a.note;
    if (a.photos?.length) {
      const ids: string[] = [];
      for (const clientId of a.photos) {
        const made = await env.attachmentOf(clientId);
        if (!made || made.recordType !== 'inspection' || made.recordId.toLowerCase() !== p.inspectionId) return photoMissing();
        ids.push(made.attachmentId);
      }
      const had: string[] = current.body?.responses?.[a.itemId]?.attachment_ids ?? [];
      r.attachment_ids = [...new Set([...had, ...ids])];
    }
    responses.push(r);
  }
  const saved = await env.call('PUT', `${base}/responses`, { responses });
  return ok(saved.status) ? null : saved;
}

const RESULT_WORDS: Record<string, string> = { pass: 'Pass', pass_with_findings: 'Pass with findings', fail: 'Fail' };

async function runInspection(env: SyncEnv, p: Row, complete: boolean): Promise<KindOutcome> {
  const refused = await saveInspectionAnswers(env, p);
  if (refused) return refused;
  if (!complete) {
    const n = (p.answers as unknown[]).length;
    return { status: 200, body: {}, result: { recordType: 'inspection', id: p.inspectionId, message: `${n} answer${n === 1 ? '' : 's'} saved.` } };
  }
  const body: Row = { raise_findings: p.raiseFindings !== false };
  if (p.notes) body.notes = p.notes;
  if (p.signature) {
    body.signed_by_name = p.signature.name;
    if (p.signature.photo) {
      const made = await env.attachmentOf(p.signature.photo);
      if (!made || made.recordType !== 'inspection' || made.recordId.toLowerCase() !== p.inspectionId) {
        return fail(409, 'signature_missing', 'The signature has not arrived on the server. Send it first (Offline work), then send this again.');
      }
      body.signature_attachment_id = made.attachmentId;
    }
  }
  const done = await env.call('POST', `/api/inspections/${p.inspectionId}/complete`, body);
  if (!ok(done.status)) return done;
  const ins = done.body?.inspection ?? {};
  const findings = ((done.body?.findings ?? []) as Row[]).map((f) => ({ id: String(f.id), ref: f.ref ?? null, title: String(f.title ?? '') }));
  const words = RESULT_WORDS[String(ins.result)] ?? String(ins.result ?? '');
  const result: SyncResult = {
    recordType: 'inspection', id: p.inspectionId, ref: ins.ref ?? null, outcome: ins.result ?? null, scorePct: ins.score_pct ?? null, findings,
    message: `Completed: ${words}${ins.score_pct === null || ins.score_pct === undefined ? '' : ` (${ins.score_pct}%)`}${findings.length ? `; ${findings.length} finding${findings.length === 1 ? '' : 's'} raised` : ''}.`,
  };
  return { ...done, result };
}

// ---------- condition assessments ----------

function checkCondition(payload: unknown): Row | string {
  const p = (payload ?? {}) as Partial<SyncConditionAssess>;
  if (!['asset', 'vehicle', 'site'].includes(String(p.targetType)) || !isUuid(p.targetId)) return 'This assessment names no asset, vehicle or site.';
  if (typeof p.assessedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.assessedOn)) return 'This assessment has no date.';
  if (typeof p.rating !== 'string' || !p.rating.trim() || p.rating.length > 50) return 'This assessment has no condition rating.';
  return {
    targetType: p.targetType, targetId: p.targetId.toLowerCase(), assessedOn: p.assessedOn, rating: p.rating.trim(),
    method: typeof p.method === 'string' && p.method.trim() ? p.method.trim().slice(0, 50) : null,
    notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim().slice(0, NOTE_MAX) : null,
  };
}

// ---------- inventory counts ----------

function checkFound(payload: unknown): Row | string {
  const p = (payload ?? {}) as Partial<SyncCountFound>;
  if (!isUuid(p.countId)) return 'This find names no inventory count.';
  const source = ['code', 'text', 'typed'].includes(String(p.source)) ? p.source : 'typed';
  if (typeof p.value === 'string' && p.value.trim()) return { countId: p.countId.toLowerCase(), value: p.value.trim().slice(0, 200), source };
  if (typeof p.recordType === 'string' && isUuid(p.recordId)) return { countId: p.countId.toLowerCase(), recordType: p.recordType, recordId: p.recordId.toLowerCase() };
  return 'This find has no tag number.';
}

export function registerFieldwork(ctx: ModuleContext): void {
  const app: FastifyInstance = ctx.app;

  defineSyncKind(app, {
    key: 'inspection.answers',
    check: (payload) => checkInspection(payload, false),
    run: (env, p) => runInspection(env, p, false),
  });
  defineSyncKind(app, {
    key: 'inspection.complete',
    check: (payload) => checkInspection(payload, true),
    run: (env, p) => runInspection(env, p, true),
  });

  defineSyncKind(app, {
    key: 'condition.assess',
    check: checkCondition,
    async run(env, p) {
      const def = env.ctx.resources.get('condition_assessment');
      if (!def) return fail(404, 'switched_off', 'Asset condition is not in use.');
      const made = await env.call('POST', def.path, {
        target_type: p.targetType, target_id: p.targetId, assessed_on: p.assessedOn, rating: p.rating,
        ...(p.method ? { method: p.method } : {}), ...(p.notes ? { notes: p.notes } : {}),
      });
      if (!ok(made.status)) return made;
      return { ...made, result: { recordType: 'condition_assessment', id: String(made.body?.id ?? ''), ref: made.body?.ref ?? null } };
    },
  });

  defineSyncKind(app, {
    key: 'count.found',
    check: checkFound,
    async run(env, p) {
      const res = await env.call('POST', `/api/inventory-counts/${p.countId}/found`,
        p.value ? { value: p.value, source: p.source } : { recordType: p.recordType, recordId: p.recordId });
      if (!ok(res.status)) return res;
      // Not a new record: the result says what the find came to (the server's own words).
      return { ...res, result: { outcome: String(res.body?.outcome ?? ''), message: String(res.body?.message ?? ''), label: res.body?.item?.label ?? undefined } };
    },
  });

  // ---------- package parts ----------

  // Inspections assigned to me that are not over, due by the package's last day (or without a due date), with their checklists.
  definePackagePart(app, {
    key: 'inspections',
    async build(env) {
      const def = env.ctx.resources.get('inspection');
      if (!def) return null;
      const values = await env.ctx.lookups.values('inspection_status');
      const open = values
        .filter((v) => !DONE_STATUSES.includes(v.value) && (v as { meta?: { closed?: boolean } | null }).meta?.closed !== true)
        .map((v) => v.value);
      const q = new URLSearchParams({ 'f.inspector_id': env.user.id, sort: 'due_on', dir: 'asc', pageSize: '200' });
      if (open.length) q.set('f.status', open.join(','));
      const res = await env.call('GET', `${def.path}?${q}`);
      if (res.status !== 200) return null;
      const rows = (res.body.rows as Row[]).filter((r) => !r.due_on || String(r.due_on).slice(0, 10) <= env.until);
      const data: PackageInspection[] = [];
      for (const [n, r] of rows.entries()) {
        const item: PackageInspection = {
          id: r.id, ref: r.ref ?? null, title: String(r[def.titleField] ?? r.ref ?? r.id), status: r._display?.status ?? r.status ?? null,
          statusValue: r.status ?? null, dueOn: r.due_on ? String(r.due_on).slice(0, 10) : null,
          target: r.target_type && r.target_id && r.target_type !== 'none' ? { type: String(r.target_type), id: String(r.target_id), label: r.target_label ?? null } : null,
          checklist: null,
        };
        if (n < MAX_PACKAGE_INSPECTIONS) {
          const c = await env.call('GET', `/api/inspections/${r.id}/responses`);
          if (c.status === 200) {
            const responses: Record<string, PackageChecklistAnswer> = {};
            for (const [itemId, a] of Object.entries((c.body.responses ?? {}) as Record<string, Row>)) {
              responses[itemId] = { answer: a.answer ?? null, note: a.note ?? null, photos: Array.isArray(a.attachment_ids) ? a.attachment_ids.length : 0 };
            }
            item.checklist = {
              template: c.body.template ? { id: String(c.body.template.id), name: String(c.body.template.name) } : null,
              items: ((c.body.items ?? []) as Row[]).map((i): PackageChecklistItem => ({
                id: i.id, section: i.section ?? null, prompt: String(i.prompt), guidance: i.guidance ?? null,
                critical: i.critical === true, photo_required: i.photo_required === true, removed: i.removed === true,
              })),
              responses, canAnswer: c.body.can_answer === true,
            };
          }
        }
        data.push(item);
      }
      return { data, records: data.flatMap((i) => (i.target ? [{ type: i.target.type, id: i.target.id }] : [])) };
    },
  });

  // Condition assessments due for what I look after (my calendar feed's source), up to the package's last day.
  definePackagePart(app, {
    key: 'condition',
    async build(env) {
      if (!env.ctx.resources.get('condition_assessment')) return null;
      const source = calendarSources(app, env.ctx.resources, env.user).find((s) => s.key === 'condition.assessments_due');
      if (!source) return null;
      const events = await source.events(env.ctx, env.user, '2000-01-01', env.until).catch(() => null);
      if (!events) return null;
      const today = dayInZone();
      events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
      const data: PackageCondition = {
        due: events.slice(0, 500).map((e) => ({
          type: e.recordType, id: e.recordId, label: e.title.replace(/^Condition assessment due: /, ''),
          dueOn: e.start ? String(e.start).slice(0, 10) : null, overdue: Boolean(e.start) && String(e.start).slice(0, 10) < today,
        })),
      };
      return { data, records: data.due.map((d) => ({ type: d.type, id: d.id })) };
    },
  });

  // Open inventory counts I may count, with their expected records and what was found so far.
  definePackagePart(app, {
    key: 'counts',
    async build(env) {
      const def = env.ctx.resources.get('inventory_count');
      if (!def || !env.ctx.can(env.user, 'tags.count')) return null;
      const list = await env.call('GET', `${def.path}?${new URLSearchParams({ 'f.status': 'open', sort: 'started_at', dir: 'desc', pageSize: String(MAX_PACKAGE_COUNTS) })}`);
      if (list.status !== 200) return null;
      const data: PackageCount[] = [];
      const records: { type: string; id: string }[] = [];
      for (const c of list.body.rows as Row[]) {
        const items = await env.call('GET', `${def.path}/${c.id}/items`);
        if (items.status !== 200) continue;
        const rows = (items.body.rows as Row[]);
        const kept = rows.slice(0, MAX_COUNT_ITEMS).map((i): PackageCountItem => ({
          recordType: i.recordType, recordId: i.recordId, label: i.label, ref: i.ref ?? null, tagValue: i.tagValue ?? null,
          expected: i.expected === true, state: i.state,
        }));
        for (const i of rows.slice(0, MAX_COUNT_ITEMS)) if (i.route) records.push({ type: i.recordType, id: i.recordId });
        data.push({
          id: c.id, ref: c.ref ?? null, title: String(c.title ?? c.ref ?? ''),
          site: c.site_id ? { id: c.site_id, label: c._display?.site_id ?? '' } : null, area: c.area ?? null,
          recordTypes: Array.isArray(c.record_types) ? c.record_types : [], startedAt: c.started_at ? new Date(c.started_at).toISOString() : null,
          totals: items.body.totals, items: kept, truncated: rows.length > MAX_COUNT_ITEMS,
        });
      }
      return { data, records };
    },
  });
}
