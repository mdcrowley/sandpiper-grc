import type { ModuleContext, Row } from '../../core/module.ts';
import { UUID_RE } from '../../core/errors.ts';

// Regulatory change intake (E30-04, E30-05): the `regulatory_change` record type (REG- numbers,
// permission module `obligations`). The records a change affects are generic links with the
// relation `affects` (contract C7: policies, obligations, controls); its actions are ordinary
// actions with the source `regulatory_change`. No law or regulator is shipped: every change is the
// organization's own entry.

export const AFFECTS = 'affects';

/** The lists of regulatory changes. Called from risks/index.ts `seedDefaults`; idempotent. */
export async function seedRegulatoryChangeDefaults(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('regulatory_change_status', [
    { value: 'identified', label: 'Identified', color: 'blue', sort: 10 },
    { value: 'assessing', label: 'Assessing', color: 'amber', sort: 20 },
    { value: 'implementing', label: 'Implementing', color: 'purple', sort: 30 },
    { value: 'implemented', label: 'Implemented', color: 'green', sort: 40, meta: { closed: true } },
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', sort: 50, meta: { closed: true } },
  ], { module: 'obligations' });
  await ctx.lookups.ensure('regulatory_impact', [
    { value: 'low', label: 'Low', color: 'green', sort: 10 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
    { value: 'high', label: 'High', color: 'red', sort: 30 },
  ], { module: 'obligations' });
  // The action source `regulatory_change` is in the action_source list in risks/index.ts.
}

/** Defines the `regulatory_change` type and its routes. Called from risks/index.ts `register`, after the obligations. */
export async function registerRegulatoryChanges(ctx: ModuleContext): Promise<void> {
  ctx.defineResource({
    type: 'regulatory_change', table: 'regulatory_changes', module: 'obligations',
    label: 'Regulatory change', plural: 'Regulatory changes',
    path: '/api/regulatory-changes', route: '/regulatory-changes', titleField: 'title', ref: { field: 'ref', prefix: 'REG-' },
    searchable: ['title', 'issuer', 'citation', 'summary', 'impact_assessment'],
    defaultSort: { field: 'effective_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      issuer: { label: 'Issued by', type: 'text' },
      citation: { label: 'Citation', type: 'text' },
      published_on: { label: 'Published', type: 'date' },
      effective_on: { label: 'Takes effect', type: 'date' },
      summary: { label: 'Summary', type: 'longtext', personal: false },
      impact_level: { label: 'Impact', type: 'lookup', list: 'regulatory_impact' },
      impact_assessment: { label: 'Impact assessment', type: 'longtext' },
      status: { label: 'Status', type: 'lookup', list: 'regulatory_change_status', default: 'identified' },
      owner_id: { label: 'Owner', type: 'user' },
    },
    hooks: {
      beforeCreate: (_req, data) => check(null, data),
      beforeUpdate: (_req, existing, patch) => check(existing, patch),
    },
  });

  /** A change is closed as implemented or not applicable only with its impact assessment written down. */
  function check(existing: Row | null, data: Row): Row {
    const merged = { ...(existing ?? {}), ...data };
    const errors: Record<string, string> = {};
    if (['implemented', 'not_applicable'].includes(merged.status) && !String(merged.impact_assessment ?? '').trim()) {
      errors.impact_assessment = merged.status === 'not_applicable'
        ? 'Say why the change does not apply before marking it not applicable.'
        : 'Write the impact assessment before marking the change implemented.';
    }
    if (merged.published_on && merged.effective_on && String(merged.effective_on) < String(merged.published_on)) {
      errors.effective_on = 'A change cannot take effect before it is published.';
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    return data;
  }

  // E30-05: an obligation made from a change, linked to it as an affected record.
  ctx.app.post('/api/regulatory-changes/:id/obligation', { preHandler: [ctx.requirePerm('obligations.edit'), ctx.requirePerm('obligations.create')] }, async (req, reply) => {
    const id = String((req.params as any).id);
    const change = (UUID_RE.test(id) && await ctx.resources.find('regulatory_change', id, req.user)) || ctx.fail(404, 'not_found', 'Regulatory change not found.');
    const b = (req.body ?? {}) as Row;
    const data: Row = {
      title: String(b.title ?? '').trim() || change.title,
      source: String(b.source ?? '').trim() || [change.citation, change.issuer].filter(Boolean).join(', ') || change.ref,
      requirement: b.requirement ?? change.summary ?? null,
      owner_id: b.owner_id ?? change.owner_id ?? null,
    };
    for (const k of ['type', 'frequency', 'next_due_on', 'applies_to']) if (b[k] !== undefined && b[k] !== '') data[k] = b[k];
    if (data.next_due_on === undefined && change.effective_on) data.next_due_on = String(change.effective_on).slice(0, 10);
    const obligation = await ctx.resources.create('obligation', data, req);
    await ctx.db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('regulatory_change', $1, 'obligation', $2, $3, $4)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [change.id, obligation.id, AFFECTS, req.user!.id]);
    await ctx.audit(req, {
      action: 'regulatory_change.obligation', recordType: 'regulatory_change', recordId: change.id,
      summary: `Obligation ${obligation.ref} made from ${change.ref}`, after: { obligation_id: obligation.id, ref: obligation.ref },
    });
    reply.code(201);
    return obligation;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/regulatory-changes/:id/obligation', permission: 'obligations.create',
    summary: 'Makes an obligation from a regulatory change and links it as an affected record',
    description: 'Needs obligations.create and obligations.edit. Fields left out are taken from the change: title, source (citation and issuer), requirement (summary), owner, next due (the date it takes effect).',
    body: { type: 'object', properties: { title: { type: 'string' }, source: { type: 'string' }, requirement: { type: 'string' }, owner_id: { type: 'string' }, type: { type: 'string' }, frequency: { type: 'string' }, next_due_on: { type: 'string', format: 'date' }, applies_to: { type: 'array' } } },
    response: 'The new obligation',
  });

  // The affected records, grouped for the change's page (links in either direction with the relation `affects`).
  ctx.app.get('/api/regulatory-changes/:id/affected', { preHandler: ctx.requirePerm('obligations.view') }, async (req) => {
    const id = String((req.params as any).id);
    const change = (UUID_RE.test(id) && await ctx.resources.find('regulatory_change', id, req.user)) || ctx.fail(404, 'not_found', 'Regulatory change not found.');
    const links = await ctx.db.query<Row>(
      `select id, to_type as type, to_id as record_id from record_links where from_type = 'regulatory_change' and from_id = $1 and relation = $2
       union all
       select id, from_type as type, from_id as record_id from record_links where to_type = 'regulatory_change' and to_id = $1 and relation = $2`,
      [change.id, AFFECTS]);
    const out: Row[] = [];
    for (const l of links) {
      const def = ctx.resources.get(l.type);
      if (!def || !ctx.can(req.user, `${def.module}.view`)) continue;
      const row = await ctx.resources.find(l.type, l.record_id, req.user);
      if (!row) continue;
      out.push({ link_id: l.id, type: l.type, type_label: def.label, id: l.record_id, ref: row.ref ?? null, label: row[def.titleField] ?? null, route: `${def.route}/${l.record_id}`, status: row.status ?? null });
    }
    return out;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/regulatory-changes/:id/affected', permission: 'obligations.view',
    summary: 'The records a regulatory change affects (links with the relation "affects"), those the caller may see',
    response: '[{ link_id, type, type_label, id, ref, label, route, status }]',
  });
}
