// Motions (wave 25): a decision of the register taken on a motion, recorded in the minutes of an
// agenda item (or as adopting the consent agenda), with its mover and seconder, the vote and a
// resolution number.
//
// The mover and seconder are members of the committee (by member id, or by name), or anyone else
// named the way a data load names people (`resolvePerson`: an account, a roster person, or
// "name:<their name>" for someone with neither). The vote is per member (for, against, abstaining,
// absent; the counts are worked out) or counts only. When no outcome is given, the motion is carried
// when more members voted for it than against it; the committee's own rules (a two-thirds vote, a
// casting vote) are the secretary's to apply by giving the outcome. Resolution numbers are the
// committee's prefix, the meeting's year and a running number (R-2026-01).
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad, resolvePerson } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { quorumOf, seesClosed, withNames } from './committees.ts';
import { votesOf } from './decisions.ts';
import { checkRecusals } from './declarations.ts';
import { meetingFor } from './meetings.ts';

// "recused": the member declared an interest and took no part (E45-60, declarations.ts).
export const VOTES = ['for', 'against', 'abstain', 'absent', 'recused'] as const;
type Vote = (typeof VOTES)[number];
const LOCKED = 'minutes_approved';

/** "For 5, against 1, abstaining 0, absent 1" (and ", recused 1" when someone was). */
export function voteSummary(c: { for: number; against: number; abstain: number; absent: number; recused?: number }): string {
  return `For ${c.for}, against ${c.against}, abstaining ${c.abstain}, absent ${c.absent}${c.recused ? `, recused ${c.recused}` : ''}`;
}

/** Carried when more voted for than against (a simple majority of the votes cast). */
export const carried = (c: { for: number; against: number }): boolean => c.for > c.against;

/** Every member of a committee, past ones too, with their names (for matching a name to a member). */
async function allMembers(ctx: ModuleContext, committeeId: string): Promise<Row[]> {
  return withNames(ctx, await ctx.db.query<Row>(
    `select m.id, m.user_id, m.person_id, m.voting, m.deleted_at, coalesce(nullif(m.name, ''), u.display_name) as name, m.name as typed_name
     from committee_members m left join users u on u.id = m.user_id where m.committee_id = $1 order by m.deleted_at nulls first, m.created_at`, [committeeId]));
}

export interface Named { member_id: string | null; user_id: string | null; name: string | null }

