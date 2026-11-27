// Meetings (E28-03, E28-04): a committee's meeting with its agenda (items may point at a record, or
// at an approval waiting for the chair), the report pack frozen and sent out before it, attendance
// with the quorum worked out from it, and minutes the chair approves through the `meeting_minutes`
// approval kind. Approved minutes lock the meeting: its minutes, attendance, agenda and decisions.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, approvalKind, defineApprovalKind } from '../../core/approval-kinds.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import { memberById, membersOn, quorumOf } from './committees.ts';

export const SESSIONS = ['open', 'closed'] as const;
/** Shown in place of a closed-session item to people who may not read it: the count stays, the detail goes. */
export const CLOSED_TITLE = 'Closed session item';

export const MINUTES_KIND = 'meeting_minutes';
const LOCKED = 'minutes_approved';

export const DEFAULT_MINUTES_WORKFLOW = {
  name: 'Minutes approval',
  description: 'The chair of the meeting approves its minutes once the secretary submits them. Approval locks the minutes, attendance, agenda and decisions.',
  steps: [{ key: 'chair', name: 'Chair', approvers: { kind: 'field', field: 'chair_id' }, quorum: 'any', due_hours: 336 }],
};

/** The meeting a request names, if the caller may see it. */
export async function meetingFor(ctx: ModuleContext, req: FastifyRequest): Promise<Row> {
  return (await ctx.resources.find('meeting', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Meeting not found.');
}

/** A record of any loaded type that the caller may see (for agenda items and decisions), or a validation error. */
export async function visibleTarget(ctx: ModuleContext, req: FastifyRequest | null, type: unknown, id: unknown, field = 'record_id'): Promise<Row> {
  const def = typeof type === 'string' ? ctx.resources.get(type) : undefined;
  const bad = (): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: 'That record was not found.' });
  if (!def || !UUID_RE.test(String(id ?? ''))) bad();
  if (req && !ctx.can(req.user, `${def!.module}.view`)) bad();
  return (await ctx.resources.find(def!.type, String(id), req?.user ?? undefined)) ?? bad();
}

