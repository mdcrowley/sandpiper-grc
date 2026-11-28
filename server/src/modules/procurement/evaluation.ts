// Evaluation and award (E46): criteria with weights, the evaluation committee with conflict-of-interest
// declarations, each evaluator's scores, the ranked result, the award decision and the resulting contract.
// Scores and offers stay with procurement staff and the committee until the award.
import type { FastifyRequest } from 'fastify';
import { actorOf, dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { cleanCriteria, criteriaTemplate } from './settings.ts';
import { body, cents, cleanText, day, idParam, invalid, isDate, isInstant, num } from './shared.ts';
import { isStaff, methodOf, OFFER, PROCUREMENT, rankOffers } from './solicitations.ts';

const FINISHED = ['canceled', 'closed'];

export function registerEvaluation(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = ctx.requirePerm('procurement.view');
  const edit = ctx.requirePerm('procurement.edit');
  const approve = ctx.requirePerm('procurement.approve');

  /** The procurement the route names, if the reader may see it (404 otherwise). */
  async function need(req: FastifyRequest): Promise<Row> {
    const id = idParam(ctx, req, 'id', 'Solicitation');
    return (await ctx.resources.find(PROCUREMENT, id, req.user)) ?? ctx.fail(404, 'not_found', 'Solicitation not found.');
  }
  /** Changes to an evaluation stop once it is awarded or finished (history loads as it was). */
  function assertOpen(req: FastifyRequest, proc: Row, what: string) {
    if (isDataLoad(req)) return;
    if (proc.awarded_on || FINISHED.includes(proc.status)) ctx.fail(409, 'evaluation_closed', `This solicitation is awarded or closed: ${what} can no longer change.`);
  }

  async function evaluatorsOf(procId: string): Promise<Row[]> {
    return db.query<Row>(
      `select e.id, e.user_id, u.display_name as name, e.role, e.coi_status, e.coi_note, e.coi_declared_at, e.submitted_at,
              (select count(*)::int from procurement_scores s where s.procurement_id = e.procurement_id and s.evaluator_id = e.user_id) as scores
       from procurement_evaluators e left join users u on u.id = e.user_id where e.procurement_id = $1 order by e.role = 'chair' desc, u.display_name`, [procId]);
  }

  // ---------- the evaluation as staff see it ----------

  app.get('/api/procurements/:id/evaluation', { preHandler: view }, async (req) => {
    const proc = await need(req);
    const m = await methodOf(ctx, proc.method);
    const criteria = await db.query<Row>('select id, name, description, weight, max_score, sort from procurement_criteria where procurement_id = $1 order by sort, created_at', [proc.id]);
    const counts = (await db.one<Row>(
      `select (select count(*)::int from procurement_offers where procurement_id = $1 and deleted_at is null) as offers,
              (select count(*)::int from procurement_evaluators where procurement_id = $1) as evaluators,
              (select count(*)::int from procurement_evaluators where procurement_id = $1 and submitted_at is not null) as submitted`, [proc.id]))!;
    const full = isStaff(ctx, req.user) || Boolean(proc.awarded_on);
    const base = { evaluation: m.evaluation, method: m.label, criteria, counts, awarded: Boolean(proc.awarded_on) };
    // Before the award, people outside procurement see that the evaluation runs, not who scores what.
    if (!full) return { ...base, restricted: true, evaluators: [], offers: [], scores: [] };
    const ranked = await rankOffers(ctx, proc);
    const scores = await db.query<Row>(
      `select s.offer_id, s.criterion_id, s.evaluator_id, s.score, s.comment from procurement_scores s where s.procurement_id = $1`, [proc.id]);
    return { ...base, restricted: false, evaluators: await evaluatorsOf(proc.id), offers: ranked.offers, scores };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/procurements/:id/evaluation', tag: 'Procurement', permission: 'procurement.view',
    summary: 'A solicitation\'s evaluation: criteria, counts, and (for procurement staff, or for everyone after the award) the committee, scores and ranked offers',
    response: '{ evaluation, method, criteria, counts: { offers, evaluators, submitted }, awarded, restricted, evaluators, offers: RankedOffer[], scores }',
  });

  app.put('/api/procurements/:id/criteria', { preHandler: edit }, async (req) => {
    const proc = await need(req);
    assertOpen(req, proc, 'the criteria');
    const b = body(req);
    const list = b.use_template ? await criteriaTemplate(ctx) : cleanCriteria(ctx, b.criteria);
    const scored = await db.one<Row>('select count(*)::int as n from procurement_scores where procurement_id = $1', [proc.id]);
    if (Number(scored?.n) > 0 && !isDataLoad(req)) ctx.fail(409, 'already_scored', 'Evaluators have started scoring: the criteria can no longer change. Remove the scores first by reopening the evaluation.');
    const before = await db.query<Row>('select name, weight, max_score from procurement_criteria where procurement_id = $1 order by sort', [proc.id]);
    await db.tx(async (tx) => {
      // Keep criteria that are still named (their scores stay), replace the rest.
      const kept = await tx.query<Row>('select id, name from procurement_criteria where procurement_id = $1', [proc.id]);
      const names = new Set(list.map((c) => c.name));
      for (const k of kept) if (!names.has(k.name)) await tx.query('delete from procurement_criteria where id = $1', [k.id]);
      for (const [i, c] of list.entries()) {
        const existing = kept.find((k) => k.name === c.name);
        if (existing) await tx.query('update procurement_criteria set description = $2, weight = $3, max_score = $4, sort = $5 where id = $1', [existing.id, c.description, c.weight, c.max_score, i]);
        else await tx.query('insert into procurement_criteria (procurement_id, name, description, weight, max_score, sort, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [proc.id, c.name, c.description, c.weight, c.max_score, i, req.user!.id]);
      }
    });
    await ctx.audit(req, {
      action: 'procurement.criteria', recordType: PROCUREMENT, recordId: proc.id,
      summary: `Evaluation criteria of ${proc.ref} set (${list.length})`, before, after: list.map((c) => ({ name: c.name, weight: c.weight, max_score: c.max_score })),
    });
    return db.query<Row>('select id, name, description, weight, max_score, sort from procurement_criteria where procurement_id = $1 order by sort', [proc.id]);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/procurements/:id/criteria', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Set a solicitation\'s evaluation criteria (before scoring starts); use_template copies the standard criteria',
    body: '{ criteria?: { name, description?, weight, max_score? }[], use_template?: boolean }', response: 'criteria[]',
  });

  // ---------- the committee ----------

  app.post('/api/procurements/:id/evaluators', { preHandler: edit }, async (req, reply) => {
    const proc = await need(req);
    assertOpen(req, proc, 'the committee');
    const b = body(req);
    const userId = String(b.user_id ?? '');
    const user = /^[0-9a-f-]{36}$/i.test(userId) ? await db.one<Row>(`select id, display_name from users where id = $1 and deleted_at is null`, [userId]) : undefined;
    if (!user) invalid(ctx, { user_id: 'Choose a person who has an account.' });
    const roles = (await ctx.lookups.values('evaluator_role')).map((r) => r.value);
    const role = String(b.role ?? 'member');
    if (!roles.includes(role)) invalid(ctx, { role: 'Choose a role from the list.' });
    const row = await db.one<Row>(
      `insert into procurement_evaluators (procurement_id, user_id, role, created_by) values ($1,$2,$3,$4)
       on conflict (procurement_id, user_id) do nothing returning *`, [proc.id, userId, role, req.user!.id]);
    if (!row) ctx.fail(409, 'already_member', `${user!.display_name} is already on the committee.`);
    await ctx.audit(req, {
      action: 'procurement.evaluator_add', recordType: PROCUREMENT, recordId: proc.id,
      summary: `${user!.display_name} added to the evaluation committee of ${proc.ref}`, after: { user_id: userId, role },
    });
    if (app.hasDecorator('notify') && role !== 'advisor') {
      await app.notify({
        userIds: [userId], kind: 'assignment', route: `/procurement/evaluate/${proc.id}`,
        title: `You are on the evaluation committee of ${proc.ref} ${proc.title}`,
        body: 'Declare any conflict of interest first, then score each offer against the criteria.',
      });
    }
    reply.code(201);
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/procurements/:id/evaluators', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Add a person to the evaluation committee (they are notified)', body: '{ user_id, role? }', response: 'the committee row',
  });

  app.patch('/api/procurements/:id/evaluators/:eid', { preHandler: edit }, async (req) => {
    const proc = await need(req);
    assertOpen(req, proc, 'the committee');
    const eid = idParam(ctx, req, 'eid', 'Evaluator');
    const ev = await db.one<Row>('select e.*, u.display_name from procurement_evaluators e left join users u on u.id = e.user_id where e.id = $1 and e.procurement_id = $2', [eid, proc.id]);
    if (!ev) ctx.fail(404, 'not_found', 'Evaluator not found.');
    const b = body(req);
    if (b.role !== undefined) {
      const roles = (await ctx.lookups.values('evaluator_role')).map((r) => r.value);
      if (!roles.includes(String(b.role))) invalid(ctx, { role: 'Choose a role from the list.' });
      await db.query('update procurement_evaluators set role = $2 where id = $1', [eid, b.role]);
    }
    // Reopening lets the evaluator change submitted scores.
    if (b.reopen === true) await db.query('update procurement_evaluators set submitted_at = null where id = $1', [eid]);
    await ctx.audit(req, {
      action: 'procurement.evaluator_change', recordType: PROCUREMENT, recordId: proc.id,
      summary: `${ev!.display_name ?? 'An evaluator'}: ${b.reopen === true ? 'scores reopened' : `role set to ${b.role}`} on ${proc.ref}`,
      before: { role: ev!.role, submitted_at: ev!.submitted_at }, after: { role: b.role ?? ev!.role, reopened: b.reopen === true },
    });
    return (await evaluatorsOf(proc.id)).find((e) => e.id === eid);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/procurements/:id/evaluators/:eid', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Change an evaluator\'s role, or reopen their submitted scores', body: '{ role?, reopen?: true }', response: 'the committee row',
  });

  app.delete('/api/procurements/:id/evaluators/:eid', { preHandler: edit }, async (req) => {
    const proc = await need(req);
    assertOpen(req, proc, 'the committee');
    const eid = idParam(ctx, req, 'eid', 'Evaluator');
    const ev = await db.one<Row>('select e.*, u.display_name from procurement_evaluators e left join users u on u.id = e.user_id where e.id = $1 and e.procurement_id = $2', [eid, proc.id]);
    if (!ev) ctx.fail(404, 'not_found', 'Evaluator not found.');
    const scored = await db.one<Row>('select count(*)::int as n from procurement_scores where procurement_id = $1 and evaluator_id = $2', [proc.id, ev!.user_id]);
    if (Number(scored?.n) > 0) ctx.fail(409, 'has_scores', `${ev!.display_name ?? 'This evaluator'} has scored offers: their scores are part of the record and they stay on the committee.`);
    await db.query('delete from procurement_evaluators where id = $1', [eid]);
    await ctx.audit(req, {
      action: 'procurement.evaluator_remove', recordType: PROCUREMENT, recordId: proc.id,
      summary: `${ev!.display_name ?? 'An evaluator'} removed from the evaluation committee of ${proc.ref}`, before: { user_id: ev!.user_id, role: ev!.role },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/procurements/:id/evaluators/:eid', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Remove an evaluator who has not scored', response: '{ ok }',
  });

  // ---------- the evaluator's own page (named: no procurement permission needed) ----------

  /** The committee row of the person acting (the person a data load names). */
  async function myRow(req: FastifyRequest, procId: string, forWrite: boolean): Promise<{ ev: Row; userId: string }> {
    const userId = forWrite ? actorOf(req).id : req.user!.id;
    if (!userId) invalid(ctx, { on_behalf_of: 'Name an evaluator who has an account.' });
    const ev = await db.one<Row>('select * from procurement_evaluators where procurement_id = $1 and user_id = $2', [procId, userId]);
    if (!ev) ctx.fail(404, 'not_found', forWrite && isDataLoad(req) ? 'The person named is not on this evaluation committee.' : 'Evaluation not found.');
    return { ev: ev!, userId: userId! };
  }
  async function procOf(req: FastifyRequest): Promise<Row> {
    const id = idParam(ctx, req, 'id', 'Evaluation');
    // Visibility of the solicitation itself (scope rules) is not what decides here: being on the committee is.
    return (await db.one<Row>('select * from procurements where id = $1 and deleted_at is null', [id])) ?? ctx.fail(404, 'not_found', 'Evaluation not found.');
  }

  app.get('/api/procurement/my-evaluations', async (req) => {
    return db.query<Row>(
      `select p.id, p.ref, p.title, p.status, p.proposals_due_at, p.award_planned_on, p.awarded_on, e.role, e.coi_status, e.submitted_at,
              (select count(*)::int from procurement_offers o where o.procurement_id = p.id and o.deleted_at is null and coalesce(o.status, '') not in ('withdrawn', 'nonresponsive')) as offers,
              (select count(*)::int from procurement_criteria c where c.procurement_id = p.id) as criteria,
              (select count(*)::int from procurement_scores s where s.procurement_id = p.id and s.evaluator_id = e.user_id) as scored
       from procurement_evaluators e join procurements p on p.id = e.procurement_id and p.deleted_at is null
       where e.user_id = $1 order by (p.awarded_on is null) desc, p.proposals_due_at desc nulls last limit 200`, [req.user!.id]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/procurement/my-evaluations', tag: 'Procurement',
    summary: 'The evaluations the signed-in person sits on as a committee member', response: '{ id, ref, title, status, proposals_due_at, role, coi_status, submitted_at, offers, criteria, scored }[]',
  });

  app.get('/api/procurement/my-evaluations/:id', async (req) => {
    const proc = await procOf(req);
    const { ev } = await myRow(req, proc.id, false);
    const m = await methodOf(ctx, proc.method);
    const criteria = await db.query<Row>('select id, name, description, weight, max_score from procurement_criteria where procurement_id = $1 order by sort, created_at', [proc.id]);
    // A member who declared a conflict sees no offers.
    const offers = ev.coi_status === 'conflict' ? [] : await db.query<Row>(
      `select id, ref, bidder_name, amount, received_at, status from procurement_offers
       where procurement_id = $1 and deleted_at is null and coalesce(status, '') not in ('withdrawn') order by received_at, ref`, [proc.id]);
    const scores = await db.query<Row>('select offer_id, criterion_id, score, comment from procurement_scores where procurement_id = $1 and evaluator_id = $2', [proc.id, ev.user_id]);
    return {
      procurement: { id: proc.id, ref: proc.ref, title: proc.title, description: proc.description, method: m.label, status: proc.status, proposals_due_at: proc.proposals_due_at, awarded: Boolean(proc.awarded_on) },
      me: { role: ev.role, coi_status: ev.coi_status, coi_note: ev.coi_note, coi_declared_at: ev.coi_declared_at, submitted_at: ev.submitted_at },
      criteria, offers, scores,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/procurement/my-evaluations/:id', tag: 'Procurement',
    summary: 'One evaluation for a member of its committee: the criteria, the offers and their own scores',
    response: '{ procurement, me: { role, coi_status, coi_note, coi_declared_at, submitted_at }, criteria, offers, scores }',
  });

  app.post('/api/procurement/my-evaluations/:id/declaration', async (req) => {
    const proc = await procOf(req);
    assertOpen(req, proc, 'declarations');
    const { ev, userId } = await myRow(req, proc.id, true);
    const b = body(req);
    if (typeof b.conflict !== 'boolean') invalid(ctx, { conflict: 'Say whether you have a conflict of interest.' });
    const note = cleanText(b.note, 2000);
    if (b.conflict && !note) invalid(ctx, { note: 'Describe the conflict.' });
    const scored = await db.one<Row>('select count(*)::int as n from procurement_scores where procurement_id = $1 and evaluator_id = $2', [proc.id, userId]);
    if (b.conflict && Number(scored?.n) > 0 && !isDataLoad(req)) ctx.fail(409, 'has_scores', 'You have already scored offers. Tell the buyer about the conflict: your scores need to be reviewed.');
    const load = await dataLoadFor(db, req);
    const at = load && isInstant(b.declared_at) ? new Date(b.declared_at).toISOString() : new Date().toISOString();
    await db.query('update procurement_evaluators set coi_status = $2, coi_note = $3, coi_declared_at = $4 where id = $1', [ev.id, b.conflict ? 'conflict' : 'none', note, at]);
    await ctx.audit(req, {
      action: 'procurement.coi_declaration', recordType: PROCUREMENT, recordId: proc.id,
      summary: `${actorOf(req).name ?? 'An evaluator'} declared ${b.conflict ? 'a conflict of interest' : 'no conflict of interest'} on ${proc.ref}`,
      after: { user_id: userId, conflict: b.conflict },
    });
    if (b.conflict && app.hasDecorator('notify') && proc.buyer_id) {
      await app.notify({ userIds: [proc.buyer_id], kind: 'general', recordType: PROCUREMENT, recordId: proc.id, title: `Conflict of interest declared on ${proc.ref}`, body: 'An evaluator declared a conflict and will not see or score the offers.' });
    }
    return { coi_status: b.conflict ? 'conflict' : 'none', coi_declared_at: at };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/procurement/my-evaluations/:id/declaration', tag: 'Procurement',
    summary: 'A committee member declares whether they have a conflict of interest (declared_at in a data load)',
    body: '{ conflict: boolean, note?, declared_at? }', response: '{ coi_status, coi_declared_at }',
  });

  app.put('/api/procurement/my-evaluations/:id/scores', async (req) => {
    const proc = await procOf(req);
    assertOpen(req, proc, 'scores');
    const { ev, userId } = await myRow(req, proc.id, true);
    const load = await dataLoadFor(db, req);
    if (!load) {
      if (ev.role === 'advisor') ctx.fail(403, 'advisor', 'Advisors to the committee do not score.');
      if (ev.coi_status !== 'none') ctx.fail(409, 'declaration_needed', ev.coi_status === 'conflict' ? 'You declared a conflict of interest and do not score this evaluation.' : 'Declare whether you have a conflict of interest first.');
      if (ev.submitted_at) ctx.fail(409, 'submitted', 'Your scores are submitted. Ask the buyer to reopen them to make a change.');
    }
    const b = body(req);
    if (!Array.isArray(b.scores)) invalid(ctx, { scores: 'Give a list of scores.' });
    const criteria = await db.query<Row>('select id, max_score from procurement_criteria where procurement_id = $1', [proc.id]);
    const offers = new Set((await db.query<Row>('select id from procurement_offers where procurement_id = $1 and deleted_at is null', [proc.id])).map((o) => o.id));
    const cleaned = (b.scores as Row[]).slice(0, 2000).map((s) => {
      const c = criteria.find((x) => x.id === s?.criterion_id);
      if (!c || !offers.has(s?.offer_id)) invalid(ctx, { scores: 'Each score names an offer and a criterion of this evaluation.' });
      const clear = s.score === null || s.score === '';
      const score = Number(s.score);
      if (!clear && (!Number.isFinite(score) || score < 0 || score > num(c!.max_score))) invalid(ctx, { scores: `Give scores from 0 to ${num(c!.max_score)}.` });
      return { offer_id: String(s.offer_id), criterion_id: String(s.criterion_id), score: clear ? null : score, comment: cleanText(s.comment, 2000) };
    });
    const at = load && isInstant(b.scored_at) ? new Date(b.scored_at).toISOString() : new Date().toISOString();
    await db.tx(async (tx) => {
      for (const s of cleaned) {
        if (s.score === null) {
          await tx.query('delete from procurement_scores where offer_id = $1 and criterion_id = $2 and evaluator_id = $3', [s.offer_id, s.criterion_id, userId]);
          continue;
        }
        await tx.query(
          `insert into procurement_scores (procurement_id, offer_id, criterion_id, evaluator_id, score, comment, scored_at, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (offer_id, criterion_id, evaluator_id) do update set score = excluded.score, comment = excluded.comment, scored_at = excluded.scored_at, recorded_by = excluded.recorded_by`,
          [proc.id, s.offer_id, s.criterion_id, userId, s.score, s.comment, at, req.user!.id]);
      }
      if (b.submit === true) {
        const n = await tx.one<Row>('select count(*)::int as n from procurement_scores where procurement_id = $1 and evaluator_id = $2', [proc.id, userId]);
        const needed = criteria.length * offers.size;
        if (!load && Number(n?.n) < needed) invalid(ctx, { scores: `Score every offer against every criterion before submitting (${n?.n ?? 0} of ${needed}).` });
        const when = load && isInstant(b.submitted_at) ? new Date(b.submitted_at).toISOString() : at;
        await tx.query('update procurement_evaluators set submitted_at = $2 where id = $1', [ev.id, when]);
      }
    });
    // The audit line names who scored, never the scores (they stay with the committee until the award).
    await ctx.audit(req, {
      action: b.submit === true ? 'procurement.scores_submit' : 'procurement.scores', recordType: PROCUREMENT, recordId: proc.id,
      summary: `${actorOf(req).name ?? 'An evaluator'} ${b.submit === true ? 'submitted' : 'saved'} scores on ${proc.ref} (${cleaned.length})`,
      after: { user_id: userId, count: cleaned.length },
    });
    const scores = await db.query<Row>('select offer_id, criterion_id, score, comment from procurement_scores where procurement_id = $1 and evaluator_id = $2', [proc.id, userId]);
    const after = await db.one<Row>('select submitted_at from procurement_evaluators where id = $1', [ev.id]);
    return { scores, submitted_at: after?.submitted_at ?? null };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/procurement/my-evaluations/:id/scores', tag: 'Procurement',
    summary: 'A committee member saves (and with submit, hands in) their scores; a null score clears one. In a data load, on_behalf_of names the evaluator',
    body: '{ scores: { offer_id, criterion_id, score: number | null, comment? }[], submit?: boolean, scored_at?, submitted_at? }', response: '{ scores, submitted_at }',
  });

  // ---------- award ----------

  app.post('/api/procurements/:id/award', { preHandler: approve }, async (req) => {
    const proc = await need(req);
    const load = await dataLoadFor(db, req);
    if (!load && proc.awarded_on) ctx.fail(409, 'already_awarded', `${proc.ref} is already awarded.`);
    if (!load && FINISHED.includes(proc.status)) ctx.fail(409, 'evaluation_closed', `${proc.ref} is ${proc.status}: it cannot be awarded.`);
    const b = body(req);
    const offerId = String(b.offer_id ?? '');
    const offer = /^[0-9a-f-]{36}$/i.test(offerId) ? await db.one<Row>('select * from procurement_offers where id = $1 and procurement_id = $2 and deleted_at is null', [offerId, proc.id]) : undefined;
    if (!offer) invalid(ctx, { offer_id: 'Choose one of the offers received.' });
    const reason = cleanText(b.reason, 4000);
    if (!reason) invalid(ctx, { reason: 'Write why this offer is chosen.' });
    if (!load && ['withdrawn', 'nonresponsive'].includes(offer!.status)) invalid(ctx, { offer_id: 'A withdrawn or nonresponsive offer cannot be awarded.' });
    const m = await methodOf(ctx, proc.method);
    if (!load && m.justification && !String(proc.justification ?? '').trim()) invalid(ctx, { reason: `Write the ${m.label.toLowerCase()} justification on the solicitation first.` });
    const today = todayInZone();
    const on = isDate(b.awarded_on) ? b.awarded_on : today;
    if (!load && on > today) invalid(ctx, { awarded_on: 'The award date cannot be in the future.' });
    const amount = b.amount !== undefined && b.amount !== null && b.amount !== '' ? Number(b.amount) : (offer!.amount === null ? null : num(offer!.amount));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) invalid(ctx, { amount: 'Give an amount of zero or more.' });
    const actor = actorOf(req);
    const saved = await ctx.resources.update(PROCUREMENT, proc.id, {
      awarded_offer_id: offer!.id, awarded_on: on, awarded_by: actor.id, awarded_by_name: actor.name,
      award_amount: amount === null ? null : cents(amount), award_reason: reason, status: 'awarded',
    }, null);
    // The other offers are not selected; history keeps their status as loaded.
    await db.query(`update procurement_offers set status = 'awarded', updated_at = now() where id = $1`, [offer!.id]);
    if (!load) {
      await db.query(
        `update procurement_offers set status = 'not_selected', updated_at = now()
         where procurement_id = $1 and id <> $2 and deleted_at is null and coalesce(status, 'received') in ('received', 'responsive')`, [proc.id, offer!.id]);
    }
    await ctx.audit(req, {
      action: 'procurement.award', recordType: PROCUREMENT, recordId: proc.id,
      summary: `${proc.ref} awarded to ${offer!.bidder_name}${amount !== null ? ` for ${cents(amount).toLocaleString('en-US')}` : ''}: ${reason}`,
      before: { status: proc.status }, after: { offer_id: offer!.id, awarded_on: on, amount, by: actor.name },
    });
    return saved;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/procurements/:id/award', tag: 'Procurement', permission: 'procurement.approve',
    summary: 'Record the award decision: which offer, when, why, and the amount (the other offers become "Not selected"). Offers and scores are then readable by everyone who may view procurement',
    body: '{ offer_id, reason, awarded_on?, amount? }', response: 'the solicitation',
  });

  // ---------- the resulting contract ----------

  app.post('/api/procurements/:id/contract', { preHandler: edit }, async (req) => {
    const proc = await need(req);
    if (!ctx.resources.get('contract')) ctx.fail(404, 'not_found', 'Contracts are not part of this installation.');
    const b = body(req);
    let contractId: string;
    if (b.contract_id) {
      const c = await ctx.resources.find('contract', String(b.contract_id), req.user);
      if (!c) invalid(ctx, { contract_id: 'Contract not found.' });
      contractId = c!.id;
    } else {
      if (!ctx.can(req.user, 'contracts.create')) ctx.fail(403, 'forbidden', 'Making a contract needs permission to create contracts.');
      if (!proc.awarded_offer_id) invalid(ctx, { contract_id: 'Record the award first, or choose an existing contract.' });
      const offer = await db.one<Row>('select * from procurement_offers where id = $1', [proc.awarded_offer_id]);
      if (!offer?.vendor_id) invalid(ctx, { contract_id: 'The awarded offer has no vendor record. Record the bidder as a vendor on the offer first.' });
      const title = cleanText(b.title, 200) ?? proc.title;
      const made = await ctx.resources.create('contract', {
        title, vendor_id: offer!.vendor_id, status: 'draft',
        total_value: proc.award_amount ?? offer!.amount ?? null,
        start_date: isDate(b.start_date) ? b.start_date : null, end_date: isDate(b.end_date) ? b.end_date : null,
        notes: `Made from the award of ${proc.ref} ${proc.title}.`,
      }, req);
      contractId = made.id;
    }
    await ctx.resources.update(PROCUREMENT, proc.id, { contract_id: contractId }, req);
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('procurement', $1, 'contract', $2, 'resulted_in', $3)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [proc.id, contractId, actorOf(req).id]);
    return { contract_id: contractId };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/procurements/:id/contract', tag: 'Procurement', permission: 'procurement.edit',
    summary: 'Link the resulting contract (contract_id), or make a draft contract for the awarded vendor (needs contracts.create); linked both ways',
    body: '{ contract_id? , title?, start_date?, end_date? }', response: '{ contract_id }',
  });

  // ---------- addenda ----------

  app.get('/api/procurements/:id/addenda', { preHandler: view }, async (req) => {
    const proc = await need(req);
    return db.query<Row>('select id, number, issued_on::text as issued_on, summary, document_id from procurement_addenda where procurement_id = $1 order by number', [proc.id]);
  });
  ctx.describeRoute({ method: 'GET', path: '/api/procurements/:id/addenda', tag: 'Procurement', permission: 'procurement.view', summary: 'Addenda issued to a solicitation', response: '{ id, number, issued_on, summary, document_id }[]' });

  app.post('/api/procurements/:id/addenda', { preHandler: edit }, async (req, reply) => {
    const proc = await need(req);
    const b = body(req);
    const summary = cleanText(b.summary, 4000);
    if (!summary) invalid(ctx, { summary: 'Say what the addendum changes.' });
    if (!isDate(b.issued_on)) invalid(ctx, { issued_on: 'Give the date it was issued.' });
    const doc = b.document_id ? String(b.document_id) : null;
    if (doc && !(await ctx.resources.find('policy', doc, req.user))) invalid(ctx, { document_id: 'Document not found.' });
    const next = await db.one<Row>('select coalesce(max(number), 0) + 1 as n from procurement_addenda where procurement_id = $1', [proc.id]);
    const row = await db.one<Row>(
      `insert into procurement_addenda (procurement_id, number, issued_on, summary, document_id, created_by) values ($1,$2,$3,$4,$5,$6) returning id, number, issued_on::text as issued_on, summary, document_id`,
      [proc.id, Number(next?.n ?? 1), b.issued_on, summary, doc, actorOf(req).id]);
    await ctx.audit(req, { action: 'procurement.addendum', recordType: PROCUREMENT, recordId: proc.id, summary: `Addendum ${row!.number} to ${proc.ref}: ${summary}`, after: row });
    reply.code(201);
    return row;
  });
  ctx.describeRoute({ method: 'POST', path: '/api/procurements/:id/addenda', tag: 'Procurement', permission: 'procurement.edit', summary: 'Record an addendum (numbered in order)', body: '{ issued_on, summary, document_id? }', response: 'the addendum' });

  app.delete('/api/procurements/:id/addenda/:aid', { preHandler: edit }, async (req) => {
    const proc = await need(req);
    const aid = idParam(ctx, req, 'aid', 'Addendum');
    const row = await db.one<Row>('delete from procurement_addenda where id = $1 and procurement_id = $2 returning number, summary', [aid, proc.id]);
    if (!row) ctx.fail(404, 'not_found', 'Addendum not found.');
    await ctx.audit(req, { action: 'procurement.addendum_remove', recordType: PROCUREMENT, recordId: proc.id, summary: `Addendum ${row!.number} removed from ${proc.ref}`, before: row });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/procurements/:id/addenda/:aid', tag: 'Procurement', permission: 'procurement.edit', summary: 'Remove an addendum recorded by mistake', response: '{ ok }' });

  // ---------- protests ----------

  const protestRow = `id, protester, vendor_id, received_on::text as received_on, grounds, status, decided_on::text as decided_on, decision, decided_by_name`;
  app.get('/api/procurements/:id/protests', { preHandler: view }, async (req) => {
    const proc = await need(req);
    return db.query<Row>(`select ${protestRow} from procurement_protests where procurement_id = $1 order by received_on, created_at`, [proc.id]);
  });
  ctx.describeRoute({ method: 'GET', path: '/api/procurements/:id/protests', tag: 'Procurement', permission: 'procurement.view', summary: 'The protests log of a solicitation', response: '{ id, protester, vendor_id, received_on, grounds, status, decided_on, decision, decided_by_name }[]' });

  async function protestStatus(v: unknown) {
    const statuses = (await ctx.lookups.values('protest_status')).map((s) => s.value);
    if (!statuses.includes(String(v))) invalid(ctx, { status: 'Choose a status from the list.' });
    return String(v);
  }

  app.post('/api/procurements/:id/protests', { preHandler: edit }, async (req, reply) => {
    const proc = await need(req);
    const b = body(req);
    const protester = cleanText(b.protester, 300);
    if (!protester) invalid(ctx, { protester: 'Name who protests.' });
    if (!isDate(b.received_on)) invalid(ctx, { received_on: 'Give the date it was received.' });
    const vendor = b.vendor_id ? String(b.vendor_id) : null;
    if (vendor && !(await ctx.resources.find('vendor', vendor, req.user))) invalid(ctx, { vendor_id: 'Vendor not found.' });
    const status = b.status ? await protestStatus(b.status) : 'received';
    const row = await db.one<Row>(
      `insert into procurement_protests (procurement_id, protester, vendor_id, received_on, grounds, status, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning ${protestRow}`,
      [proc.id, protester, vendor, b.received_on, cleanText(b.grounds, 4000), status, actorOf(req).id]);
    await ctx.audit(req, { action: 'procurement.protest', recordType: PROCUREMENT, recordId: proc.id, summary: `Protest by ${protester} recorded on ${proc.ref}`, after: row });
    if (app.hasDecorator('notify') && proc.buyer_id) {
      await app.notify({ userIds: [proc.buyer_id], kind: 'general', recordType: PROCUREMENT, recordId: proc.id, title: `Protest received on ${proc.ref}`, body: `${protester}, received ${row!.received_on}.` });
    }
    reply.code(201);
    return row;
  });
  ctx.describeRoute({ method: 'POST', path: '/api/procurements/:id/protests', tag: 'Procurement', permission: 'procurement.edit', summary: 'Record a protest', body: '{ protester, received_on, vendor_id?, grounds?, status? }', response: 'the protest' });

  app.patch('/api/procurements/:id/protests/:pid', { preHandler: edit }, async (req) => {
    const proc = await need(req);
    const pid = idParam(ctx, req, 'pid', 'Protest');
    const before = await db.one<Row>(`select ${protestRow} from procurement_protests where id = $1 and procurement_id = $2`, [pid, proc.id]);
    if (!before) ctx.fail(404, 'not_found', 'Protest not found.');
    const b = body(req);
    const status = b.status !== undefined ? await protestStatus(b.status) : before!.status;
    const decided = ['upheld', 'denied', 'withdrawn'].includes(status);
    const decidedOn = isDate(b.decided_on) ? b.decided_on : decided ? (before!.decided_on ?? todayInZone()) : null;
    const decision = b.decision !== undefined ? cleanText(b.decision, 4000) : before!.decision;
    if (['upheld', 'denied'].includes(status) && !decision) invalid(ctx, { decision: 'Write the decision.' });
    const actor = actorOf(req);
    const row = await db.one<Row>(
      `update procurement_protests set status = $2, decided_on = $3, decision = $4, decided_by = case when $5 then $6::uuid else decided_by end,
         decided_by_name = case when $5 then $7 else decided_by_name end, grounds = coalesce($8, grounds), updated_at = now()
       where id = $1 returning ${protestRow}`,
      [pid, status, decidedOn, decision, decided && status !== before!.status, actor.id, actor.name, cleanText(b.grounds, 4000)]);
    await ctx.audit(req, { action: 'procurement.protest_change', recordType: PROCUREMENT, recordId: proc.id, summary: `Protest by ${before!.protester} on ${proc.ref}: ${status}`, before, after: row });
    return row;
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/procurements/:id/protests/:pid', tag: 'Procurement', permission: 'procurement.edit', summary: 'Change a protest\'s status or record its decision (who decided is recorded)', body: '{ status?, decided_on?, decision?, grounds? }', response: 'the protest' });

  // ---------- offers of a solicitation for its own page ----------

  app.get('/api/procurements/:id/offers-summary', { preHandler: view }, async (req) => {
    const proc = await need(req);
    // A figure: the number of offers is the same for everyone; who may read them is the offers' own rule.
    const r = (await db.one<Row>(`select count(*)::int as total, count(*) filter (where coalesce(status, '') not in ('withdrawn', 'nonresponsive'))::int as responsive
      from procurement_offers where procurement_id = $1 and deleted_at is null`, [proc.id]))!;
    const visible = await db.one<Row>(`select count(*)::int as n from procurement_offers o where o.procurement_id = $1 and o.deleted_at is null and ${ctx.resources.visibleWhere(OFFER, req.user, 'o')}`, [proc.id]);
    return { total: r.total, responsive: r.responsive, hidden: r.total - Number(visible?.n ?? 0) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/procurements/:id/offers-summary', tag: 'Procurement', permission: 'procurement.view',
    summary: 'How many offers a solicitation received (the same for everyone) and how many the reader may not open before the award',
    response: '{ total, responsive, hidden }',
  });
}

/** Offers' `procurement_id` is copied into scores; nothing else to do when a solicitation is deleted. */
export const PROCUREMENT_TYPES = [PROCUREMENT, OFFER];
