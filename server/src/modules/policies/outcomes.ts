// Mapping policies to framework outcomes. The mapping is a generic record link
// (policy -> framework_outcome, relation "supports"), so it also shows on the outcome's own
// Related tab. The frameworks module may not be loaded, so every use is guarded.
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

export const OUTCOME_TYPE = 'framework_outcome';
export const OUTCOME_RELATION = 'supports';

export function registerOutcomeRoutes(ctx: ModuleContext) {
  const { db } = ctx;

  const needPolicy = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('policy', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Policy not found.');

  /** The outcome record type, when the frameworks module is loaded and this person may see it. */
  const outcomeDef = (req: FastifyRequest) => {
    const def = ctx.resources.get(OUTCOME_TYPE);
    return def && def.restricted !== true && ctx.can(req.user, `${def.module}.view`) ? def : undefined;
  };

  ctx.app.get('/api/policies/:id/outcomes', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const policy = await needPolicy(req);
    const def = outcomeDef(req);
    if (!def) return { available: false, route: null, rows: [] };
    const links = await db.query<Row>(
      `select id, to_id, created_at from record_links where from_type = 'policy' and from_id = $1 and to_type = $2 and relation = $3`,
      [policy.id, OUTCOME_TYPE, OUTCOME_RELATION],
    );
    const rows: Row[] = [];
    for (const l of links) {
      const o = await ctx.resources.find(OUTCOME_TYPE, l.to_id, req.user);
      if (!o) continue;
      rows.push({
        link_id: l.id, id: o.id, code: def.ref ? o[def.ref.field] ?? null : null, title: o[def.titleField] ?? '',
        status: o.status ?? null, status_list: def.fields.status?.list ?? null, linked_at: l.created_at,
      });
    }
    rows.sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? ''), undefined, { numeric: true }));
    return { available: true, route: def.route, rows };
  });

  ctx.app.post('/api/policies/:id/outcomes', { preHandler: ctx.requirePerm('policies.edit') }, async (req, reply) => {
    const policy = await needPolicy(req);
    const def = outcomeDef(req) ?? ctx.fail(409, 'unavailable', 'Framework outcomes are not available.');
    const outcomeId = String(((req.body ?? {}) as Row).outcome_id ?? '');
    const outcome = (await ctx.resources.find(OUTCOME_TYPE, outcomeId, req.user))
      ?? ctx.fail(400, 'validation', 'Check the highlighted fields.', { outcome_id: 'Choose a framework outcome.' });
    const made = await db.one<Row>(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('policy', $1, $2, $3, $4, $5)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing returning id`,
      [policy.id, OUTCOME_TYPE, outcome.id, OUTCOME_RELATION, actorOf(req).id],
    );
    if (made) {
      const name = [def.ref && outcome[def.ref.field], outcome[def.titleField]].filter(Boolean).join(' ');
      await ctx.audit(req, {
        action: 'policy.outcome_link', recordType: 'policy', recordId: policy.id,
        summary: `Mapped to framework outcome ${name}`, after: { to_type: OUTCOME_TYPE, to_id: outcome.id, relation: OUTCOME_RELATION },
      });
    }
    reply.code(made ? 201 : 200);
    return { ok: true, added: !!made };
  });

  ctx.app.delete('/api/policies/:id/outcomes/:outcomeId', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const policy = await needPolicy(req);
    const outcomeId = String((req.params as Row).outcomeId);
    const gone = /^[0-9a-f-]{36}$/i.test(outcomeId)
      ? await db.query<Row>(
        `delete from record_links where from_type = 'policy' and from_id = $1 and to_type = $2 and to_id = $3 and relation = $4 returning id`,
        [policy.id, OUTCOME_TYPE, outcomeId, OUTCOME_RELATION],
      )
      : [];
    if (!gone.length) ctx.fail(404, 'not_found', 'This outcome is not mapped to the policy.');
    await ctx.audit(req, {
      action: 'policy.outcome_unlink', recordType: 'policy', recordId: policy.id,
      summary: `Mapping to ${(await ctx.resources.labelFor(OUTCOME_TYPE, outcomeId).catch(() => null)) ?? 'a framework outcome'} removed`,
      before: { to_type: OUTCOME_TYPE, to_id: outcomeId, relation: OUTCOME_RELATION },
    });
    return { ok: true };
  });
}
