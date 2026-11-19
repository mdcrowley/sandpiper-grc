import type { ModuleContext, Row } from '../../core/module.ts';
import { makeScales, type Scale } from '../risks/scales.ts';

/**
 * The hazard log. Hazards are scored on the safety hazard matrix (`hazard_4x5`) that the risks
 * module keeps: this module reads that scale through the risks module's own scale code and
 * never keeps a copy, so an administrator's edit to the matrix applies here too.
 */

export const HAZARD_SCALE = 'hazard_4x5';

export function hazardScale(ctx: ModuleContext) {
  const scales = makeScales(ctx);
  /** The hazard matrix, or undefined when the risks module (which owns it) is not loaded. */
  async function get(): Promise<Scale | undefined> {
    if (!ctx.resources.get('risk')) return undefined;
    return scales.get(HAZARD_SCALE);
  }
  /** Rating and sortable score for a likelihood/severity pair. */
  async function rate(likelihood: unknown, severity: unknown): Promise<{ rating: string | null; score: number | null }> {
    const scale = await get();
    if (!scale) return { rating: null, score: null };
    const s = scales.score(scale, await scales.summaryLevels(), likelihood, severity);
    return { rating: s.rating, score: s.score };
  }
  return { get, rate };
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
}
