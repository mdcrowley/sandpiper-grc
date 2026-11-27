import type { preHandlerHookHandler } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { heatBasis, type Scale, type ScaleLevel, type Scales } from './scales.ts';
import { riskMasker } from './masking.ts';

// One heat map for every risk scale at the common level (E41-17). Scales differ in size (five by
// five, four severities by five likelihoods, or whatever an administrator built), so each scale's
// likelihood and impact levels are placed on a common five-step axis by their position on their own
// scale: the lowest level of every scale is step 1, the highest step 5, and the levels between are
// spread evenly (a four-level severity becomes steps 1, 2, 4 and 5). A cell is colored by the most
// severe common level of the risks in it, or, while empty, by the most severe common level any
// offered scale gives that part of its matrix. The legend counts every risk at its own common level,
// so its totals match the register's "Critical" and "High" tiles. Figures are the same for everyone
// who may see risks (risks.view); a restricted risk the caller may not see is listed masked (masking.ts).

export const COMMON_KEY = '_common';
export const COMMON_STEPS = 5;
const STEP_LABELS: ScaleLevel[] = [
  { value: 1, label: 'Lowest', description: 'The lowest level of every scale' },
  { value: 2, label: 'Low', description: 'The second level of a five-level scale; the second of four' },
  { value: 3, label: 'Middle', description: 'The middle level of a five-level scale' },
  { value: 4, label: 'High', description: 'The fourth level of a five-level scale; the third of four' },
  { value: 5, label: 'Highest', description: 'The highest level of every scale' },
];

/** Where a level of a scale falls on the common five-step axis (null: not a level of that scale). */
export function commonStep(levels: ScaleLevel[], value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const sorted = [...levels].sort((a, b) => a.value - b.value);
  const at = sorted.findIndex((l) => l.value === Number(value));
  if (at < 0) return null;
  if (sorted.length === 1) return Math.ceil(COMMON_STEPS / 2);
  return 1 + Math.round((at * (COMMON_STEPS - 1)) / (sorted.length - 1));
}

interface Deps {
  scales: Scales;
  riskPre: (action: string) => preHandlerHookHandler[];
  statusesWith: (list: string, flag: string) => Promise<string[]>;
  scaleOffered: (key: string) => Promise<boolean>;
}

