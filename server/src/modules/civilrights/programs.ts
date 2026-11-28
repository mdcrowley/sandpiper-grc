// Civil rights programs: each with its owner, its adoption (the program document, a controlled
// document, and the board decision when committees are on), its update cycle, its required elements
// (each with evidence from the library), its public notice locations, its language assistance plan
// items and its monitoring reports with their submission log. Program templates are the
// organization's own: a template's elements and reports are copied into a program made from it.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addMonths } from '../../../../shared/dates.ts';
import { defineEvidencePart } from '../evidence/parts.ts';
import { defineChildRows } from './children.ts';
import { REPORT_DONE } from './lists.ts';

export const TEMPLATE = 'civil_rights_template';
export const PROGRAM = 'civil_rights_program';
export const REPORT = 'civil_rights_report';
const TAG = 'Civil rights';
const ymd = (v: unknown): string | null => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** The required elements of a template, one per line (blank lines and bullets left out). */
export const elementLines = (text: unknown): string[] =>
  String(text ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean).slice(0, 200);

/** The reports of a template: "Name | months" per line (months optional: a one-off report). */
export function reportLines(text: unknown): { title: string; months: number | null }[] {
  return String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 50).map((l) => {
    const [title, months] = l.split('|').map((p) => p.trim());
    const m = Number(months);
    return { title: title.slice(0, 300), months: Number.isInteger(m) && m > 0 && m <= 120 ? m : null };
  }).filter((r) => r.title);
}

