import type { ModuleContext, Row } from '../../core/module.ts';
import { makeScales, type Scale } from '../risks/scales.ts';

/**
 * The hazard log. Hazards are scored on the safety hazard matrix (`hazard_4x5`) that the risks
 * module keeps: this module reads that scale through the risks module's own scale code and
 * never keeps a copy, so an administrator's edit to the matrix applies here too. The matrix stays in
 * use while the risks area is switched off (Administration > Features), and can then be changed from
 * the Safety side (`PATCH /api/safety/scale`, Administration > Hazard matrix): E20-15.
 */

export const HAZARD_SCALE = 'hazard_4x5';

export function hazardScale(ctx: ModuleContext) {
  const scales = makeScales(ctx);
  /**
   * Whether the risks module, which keeps the matrix, is installed. Its record types leave the
   * registry while its area is switched off, but its tables and the matrix are still there.
   */
  const installed = () => Boolean(ctx.resources.get('risk'))
    || (ctx.app.hasDecorator('switchedOffTypes') && ctx.app.switchedOffTypes().includes('risk'));
  /** The hazard matrix, or undefined when the risks module (which owns it) is not loaded. */
  async function get(): Promise<Scale | undefined> {
    if (!installed()) return undefined;
    return scales.get(HAZARD_SCALE);
  }
  /** Rating and sortable score for a likelihood/severity pair. */
  async function rate(likelihood: unknown, severity: unknown): Promise<{ rating: string | null; score: number | null }> {
    const scale = await get();
    if (!scale) return { rating: null, score: null };
    const s = scales.score(scale, await scales.summaryLevels(), likelihood, severity);
    return { rating: s.rating, score: s.score };
  }
  return { get, rate, scales };
}