/** The next resolution number of a committee for a meeting's year: prefix, year, running number. */
export async function nextResolution(ctx: ModuleContext, committee: Row, meeting: Row): Promise<string> {
  const year = todayInZone(new Date(meeting.scheduled_at)).slice(0, 4);
  const stem = `${committee.resolution_prefix ?? ''}${year}-`;
  const used = await ctx.db.query<{ n: string }>(
    `select d.resolution_number as n from meeting_decisions d join meetings m on m.id = d.meeting_id
     where m.committee_id = $1 and d.deleted_at is null and d.resolution_number is not null and lower(d.resolution_number) like lower($2) || '%'`,
    [committee.id, stem]);
  let max = 0;
  for (const u of used) {
    const n = Number(/^(\d+)$/.exec(u.n.slice(stem.length))?.[1] ?? NaN);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${stem}${String(max + 1).padStart(2, '0')}`;
}

export function registerMotions(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  /** A mover or seconder: a member of the committee, by id or name; otherwise a person named as a data load names them. */
  async function named(members: Row[], value: unknown, field: string): Promise<Named> {
    if (value === null || value === undefined || value === '') return { member_id: null, user_id: null, name: null };
    const o = value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
    const memberId = o?.member_id ?? (typeof value === 'string' && UUID_RE.test(value) ? value : null);
    if (memberId) {
      const m = members.find((x) => x.id === String(memberId));
      if (m) return { member_id: m.id, user_id: m.user_id ?? null, name: String(m.name) };
      if (o?.member_id) invalid({ [field]: 'That person is not a member of this committee.' });
    }
    const typed = typeof value === 'string' ? value.trim() : typeof o?.name === 'string' ? o.name.trim() : '';
    if (typed && !/^(user|person|name):/i.test(typed)) {
      const byName = members.filter((x) => !x.deleted_at && String(x.name).toLowerCase() === typed.toLowerCase());
      if (byName.length === 1) return { member_id: byName[0].id, user_id: byName[0].user_id ?? null, name: String(byName[0].name) };
    }
    const p = await resolvePerson(db, value, field);
    const member = members.find((x) => !x.deleted_at && ((p.userId && x.user_id === p.userId) || (p.personId && x.person_id === p.personId)));
    return member ? { member_id: member.id, user_id: member.user_id ?? null, name: String(member.name) } : { member_id: null, user_id: p.userId, name: p.name };
  }

  /** The vote: per member (`votes`), or counts (`for`, `against`, `abstain`, `absent`). */
  function countsOf(body: Row): { mode: 'counts'; counts: Record<Vote, number> } | null {
    const v = body.vote as Row | undefined;
    if (!v || v.mode !== 'counts') return null;
    const counts = {} as Record<Vote, number>;
    for (const k of VOTES) {
      const n = v[k] === undefined || v[k] === null || v[k] === '' ? 0 : Number(v[k]);
      if (!Number.isInteger(n) || n < 0 || n > 500) invalid({ [`vote.${k}`]: 'Enter a whole number from 0 to 500.' });
      counts[k] = n;
    }
    return { mode: 'counts', counts };
  }

  async function memberVotes(members: Row[], body: Row): Promise<{ member_id: string; vote: Vote }[] | null> {
    const v = body.vote as Row | undefined;
    if (!v || v.mode !== 'members') return null;
    if (!Array.isArray(v.votes) || v.votes.length > 500) invalid({ vote: 'Send each member\'s vote.' });
    const out: { member_id: string; vote: Vote }[] = [];
    for (const raw of v.votes as Row[]) {
      const vote = String(raw?.vote ?? '') as Vote;
      if (!VOTES.includes(vote)) invalid({ vote: 'Each vote is for, against, abstain, absent or recused.' });
      const who = await named(members, raw?.member_id ? { member_id: raw.member_id } : raw?.member ?? raw?.name, 'vote');
      if (!who.member_id) invalid({ vote: `${who.name ?? 'Someone'} is not a member of this committee.` });
      const member = members.find((m) => m.id === who.member_id)!;
      if (!member.voting) invalid({ vote: `${member.name} is not a voting member.` });
      if (out.some((x) => x.member_id === who.member_id)) invalid({ vote: `${member.name} is listed twice.` });
      out.push({ member_id: who.member_id!, vote });
    }
    return out;
  }

  const tally = (votes: { vote: Vote }[]): Record<Vote, number> => {
    const c = { for: 0, against: 0, abstain: 0, absent: 0, recused: 0 };
    for (const v of votes) c[v.vote] += 1;
    return c;
  };

  interface Plan { patch: Row; votes: { member_id: string; vote: Vote }[] | null }

  /** Checks a motion's mover, seconder and vote against the decision as it is (or will be), before anything is saved. */
  async function planMotion(decision: Row, body: Row, members: Row[]): Promise<Plan> {
    const patch: Row = {};
    for (const [key, field] of [['mover', 'mover'], ['seconder', 'seconder']] as const) {
      if (body[key] === undefined) continue;
      const who = await named(members, body[key], key);
      patch[`${field}_member_id`] = who.member_id; patch[`${field}_user_id`] = who.user_id; patch[`${field}_name`] = who.name;
    }
    const final = (k: string) => (k in patch ? patch[k] : decision[k]) ?? null;
    const mover = final('mover_member_id') ?? (final('mover_name') ? `name:${String(final('mover_name')).toLowerCase()}` : null);
    const seconder = final('seconder_member_id') ?? (final('seconder_name') ? `name:${String(final('seconder_name')).toLowerCase()}` : null);
    if (mover && mover === seconder) invalid({ seconder: 'The seconder must be someone other than the mover.' });
    let votes: { member_id: string; vote: Vote }[] | null = null;
    if (body.vote !== undefined) {
      if (body.vote === null) {
        Object.assign(patch, { vote_mode: null, votes_for: null, votes_against: null, votes_abstain: null, votes_absent: null, votes_recused: null, vote_summary: null });
        votes = [];
      } else {
        const counts = countsOf(body);
        votes = counts ? [] : await memberVotes(members, body);
        if (!counts && !votes) invalid({ vote: 'Record the vote per member (mode "members") or as counts (mode "counts").' });
        const c = counts ? counts.counts : tally(votes!);
        Object.assign(patch, {
          vote_mode: counts ? 'counts' : 'members', votes_for: c.for, votes_against: c.against, votes_abstain: c.abstain, votes_absent: c.absent,
          votes_recused: c.recused, vote_summary: voteSummary(c),
        });
      }
    }
    return { patch, votes };
  }

  /** Saves a checked motion on its decision (system work: these fields are set only here). */
  async function applyMotion(decisionId: string, plan: Plan): Promise<Row> {
    if (plan.votes) {
      await db.query('delete from meeting_decision_votes where decision_id = $1', [decisionId]);
      for (const v of plan.votes) await db.query('insert into meeting_decision_votes (decision_id, member_id, vote) values ($1,$2,$3)', [decisionId, v.member_id, v.vote]);
    }
    if (Object.keys(plan.patch).length) await ctx.resources.update('meeting_decision', decisionId, plan.patch, null, { via: 'the motion' });
    return plan.patch;
  }

  /** The decision fields a motion sets through the register (validated and audited by the resource engine). */
  async function decisionFields(body: Row, existing: Row | null, members: Row[]): Promise<Row> {
    const data: Row = {};
    for (const k of ['title', 'motion_text', 'notes', 'outcome', 'record_type', 'record_id', 'resolution_number', 'created_at', 'created_by', 'updated_at'] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.agenda_item_id !== undefined) data.agenda_item_id = body.agenda_item_id || null;
    if (!existing) {
      if (typeof data.motion_text === 'string') data.motion_text = data.motion_text.trim();
      if (!data.motion_text && !data.title) invalid({ motion_text: 'Write the motion.' });
      if (!data.title) data.title = String(data.motion_text).slice(0, 200);
    }
    // No outcome given: carried on a simple majority of the votes cast.
    if (!data.outcome && !existing && body.vote && typeof body.vote === 'object') {
      const c = countsOf(body)?.counts ?? tally((await memberVotes(members, body)) ?? []);
      data.outcome = carried(c) ? 'approved' : 'rejected';
    }
    if (!existing && body.consent_agenda === true && data.agenda_item_id) invalid({ consent_agenda: 'A motion adopting the consent agenda is not about one item.' });
    return data;
  }

  const motionResult = async (req: FastifyRequest, meeting: Row, id: string) => {
    const row = await ctx.resources.find('meeting_decision', id, req.user);
    const votes = await votesOf(ctx, [id]);
    return { ...row, votes: votes.get(id) ?? [], quorum: await quorumOf(ctx, meeting) };
  };

  async function editable(req: FastifyRequest, meeting: Row) {
    if (isDataLoad(req)) return;
    if (meeting.status === LOCKED) ctx.fail(409, 'minutes_approved', 'The minutes of this meeting are approved, so its decisions can no longer be changed.');
    if (meeting.status === 'canceled') ctx.fail(409, 'canceled', 'The meeting was canceled.');
  }

  app.post('/api/meetings/:id/motions', { preHandler: ctx.requirePerm('governance.create') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    await editable(req, meeting);
    const body = (req.body ?? {}) as Row;
    if (body.agenda_item_id && UUID_RE.test(String(body.agenda_item_id))) {
      const item = await db.one<Row>('select session from agenda_items where id = $1 and meeting_id = $2', [body.agenda_item_id, meeting.id]);
      if (item?.session === 'closed' && !(await seesClosed(ctx, req.user, meeting.committee_id))) invalid({ agenda_item_id: 'Choose an item of this meeting\'s agenda.' });
    }
    const members = await allMembers(ctx, meeting.committee_id);
    const data = await decisionFields(body, null, members);
    // The mover, seconder and vote are checked before anything is saved.
    const plan = await planMotion({}, body, members);
    // A member who declared an interest and took no part is recorded as recused (E45-60).
    await checkRecusals(ctx, req, meeting.id, body.agenda_item_id ? String(body.agenda_item_id) : null, plan.votes, members);
    const recorder = actorOf(req);
    Object.assign(plan.patch, { recorded_by: recorder.id, recorded_by_name: recorder.name, consent_agenda: body.consent_agenda === true });
    const created = await ctx.resources.create('meeting_decision', { meeting_id: meeting.id, ...data }, req);
    const committee = (await db.one<Row>('select * from committees where id = $1', [meeting.committee_id]))!;
    const motion = await applyMotion(created.id, plan);
    if (body.assign_resolution === true && !created.resolution_number) {
      await ctx.resources.update('meeting_decision', created.id, { resolution_number: await nextResolution(ctx, committee, meeting) }, req);
    }
    await ctx.audit(req, {
      action: 'meeting.motion', recordType: 'meeting', recordId: meeting.id,
      summary: `Motion recorded (${created.ref})${motion.vote_summary ? `: ${motion.vote_summary}` : ''}`,
      after: { decision_id: created.id, mover: motion.mover_name ?? null, seconder: motion.seconder_name ?? null, vote: motion.vote_summary ?? null },
    });
    reply.code(201);
    return motionResult(req, meeting, created.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meetings/:id/motions', tag: 'Governance', permission: 'governance.create',
    summary: 'Record a motion and its decision: mover, seconder, the vote (per member or counts), outcome and resolution number. Movers and seconders are members (id or name) or, in a data load, anyone named as a data load names people',
    body: '{ agenda_item_id?, consent_agenda?, motion_text, title?, outcome?, notes?, record_type?, record_id?, resolution_number?, assign_resolution?, mover?, seconder?, vote?: { mode: "members", votes: [{ member_id | name, vote: for | against | abstain | absent | recused }] } | { mode: "counts", for, against, abstain, absent, recused } }',
    response: 'the decision with votes and the meeting\'s quorum',
  });

  app.patch('/api/meetings/:id/motions/:decisionId', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const meeting = await meetingFor(ctx, req);
    await editable(req, meeting);
    const id = String((req.params as Row).decisionId ?? '');
    const decision = await ctx.resources.find('meeting_decision', id, req.user);
    if (!decision || decision.meeting_id !== meeting.id) return ctx.fail(404, 'not_found', 'Decision not found.');
    const body = (req.body ?? {}) as Row;
    const members = await allMembers(ctx, meeting.committee_id);
    const plan = await planMotion(decision, body, members);
    const data = await decisionFields(body, decision, members);
    await checkRecusals(ctx, req, meeting.id, String((data.agenda_item_id !== undefined ? data.agenda_item_id : decision.agenda_item_id) ?? '') || null, plan.votes, members);
    if (Object.keys(data).length) await ctx.resources.update('meeting_decision', decision.id, data, req);
    const motion = await applyMotion(decision.id, plan);
    if (Object.keys(motion).length) {
      await ctx.audit(req, {
        action: 'meeting.motion_change', recordType: 'meeting', recordId: meeting.id, summary: `Motion changed (${decision.ref})`,
        before: Object.fromEntries(Object.keys(motion).map((k) => [k, decision[k] ?? null])), after: motion,
      });
    }
    return motionResult(req, meeting, decision.id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/meetings/:id/motions/:decisionId', tag: 'Governance', permission: 'governance.edit',
    summary: 'Change a motion: its text, mover, seconder, vote, outcome or resolution number (vote: null removes the vote)',
    body: 'as POST /api/meetings/:id/motions',
  });

  app.post('/api/meeting-decisions/:id/resolution-number', { preHandler: ctx.requirePerm('governance.edit') }, async (req) => {
    const decision = (await ctx.resources.find('meeting_decision', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Decision not found.');
    if (decision.resolution_number) ctx.fail(409, 'numbered', `This decision already has resolution number ${decision.resolution_number}.`);
    if (decision.outcome !== 'approved') ctx.fail(409, 'not_adopted', 'Only an approved (carried) motion becomes a resolution.');
    const meeting = (await db.one<Row>('select * from meetings where id = $1', [decision.meeting_id]))!;
    const committee = (await db.one<Row>('select * from committees where id = $1', [meeting.committee_id]))!;
    await ctx.resources.update('meeting_decision', decision.id, { resolution_number: await nextResolution(ctx, committee, meeting) }, req);
    return ctx.resources.find('meeting_decision', decision.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/meeting-decisions/:id/resolution-number', tag: 'Governance', permission: 'governance.edit',
    summary: 'Give an approved decision the committee\'s next resolution number (prefix, year of the meeting, running number)',
  });
}