export async function registerPrograms(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  ctx.defineResource({
    type: TEMPLATE, table: 'civil_rights_templates', module: 'civilrights', label: 'Program template', plural: 'Program templates',
    path: '/api/civil-rights/templates', route: '/civil-rights/templates', titleField: 'name',
    ref: { field: 'ref', prefix: 'CRT-' }, searchable: ['name', 'description', 'elements'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true, help: 'What the template is for, for example "Nondiscrimination program".' },
      program_type: { label: 'Program type', type: 'lookup', list: 'civil_rights_program_type' },
      description: { label: 'Description', type: 'longtext', personal: false },
      elements: { label: 'Required elements', type: 'longtext', personal: false, help: 'One required element per line. Each becomes a checklist item of a program made from the template.' },
      reports: { label: 'Monitoring reports', type: 'longtext', personal: false, help: 'One report per line, as "Name | months between reports", for example "Program update | 36". Leave the months out for a one-off report.' },
      update_cycle_months: { label: 'Update cycle (months)', type: 'number', help: 'How often a program made from the template is updated, in months.' },
    },
    hooks: {
      beforeCreate: async (_req, data) => checkCycle(data),
      beforeUpdate: async (_req, _existing, patch) => checkCycle(patch),
    },
  });

  function checkCycle(data: Row): Row {
    if (data.update_cycle_months != null && data.update_cycle_months !== '') {
      const n = Number(data.update_cycle_months);
      if (!Number.isInteger(n) || n < 1 || n > 240) invalid({ update_cycle_months: 'Give whole months from 1 to 240.' });
    }
    return data;
  }

  /** The next update date: the last update (or the adoption) plus the cycle. */
  const nextUpdate = (r: Row): string | null => {
    const from = ymd(r.last_updated_on) ?? ymd(r.adopted_on);
    const n = Number(r.update_cycle_months);
    return from && Number.isInteger(n) && n > 0 ? addMonths(from, n) : null;
  };

  ctx.defineResource({
    type: PROGRAM, table: 'civil_rights_programs', module: 'civilrights', label: 'Civil rights program', plural: 'Civil rights programs',
    path: '/api/civil-rights/programs', route: '/civil-rights', titleField: 'name',
    ref: { field: 'ref', prefix: 'CRP-' }, searchable: ['name', 'description'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true, help: 'The program\'s name, for example "Nondiscrimination program".' },
      program_type: { label: 'Program type', type: 'lookup', list: 'civil_rights_program_type' },
      status: { label: 'Status', type: 'lookup', list: 'civil_rights_program_status', default: 'draft' },
      owner_id: { label: 'Owner', type: 'user' },
      description: { label: 'Description', type: 'longtext', personal: false },
      template_id: { label: 'Made from template', type: 'ref', to: TEMPLATE, help: 'A program template: its required elements and monitoring reports are copied into the new program.' },
      document_id: { label: 'Program document', type: 'ref', to: 'policy', help: 'The controlled document that sets out the program.' },
      decision_id: { label: 'Board decision', type: 'ref', to: 'meeting_decision', help: 'The decision of the board or committee that adopted or approved the program.' },
      adopted_on: { label: 'Adopted on', type: 'date' },
      update_cycle_months: { label: 'Update cycle (months)', type: 'number' },
      last_updated_on: { label: 'Last updated on', type: 'date' },
      next_update_due: { label: 'Next update due', type: 'date', help: 'Worked out from the last update (or the adoption) and the cycle when left empty.' },
    },
    hooks: {
      beforeCreate: async (_req, data) => {
        checkCycle(data);
        if (data.template_id) {
          const t = await db.one<Row>('select program_type, update_cycle_months from civil_rights_templates where id = $1 and deleted_at is null', [data.template_id]);
          if (t) {
            data.program_type ??= t.program_type;
            data.update_cycle_months ??= t.update_cycle_months;
          }
        }
        if (!data.next_update_due) data.next_update_due = nextUpdate(data);
        return data;
      },
      beforeUpdate: async (_req, existing, patch) => {
        checkCycle(patch);
        const touches = ['adopted_on', 'last_updated_on', 'update_cycle_months'].some((k) => k in patch);
        if (touches && !('next_update_due' in patch)) {
          const next = nextUpdate({ ...existing, ...patch });
          if (next) patch.next_update_due = next;
        }
        return patch;
      },
      afterCreate: async (req, row) => {
        // A data load brings a program's past elements and reports itself: nothing is copied then.
        if (!row.template_id || isDataLoad(req)) return;
        const t = await db.one<Row>('select * from civil_rights_templates where id = $1 and deleted_at is null', [row.template_id]);
        if (!t) return;
        let sort = 0;
        for (const title of elementLines(t.elements)) {
          sort += 10;
          await db.query(`insert into civil_rights_program_items (program_id, kind, title, sort, created_by) values ($1, 'element', $2, $3, $4)`,
            [row.id, title.slice(0, 300), sort, actorOf(req).id]);
        }
        // The first report of each kind the template lists, due a cycle after adoption (or today).
        const start = ymd(row.adopted_on) ?? todayInZone();
        for (const r of reportLines(t.reports)) {
          await ctx.resources.create(REPORT, {
            title: r.title, program_id: row.id, due_on: addMonths(start, r.months ?? 12), every_months: r.months, owner_id: row.owner_id ?? null,
          }, null);
        }
      },
    },
  });

  // ---------------------------------------------------------------- elements, notices, language items
  defineChildRows(ctx, {
    table: 'civil_rights_program_items', parentType: PROGRAM, parentColumn: 'program_id',
    base: '/api/civil-rights/programs', segment: 'items', tag: TAG,
    label: (r) => (r.kind === 'notice' ? 'Public notice' : r.kind === 'language' ? 'Language assistance item' : 'Required element'),
    kinds: ['element', 'notice', 'language'],
    fields: {
      title: { kind: 'text', required: true }, detail: { kind: 'longtext' }, status: { kind: 'lookup', list: 'civil_rights_item_status' },
      site_id: { kind: 'ref', to: 'site' }, language: { kind: 'text', max: 100 }, due_on: { kind: 'date' }, checked_on: { kind: 'date' },
      note: { kind: 'longtext' },
    },
    stamp: { date: 'checked_on', id: 'checked_by', name: 'checked_by_name' },
    view: 'civilrights.view', edit: 'civilrights.edit',
    summary: 'a program\'s required elements, public notice locations and language assistance plan items',
    body: '{ kind: "element" | "notice" | "language" (on add), title, detail?, status?, site_id?, language?, due_on?, checked_on?, note? }',
  });

  // Evidence from the library on one required element (part "element:<item id>").
  defineEvidencePart(app, {
    recordType: PROGRAM, prefix: 'element', label: 'Required element',
    describe: async (d, recordId, key) => (UUID_RE.test(key)
      ? (await d.one<{ title: string }>(`select title from civil_rights_program_items where id = $1 and program_id = $2 and kind = 'element'`, [key, recordId]))?.title ?? null
      : null),
    names: async (d, recordId) => new Map((await d.query<Row>(`select id::text as id, title from civil_rights_program_items where program_id = $1 and kind = 'element'`, [recordId])).map((r) => [r.id, r.title])),
  });

  // ---------------------------------------------------------------- monitoring reports
  ctx.defineResource({
    type: REPORT, table: 'civil_rights_reports', module: 'civilrights', label: 'Civil rights report', plural: 'Civil rights reports',
    path: '/api/civil-rights/reports', route: '/civil-rights/reports', titleField: 'title',
    ref: { field: 'ref', prefix: 'CRR-' }, searchable: ['title', 'notes', 'recipient'],
    defaultSort: { field: 'due_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, help: 'What the report is, for example "Program update".' },
      program_id: { label: 'Program', type: 'ref', to: PROGRAM },
      report_type: { label: 'Report type', type: 'lookup', list: 'civil_rights_report_type' },
      period_label: { label: 'Period', type: 'text', help: 'The period the report covers, in your own words ("First half of the year").' },
      due_on: { label: 'Due on', type: 'date' },
      every_months: { label: 'Repeats every (months)', type: 'number', help: 'When the report is submitted, the next one is planned this many months after its due date. Empty: a one-off report.' },
      status: { label: 'Status', type: 'lookup', list: 'civil_rights_report_status', default: 'planned' },
      owner_id: { label: 'Owner', type: 'user' },
      submitted_on: { label: 'Last submitted on', type: 'date', readOnly: true },
      recipient: { label: 'Sent to', type: 'text', personal: false, help: 'Who receives the report (a body, a funder, the board).' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
  });

  const reportFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find(REPORT, String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Report not found.');

  app.get('/api/civil-rights/reports/:id/submissions', { preHandler: ctx.requirePerm('civilrights.view') }, async (req) => {
    const report = await reportFor(req);
    return db.query<Row>(
      `select id, submitted_on::text as submitted_on, submitted_by_name, recipient, reference, note, created_at
       from civil_rights_report_submissions where report_id = $1 order by submitted_on desc, created_at desc`, [report.id]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/reports/:id/submissions', tag: TAG, permission: 'civilrights.view',
    summary: 'The submission log of a report: each time it was sent, by whom and to whom',
    response: '[{ id, submitted_on, submitted_by_name, recipient, reference, note, created_at }]',
  });

  app.post('/api/civil-rights/reports/:id/submit', { preHandler: ctx.requirePerm('civilrights.edit') }, async (req, reply) => {
    const report = await reportFor(req);
    const b = (req.body ?? {}) as Row;
    const on = b.submitted_on ?? todayInZone();
    if (!isDate(on)) invalid({ submitted_on: 'Give the date it was sent (YYYY-MM-DD).' });
    if (on > todayInZone()) invalid({ submitted_on: 'A report cannot be sent in the future.' });
    const text = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);
    const who = actorOf(req);
    const recipient = text(b.recipient, 300) ?? report.recipient ?? null;
    await db.query(
      `insert into civil_rights_report_submissions (report_id, submitted_on, submitted_by, submitted_by_name, recipient, reference, note) values ($1,$2,$3,$4,$5,$6,$7)`,
      [report.id, on, who.id, who.name, recipient, text(b.reference, 200), text(b.note, 2000)]);
    // System work: "last submitted on" is read-only to forms.
    await ctx.resources.update(REPORT, report.id, { status: 'submitted', submitted_on: on, recipient }, null);
    await ctx.audit(req, {
      action: 'civil_rights_report.submit', recordType: REPORT, recordId: report.id,
      summary: `Report ${report.ref} submitted on ${on}${recipient ? ` to ${recipient}` : ''}`, after: { submitted_on: on, recipient, reference: text(b.reference, 200) },
    });
    // A repeating report: plan the next one, once.
    let next: Row | null = null;
    const every = Number(report.every_months);
    const due = ymd(report.due_on);
    if (Number.isInteger(every) && every > 0 && due) {
      const nextDue = addMonths(due, every);
      const exists = await db.one(
        `select 1 from civil_rights_reports where deleted_at is null and id <> $1 and title = $2 and program_id is not distinct from $3 and due_on = $4`,
        [report.id, report.title, report.program_id, nextDue]);
      if (!exists) {
        next = await ctx.resources.create(REPORT, {
          title: report.title, program_id: report.program_id, report_type: report.report_type, due_on: nextDue, every_months: every,
          owner_id: report.owner_id, recipient: report.recipient,
        }, null);
      }
    }
    reply.code(201);
    return { report: await ctx.resources.find(REPORT, report.id, req.user), next: next ? { id: next.id, ref: next.ref, due_on: ymd(next.due_on) } : null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/civil-rights/reports/:id/submit', tag: TAG, permission: 'civilrights.edit',
    summary: 'Record that a report was sent (added to its submission log); a repeating report gets its next one planned',
    body: '{ submitted_on?: date (today), recipient?, reference?, note? }',
    response: '{ report, next: { id, ref, due_on } | null }',
  });

  // ---------------------------------------------------------------- calendar and My work
  defineCalendarSource(app, {
    key: 'civilrights.reports', label: 'Civil rights reports I own, by due date', kind: 'Civil rights reports',
    recordType: REPORT, permission: 'civilrights.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const rows = await c.db.query<Row>(
        `select r.id, r.ref, r.title, r.due_on::text as d, r.owner_id from civil_rights_reports r
         where r.deleted_at is null and r.status not in (${REPORT_DONE.map((s) => `'${s}'`).join(', ')}) and r.due_on is not null
           and r.due_on <= $3::date and (r.due_on >= $2::date or r.due_on < current_date)
           and ($1::uuid is null or r.owner_id = $1) and ${c.resources.visibleWhere(REPORT, user, 'r')}
         order by r.due_on limit 1000`, [whoFor(user, scope), from, to]);
      return rows.map((r) => ({
        uid: `civilrights.reports:${r.id}`, title: `Report due: ${[r.ref, r.title].filter(Boolean).join(' ')}`, start: ymd(r.d)!, allDay: true,
        url: `/civil-rights/reports/${r.id}`, recordType: REPORT, recordId: r.id, ref: r.ref ?? null, personId: r.owner_id ?? null,
      }));
    },
  });
}
