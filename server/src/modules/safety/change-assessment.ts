import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { RELATION, safetyAssessments } from '../changes/safety-impact.ts';

/**
 * The safety assessment of a change (E25-11), served by the safety module so that it follows the
 * safety area: while safety management is switched off these routes answer 404 and leave the API
 * description. The rule that a change affecting safety needs a hazard linked with the relation
 * `safety_assessment` before submission, scheduling or start is the changes module's
 * (changes/workflow.ts, helper changes/safety-impact.ts).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerChangeAssessment(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('changes.view') };
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const safetyOn = () => Boolean(ctx.resources.get('hazard'));
  const changeFor = async (req: FastifyRequest): Promise<Row> =>
    (ctx.resources.get('change') && await ctx.resources.find('change', (req.params as { id: string }).id, req.user)) || ctx.fail(404, 'not_found', 'Change not found.');

  /** The hazards themselves are listed only to people who may see the hazard log; everyone else sees how many. */
  async function state(req: FastifyRequest, change: Row) {
    if (!safetyOn()) return { available: false, safety_impact: Boolean(change.safety_impact), required: false, count: 0, hazards: [] };
    const count = await safetyAssessments(ctx, change.id);
    const hazards = ctx.can(req.user, 'safety.view')
      ? await db.query<Row>(
        `select distinct h.id, h.ref, h.title, h.status, h.rating, h.residual_rating from record_links l join hazards h on h.deleted_at is null
           and ((l.from_type = 'change' and l.from_id = $1 and l.to_type = 'hazard' and h.id = l.to_id)
             or (l.to_type = 'change' and l.to_id = $1 and l.from_type = 'hazard' and h.id = l.from_id))
         where l.relation = $2 order by h.ref`, [change.id, RELATION])
      : [];
    return { available: true, safety_impact: Boolean(change.safety_impact), required: Boolean(change.safety_impact) && count === 0, count, hazards };
  }

  app.get('/api/changes/:id/safety-assessment', view, async (req) => state(req, await changeFor(req)));
  ctx.describeRoute({
    method: 'GET', path: '/api/changes/:id/safety-assessment', permission: 'changes.view', tag: 'Changes',
    summary: 'Whether a change affects safety, and the hazards linked as its safety assessment (listed only with safety.view)',
    response: '{ available, safety_impact, required, count, hazards: [{ id, ref, title, status, rating, residual_rating }] }',
  });

  async function link(req: FastifyRequest, change: Row, hazard: Row) {
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('change', $1, 'hazard', $2, $3, $4)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [change.id, hazard.id, RELATION, req.user!.id]);
    await ctx.audit(req, { action: 'change.safety_assessment_add', recordType: 'change', recordId: change.id, summary: `Hazard ${hazard.ref} linked as the safety assessment`, after: { hazard_id: hazard.id } });
    await ctx.audit(req, { action: 'hazard.change_add', recordType: 'hazard', recordId: hazard.id, summary: `Linked as the safety assessment of change ${change.ref}`, after: { change_id: change.id } });
  }

  /** Body: { hazard_id } links an existing hazard; { title, description?, consequence?, likelihood?, severity? } creates one from the change. */
  app.post('/api/changes/:id/safety-assessment', { preHandler: [ctx.requirePerm('changes.edit'), ctx.requirePerm('safety.view')] }, async (req, reply) => {
    if (!safetyOn()) ctx.fail(409, 'safety_off', 'Safety management is not available on this installation.');
    const change = await changeFor(req);
    const b = (req.body ?? {}) as Row;
    let hazard: Row | undefined;
    if (b.hazard_id !== undefined) {
      if (!UUID.test(String(b.hazard_id))) invalid({ hazard_id: 'Choose a hazard.' });
      hazard = (await ctx.resources.find('hazard', String(b.hazard_id), req.user)) ?? invalid({ hazard_id: 'That hazard does not exist.' });
    } else {
      if (!ctx.can(req.user, 'safety.create')) ctx.fail(403, 'forbidden', 'Creating a hazard needs permission to create safety records.');
      const title = String(b.title ?? '').trim();
      if (!title) invalid({ title: 'Name the hazard the change brings or changes.' });
      hazard = await ctx.resources.create('hazard', {
        title, source: 'change', description: b.description ?? `Raised from change ${change.ref}: ${change.title}`,
        consequence: b.consequence ?? null, likelihood: b.likelihood ?? null, severity: b.severity ?? null, owner_id: req.user!.id,
      }, req);
    }
    await link(req, change, hazard!);
    reply.code(201);
    return state(req, change);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/changes/:id/safety-assessment', permission: 'changes.edit', tag: 'Changes',
    summary: 'Link a hazard as a change\'s safety assessment, or create one from the change (also needs safety.view; creating needs safety.create)',
    body: '{ hazard_id } | { title, description?, consequence?, likelihood?, severity? }',
  });

  app.delete('/api/changes/:id/safety-assessment/:hazardId', { preHandler: [ctx.requirePerm('changes.edit'), ctx.requirePerm('safety.view')] }, async (req) => {
    const change = await changeFor(req);
    const hazardId = (req.params as { hazardId: string }).hazardId;
    const gone = UUID.test(hazardId) ? await db.query(
      `delete from record_links where relation = $3 and ((from_type = 'change' and from_id = $1 and to_type = 'hazard' and to_id = $2)
         or (to_type = 'change' and to_id = $1 and from_type = 'hazard' and from_id = $2)) returning id`, [change.id, hazardId, RELATION]) : [];
    if (!gone.length) ctx.fail(404, 'not_found', 'That hazard is not linked as this change\'s safety assessment.');
    await ctx.audit(req, { action: 'change.safety_assessment_remove', recordType: 'change', recordId: change.id, summary: 'Safety assessment hazard unlinked', before: { hazard_id: hazardId } });
    return state(req, change);
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/changes/:id/safety-assessment/:hazardId', permission: 'changes.edit', tag: 'Changes', summary: 'Unlink a hazard from a change\'s safety assessment (also needs safety.view)' });

}
