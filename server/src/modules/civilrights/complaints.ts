// Civil rights complaints: intake (date and channel received, the complainant or "anonymous", the
// basis, the program and the related service, vehicle, site or employee), the time limits the
// organization sets (acknowledgment, investigation, appeal), investigation steps and letters sent,
// findings, outcome, appeal and closure.
//
// Complaints are confidential by default, as confidential safety reports are: a confidential
// complaint is seen only by the people an administrator names as complaint handlers (Civil rights >
// Settings), its investigator and the person who entered it. Everyone else who may see the area sees
// the counts (figures are the same for everyone) but never the complaint, its words or its people.
// The rule is the type's row rule, so lists, search, links, exports, reports and the assistant follow
// it. A complaint marked not confidential is seen by everyone who may see the area.
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, RowRule, SessionUser } from '../../core/module.ts';
import { ANONYMIZED_TEXT, onAnonymize } from '../../core/retention.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { defineChildRows } from './children.ts';
import { COMPLAINT_FINAL } from './lists.ts';
import { PROGRAM } from './programs.ts';
import { readSettings } from './settings.ts';

export const COMPLAINT = 'civil_rights_complaint';
const TAG = 'Civil rights';
const MAX_HANDLERS = 25;
const ymd = (v: unknown): string | null => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const finalList = COMPLAINT_FINAL.map((s) => `'${s}'`).join(', ');

/** The complaint's row rule: a confidential complaint is seen by named handlers, its investigator and who entered it. */
export function complaintRule(): RowRule {
  return {
    where: (user, col) => {
      if (!UUID_RE.test(user.id)) return `not ${col('confidential')}`;
      const uid = user.id;
      return `(not ${col('confidential')} or ${col('investigator_id')} = '${uid}' or ${col('created_by')} = '${uid}'
        or exists (select 1 from civil_rights_complaint_viewers crv_ where crv_.user_id = '${uid}'))`;
    },
    figures: 'mask',
    hidden: (col) => `${col('confidential')}`,
  };
}

/** The next time limit still open on a complaint, or null once it is closed or every limit is met. */
export function nextDue(r: Row): string | null {
  if (COMPLAINT_FINAL.includes(String(r.status))) return null;
  if (r.appeal_received_on && !r.appeal_decided_on) return ymd(r.appeal_due_on);
  if (!r.acknowledged_on && r.ack_due_on) return ymd(r.ack_due_on);
  if (!r.findings_on && r.investigation_due_on) return ymd(r.investigation_due_on);
  return null;
}

/** The complaint's time limits with their state (met, met late, open, due soon, overdue). */
export function limitsOf(r: Row, soonDays: number, today = todayInZone()): Row[] {
  const closed = COMPLAINT_FINAL.includes(String(r.status));
  const one = (key: string, label: string, due: unknown, done: unknown) => {
    const d = ymd(due);
    const at = ymd(done);
    if (!d) return null;
    const state = at ? (at > d ? 'late' : 'met') : closed ? 'stopped' : d < today ? 'overdue' : addDays(today, soonDays) >= d ? 'soon' : 'open';
    return { key, label, due_on: d, done_on: at, state, days_left: at || closed ? null : Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) };
  };
  return [
    one('ack', 'Acknowledge', r.ack_due_on, r.acknowledged_on),
    one('investigation', 'Finish the investigation', r.investigation_due_on, r.findings_on),
    r.appeal_received_on ? one('appeal', 'Decide the appeal', r.appeal_due_on, r.appeal_decided_on) : null,
  ].filter(Boolean) as Row[];
}