export function registerHazards(ctx: ModuleContext) {
  const scale = hazardScale(ctx);
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  /** Checks the levels against the matrix and works out both ratings. */
  async function score(merged: Row, patch: Row): Promise<Row> {
    const pairs = [['likelihood', 'severity', 'rating', 'score'], ['residual_likelihood', 'residual_severity', 'residual_rating', 'residual_score']] as const;
    const touched = pairs.some(([l, s]) => l in patch || s in patch);
    if (!touched) return patch;
    const m = await scale.get();
    const errors: Record<string, string> = {};
    for (const [l, s, rating, sc] of pairs) {
      const lv = merged[l];
      const sv = merged[s];
      if (m) {
        if (lv !== null && lv !== undefined && !m.likelihood_levels.some((x) => x.value === Number(lv))) errors[l] = 'Choose a likelihood level from the hazard matrix.';
        if (sv !== null && sv !== undefined && !m.impact_levels.some((x) => x.value === Number(sv))) errors[s] = 'Choose a severity level from the hazard matrix.';
      }
      if ((lv === null || lv === undefined) !== (sv === null || sv === undefined)) {
        errors[lv === null || lv === undefined ? l : s] = 'Give both likelihood and severity, or neither.';
      }
      const r = await scale.rate(lv, sv);
      patch[rating] = r.rating;
      patch[sc] = r.score;
    }
    if (Object.keys(errors).length) invalid(errors);
    return patch;
  }

  ctx.defineResource({
    type: 'hazard', table: 'hazards', module: 'safety', label: 'Hazard', plural: 'Hazards',
    path: '/api/hazards', route: '/safety/hazards', titleField: 'title',
    ref: { field: 'ref', prefix: 'HAZ-' },
    searchable: ['title', 'description', 'consequence', 'existing_controls'],
    defaultSort: { field: 'score', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Hazard', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext' },
      source: { label: 'Source', type: 'lookup', list: 'hazard_source' },
      consequence: { label: 'Possible consequence', type: 'longtext' },
      existing_controls: { label: 'Existing controls', type: 'longtext' },
      mode: { label: 'Mode', type: 'lookup', list: 'vehicle_mode' },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      likelihood: { label: 'Likelihood', type: 'number' },
      severity: { label: 'Severity', type: 'number' },
      rating: { label: 'Rating', type: 'text', readOnly: true },
      score: { label: 'Score', type: 'number', readOnly: true },
      residual_likelihood: { label: 'Likelihood after mitigation', type: 'number' },
      residual_severity: { label: 'Severity after mitigation', type: 'number' },
      residual_rating: { label: 'Rating after mitigation', type: 'text', readOnly: true },
      residual_score: { label: 'Score after mitigation', type: 'number', readOnly: true },
      owner_id: { label: 'Owner', type: 'user' },
      review_date: { label: 'Review date', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'hazard_status', default: 'identified' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (_req, data) => score(data, data),
      beforeUpdate: (_req, existing, patch) => score({ ...existing, ...patch }, patch),
    },
  });

  ctx.app.get('/api/safety/scale', { preHandler: ctx.requirePerm('safety.view') }, async () =>
    (await scale.get()) ?? ctx.fail(404, 'scale_missing', 'The safety hazard matrix is kept by the risks module, which is not loaded.'));
  ctx.describeRoute({ method: 'GET', path: '/api/safety/scale', summary: 'The safety hazard matrix hazards are scored on (read from the risks module)', permission: 'safety.view' });

  /**
   * Changes the hazard matrix from the Safety side (E20-15), so that it can be kept up to date while
   * the risks area is switched off. Only what concerns hazards: the labels and meanings of the levels
   * (their values stay, so no score loses its meaning) and the rating of each cell. The rest of the
   * scale (its name, ratings and approval threshold) is edited with the risk scales. Saving re-rates
   * every hazard and every risk on the matrix, so stored ratings always follow it.
   */
  ctx.app.patch('/api/safety/scale', { preHandler: ctx.requirePerm('safety.administer') }, async (req) => {
    const existing = (await scale.get()) ?? ctx.fail(404, 'scale_missing', 'The safety hazard matrix is not available on this installation.');
    const body = (req.body ?? {}) as Row;
    const next: Row = { ...existing };
    const fields: Record<string, string> = {};
    for (const [name, label] of [['likelihood_levels', 'likelihood'], ['impact_levels', 'severity']] as const) {
      if (body[name] === undefined) continue;
      const given = body[name];
      const same = Array.isArray(given) && given.length === existing[name].length
        && existing[name].every((l) => given.some((g: Row) => Number(g?.value) === l.value));
      if (!same) { fields[name] = `Keep the same ${label} levels: only their names and meanings can be changed here.`; continue; }
      next[name] = existing[name].map((l) => {
        const g = given.find((x: Row) => Number(x.value) === l.value) as Row;
        const { description: kept, ...level } = l;
        const description = typeof g.description === 'string' ? g.description.trim().slice(0, 500) : kept;
        return { ...level, label: String(g.label ?? '').trim().slice(0, 80), ...(description ? { description } : {}) };
      });
    }
    if (body.matrix !== undefined) next.matrix = body.matrix;
    for (const k of Object.keys(body)) {
      if (!['likelihood_levels', 'impact_levels', 'matrix'].includes(k)) fields[k] = 'This cannot be changed here.';
    }
    if (Object.keys(fields).length) invalid(fields);
    await scale.scales.validate(next, false);
    await scale.scales.save(next, false, req.user!.id);
    const saved = (await scale.get())!;
    // Stored ratings follow the matrix: the hazards, and the risks scored on it (kept while their area is off).
    // The same re-rating runs when the matrix is saved from Risk scales (BS-4).
    const hazards = await scale.scales.rescoreHazards();
    await scale.scales.rescore(HAZARD_SCALE);
    await ctx.audit(req, {
      action: 'risk_scale.update', recordType: 'risk_scale', recordId: HAZARD_SCALE,
      summary: `Hazard matrix changed from Safety: ${saved.name} (${hazards} hazards re-rated)`,
      before: { likelihood_levels: existing.likelihood_levels, impact_levels: existing.impact_levels, matrix: existing.matrix },
      after: { likelihood_levels: saved.likelihood_levels, impact_levels: saved.impact_levels, matrix: saved.matrix },
    });
    return { scale: saved, rerated: hazards };
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/safety/scale', permission: 'safety.administer',
    summary: 'Change the hazard matrix: level names and meanings, and the rating of each cell (re-rates hazards)',
    body: '{ likelihood_levels?: [{ value, label, description? }], impact_levels?: [{ value, label, description? }], matrix?: { [likelihood]: { [severity]: rating } } }',
    response: '{ scale, rerated }',
  });
}