export function registerMeetings(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const engine = () => approvalEngine(app);
  const minutesRunning = async (id: string) => Boolean(await engine()?.running(MINUTES_KIND, id));

  async function beforeCreate(req: FastifyRequest | null, data: Row): Promise<Row> {
    const committee = req
      ? await ctx.resources.find('committee', String(data.committee_id ?? ''), req.user)
      : await db.one<Row>('select * from committees where id = $1 and deleted_at is null', [data.committee_id]);
    if (!committee) invalid({ committee_id: 'Choose a committee.' });
    // A data load (E18-70) may load a past meeting whose minutes were approved long ago.
    if (req && data.status === LOCKED && !isDataLoad(req)) invalid({ status: 'Minutes are approved by the chair through the approval workflow.' });
    // The chair and secretary of the day are kept with the meeting: the chair approves its minutes.
    data.chair_id = committee!.chair_id ?? null;
    data.secretary_id = committee!.secretary_id ?? null;
    return data;
  }

  async function beforeUpdate(req: FastifyRequest | null, existing: Row, patch: Row): Promise<Row> {
    if (!req) return patch; // system work: the approval outcome, the quorum
    if ('committee_id' in patch && patch.committee_id !== existing.committee_id) {
      invalid({ committee_id: 'A meeting stays with its committee. Cancel it and plan one for the other committee.' });
    }
    if (isDataLoad(req)) return patch; // loading history: the dates and statuses given are kept
    if (existing.status === LOCKED) {
      ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved, so the meeting can no longer be changed.');
    }
    if (patch.status === LOCKED) invalid({ status: 'Minutes are approved by the chair through the approval workflow: submit them for approval.' });
    if ('minutes' in patch && patch.minutes !== existing.minutes && await minutesRunning(existing.id)) {
      ctx.fail(409, 'minutes_in_approval', 'The minutes are waiting for the chair\'s approval. Withdraw them (or wait for the decision) before changing them.');
    }
    return patch;
  }

  ctx.defineResource({
    type: 'meeting', table: 'meetings', module: 'governance', label: 'Meeting', plural: 'Meetings',
    path: '/api/meetings', route: '/governance/meetings', titleField: 'title',
    ref: { field: 'ref', prefix: 'MTG-' },
    searchable: ['title', 'location', 'minutes'],
    defaultSort: { field: 'scheduled_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, personal: false },
      committee_id: { label: 'Committee', type: 'ref', to: 'committee', required: true },
      scheduled_at: { label: 'Date and time', type: 'datetime', required: true },
      // E41-17: the calendar invitation's length (an hour when empty) and when it was last emailed.
      duration_minutes: { label: 'Length (minutes)', type: 'number' },
      location: { label: 'Location or call details', type: 'text' },
      status: { label: 'Status', type: 'lookup', list: 'meeting_status', default: 'planned' },
      chair_id: { label: 'Chair', type: 'user', readOnly: true },
      secretary_id: { label: 'Secretary', type: 'user', readOnly: true },
      minutes: { label: 'Minutes', type: 'longtext' },
      quorum_met: { label: 'Quorum met', type: 'boolean', readOnly: true },
      pack_snapshot_id: { label: 'Frozen pack', type: 'text', readOnly: true },
      pack_frozen_at: { label: 'Pack frozen', type: 'datetime', readOnly: true },
      invited_at: { label: 'Invitations sent', type: 'datetime', readOnly: true },
      // Minutes approved at a later meeting by a motion, or by the chair through the approval workflow; then published.
      minutes_approved_on: { label: 'Minutes approved on', type: 'date', readOnly: true },
      minutes_approved_meeting_id: { label: 'Minutes approved at', type: 'ref', to: 'meeting', readOnly: true },
      minutes_approved_decision_id: { label: 'Approving decision', type: 'text', readOnly: true },
      minutes_published_at: { label: 'Minutes published', type: 'datetime', readOnly: true },
      minutes_published_by: { label: 'Minutes published by', type: 'user', readOnly: true },
      minutes_published_by_name: { label: 'Published by (name)', type: 'text', readOnly: true },
    },
    hooks: { beforeCreate, beforeUpdate, afterUpdate: async (req, before, after) => { await agendaPublished(req, before, after); } },
  });

  /** Members with an account hear that the agenda and board book are ready, with a link to their reading view. */
  async function agendaPublished(_req: FastifyRequest | null, before: Row, after: Row) {
    if (before.status === after.status || after.status !== 'agenda_published' || !ctx.app.hasDecorator('notify')) return;
    const members = await membersOn(ctx, after.committee_id, todayInZone(new Date(after.scheduled_at)));
    const person = ctx.resources.get('person');
    const viaPerson = person?.fields.user_id
      ? (await db.query<{ u: string }>(`select user_id::text as u from ${person.table} where id::text = any($1::text[]) and user_id is not null and deleted_at is null`,
        [members.filter((m) => !m.user_id && m.person_id).map((m) => String(m.person_id))])).map((r) => r.u)
      : [];
    const userIds = [...new Set([...members.map((m) => m.user_id).filter(Boolean).map(String), ...viaPerson])];
    if (!userIds.length) return;
    await ctx.app.notify({
      userIds, kind: 'governance', route: `/governance/my-meetings/${after.id}`,
      title: `Agenda published: ${after.ref} ${after.title}`,
      body: 'The agenda and the board book are ready to read.', once: `governance.agenda:${after.id}`,
    });
  }

  async function locked(meeting: Row, req?: FastifyRequest | null) {
    if (isDataLoad(req)) return; // a data load may add the agenda, minutes and votes of a past meeting
    if (meeting.status === LOCKED) ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved, so it can no longer be changed.');
  }

  // ---------- minutes approval ----------

  defineApprovalKind(app, {
    key: MINUTES_KIND, recordType: 'meeting', label: 'Meeting minutes',
    startsWhen: 'The secretary submits the minutes of a meeting that was held',
    outcome: 'Approved: the meeting becomes "Minutes approved" and is locked; rejected: it stays "Held", with the reason in its history, for the minutes to be corrected and submitted again',
    approverPermission: 'governance.view',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_MINUTES_WORKFLOW);
    },
    async onFinish(e) {
      if (e.outcome === 'canceled') return;
      const meeting = await db.one<Row>('select * from meetings where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!meeting) throw new Error('The meeting no longer exists.');
      const who = `${e.approverName ?? 'the chair'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'meeting.minutes_rejected', recordType: 'meeting', recordId: meeting.id,
          summary: `Minutes of ${meeting.ref} sent back by ${who}: ${e.comment ?? 'no reason given'}`, after: { reason: e.comment },
        });
        return;
      }
      await ctx.resources.update('meeting', meeting.id, { status: LOCKED, minutes_approved_on: dayInZone() }, null);
      await ctx.audit(e.req, { action: 'meeting.minutes_approved', recordType: 'meeting', recordId: meeting.id, summary: `Minutes of ${meeting.ref} approved by ${who}` });
    },
  });

  app.post('/api/meetings/:id/minutes/submit', { preHandler: ctx.requirePerm('governance.edit') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    const eng = engine();
    if (!eng) ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available in this installation.');
    if (meeting.status !== 'held') ctx.fail(409, 'not_held', 'Minutes can be submitted once the meeting is marked as held.');
    const written = String(meeting.minutes ?? '').trim()
      || await db.one(`select 1 as ok from agenda_items where meeting_id = $1 and coalesce(trim(discussion), '') <> '' limit 1`, [meeting.id]);
    if (!written) invalid({ minutes: 'Write the minutes before submitting them.' });
    if (!meeting.chair_id) ctx.fail(409, 'no_chair', 'The meeting has no chair to approve its minutes. Name the committee\'s chair first.');
    if (meeting.chair_id === req.user!.id) ctx.fail(409, 'chair_submits', 'You chaired this meeting, so the secretary submits the minutes for your approval.');
    if (await eng!.running(MINUTES_KIND, meeting.id)) ctx.fail(409, 'already_submitted', 'The minutes are already waiting for approval.');
    const note = String((req.body as Row | null)?.note ?? '').trim().slice(0, 2000) || null;
    const started = await eng!.start(MINUTES_KIND, meeting, { requester: req.user!.id, req, note });
    if (!started) ctx.fail(409, 'no_workflow', 'No active Minutes approval workflow applies. An administrator can set one up under Administration > Approval workflows.');
    await ctx.audit(req, { action: 'meeting.minutes_submitted', recordType: 'meeting', recordId: meeting.id, summary: `Minutes of ${meeting.ref} submitted for approval`, after: { workflow: started!.name } });
    reply.code(201);
    return { instance_id: started!.id, workflow: started!.name, status: started!.status };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/minutes/submit', tag: 'Governance', permission: 'governance.edit',
    summary: 'Submit the minutes of a held meeting for the chair\'s approval (starts the Minutes approval workflow)',
    body: '{ note? }', response: '{ instance_id, workflow, status }',
  });

  // ---------- attendance ----------

  async function attendanceOf(meeting: Row): Promise<Row> {
    const day = todayInZone(new Date(meeting.scheduled_at));
    const inOffice = await membersOn(ctx, meeting.committee_id, day);
    const marks = await db.query<Row>('select member_id, present, apology from meeting_attendance where meeting_id = $1', [meeting.id]);
    const byId = new Map(marks.map((r) => [r.member_id, r]));
    const row = (m: Row): Row => ({
      member_id: m.id, name: m.name, side: m.side, role: m.role, voting: m.voting, user_id: m.user_id, person_id: m.person_id,
      present: byId.get(m.id)?.present ?? false, apology: byId.get(m.id)?.apology ?? false, recorded: byId.has(m.id),
    });
    const rows: Row[] = inOffice.map(row);
    // Someone recorded earlier whose term has since been changed still shows.
    for (const r of marks) {
      if (rows.some((x) => x.member_id === r.member_id)) continue;
      const m = await memberById(ctx, r.member_id);
      if (m) rows.push(row(m));
    }
    return { members: rows, quorum: await quorumOf(ctx, meeting) };
  }

  app.get('/api/meetings/:id/attendance', { preHandler: ctx.requirePerm('governance.view') }, async (req) => attendanceOf(await meetingFor(ctx, req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/attendance', tag: 'Governance', permission: 'governance.view',
    summary: 'Who was present or sent apologies, with the quorum worked out from it',
    response: '{ members: [{ member_id, name, side, role, voting, present, apology, recorded }], quorum: { voting, present, needed, met, rule } }',
  });

  app.put('/api/meetings/:id/attendance', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    if (meeting.status === 'canceled') ctx.fail(409, 'canceled', 'The meeting was canceled.');
    const list = (req.body as Row | null)?.attendance;
    if (!Array.isArray(list) || list.length > 500) invalid({ attendance: 'Send the list of members.' });
    const known = new Set((await db.query<{ id: string }>('select id from committee_members where committee_id = $1', [meeting.committee_id])).map((r) => r.id));
    const before = await attendanceOf(meeting);
    for (const a of list as Row[]) {
      const id = String(a?.member_id ?? '');
      if (!UUID_RE.test(id) || !known.has(id)) invalid({ attendance: 'One of the people is not a member of this committee.' });
      const present = a.present === true;
      const apology = !present && a.apology === true;
      await db.query(
        `insert into meeting_attendance (meeting_id, member_id, present, apology, updated_by) values ($1,$2,$3,$4,$5)
         on conflict (meeting_id, member_id) do update set present = excluded.present, apology = excluded.apology, updated_at = now(), updated_by = excluded.updated_by`,
        [meeting.id, id, present, apology, actorOf(req).id]);
    }
    const after = await attendanceOf(meeting);
    const changed = after.members.filter((m: Row) => {
      const b = before.members.find((x: Row) => x.member_id === m.member_id);
      return !b || b.present !== m.present || b.apology !== m.apology;
    });
    if (changed.length) {
      await ctx.audit(req, {
        action: 'meeting.attendance', recordType: 'meeting', recordId: meeting.id,
        summary: `Attendance recorded: ${after.quorum.present} of ${after.quorum.voting} voting members present (quorum ${after.quorum.met ? 'met' : 'not met'})`,
        after: { changed: changed.map((m: Row) => ({ member_id: m.member_id, name: m.name, present: m.present, apology: m.apology })) },
      });
    }
    if (after.quorum.met !== meeting.quorum_met) await ctx.resources.update('meeting', meeting.id, { quorum_met: after.quorum.met }, null);
    return after;
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/meetings/:id/attendance', tag: 'Governance', permission: 'governance.edit',
    summary: 'Record who was present or sent apologies; works out whether the quorum was met',
    body: '{ attendance: [{ member_id, present, apology }] }',
  });

  // ---------- the frozen pack ----------

  app.post('/api/meetings/:id/freeze-pack', { preHandler: ctx.requirePerm('governance.edit') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    await locked(meeting, req);
    if (!ctx.resources.get('report_pack')) ctx.fail(409, 'reports_unavailable', 'Report packs are not available in this installation.');
    if (!ctx.can(req.user, 'reports.export')) ctx.fail(403, 'forbidden', 'Freezing a pack produces it as a document, which needs permission to export reports.');
    const packId = String((req.body as Row | null)?.pack_id ?? '');
    if (!UUID_RE.test(packId)) invalid({ pack_id: 'Choose a report pack.' });
    // The reports module's own rules: the pack must be shared with the caller, and every section is
    // worked out with the caller's permissions, exactly as "Produce" on the pack does.
    const [{ makeSharing }, { makeDocuments }, { makeSnapshots }, { mayView }] = await Promise.all([
      import('../reports/sharing.ts'), import('../reports/documents.ts'), import('../reports/snapshots.ts'), import('../reports/spec.ts'),
    ]);
    const sharing = makeSharing(ctx);
    const pack = (await sharing.load(req.user, 'report_pack', packId)) ?? invalid({ pack_id: 'That report pack was not found.' });
    const documents = makeDocuments(ctx, (user, id) => sharing.load(user, 'report_definition', id));
    const doc = await documents.forPack(req.user!, pack, {
      allow: (r) => r.recordTypes.every((t) => { const d = ctx.resources.get(t); return Boolean(d && mayView(ctx, req.user, d, 'export')); }),
    });
    const snapshotId = await makeSnapshots(ctx).save({
      sourceType: 'pack', sourceId: pack.id, title: `${meeting.ref}: ${doc.title}`, format: 'html', forUser: req.user!,
      content: doc.html, recordTypes: doc.recordTypes, restricted: doc.restricted,
    });
    await ctx.resources.update('meeting', meeting.id, { pack_snapshot_id: snapshotId, pack_frozen_at: new Date().toISOString() }, null);
    await ctx.audit(req, {
      action: 'meeting.pack_frozen', recordType: 'meeting', recordId: meeting.id,
      summary: `Report pack "${pack.name}" frozen for ${meeting.ref}${doc.restricted ? ' (includes restricted records)' : ''}`,
      after: { pack_id: pack.id, snapshot_id: snapshotId, record_types: doc.recordTypes, restricted: doc.restricted },
    });
    reply.code(201);
    return packOf(meeting.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/freeze-pack', tag: 'Governance', permission: 'governance.edit',
    summary: 'Produce a report pack as a dated document kept with the meeting (also needs reports.export)',
    body: '{ pack_id }', response: '{ snapshot: { id, title, created_at, restricted } | null, frozen_at }',
  });

  async function packOf(meetingId: string): Promise<Row> {
    const m = (await db.one<Row>('select pack_snapshot_id, pack_frozen_at from meetings where id = $1', [meetingId]))!;
    const snapshot = m.pack_snapshot_id && ctx.resources.get('report_pack')
      ? await db.one<Row>('select id, title, created_at, restricted, size_bytes from report_snapshots where id = $1', [m.pack_snapshot_id]) ?? null
      : null;
    return { snapshot, frozen_at: m.pack_frozen_at };
  }

  app.get('/api/meetings/:id/pack', { preHandler: ctx.requirePerm('governance.view') }, async (req) => packOf((await meetingFor(ctx, req)).id));
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/pack', tag: 'Governance', permission: 'governance.view',
    summary: 'The report pack frozen for a meeting (open it under Reports, which applies its own access rules)',
    response: '{ snapshot: { id, title, created_at, restricted, size_bytes } | null, frozen_at }',
  });

  // ---------- meetings of one committee ----------

  app.get('/api/committees/:id/meetings', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const committee = (await ctx.resources.find('committee', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Committee not found.');
    return db.query<Row>(
      `select id, ref, title, scheduled_at, status, quorum_met from meetings where committee_id = $1 and deleted_at is null order by scheduled_at desc limit 200`, [committee.id]);
  });
  ctx.describeRoute({ method: 'GET', path: '/api/committees/:id/meetings', tag: 'Governance', permission: 'governance.view', summary: 'Meetings of one committee, newest first' });
}
