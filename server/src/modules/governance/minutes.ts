// Minutes approved at a later meeting, then published (wave 25). The draft minutes of a held meeting
// (its attendance, each agenda item's discussion and motions, and the general minutes text) are
// approved by a motion at a later meeting of the same committee: the approval is recorded with that
// meeting's date and the decision, and locks the meeting as the chair's approval through the workflow
// does. Approved minutes are then published, which makes them readable to the committee's members in
// their reading view and as the published minutes PDF.
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { meetingFor, MINUTES_KIND } from './meetings.ts';

const LOCKED = 'minutes_approved';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function registerMinutes(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  /** Decisions at later meetings of the same committee that approve this meeting's minutes. */
  async function candidates(req: Parameters<typeof meetingFor>[1], meeting: Row): Promise<Row[]> {
    return db.query<Row>(
      `select d.id, d.ref, d.title, d.outcome, d.resolution_number, m.id as meeting_id, m.ref as meeting_ref, m.title as meeting_title, m.scheduled_at
       from meeting_decisions d join meetings m on m.id = d.meeting_id
       where d.deleted_at is null and m.deleted_at is null and m.committee_id = $1 and m.id <> $2 and m.scheduled_at > $3
         and d.outcome = 'approved' and ((d.record_type = 'meeting' and d.record_id::text = $2::text) or d.record_type is null)
         and ${ctx.resources.visibleWhere('meeting_decision', req.user, 'd')}
       order by (d.record_type = 'meeting') desc nulls last, m.scheduled_at, d.created_at limit 50`,
      [meeting.committee_id, meeting.id, meeting.scheduled_at]);
  }

  app.get('/api/meetings/:id/minutes/approvals', { preHandler: ctx.requirePerm('governance.view') }, async (req) => candidates(req, await meetingFor(ctx, req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/minutes/approvals', tag: 'Governance', permission: 'governance.view',
    summary: 'Approved decisions at later meetings of the same committee that can be recorded as approving this meeting\'s minutes (those about this meeting first)',
    response: '[{ id, ref, title, resolution_number, meeting_id, meeting_ref, meeting_title, scheduled_at }]',
  });

  app.post('/api/meetings/:id/minutes/approve', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    const body = (req.body ?? {}) as Row;
    const load = isDataLoad(req);
    if (meeting.status === LOCKED && !load) ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are already approved.');
    if (meeting.status !== 'held' && !load) ctx.fail(409, 'not_held', 'Minutes can be approved once the meeting is marked as held.');
    if (await approvalEngine(app)?.running(MINUTES_KIND, meeting.id)) {
      ctx.fail(409, 'minutes_in_approval', 'The minutes are waiting for the chair\'s approval through the workflow. Withdraw them first to record their approval at a meeting.');
    }
    const id = String(body.decision_id ?? '');
    const decision = UUID_RE.test(id) ? await ctx.resources.find('meeting_decision', id, req.user) : undefined;
    if (!decision) return invalid({ decision_id: 'Choose the decision that approved the minutes.' });
    const at = await db.one<Row>('select id, ref, committee_id, scheduled_at from meetings where id = $1 and deleted_at is null', [decision.meeting_id]);
    if (!at || at.committee_id !== meeting.committee_id || at.id === meeting.id || new Date(at.scheduled_at) <= new Date(meeting.scheduled_at)) {
      invalid({ decision_id: 'Choose a decision taken at a later meeting of the same committee.' });
    }
    if (decision.outcome !== 'approved') invalid({ decision_id: 'Choose a decision that approved the minutes.' });
    if (decision.record_type && !(decision.record_type === 'meeting' && decision.record_id === meeting.id)) invalid({ decision_id: 'That decision is about another record.' });
    let on = todayInZone(new Date(at!.scheduled_at));
    if (body.approved_on !== undefined && body.approved_on !== null && body.approved_on !== '') {
      if (!load) invalid({ approved_on: 'The approval date is the date of the meeting that approved the minutes.' });
      if (!DATE.test(String(body.approved_on))) invalid({ approved_on: 'Enter a date.' });
      on = String(body.approved_on);
    }
    if (!decision.record_type) await ctx.resources.update('meeting_decision', decision.id, { record_type: 'meeting', record_id: meeting.id }, req);
    await ctx.resources.update('meeting', meeting.id, {
      status: LOCKED, minutes_approved_on: on, minutes_approved_meeting_id: at!.id, minutes_approved_decision_id: decision.id,
    }, null, { via: `decision ${decision.ref}` });
    await ctx.audit(req, {
      action: 'meeting.minutes_approved', recordType: 'meeting', recordId: meeting.id,
      summary: `Minutes of ${meeting.ref} approved at ${at!.ref} on ${on} (decision ${decision.ref}${decision.resolution_number ? `, resolution ${decision.resolution_number}` : ''})`,
      after: { decision_id: decision.id, meeting_id: at!.id, approved_on: on },
    });
    return ctx.resources.find('meeting', meeting.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/minutes/approve', tag: 'Governance', permission: 'governance.edit',
    summary: 'Record that a later meeting approved these minutes by a motion: the approval takes that meeting\'s date and the decision, and locks the meeting',
    body: '{ decision_id, approved_on? (data load only) }',
  });

  app.post('/api/meetings/:id/minutes/publish', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    const body = (req.body ?? {}) as Row;
    if (meeting.status !== LOCKED) ctx.fail(409, 'not_approved', 'Minutes are published once they are approved.');
    if (meeting.minutes_published_at) ctx.fail(409, 'published', 'The minutes are already published.');
    let at = new Date().toISOString();
    if (body.published_at !== undefined && body.published_at !== null && body.published_at !== '') {
      if (!isDataLoad(req)) invalid({ published_at: 'Minutes are published now; an earlier time is given only in a data load.' });
      if (Number.isNaN(Date.parse(String(body.published_at)))) invalid({ published_at: 'Enter a date and time.' });
      at = new Date(String(body.published_at)).toISOString();
    }
    const by = actorOf(req);
    await ctx.resources.update('meeting', meeting.id, { minutes_published_at: at, minutes_published_by: by.id, minutes_published_by_name: by.name }, null, { via: 'publishing the minutes' });
    await ctx.audit(req, { action: 'meeting.minutes_published', recordType: 'meeting', recordId: meeting.id, summary: `Minutes of ${meeting.ref} published`, after: { published_at: at, by: by.name } });
    return ctx.resources.find('meeting', meeting.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/minutes/publish', tag: 'Governance', permission: 'governance.edit',
    summary: 'Publish approved minutes: members can then read them, and the published minutes PDF is available',
    body: '{ published_at? (data load only) }',
  });
}