export function registerCommonHeatmap(ctx: ModuleContext, deps: Deps): void {
  ctx.app.get('/api/risks/heatmap/common', { preHandler: deps.riskPre('view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const basis = heatBasis(q.basis);
    const mask = riskMasker(ctx, req.user);
    const levels = (await ctx.lookups.values('risk_summary_level')).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const rank = new Map(levels.map((l, i) => [l.value, i]));
    const all: Scale[] = [];
    for (const s of await deps.scales.all()) if (await deps.scaleOffered(s.key)) all.push(s);
    const byKey = new Map(all.map((s) => [s.key, s]));
    const levelOf = (s: Scale | undefined, rating: string | null) => s?.ratings.find((r) => r.key === rating)?.summary_level ?? null;
    const worse = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : (rank.get(b) ?? -1) > (rank.get(a) ?? -1) ? b : a);

    // What each part of the common grid stands for on the offered scales.
    const background = new Map<string, string | null>();
    for (const s of all) {
      for (const l of s.likelihood_levels) {
        for (const i of s.impact_levels) {
          const key = `${commonStep(s.likelihood_levels, l.value)}.${commonStep(s.impact_levels, i.value)}`;
          background.set(key, worse(background.get(key) ?? null, levelOf(s, s.matrix[String(l.value)]?.[String(i.value)] ?? null)));
        }
      }
    }

    const closed = q.include_closed === 'true' ? [] : await deps.statusesWith('risk_status', 'closed');
    const allClosed = await deps.statusesWith('risk_status', 'closed');
    const rows = await ctx.db.query<Row>(
      `select r.id, r.ref, r.title, r.status, r.scale_key, r.restricted, u.display_name as owner_name,
              r.inherent_likelihood as il, r.inherent_impact as ii, r.residual_likelihood as rl, r.residual_impact as ri,
              r.target_likelihood as tl, r.target_impact as ti, r.target_rating, r.target_on::text as target_on,
              r.inherent_rating, r.residual_rating, r.${basis}_score as score
       from risks r left join users u on u.id = r.owner_id
       where r.deleted_at is null and r.scale_key = any($1::text[]) and not (coalesce(r.status, '') = any($2::text[]))
       order by r.${basis}_score desc nulls last, r.ref`,
      [all.map((s) => s.key), closed],
    );
    const risks = rows.map((r) => {
      const s = byKey.get(r.scale_key)!;
      const place = (l: unknown, i: unknown) => {
        const cl = commonStep(s.likelihood_levels, l as number | null);
        const ci = commonStep(s.impact_levels, i as number | null);
        return cl === null || ci === null ? null : { likelihood: cl, impact: ci };
      };
      const inherent = place(r.il, r.ii);
      const residual = place(r.rl, r.ri);
      const target = place(r.tl, r.ti);
      return {
        id: r.id as string, ref: r.ref, title: r.title, status: r.status, closed: allClosed.includes(r.status), owner_name: r.owner_name, restricted: r.restricted,
        scale_key: r.scale_key, scale_name: s.name,
        score: r.score,
        inherent: inherent && { ...inherent, rating: levelOf(s, r.inherent_rating) },
        residual: residual && { ...residual, rating: levelOf(s, r.residual_rating) },
        target: target && { ...target, rating: levelOf(s, r.target_rating), on: r.target_on },
        at: basis === 'residual' ? residual : basis === 'target' ? target : inherent,
        level: levelOf(s, basis === 'residual' ? r.residual_rating : basis === 'target' ? r.target_rating : r.inherent_rating),
      };
    });

    const cells = STEP_LABELS.flatMap((l) => STEP_LABELS.map((i) => {
      const here = risks.filter((r) => r.at?.likelihood === l.value && r.at?.impact === i.value);
      const rating = here.length ? here.reduce<string | null>((m, r) => worse(m, r.level), null) : background.get(`${l.value}.${i.value}`) ?? null;
      const lv = levels.find((x) => x.value === rating);
      return {
        likelihood: l.value, impact: i.value, rating, color: lv?.color ?? 'gray', count: here.length, risk_ids: here.map((r) => r.id),
        above_appetite: false,
      };
    }));

    const moves = new Map<string, { from: { likelihood: number; impact: number }; to: { likelihood: number; impact: number }; count: number; risk_ids: string[] }>();
    for (const r of risks) {
      const [from, to] = basis === 'target' ? [r.residual ?? r.inherent, r.target] : [r.inherent, r.residual];
      if (!from || !to || (from.likelihood === to.likelihood && from.impact === to.impact)) continue;
      const key = `${from.likelihood}.${from.impact}.${to.likelihood}.${to.impact}`;
      const m = moves.get(key) ?? { from: { likelihood: from.likelihood, impact: from.impact }, to: { likelihood: to.likelihood, impact: to.impact }, count: 0, risk_ids: [] as string[] };
      m.count += 1;
      m.risk_ids.push(r.id);
      moves.set(key, m);
    }

    const matrix: Scale['matrix'] = {};
    for (const l of STEP_LABELS) {
      matrix[l.value] = {};
      for (const i of STEP_LABELS) matrix[l.value][i.value] = background.get(`${l.value}.${i.value}`) ?? '';
    }
    const scale: Scale = {
      key: COMMON_KEY, name: 'All scales (common levels)',
      description: `Every scale in use (${all.map((s) => s.name).join(', ')}) on one grid: each scale's levels are spread from its lowest to its highest, and each rating counts at its common level.`,
      likelihood_label: 'Likelihood', impact_label: 'Impact or severity',
      likelihood_levels: STEP_LABELS, impact_levels: STEP_LABELS, matrix,
      ratings: levels.map((l, i) => ({ key: l.value, label: l.label, color: l.color ?? 'gray', sort: (i + 1) * 10, summary_level: l.value })),
      acceptance_threshold: null,
    };
    const scored = risks.filter((r) => r.at).length;
    return {
      scale, basis, cells, appetite: null,
      totals: levels.map((l) => ({ rating: l.value, label: l.label, color: l.color ?? 'gray', count: risks.filter((r) => r.at && r.level === l.value).length })),
      total: risks.length, unscored: risks.length - scored,
      include_closed: q.include_closed === 'true',
      movements: [...moves.values()],
      scales: all.map((s) => ({ key: s.key, name: s.name, count: risks.filter((r) => r.scale_key === s.key).length })),
      inherent_only: basis === 'residual' ? risks.filter((r) => !r.residual && r.inherent).length : 0,
      risks: risks.map(({ at, level: _level, ...r }) => mask({ ...r, likelihood: at?.likelihood ?? null, impact: at?.impact ?? null })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/risks/heatmap/common', permission: 'risks.view', tag: 'Risks',
    summary: 'One heat map of every offered risk scale at the common level: each scale\'s levels placed on a five-step grid, colored by common level',
    description: 'Restricted risks the caller may not see are counted and listed as "Restricted risk" without their details. Same shape as /api/risks/heatmap, with a scale whose key is "_common" and whose ratings are the common levels.',
    query: { basis: 'residual (default) | inherent | target', include_closed: 'true to include closed risks' },
  });
}