export async function registerComplaints(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function check(req: FastifyRequest | null, merged: Row, patch: Row, existing: Row | null): Promise<Row> {
    const load = isDataLoad(req);
    const today = todayInZone();
    const s = await readSettings(ctx);
    if (!load && 'received_on' in patch && patch.received_on && ymd(patch.received_on)! > today) invalid({ received_on: 'A complaint cannot be received in the future.' });
    if (merged.anonymous === true) {
      // An anonymous complaint keeps no name or contact.
      if (merged.complainant_name) patch.complainant_name = null;
      if (merged.complainant_contact) patch.complainant_contact = null;
    }
    // Changing who may see the complaint is for administrators of the area or its handlers.
    if (existing && 'confidential' in patch && patch.confidential !== existing.confidential && req?.user
      && !ctx.can(req.user, 'civilrights.administer') && !(await isHandler(req.user))) {
      ctx.fail(403, 'forbidden', 'Only the named complaint handlers and administrators of civil rights can change whether a complaint is confidential.');
    }
    // Time limits counted from the day received (and the day an appeal arrived), by the organization's settings.
    const received = ymd(merged.received_on);
    if (received && (!existing || 'received_on' in patch)) {
      patch.ack_due_on = addDays(received, s.ackDays);
      patch.investigation_due_on = addDays(received, s.investigationDays);
    }
    const appeal = ymd(merged.appeal_received_on);
    if ('appeal_received_on' in patch) patch.appeal_due_on = appeal ? addDays(appeal, s.appealDays) : null;
    // Status moves fill the dates they mean (skipped in a data load, which gives its own dates).
    if (!load && 'status' in patch && patch.status !== existing?.status) {
      const to = String(patch.status);
      if (to === 'acknowledged' && !merged.acknowledged_on) patch.acknowledged_on = today;
      if (to === 'findings_issued') {
        if (!String(merged.findings ?? '').trim()) invalid({ findings: 'Write the findings before they are issued.' });
        if (!merged.findings_on) patch.findings_on = today;
      }
      if (to === 'appealed' && !merged.appeal_received_on) {
        patch.appeal_received_on = today;
        patch.appeal_due_on = addDays(today, s.appealDays);
      }
      if (to === 'closed' && !merged.outcome) invalid({ outcome: 'Choose the outcome before the complaint is closed.' });
      if (to === 'withdrawn' && !merged.outcome) patch.outcome = 'withdrawn';
      if (COMPLAINT_FINAL.includes(to) && !merged.closed_on) patch.closed_on = today;
      if (!COMPLAINT_FINAL.includes(to) && existing && COMPLAINT_FINAL.includes(String(existing.status))) patch.closed_on = null;
    }
    patch.next_due_on = nextDue({ ...merged, ...patch });
    return patch;
  }

  ctx.defineResource({
    type: COMPLAINT, table: 'civil_rights_complaints', module: 'civilrights', label: 'Civil rights complaint', plural: 'Civil rights complaints',
    path: '/api/civil-rights/complaints', route: '/civil-rights/complaints', titleField: 'subject',
    ref: { field: 'ref', prefix: 'CRC-' }, searchable: ['subject', 'description', 'findings'],
    defaultSort: { field: 'next_due_on', dir: 'asc' },
    rowRule: complaintRule(),
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      subject: { label: 'Subject', type: 'text', required: true, personal: false, help: 'A short title for lists, never the complainant\'s name ("Ramp not deployed at a stop").' },
      received_on: { label: 'Received on', type: 'date', help: 'Today when left empty. The time limits are counted from this day.' },
      channel: { label: 'Received by', type: 'lookup', list: 'civil_rights_channel' },
      anonymous: { label: 'Anonymous', type: 'boolean', default: false, help: 'The complainant did not give a name; no name or contact is kept.' },
      complainant_name: { label: 'Complainant', type: 'text', personal: true },
      complainant_contact: { label: 'Complainant contact', type: 'text', personal: true, help: 'Address, phone or email for letters.' },
      language_needed: { label: 'Language or format needed', type: 'text', personal: true, help: 'A language other than English, or an accessible format, for letters and interviews.' },
      basis: { label: 'Basis', type: 'lookup', list: 'civil_rights_basis', help: 'What the complaint says the treatment was based on (your own list).' },
      program_id: { label: 'Program', type: 'ref', to: PROGRAM },
      service_id: { label: 'Route or service', type: 'ref', to: 'service' },
      vehicle_id: { label: 'Vehicle', type: 'ref', to: 'vehicle' },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      employee_id: { label: 'Employee involved', type: 'ref', to: 'person', personal: true },
      occurred_on: { label: 'Happened on', type: 'date' },
      description: { label: 'What happened', type: 'longtext', personal: true },
      investigator_id: { label: 'Investigator', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'civil_rights_complaint_status', default: 'received' },
      ack_due_on: { label: 'Acknowledge by', type: 'date', readOnly: true },
      acknowledged_on: { label: 'Acknowledged on', type: 'date' },
      investigation_due_on: { label: 'Investigation due', type: 'date', readOnly: true },
      findings: { label: 'Findings', type: 'longtext', personal: true },
      findings_on: { label: 'Findings issued on', type: 'date' },
      outcome: { label: 'Outcome', type: 'lookup', list: 'civil_rights_outcome' },
      appeal_received_on: { label: 'Appeal received on', type: 'date' },
      appeal_due_on: { label: 'Appeal decision due', type: 'date', readOnly: true },
      appeal_decision: { label: 'Appeal decision', type: 'longtext', personal: true },
      appeal_decided_on: { label: 'Appeal decided on', type: 'date' },
      closed_on: { label: 'Closed on', type: 'date' },
      next_due_on: { label: 'Next due', type: 'date', readOnly: true },
      confidential: { label: 'Confidential', type: 'boolean', default: true, help: 'Seen only by the named complaint handlers, the investigator and the person who entered it. Everyone else sees counts only.' },
    },
    hooks: {
      beforeCreate: async (req, data) => {
        data.received_on ??= todayInZone();
        return check(req, data, data, null);
      },
      beforeUpdate: async (req, existing, patch) => check(req, { ...existing, ...patch }, patch, existing),
    },
  });

  // Anonymizing a complaint (end of its retention period) also blanks the notes of its steps and letters.
  onAnonymize(COMPLAINT, async (tx, id) => {
    await tx.query(`update civil_rights_complaint_steps set note = case when note is null then null else $2 end, done_by_name = null, updated_at = now() where complaint_id = $1`, [id, ANONYMIZED_TEXT]);
  }, 'civilrights');

  defineChildRows(ctx, {
    table: 'civil_rights_complaint_steps', parentType: COMPLAINT, parentColumn: 'complaint_id',
    base: '/api/civil-rights/complaints', segment: 'steps', tag: TAG,
    label: (r) => (r.kind === 'letter' ? 'Letter' : 'Investigation step'),
    kinds: ['step', 'letter'],
    fields: { title: { kind: 'text', required: true }, due_on: { kind: 'date' }, done_on: { kind: 'date' }, note: { kind: 'longtext' } },
    stamp: { date: 'done_on', id: 'done_by', name: 'done_by_name' },
    view: 'civilrights.view', edit: 'civilrights.edit',
    summary: 'a complaint\'s investigation steps and letters sent (a letter\'s "done on" is the day it was sent; its file is an attachment of the complaint)',
    body: '{ kind: "step" | "letter" (on add), title, due_on?, done_on?, note? }',
  });

  // ---------------------------------------------------------------- complaint handlers

  /** Active people with the permissions their enabled roles grant. */
  async function people(ids: string[] | null): Promise<SessionUser[]> {
    const rows = await db.query<Row>(
      `select u.id, u.username, u.display_name, u.email,
          coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
          coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
       from users u
       left join user_roles ur on ur.user_id = u.id
       left join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
       where u.status = 'active' and u.deleted_at is null and ($1::uuid[] is null or u.id = any($1::uuid[]))
       group by u.id order by u.display_name`, [ids]);
    return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, roles: r.roles, permissions: r.permissions }) as SessionUser);
  }
  const mayBeNamed = (u: SessionUser) => ctx.can(u, 'civilrights.view');
  const handlerIds = async () => (await db.query<{ user_id: string }>('select user_id from civil_rights_complaint_viewers order by added_at')).map((r) => r.user_id);
  async function isHandler(user: SessionUser): Promise<boolean> {
    return UUID_RE.test(user.id) && Boolean(await db.one('select 1 from civil_rights_complaint_viewers where user_id = $1', [user.id]));
  }

  async function handlerState(user: SessionUser) {
    const ids = await handlerIds();
    const found = ids.length ? await people(ids) : [];
    const admin = ctx.can(user, 'civilrights.administer');
    return {
      handlers: ids.map((id) => {
        const p = found.find((u) => u.id === id);
        return { id, label: p?.displayName ?? 'Inactive or removed user', eligible: Boolean(p && mayBeNamed(p)) };
      }),
      named: await isHandler(user),
      eligible: admin ? (await people(null)).filter(mayBeNamed).map((u) => ({ id: u.id, label: u.displayName })) : undefined,
      can_administer: admin,
    };
  }

  app.get('/api/civil-rights/complaint-handlers', { preHandler: ctx.requirePerm('civilrights.view') }, async (req) => handlerState(req.user!));
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/complaint-handlers', tag: TAG, permission: 'civilrights.view',
    summary: 'The people named to handle confidential complaints, and whether I am one of them',
    description: 'Administrators of civil rights (`civilrights.administer`) also get the people who may be named.',
    response: '{ handlers: [{ id, label, eligible }], named, eligible?: [{ id, label }], can_administer }',
  });

  app.put('/api/civil-rights/complaint-handlers', { preHandler: ctx.requirePerm('civilrights.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    if (!Array.isArray(b.handlers) || b.handlers.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))) invalid({ handlers: 'Choose people from the list.' });
    const ids = [...new Set(b.handlers as string[])];
    if (ids.length > MAX_HANDLERS) invalid({ handlers: `Name at most ${MAX_HANDLERS} people.` });
    const before = await handlerIds();
    const added = ids.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !ids.includes(id));
    if (!added.length && !removed.length) return handlerState(req.user!);
    const found = added.length ? await people(added) : [];
    if (added.some((id) => !found.some((u) => u.id === id && mayBeNamed(u)))) invalid({ handlers: 'Only active people who can see civil rights can be named.' });
    // Naming someone lets them read every confidential complaint: confirm who is asking first.
    if (added.length) await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'name people who may handle confidential civil rights complaints');
    const save = async () => {
      if (removed.length) await db.query('delete from civil_rights_complaint_viewers where user_id = any($1::uuid[])', [removed]);
      for (const id of added) await db.query('insert into civil_rights_complaint_viewers (user_id, added_by) values ($1, $2) on conflict do nothing', [id, req.user!.id]);
      const names = added.map((id) => found.find((u) => u.id === id)?.displayName ?? id);
      await ctx.audit(req, {
        action: 'civilrights.complaint_handlers',
        summary: `Complaint handlers changed${added.length ? `; added: ${names.join(', ')}` : ''}${removed.length ? `; ${removed.length} removed` : ''}`,
        before: { handlers: before }, after: { handlers: ids },
      });
    };
    await (db.atomic ? db.atomic(save) : save());
    return handlerState(req.user!);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/civil-rights/complaint-handlers', tag: TAG, permission: 'civilrights.administer',
    summary: 'Name the people who handle confidential complaints (they see every one)',
    description: `Replaces the list. Each person must be active and hold \`civilrights.view\`; at most ${MAX_HANDLERS}. Adding anyone needs a recent password confirmation (403 \`reauth_required\`). Audited.`,
    body: '{ handlers: [uuid] }',
  });

  // ---------------------------------------------------------------- clock

  app.get('/api/civil-rights/complaints/:id/clock', { preHandler: ctx.requirePerm('civilrights.view') }, async (req) => {
    const c = (await ctx.resources.find(COMPLAINT, String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Complaint not found.');
    const s = await readSettings(ctx);
    const limits = limitsOf(c, s.reminderDays);
    const steps = await db.query<Row>(
      `select count(*) filter (where done_on is null and due_on < $2::date)::int as overdue, count(*) filter (where done_on is null)::int as open
       from civil_rights_complaint_steps where complaint_id = $1 and kind = 'step'`, [c.id, todayInZone()]);
    return { limits, next_due_on: nextDue(c), overdue: limits.some((l) => l.state === 'overdue'), steps: steps[0] };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/complaints/:id/clock', tag: TAG, permission: 'civilrights.view',
    summary: 'A complaint\'s time limits (acknowledgment, investigation, appeal) with their state, and its open and overdue steps',
    response: '{ limits: [{ key, label, due_on, done_on, state: "open" | "soon" | "overdue" | "met" | "late" | "stopped", days_left }], next_due_on, overdue, steps: { open, overdue } }',
  });

  // ---------------------------------------------------------------- calendar and My work (the investigator)

  defineCalendarSource(app, {
    key: 'civilrights.complaints', label: 'Civil rights complaints I investigate: time limits and steps', kind: 'Civil rights complaints',
    recordType: COMPLAINT, permission: 'civilrights.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      const who = whoFor(user, scope);
      const open = `c.deleted_at is null and c.status not in (${finalList}) and ${c.resources.visibleWhere(COMPLAINT, user, 'c')}`;
      const limits = await c.db.query<Row>(
        `select c.id, c.ref, c.next_due_on::text as d, c.investigator_id, c.acknowledged_on, c.findings_on, c.appeal_received_on, c.appeal_decided_on
         from civil_rights_complaints c
         where ${open} and c.next_due_on is not null and c.next_due_on <= $3::date and (c.next_due_on >= $2::date or c.next_due_on < current_date)
           and ($1::uuid is null or c.investigator_id = $1)
         order by c.next_due_on limit 1000`, [who, from, to]);
      const steps = await c.db.query<Row>(
        `select s.id as step_id, s.title, s.due_on::text as d, c.id, c.ref, c.investigator_id
         from civil_rights_complaint_steps s join civil_rights_complaints c on c.id = s.complaint_id
         where ${open} and s.kind = 'step' and s.done_on is null and s.due_on is not null
           and s.due_on <= $3::date and (s.due_on >= $2::date or s.due_on < current_date) and ($1::uuid is null or c.investigator_id = $1)
         order by s.due_on limit 1000`, [who, from, to]);
      const what = (r: Row) => (r.appeal_received_on && !r.appeal_decided_on ? 'Decide the appeal on' : !r.acknowledged_on ? 'Acknowledge' : 'Finish the investigation of');
      return [
        ...limits.map((r) => ({
          uid: `civilrights.complaints:${r.id}`, title: `${what(r)} complaint ${r.ref}`, start: ymd(r.d)!, allDay: true,
          url: `/civil-rights/complaints/${r.id}`, recordType: COMPLAINT, recordId: r.id, ref: r.ref ?? null, personId: r.investigator_id ?? null,
        })),
        ...steps.map((r) => ({
          uid: `civilrights.complaint_step:${r.step_id}`, title: `Complaint ${r.ref}: ${r.title}`, start: ymd(r.d)!, allDay: true,
          url: `/civil-rights/complaints/${r.id}`, recordType: COMPLAINT, recordId: r.id, ref: r.ref ?? null, personId: r.investigator_id ?? null,
        })),
      ];
    },
  });

  return { isHandler };
}
