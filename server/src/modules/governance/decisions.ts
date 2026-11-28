// Decisions (E28-05, E28-06): every decision a committee takes, in one register, linked (relation
// `decided`) to the record it is about. A decision about a record whose approval is waiting for the
// committee's chair can complete that step: the decision is applied through the approval engine as
// the chair's own decision, so every rule of the engine holds (the chair must be a named approver of
// the step now waiting, must still hold the kind's permission, must see the record, must not have
// asked for the approval, and must not have decided another step where the step asks for a different
// person). Only the chair may apply it, or the secretary once the chair has approved the minutes.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, approvalKind, approvalKinds } from '../../core/approval-kinds.ts';
import { actorOf, dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { memberById, memberSql } from './committees.ts';
import { visibleTarget } from './meetings.ts';

const RELATION = 'decided';
const APPLICABLE = new Set(['approved', 'rejected']);
const OPEN_MEETING = new Set(['held', 'minutes_approved']);

export function registerDecisions(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const engine = () => approvalEngine(app);

  async function meetingOf(req: FastifyRequest | null, id: unknown): Promise<Row> {
    const meeting = req
      ? await ctx.resources.find('meeting', String(id ?? ''), req.user)
      : await db.one<Row>('select * from meetings where id = $1 and deleted_at is null', [id]);
    return meeting ?? invalid({ meeting_id: 'Choose a meeting.' });
  }

  async function check(req: FastifyRequest | null, merged: Row, patch: Row, existing: Row | null): Promise<Row> {
    if (!req) return patch;
    if (existing && 'meeting_id' in patch && patch.meeting_id !== existing.meeting_id) invalid({ meeting_id: 'A decision stays with the meeting it was taken at.' });
    const meeting = await meetingOf(req, merged.meeting_id);
    if (meeting.status === 'minutes_approved' && !isDataLoad(req)) ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved, so its decisions can no longer be changed.');
    if (meeting.status === 'canceled') ctx.fail(409, 'canceled', 'The meeting was canceled.');
    if (existing?.applied_at && ['outcome', 'record_type', 'record_id'].some((k) => k in patch && patch[k] !== existing[k])) {
      ctx.fail(409, 'applied', 'This decision has completed an approval step, so its outcome and record can no longer be changed.');
    }
    if ('agenda_item_id' in patch && !patch.agenda_item_id) patch.agenda_item_id = null;
    if ('agenda_item_id' in patch && patch.agenda_item_id) {
      const item = UUID_RE.test(String(patch.agenda_item_id))
        ? await db.one<Row>('select session from agenda_items where id = $1 and meeting_id = $2', [patch.agenda_item_id, meeting.id]) : undefined;
      if (!item) invalid({ agenda_item_id: 'Choose an item of this meeting\'s agenda.' });
      // A decision taken in closed session is read only by the committee's members (rowRule below).
      patch.closed_session = item!.session === 'closed';
    } else if ('agenda_item_id' in patch) patch.closed_session = false;
    if (typeof patch.resolution_number === 'string') {
      patch.resolution_number = patch.resolution_number.trim().slice(0, 60) || null;
      if (patch.resolution_number) {
        const taken = await db.one<Row>(
          `select d.ref from meeting_decisions d join meetings m on m.id = d.meeting_id
           where m.committee_id = $1 and d.deleted_at is null and lower(d.resolution_number) = lower($2) and d.id::text <> $3 limit 1`,
          [meeting.committee_id, patch.resolution_number, String(existing?.id ?? '')]);
        if (taken) invalid({ resolution_number: `Resolution ${patch.resolution_number} is already used (${taken.ref}).` });
      }
    }
    if ('record_type' in patch || 'record_id' in patch) {
      if (merged.record_type || merged.record_id) {
        if (!merged.record_type || !merged.record_id) invalid({ record_id: 'Choose the record decided, or leave both empty.' });
        await visibleTarget(ctx, req, merged.record_type, merged.record_id);
      } else { patch.record_type = null; patch.record_id = null; }
    }
    return patch;
  }

  /** The `decided` link from the decision to its record, kept in step with the decision. */
  async function syncLink(row: Row, req: FastifyRequest | null) {
    await db.query(`delete from record_links where from_type = 'meeting_decision' and from_id = $1 and relation = $2
      and not (to_type is not distinct from $3 and to_id::text is not distinct from $4)`, [row.id, RELATION, row.record_type ?? null, row.record_id ?? null]);
    if (row.record_type && row.record_id) {
      await db.query(
        `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('meeting_decision', $1, $2, $3, $4, $5)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing`,
        [row.id, row.record_type, row.record_id, RELATION, actorOf(req).id]);
    }
  }

  ctx.defineResource({
    type: 'meeting_decision', table: 'meeting_decisions', module: 'governance', label: 'Decision', plural: 'Decisions',
    path: '/api/meeting-decisions', route: '/governance/decisions', titleField: 'title',
    ref: { field: 'ref', prefix: 'DEC-' },
    // A decision about a restricted record (a risk, a security incident) is restricted with it.
    restricted: 'flag', restrictedFrom: { typeField: 'record_type', idField: 'record_id' },
    // A decision taken in closed session is read by the committee's members, chair and secretary and by
    // the people who prepare meetings; figures still count it, without its words.
    rowRule: {
      where: (user, col) => (ctx.can(user, 'governance.edit') ? 'true'
        : `(not coalesce(${col('closed_session')}, false) or ${memberSql(ctx, user.id, `(select mm_.committee_id from meetings mm_ where mm_.id = ${col('meeting_id')})`)})`),
      figures: 'mask',
      hidden: (col) => `coalesce(${col('closed_session')}, false)`,
    },
    searchable: ['title', 'notes', 'motion_text', 'resolution_number'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Decision', type: 'text', required: true, personal: false },
      meeting_id: { label: 'Meeting', type: 'ref', to: 'meeting', required: true },
      outcome: { label: 'Outcome', type: 'lookup', list: 'decision_outcome', default: 'approved' },
      notes: { label: 'Notes', type: 'longtext' },
      agenda_item_id: { label: 'Agenda item', type: 'text' },
      record_type: { label: 'Record type decided', type: 'text' },
      record_id: { label: 'Record decided', type: 'text' },
      restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      applied_to_workflow: { label: 'Applied to approval', type: 'text', readOnly: true, personal: false },
      applied_at: { label: 'Applied', type: 'datetime', readOnly: true },
      applied_by: { label: 'Applied by', type: 'user', readOnly: true },
      // The motion (wave 25): recorded with POST /api/meetings/:id/motions, which names the mover and
      // seconder and records the vote; the text and resolution number can be corrected here.
      motion_text: { label: 'Motion', type: 'longtext', personal: false },
      resolution_number: { label: 'Resolution number', type: 'text', personal: false },
      mover_name: { label: 'Moved by', type: 'text', readOnly: true, personal: true },
      mover_member_id: { label: 'Mover (member)', type: 'text', readOnly: true },
      mover_user_id: { label: 'Mover (account)', type: 'user', readOnly: true },
      seconder_name: { label: 'Seconded by', type: 'text', readOnly: true, personal: true },
      seconder_member_id: { label: 'Seconder (member)', type: 'text', readOnly: true },
      seconder_user_id: { label: 'Seconder (account)', type: 'user', readOnly: true },
      vote_mode: { label: 'Vote recorded', type: 'text', readOnly: true, personal: false },
      votes_for: { label: 'For', type: 'number', readOnly: true },
      votes_against: { label: 'Against', type: 'number', readOnly: true },
      votes_abstain: { label: 'Abstaining', type: 'number', readOnly: true },
      votes_absent: { label: 'Absent', type: 'number', readOnly: true },
      votes_recused: { label: 'Recused', type: 'number', readOnly: true },
      vote_summary: { label: 'Vote', type: 'text', readOnly: true, personal: false },
      closed_session: { label: 'Closed session', type: 'boolean', readOnly: true },
      consent_agenda: { label: 'Adopts the consent agenda', type: 'boolean', readOnly: true },
      recorded_by: { label: 'Recorded by', type: 'user', readOnly: true },
      recorded_by_name: { label: 'Recorded by (name)', type: 'text', readOnly: true },
    },
    hooks: {
      beforeCreate: async (req, data) => {
        if (req && data.agenda_item_id === '') data.agenda_item_id = null;
        return check(req, data, data, null);
      },
      beforeUpdate: async (req, existing, patch) => check(req, { ...existing, ...patch }, patch, existing),
      afterCreate: async (req, row) => syncLink(row, req),
      afterUpdate: async (req, before, after) => {
        if (before.record_type !== after.record_type || String(before.record_id ?? '') !== String(after.record_id ?? '')) await syncLink(after, req);
      },
    },
  });

  // ---------- applying a decision to a waiting approval (E28-06) ----------

  /** The running approvals on a record whose current step the chair may decide now (engine rules applied). */
  async function decidable(recordType: string, recordId: string, chairId: string): Promise<{ kind: string; instanceId: string; name: string; stepId: string | null }[]> {
    const eng = engine();
    if (!eng) return [];
    const out: { kind: string; instanceId: string; name: string; stepId: string | null }[] = [];
    for (const k of approvalKinds(app)) {
      if (k.recordType !== recordType) continue;
      const p = await eng.progress(k.key, recordId, chairId);
      if (p.instance?.status === 'running' && p.canDecide) out.push({ kind: k.key, instanceId: p.instance.id, name: p.instance.name, stepId: p.stepId });
    }
    return out;
  }

  app.post('/api/meeting-decisions/:id/apply', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const decision = (await ctx.resources.find('meeting_decision', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Decision not found.');
    const eng = engine();
    if (!eng) ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available in this installation.');
    if (decision.applied_at) ctx.fail(409, 'already_applied', 'This decision has already been applied.');
    if (!APPLICABLE.has(decision.outcome)) ctx.fail(409, 'not_applicable', 'Only an approval or a rejection can complete an approval step.');
    if (!decision.record_type || !decision.record_id) ctx.fail(409, 'no_record', 'The decision does not name the record decided.');
    const meeting = (await db.one<Row>('select * from meetings where id = $1 and deleted_at is null', [decision.meeting_id])) ?? ctx.fail(404, 'not_found', 'Meeting not found.');
    if (!OPEN_MEETING.has(meeting.status)) ctx.fail(409, 'not_held', 'A decision can be applied once the meeting has been held.');
    if (!meeting.chair_id) ctx.fail(409, 'no_chair', 'The meeting has no chair.');
    const committee = await db.one<Row>('select name, secretary_id from committees where id = $1', [meeting.committee_id]);
    // E18-94: in a load that names the chair or secretary, the rules are checked against them.
    const me = actorOf(req).id;
    const isChair = !!me && meeting.chair_id === me;
    const isSecretary = !!me && [meeting.secretary_id, committee?.secretary_id].includes(me) && ctx.can(req.user, 'governance.edit');
    if (!isChair && !isSecretary) ctx.fail(403, 'forbidden', 'Only the chair or the secretary of the committee may apply its decisions.');
    // The secretary acts for the chair only on minutes the chair has approved.
    if (!isChair && meeting.status !== 'minutes_approved') {
      ctx.fail(409, 'minutes_not_approved', 'The secretary can apply a decision once the chair has approved the minutes; until then only the chair can.');
    }
    // The caller must see the record too (restricted records need security.view).
    await visibleTarget(ctx, req, decision.record_type, decision.record_id).catch(() => ctx.fail(404, 'not_found', 'The record decided was not found.'));

    const agenda = decision.agenda_item_id && UUID_RE.test(String(decision.agenda_item_id))
      ? await db.one<Row>('select workflow_kind, workflow_instance_id from agenda_items where id = $1', [decision.agenda_item_id]) : undefined;
    let options = await decidable(decision.record_type, decision.record_id, meeting.chair_id);
    if (agenda?.workflow_instance_id && options.some((o) => o.instanceId === agenda.workflow_instance_id)) options = options.filter((o) => o.instanceId === agenda.workflow_instance_id);
    if (!options.length) {
      ctx.fail(409, 'chair_not_approver', 'No approval on this record is waiting for the chair now (the chair must be a named approver of the current step, still allowed to decide it), so the decision cannot be applied. Record it on the approval itself.');
    }
    if (options.length > 1) ctx.fail(409, 'ambiguous', 'Several approvals on this record wait for the chair. Put the one decided on the agenda item of this decision.');
    const target = options[0];

    // Claimed first, so two requests at once cannot apply it twice.
    const at = (req.body as Row | null)?.applied_at;
    const loadedAt = typeof at === 'string' && !Number.isNaN(Date.parse(at)) && await dataLoadFor(db, req) ? new Date(at).toISOString() : null;
    const claimed = await db.one('update meeting_decisions set applied_at = coalesce($3::timestamptz, now()), applied_by = $2 where id = $1 and applied_at is null returning id', [decision.id, me, loadedAt]);
    if (!claimed) ctx.fail(409, 'already_applied', 'This decision has already been applied.');
    const verb = decision.outcome === 'approved' ? 'Approved' : 'Rejected';
    const comment = `Decided at ${meeting.ref} (${committee?.name ?? 'committee'}): ${decision.ref} ${decision.title}`.slice(0, 2000);
    try {
      // No request: the engine records the decision as the chair's own (opts.userId) and checks every rule against the chair.
      await eng!.decide(target.kind, decision.record_id, null, decision.outcome as 'approved' | 'rejected', comment, { userId: meeting.chair_id, via: 'meeting' });
    } catch (err) {
      await db.query('update meeting_decisions set applied_at = null, applied_by = null where id = $1', [decision.id]);
      throw err;
    }
    const chair = (await db.one<{ n: string }>('select display_name as n from users where id = $1', [meeting.chair_id]))?.n ?? 'the chair';
    const label = approvalKind(app, target.kind)?.label ?? target.kind;
    const applied = `${label} "${target.name}": ${verb.toLowerCase()} as ${chair}`;
    await db.query('update meeting_decisions set applied_to_workflow = $2 where id = $1', [decision.id, applied.slice(0, 300)]);
    await ctx.audit(req, {
      action: 'meeting_decision.apply', recordType: 'meeting_decision', recordId: decision.id,
      summary: `${verb} the waiting step of ${label.toLowerCase()} "${target.name}" as ${chair}, by ${req.user!.displayName}`,
      after: { kind: target.kind, instance_id: target.instanceId, step_id: target.stepId, decision: decision.outcome, chair_id: meeting.chair_id },
    });
    // The record's history names the meeting and decision by reference only: a restricted record's details stay with it.
    await ctx.audit(req, {
      action: 'workflow.decided_at_meeting', recordType: decision.record_type, recordId: decision.record_id,
      summary: `${verb} at meeting ${meeting.ref} (decision ${decision.ref}) as ${chair}, applied by ${req.user!.displayName}`,
      after: { kind: target.kind, instance_id: target.instanceId, decision_id: decision.id, meeting_id: meeting.id },
    });
    return ctx.resources.find('meeting_decision', decision.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meeting-decisions/:id/apply', tag: 'Governance', permission: 'governance.view',
    summary: 'Complete the approval step waiting on the decided record as the chair\'s decision (by the chair, or by the secretary with governance.edit once the minutes are approved)',
    response: 'the decision, with applied_to_workflow and applied_at',
  });

  app.get('/api/governance/waiting-decisions', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const id = String((req.query as Row).committee ?? '');
    const committee = (await ctx.resources.find('committee', id, req.user)) ?? ctx.fail(404, 'not_found', 'Committee not found.');
    const eng = engine();
    if (!committee.chair_id || !eng) return { chair_id: committee.chair_id ?? null, items: [] };
    const items: Row[] = [];
    for (const k of approvalKinds(app)) {
      const def = ctx.resources.get(k.recordType);
      if (!def || !ctx.can(req.user, `${def.module}.view`)) continue;
      const waiting = [...new Set(await eng.waiting(k.key, committee.chair_id))].filter((rid) => UUID_RE.test(rid));
      // The records, once per kind (E40-09); a record the reader may not see is left out of the list.
      const records = new Map((waiting.length ? await db.query<Row>(
        `select * from ${def.table} where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(def.type, req.user)}`, [waiting]) : [])
        .map((r) => [String(r.id), r] as const));
      for (const recordId of waiting) {
        const record = records.get(recordId);
        if (!record) continue;
        const inst = await eng.running(k.key, recordId);
        if (!inst) continue;
        items.push({
          kind: k.key, kind_label: k.label, instance_id: inst.id, workflow: inst.name, started_at: inst.startedAt,
          record_type: def.type, type_label: def.label, record_id: recordId, label: String(record[def.titleField] ?? ''),
          ref: def.ref ? record[def.ref.field] ?? null : null, route: def.route,
        });
      }
    }
    items.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
    return { chair_id: committee.chair_id, items };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/governance/waiting-decisions', tag: 'Governance', permission: 'governance.view',
    summary: 'Running approvals whose current step the committee\'s chair can decide, to put on a meeting\'s agenda (records the reader may not see are left out)',
    query: { committee: 'The committee (id)' }, response: '{ chair_id, items: [{ kind, kind_label, instance_id, workflow, started_at, record_type, type_label, record_id, label, ref, route }] }',
  });

  app.get('/api/meetings/:id/decisions', { preHandler: ctx.requirePerm('governance.view') }, async (req) => {
    const meeting = (await ctx.resources.find('meeting', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Meeting not found.');
    const rows = await db.query<Row>(
      `select id, ref, title, outcome, record_type, record_id, agenda_item_id, applied_to_workflow, applied_at, restricted, notes,
              motion_text, resolution_number, mover_name, mover_member_id, seconder_name, seconder_member_id, vote_mode,
              votes_for, votes_against, votes_abstain, votes_absent, votes_recused, vote_summary, closed_session, consent_agenda, created_at
       from meeting_decisions
       where meeting_id = $1 and deleted_at is null and ${ctx.resources.visibleWhere('meeting_decision', req.user)} order by created_at`, [meeting.id]);
    // The records decided, read once per record type rather than once per decision (E40-09).
    const seen = new Map<string, string>();
    const byType = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.record_type || typeof r.record_id !== 'string' || !UUID_RE.test(r.record_id)) continue;
      byType.set(r.record_type, [...(byType.get(r.record_type) ?? []), r.record_id]);
    }
    for (const [type, ids] of byType) {
      const def = ctx.resources.get(type);
      if (!def || !ctx.can(req.user, `${def.module}.view`)) continue;
      const found = await db.query<Row>(
        `select id, ${def.titleField}::text as label from ${def.table}
         where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(type, req.user)}`, [[...new Set(ids)]]);
      for (const x of found) seen.set(`${type}:${x.id}`, x.label ?? '');
    }
    for (const r of rows) {
      const def = r.record_type ? ctx.resources.get(r.record_type) : undefined;
      const label = def ? seen.get(`${def.type}:${r.record_id}`) : undefined;
      r.record = def && label !== undefined ? { type: def.type, typeLabel: def.label, id: r.record_id, label, route: def.route } : r.record_type ? { hidden: true } : null;
    }
    const votes = await votesOf(ctx, rows.map((r) => String(r.id)));
    for (const r of rows) r.votes = votes.get(String(r.id)) ?? [];
    return rows;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/decisions', tag: 'Governance', permission: 'governance.view',
    summary: 'Decisions taken at one meeting, with the motion, mover, seconder, vote (per member when recorded so) and resolution number, and the record each is about when the reader may see it',
  });
}

/** The votes of each member on some decisions, by decision id: `[{ member_id, name, vote }]`. */
export async function votesOf(ctx: ModuleContext, decisionIds: string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  if (!decisionIds.length) return out;
  const rows = await ctx.db.query<Row>(
    `select v.decision_id::text as decision_id, v.member_id, v.vote from meeting_decision_votes v
     join committee_members m on m.id = v.member_id
     where v.decision_id::text = any($1::text[]) order by case m.role when 'chair' then 0 when 'member' then 1 else 2 end, m.created_at`, [decisionIds]);
  const names = new Map<string, string>();
  for (const id of [...new Set(rows.map((r) => String(r.member_id)))]) names.set(id, String((await memberById(ctx, id))?.name ?? 'A member'));
  for (const r of rows) out.set(r.decision_id, [...(out.get(r.decision_id) ?? []), { member_id: r.member_id, name: names.get(String(r.member_id)), vote: r.vote }]);
  return out;
}
