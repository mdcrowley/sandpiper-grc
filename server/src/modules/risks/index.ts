import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { MASKED_LABEL, MASKED_SQL, MASKED_VALUE } from '../../core/resource.ts';
import { makeActionExtras } from './actions.ts';
import { makeLifecycle } from './lifecycle.ts';
import { runObligationReminders } from './obligation-reminders.ts';
import { DEFAULT_SCALE, makeScales, THRESHOLD_SETTING, type Scale } from './scales.ts';
import { seedRisksModule } from './seed.ts';

// Risk register, cross-module action tracker and obligations register.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function seedLookups(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('risk_summary_level', [
    { value: 'low', label: 'Low', color: 'green', sort: 10 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
    { value: 'high', label: 'High', color: 'orange', sort: 30 },
    { value: 'critical', label: 'Critical', color: 'red', sort: 40 },
  ], { module: 'risks' });
  await ctx.lookups.ensure('risk_category', [
    { value: 'cyber', label: 'Cybersecurity', color: 'blue', sort: 10, meta: { scale: 'cyber_5x5' } },
    { value: 'enterprise', label: 'Enterprise', color: 'purple', sort: 20, meta: { scale: 'cyber_5x5' } },
    { value: 'third_party', label: 'Third party', color: 'teal', sort: 30, meta: { scale: 'cyber_5x5' } },
    { value: 'compliance', label: 'Compliance', color: 'gray', sort: 40, meta: { scale: 'cyber_5x5' } },
    { value: 'safety', label: 'Safety', color: 'orange', sort: 50, meta: { scale: 'hazard_4x5' } },
  ], { module: 'risks' });
  await ctx.lookups.ensure('risk_treatment', [
    { value: 'mitigate', label: 'Mitigate', color: 'blue', sort: 10 },
    { value: 'accept', label: 'Accept', color: 'amber', sort: 20 },
    { value: 'transfer', label: 'Transfer', color: 'purple', sort: 30 },
    { value: 'avoid', label: 'Avoid', color: 'teal', sort: 40 },
  ], { module: 'risks' });
  await ctx.lookups.ensure('risk_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'in_treatment', label: 'In treatment', color: 'amber', sort: 20 },
    { value: 'accepted', label: 'Accepted', color: 'purple', sort: 30 },
    // Where the daily check puts a risk whose acceptance has expired (see lifecycle.ts).
    { value: 'needs_review', label: 'Needs review', color: 'red', sort: 35, meta: { needs_review: true } },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 40, meta: { closed: true } },
  ], { module: 'risks' });
  await ctx.lookups.ensure('action_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'amber', sort: 20 },
    { value: 'blocked', label: 'Blocked', color: 'red', sort: 30 },
    { value: 'done', label: 'Done', color: 'green', sort: 40, meta: { closed: true, done: true } },
    { value: 'cancelled', label: 'Canceled', color: 'gray', sort: 50, meta: { closed: true } },
  ], { module: 'actions' });
  await ctx.lookups.ensure('action_priority', [
    { value: 'high', label: 'High', color: 'red', sort: 10 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
    { value: 'low', label: 'Low', color: 'gray', sort: 30 },
  ], { module: 'actions' });
  await ctx.lookups.ensure('action_source', [
    { value: 'risk', label: 'Risk', color: 'orange', sort: 10 },
    { value: 'assessment', label: 'Assessment', color: 'blue', sort: 20 },
    { value: 'incident', label: 'Incident', color: 'red', sort: 30 },
    { value: 'audit', label: 'Audit', color: 'purple', sort: 40 },
    { value: 'exercise', label: 'Exercise', color: 'teal', sort: 50 },
    { value: 'information_request', label: 'Information request', color: 'amber', sort: 60 },
    { value: 'project', label: 'Project', color: 'green', sort: 70 },
    { value: 'change', label: 'Change', color: 'blue', sort: 72 },
    { value: 'vulnerability', label: 'Vulnerability', color: 'red', sort: 74 },
    { value: 'policy', label: 'Policy', color: 'purple', sort: 76 },
    { value: 'training', label: 'Training', color: 'teal', sort: 77 },
    { value: 'vendor', label: 'Vendor', color: 'orange', sort: 78 },
    { value: 'problem', label: 'Problem', color: 'amber', sort: 79 },
    { value: 'other', label: 'Other', color: 'gray', sort: 80 },
  ], { module: 'actions' });
  await ctx.lookups.ensure('obligation_status', [
    { value: 'not_assessed', label: 'Not assessed', color: 'gray', sort: 10 },
    { value: 'met', label: 'Met', color: 'green', sort: 20 },
    { value: 'partly_met', label: 'Partly met', color: 'amber', sort: 30 },
    { value: 'not_met', label: 'Not met', color: 'red', sort: 40 },
  ], { module: 'obligations' });
}

const mod: ModuleDef = {
  key: 'risks',

  async seedDefaults(ctx) {
    await seedLookups(ctx);
    await makeScales(ctx).seedDefaults();
  },

  async register(ctx) {
    const scales = makeScales(ctx);
    const today = async () => (await ctx.db.one<{ d: string }>('select current_date::text as d'))!.d;
    const statusesWith = async (list: string, flag: string) =>
      (await ctx.lookups.values(list)).filter((v) => v.meta?.[flag]).map((v) => v.value);

    // Risks are restricted: hand-written routes need security.view as well as the risks permission.
    const riskPre = (action: string) => [ctx.requirePerm(`risks.${action}`), ctx.requirePerm('security.view')];

    // ------------------------------------------------------------------ risks

    /** Picks the scale, checks scores against it and fills the computed rating columns. */
    async function prepareRisk(req: FastifyRequest | null, existing: Row | null, data: Row): Promise<Row> {
      const merged: Row = { ...(existing ?? {}), ...data };
      if (data.scale_key === undefined || data.scale_key === null) {
        const categoryChanged = !existing || (data.category !== undefined && data.category !== existing.category);
        if (categoryChanged || !merged.scale_key) {
          const category = (await ctx.lookups.values('risk_category')).find((v) => v.value === merged.category);
          merged.scale_key = (category?.meta?.scale as string | undefined) ?? existing?.scale_key ?? DEFAULT_SCALE;
        } else {
          merged.scale_key = existing!.scale_key;
        }
        if (data.scale_key === null || merged.scale_key !== existing?.scale_key) data.scale_key = merged.scale_key;
      }
      const scale = await scales.get(merged.scale_key);
      if (!scale) return ctx.fail(400, 'validation', 'Check the highlighted fields.', { scale_key: `Unknown risk scale "${merged.scale_key}".` });

      const errors: Record<string, string> = {};
      const checks: [string, string, Scale['likelihood_levels']][] = [
        ['inherent_likelihood', `Inherent ${scale.likelihood_label.toLowerCase()}`, scale.likelihood_levels],
        ['inherent_impact', `Inherent ${scale.impact_label.toLowerCase()}`, scale.impact_levels],
        ['residual_likelihood', `Residual ${scale.likelihood_label.toLowerCase()}`, scale.likelihood_levels],
        ['residual_impact', `Residual ${scale.impact_label.toLowerCase()}`, scale.impact_levels],
      ];
      for (const [field, label, levels] of checks) {
        const v = merged[field];
        if (v === null || v === undefined) continue;
        if (!levels.some((l) => l.value === Number(v))) {
          errors[field] = `${label} must be one of the levels of the ${scale.name} scale: ${levels.map((l) => `${l.value} ${l.label}`).join(', ')}.`;
        }
      }
      for (const basis of ['inherent', 'residual']) {
        const l = merged[`${basis}_likelihood`] ?? null;
        const i = merged[`${basis}_impact`] ?? null;
        if ((l === null) !== (i === null)) {
          errors[l === null ? `${basis}_likelihood` : `${basis}_impact`] =
            `Give both ${scale.likelihood_label.toLowerCase()} and ${scale.impact_label.toLowerCase()}, or neither.`;
        }
      }
      if (req && data.status === 'accepted' && existing?.status !== 'accepted') {
        const current = existing && await ctx.db.one(
          'select 1 from risk_acceptances where risk_id = $1 and revoked_on is null and expires_on >= current_date', [existing.id]);
        if (!current) errors.status = 'Record an acceptance (approver, expiry and rationale) before marking a risk accepted.';
      }
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

      return { ...data, ...scales.scoreRisk(scale, await scales.summaryLevels(), merged) };
    }

    ctx.defineResource({
      type: 'risk', table: 'risks', module: 'risks', label: 'Risk', plural: 'Risks',
      path: '/api/risks', route: '/risks', titleField: 'title', ref: { field: 'ref', prefix: 'RSK-' },
      restricted: true,
      searchable: ['title', 'description', 'cause', 'consequence', 'affected'],
      defaultSort: { field: 'residual_score', dir: 'desc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        category: { label: 'Category', type: 'lookup', list: 'risk_category', default: 'cyber' },
        scale_key: { label: 'Scale', type: 'text' },
        affected: { label: 'Affected systems and data', type: 'longtext' },
        cause: { label: 'Cause', type: 'longtext' },
        consequence: { label: 'Consequence', type: 'longtext' },
        inherent_likelihood: { label: 'Inherent likelihood', type: 'number' },
        inherent_impact: { label: 'Inherent impact', type: 'number' },
        existing_controls: { label: 'Existing controls', type: 'longtext' },
        residual_likelihood: { label: 'Residual likelihood', type: 'number' },
        residual_impact: { label: 'Residual impact', type: 'number' },
        inherent_rating: { label: 'Inherent rating', type: 'text', readOnly: true },
        inherent_score: { label: 'Inherent score', type: 'number', readOnly: true },
        residual_rating: { label: 'Residual rating', type: 'text', readOnly: true },
        residual_score: { label: 'Residual score', type: 'number', readOnly: true },
        summary_level: { label: 'Summary level', type: 'lookup', list: 'risk_summary_level', readOnly: true },
        treatment: { label: 'Treatment', type: 'lookup', list: 'risk_treatment', default: 'mitigate' },
        owner_id: { label: 'Owner', type: 'user' },
        due_on: { label: 'Due', type: 'date' },
        status: { label: 'Status', type: 'lookup', list: 'risk_status', default: 'open' },
        review_on: { label: 'Next review', type: 'date' },
        last_reviewed_on: { label: 'Last reviewed', type: 'date', readOnly: true },
      },
      hooks: {
        beforeCreate: (req, data) => prepareRisk(req, null, data),
        beforeUpdate: (req, existing, patch) => prepareRisk(req, existing, patch),
      },
    });

    // ---- scales (data, editable by risks.administer)

    ctx.app.get('/api/risks/scales', { preHandler: ctx.requirePerm('risks.view') }, async () => scales.all());

    ctx.app.get('/api/risks/scales/:key', { preHandler: ctx.requirePerm('risks.view') }, async (req) =>
      (await scales.get((req.params as any).key)) ?? ctx.fail(404, 'not_found', 'Scale not found.'));

    async function saveScale(req: FastifyRequest, existing: Scale | undefined): Promise<Scale> {
      const body = (req.body ?? {}) as Row;
      const next: Row = { ...(existing ?? { acceptance_threshold: null }) };
      for (const k of ['name', 'description', 'likelihood_label', 'impact_label', 'likelihood_levels', 'impact_levels', 'ratings', 'matrix', 'acceptance_threshold']) {
        if (body[k] !== undefined) next[k] = body[k];
      }
      if (!existing) next.key = body.key;
      if (next.acceptance_threshold === '') next.acceptance_threshold = null;
      await scales.validate(next, !existing);
      if (!existing && await scales.get(next.key)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { key: 'A scale with that key already exists.' });
      if (existing) {
        // Levels in use by a risk cannot be removed: the risk would lose its meaning.
        const used = await ctx.db.query<Row>(
          `select inherent_likelihood, inherent_impact, residual_likelihood, residual_impact from risks where scale_key = $1 and deleted_at is null`, [existing.key]);
        const has = (levels: { value: number }[], v: number | null) => v === null || levels.some((l) => l.value === v);
        if (used.some((r) => !has(next.likelihood_levels, r.inherent_likelihood) || !has(next.likelihood_levels, r.residual_likelihood))) {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { likelihood_levels: 'A level that risks are scored on cannot be removed. Re-score those risks first.' });
        }
        if (used.some((r) => !has(next.impact_levels, r.inherent_impact) || !has(next.impact_levels, r.residual_impact))) {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { impact_levels: 'A level that risks are scored on cannot be removed. Re-score those risks first.' });
        }
      }
      await scales.save(next, !existing, req.user!.id);
      const thresholds = { ...(await scales.thresholds()) };
      if ((thresholds[next.key] ?? null) !== (next.acceptance_threshold ?? null)) {
        thresholds[next.key] = next.acceptance_threshold ?? null;
        await ctx.settings.set(THRESHOLD_SETTING, thresholds, req);
      }
      const rerated = existing ? await scales.rescore(next.key) : 0;
      const saved = (await scales.get(next.key))!;
      await ctx.audit(req, {
        action: existing ? 'risk_scale.update' : 'risk_scale.create', recordType: 'risk_scale', recordId: saved.key,
        summary: existing ? `Risk scale changed: ${saved.name} (${rerated} risks re-rated)` : `Risk scale added: ${saved.name}`,
        before: existing, after: saved,
      });
      return saved;
    }

    // What saving a changed scale would do, without saving it: the same validation, then how many
    // risks would be re-rated. The count is restricted information, so it is given only to people
    // who may see risks (security.view); others get the validation result alone.
    ctx.app.post('/api/risks/scales/:key/preview', { preHandler: ctx.requirePerm('risks.administer') }, async (req) => {
      const existing = (await scales.get((req.params as any).key)) ?? ctx.fail(404, 'not_found', 'Scale not found.');
      const body = (req.body ?? {}) as Row;
      const next: Row = { ...existing };
      for (const k of ['name', 'description', 'likelihood_label', 'impact_label', 'likelihood_levels', 'impact_levels', 'ratings', 'matrix', 'acceptance_threshold']) {
        if (body[k] !== undefined) next[k] = body[k];
      }
      if (next.acceptance_threshold === '') next.acceptance_threshold = null;
      await scales.validate(next, false);
      if (!ctx.can(req.user, 'security.view')) return { total: null, rerated: null, level_in_use: null };
      const levels = await scales.summaryLevels();
      const rows = await ctx.db.query<Row>('select * from risks where scale_key = $1 and deleted_at is null', [existing.key]);
      const has = (list: { value: number }[], v: number | null) => v === null || list.some((l) => l.value === v);
      return {
        total: rows.length,
        rerated: rows.filter((r) => {
          const c = scales.scoreRisk(next as Scale, levels, r);
          return (r.inherent_rating ?? null) !== c.inherent_rating || (r.residual_rating ?? null) !== c.residual_rating;
        }).length,
        level_in_use: rows.some((r) => !has(next.likelihood_levels, r.inherent_likelihood) || !has(next.likelihood_levels, r.residual_likelihood)
          || !has(next.impact_levels, r.inherent_impact) || !has(next.impact_levels, r.residual_impact)),
      };
    });

    ctx.app.post('/api/risks/scales', { preHandler: ctx.requirePerm('risks.administer') }, async (req, reply) => {
      const saved = await saveScale(req, undefined);
      reply.code(201);
      return saved;
    });

    ctx.app.patch('/api/risks/scales/:key', { preHandler: ctx.requirePerm('risks.administer') }, async (req) => {
      const existing = (await scales.get((req.params as any).key)) ?? ctx.fail(404, 'not_found', 'Scale not found.');
      return saveScale(req, existing);
    });

    // ---- heat map and summary

    ctx.app.get('/api/risks/heatmap', { preHandler: riskPre('view') }, async (req) => {
      const q = req.query as Record<string, string>;
      const scale = (await scales.get(q.scale ?? DEFAULT_SCALE)) ?? ctx.fail(404, 'not_found', 'Scale not found.');
      const basis = q.basis === 'inherent' ? 'inherent' : 'residual';
      const closed = q.include_closed === 'true' ? [] : await statusesWith('risk_status', 'closed');
      const allClosed = await statusesWith('risk_status', 'closed');
      const rows = await ctx.db.query<Row>(
        `select r.id, r.ref, r.title, r.status, u.display_name as owner_name, r.${basis}_likelihood as l, r.${basis}_impact as i,
                r.inherent_likelihood as il, r.inherent_impact as ii, r.residual_likelihood as rl, r.residual_impact as ri,
                r.inherent_rating, r.residual_rating, r.${basis}_score as score
         from risks r left join users u on u.id = r.owner_id
         where r.deleted_at is null and r.scale_key = $1 and not (coalesce(r.status, '') = any($2::text[]))
         order by r.${basis}_score desc nulls last, r.ref`,
        [scale.key, closed],
      );
      // Where controls move risks: one entry per pair of cells, inherent to residual.
      const moves = new Map<string, { from: { likelihood: number; impact: number }; to: { likelihood: number; impact: number }; count: number; risk_ids: string[] }>();
      for (const r of rows) {
        if (r.il === null || r.ii === null || r.rl === null || r.ri === null || (r.il === r.rl && r.ii === r.ri)) continue;
        const key = `${r.il}.${r.ii}.${r.rl}.${r.ri}`;
        const m = moves.get(key) ?? { from: { likelihood: r.il, impact: r.ii }, to: { likelihood: r.rl, impact: r.ri }, count: 0, risk_ids: [] as string[] };
        m.count += 1;
        m.risk_ids.push(r.id);
        moves.set(key, m);
      }
      const cells = scale.likelihood_levels.flatMap((l) => scale.impact_levels.map((i) => {
        const rating = scale.ratings.find((r) => r.key === scale.matrix[String(l.value)]?.[String(i.value)]);
        const ids = rows.filter((r) => r.l === l.value && r.i === i.value).map((r) => r.id as string);
        return { likelihood: l.value, impact: i.value, rating: rating?.key ?? null, color: rating?.color ?? 'gray', count: ids.length, risk_ids: ids };
      }));
      const scored = cells.reduce((n, c) => n + c.count, 0);
      return {
        scale, basis, cells,
        totals: scale.ratings.map((r) => ({
          rating: r.key, label: r.label, color: r.color,
          count: cells.filter((c) => c.rating === r.key).reduce((n, c) => n + c.count, 0),
        })),
        total: rows.length, unscored: rows.length - scored,
        include_closed: q.include_closed === 'true',
        movements: [...moves.values()],
        // Ranked for the list beside the matrix: highest on this basis first, unscored last.
        risks: rows.map((r) => ({
          id: r.id, ref: r.ref, title: r.title, status: r.status, closed: allClosed.includes(r.status), owner_name: r.owner_name,
          likelihood: r.l, impact: r.i, score: r.score,
          inherent: r.il === null ? null : { likelihood: r.il, impact: r.ii, rating: r.inherent_rating },
          residual: r.rl === null ? null : { likelihood: r.rl, impact: r.ri, rating: r.residual_rating },
        })),
      };
    });

    ctx.app.get('/api/risks/summary', { preHandler: riskPre('view') }, async () => {
      const all = await scales.all();
      const closed = await statusesWith('risk_status', 'closed');
      const levels = await ctx.lookups.values('risk_summary_level');
      const counts = await ctx.db.query<{ scale_key: string; summary_level: string | null; count: number }>(
        `select scale_key, summary_level, count(*)::int as count from risks
         where deleted_at is null and not (coalesce(status, '') = any($1::text[])) group by 1, 2`, [closed]);
      const top = await ctx.db.query<Row>(
        `select r.id, r.ref, r.title, r.scale_key, r.status, r.summary_level, r.owner_id, u.display_name as owner_name,
                coalesce(r.residual_rating, r.inherent_rating) as rating, coalesce(r.residual_score, r.inherent_score) as score
         from risks r left join users u on u.id = r.owner_id
         where r.deleted_at is null and not (coalesce(r.status, '') = any($1::text[])) and coalesce(r.residual_score, r.inherent_score) is not null
         order by score desc, r.created_at limit 10`, [closed]);
      const sum = (rows: typeof counts) => rows.reduce((n, r) => n + r.count, 0);
      const watch = (await ctx.db.one<Row>(
        `select count(*) filter (where r.status = any($2::text[]))::int as needs_review,
                count(*) filter (where r.review_on <= current_date)::int as reviews_due,
                count(*) filter (where r.status = 'accepted' and a.expires_on >= current_date and a.expires_on <= current_date + 60)::int as acceptances_expiring,
                count(*) filter (where (r.status = 'accepted' or r.status = any($2::text[])) and a.expires_on < current_date)::int as acceptances_expired
         from risks r
         left join lateral (select x.expires_on from risk_acceptances x where x.risk_id = r.id and x.revoked_on is null
                            order by x.approved_on desc, x.created_at desc limit 1) a on true
         where r.deleted_at is null and not (coalesce(r.status, '') = any($1::text[]))`,
        [closed, await statusesWith('risk_status', 'needs_review')]))!;
      return {
        ...watch,
        scales: all.map((s) => ({ key: s.key, name: s.name })),
        levels: levels.map((lv) => ({
          value: lv.value, label: lv.label, color: lv.color ?? 'gray',
          count: sum(counts.filter((c) => c.summary_level === lv.value)),
          by_scale: Object.fromEntries(all.map((s) => [s.key, sum(counts.filter((c) => c.summary_level === lv.value && c.scale_key === s.key))])),
        })),
        unscored: sum(counts.filter((c) => c.summary_level === null)),
        total: sum(counts),
        top: top.map((r) => {
          const rating = all.find((s) => s.key === r.scale_key)?.ratings.find((x) => x.key === r.rating);
          return { ...r, rating_label: rating?.label ?? r.rating, color: rating?.color ?? 'gray' };
        }),
      };
    });

    // ---- acceptance

    /** Whether accepting this risk needs a named executive approver, and why. */
    async function acceptanceRule(risk: Row) {
      const scale = await scales.get(risk.scale_key);
      const ratingKey: string | null = risk.residual_rating ?? risk.inherent_rating ?? null;
      const rating = scale?.ratings.find((r) => r.key === ratingKey) ?? null;
      const threshold = scale?.ratings.find((r) => r.key === scale.acceptance_threshold) ?? null;
      return {
        rating: rating?.key ?? null, rating_label: rating?.label ?? null,
        threshold: threshold?.key ?? null, threshold_label: threshold?.label ?? null,
        executive_required: !!rating && !!threshold && rating.sort >= threshold.sort,
      };
    }

    const visibleRisk = async (req: FastifyRequest) =>
      (await ctx.resources.find('risk', (req.params as any).id, req.user)) ?? ctx.fail(404, 'not_found', 'Risk not found.');

    ctx.app.get('/api/risks/acceptances-expiring', { preHandler: riskPre('view') }, async (req) => {
      const days = Math.min(3650, Math.max(0, Number((req.query as any).days ?? 60) || 0));
      return ctx.db.query(
        `select a.id, a.risk_id, r.ref, r.title, r.scale_key, r.status, coalesce(r.residual_rating, r.inherent_rating) as rating,
                a.approver_name, a.approver_title, a.approved_on, a.expires_on, a.reference, u.display_name as owner_name,
                (a.expires_on - current_date)::int as days_left, a.expires_on < current_date as expired
         from risks r
         join lateral (select * from risk_acceptances x where x.risk_id = r.id and x.revoked_on is null
                       order by x.approved_on desc, x.created_at desc limit 1) a on true
         left join users u on u.id = r.owner_id
         where r.deleted_at is null and (r.status = 'accepted' or r.status = any($2::text[])) and a.expires_on <= current_date + $1::int
         order by a.expires_on, r.ref`, [days, await statusesWith('risk_status', 'needs_review')]);
    });

    ctx.app.get('/api/risks/:id/acceptances', { preHandler: riskPre('view') }, async (req) => {
      const risk = await visibleRisk(req);
      const acceptances = await ctx.db.query<Row>(
        `select a.*, a.expires_on < current_date as expired, (a.expires_on - current_date)::int as days_left, u.display_name as recorded_by,
                v.display_name as revoked_by_name
         from risk_acceptances a left join users u on u.id = a.created_by left join users v on v.id = a.revoked_by
         where a.risk_id = $1 order by a.approved_on desc, a.created_at desc`, [risk.id]);
      // The newest acceptance that has not been revoked is the one that counts; the rest are history.
      let standing = false;
      for (const a of acceptances) {
        a.state = a.revoked_on ? 'revoked' : standing ? 'superseded' : a.expired ? 'expired' : 'current';
        if (!a.revoked_on) standing = true;
      }
      return { acceptances, rule: await acceptanceRule(risk) };
    });

    ctx.app.post('/api/risks/:id/acceptances', { preHandler: riskPre('approve') }, async (req, reply) => {
      const risk = await visibleRisk(req);
      const b = (req.body ?? {}) as Row;
      const text = (k: string) => String(b[k] ?? '').trim();
      const rule = await acceptanceRule(risk);
      if (!rule.rating) ctx.fail(400, 'not_scored', 'Score the risk before recording an acceptance.');

      const errors: Record<string, string> = {};
      const approvedOn = text('approved_on') || await today();
      const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(v));
      if (!validDate(approvedOn)) errors.approved_on = 'Approved on must be a date (YYYY-MM-DD).';
      if (!validDate(text('expires_on'))) errors.expires_on = 'Give the date the acceptance expires (YYYY-MM-DD).';
      else if (text('expires_on') <= approvedOn) errors.expires_on = 'The expiry date must be after the approval date.';
      if (!text('rationale')) errors.rationale = 'Say why the risk is being accepted.';
      if (rule.executive_required) {
        if (!text('approver_name')) errors.approver_name = 'Name the executive who approved the acceptance.';
        if (!text('approver_title')) errors.approver_title = "Give the approver's title.";
        if (!text('reference')) errors.reference = 'Give a reference for the approval (for example a memo, email or resolution).';
        if (errors.approver_name || errors.approver_title || errors.reference) {
          ctx.fail(400, 'executive_approval_required',
            `A risk rated ${rule.rating_label} is at or above the approval threshold (${rule.threshold_label}) for its scale, so acceptance needs a named executive approver: give the approver's name and title and a reference for the approval.`,
            errors);
        }
      }
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

      const row = (await ctx.db.one<Row>(
        `insert into risk_acceptances (risk_id, approver_name, approver_title, approved_on, expires_on, reference, rationale, rating_at_acceptance, executive_required, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [risk.id, text('approver_name') || req.user!.displayName, text('approver_title') || null, approvedOn, text('expires_on'),
          text('reference') || null, text('rationale'), rule.rating, rule.executive_required, req.user!.id],
      ))!;
      await ctx.audit(req, {
        action: 'risk.accept', recordType: 'risk', recordId: risk.id,
        summary: `Risk acceptance recorded for ${risk.ref}: approved by ${row.approver_name}, expires ${row.expires_on}`,
        after: row,
      });
      await ctx.resources.update('risk', risk.id, { status: 'accepted', treatment: 'accept' }, req);
      reply.code(201);
      return row;
    });

    // Revoking and expiry, reviews, the daily check and the board report.
    await makeLifecycle(ctx, { scales, riskPre, visibleRisk, statusesWith, today }).register();
    // Obligation due-date reminders, several times a day on the job queue; each goes out once.
    await scheduleWork(ctx, 'obligations.reminders', () => runObligationReminders(ctx), { every: 6 * 3_600_000, firstRunInMs: 100_000 });

    // ------------------------------------------------------------------ actions

    const extras = makeActionExtras(ctx);

    async function prepareAction(existing: Row | null, data: Row): Promise<Row> {
      const errors: Record<string, string> = {};
      // An action raised on a record files itself under that record's source unless told otherwise.
      if (!existing && (data.source === undefined || data.source === null || data.source === '')) {
        data.source = (data.source_type ? await extras.sourceFor(data.source_type) : undefined) ?? 'other';
      }
      if (data.source_id && !UUID.test(String(data.source_id))) errors.source_id = 'Source record is not a valid reference.';
      if (data.source_type && !/^[a-z_][a-z0-9_]*$/.test(String(data.source_type))) errors.source_type = 'Source record type is not valid.';
      if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
      if (data.status !== undefined && data.status !== existing?.status) {
        const done = (await statusesWith('action_status', 'done')).includes(data.status);
        if (done && !data.completed_on) data.completed_on = await today();
        if (!done && data.completed_on === undefined && existing?.completed_on) data.completed_on = null;
      }
      return data;
    }

    ctx.defineResource({
      type: 'action', table: 'actions', module: 'actions', label: 'Action', plural: 'Actions',
      path: '/api/actions', route: '/actions', titleField: 'title', ref: { field: 'ref', prefix: 'ACT-' },
      // An action raised on a restricted record (a risk, a security incident, anything flagged) is
      // itself restricted: core copies the flag from the source record and keeps it in step.
      restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
      searchable: ['title', 'description', 'notes', 'department', 'external_ref'],
      defaultSort: { field: 'due_on', dir: 'asc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'action_status', default: 'open' },
        priority: { label: 'Priority', type: 'lookup', list: 'action_priority', default: 'medium' },
        owner_id: { label: 'Owner', type: 'user' },
        due_on: { label: 'Due', type: 'date' },
        completed_on: { label: 'Completed', type: 'date' },
        // No fixed default: prepareAction files a new action under its source record's kind, else "other".
        source: { label: 'Source', type: 'lookup', list: 'action_source' },
        source_type: { label: 'Source record type', type: 'text' },
        source_id: { label: 'Source record', type: 'text' },
        external_ref: { label: 'External reference', type: 'text' },
        department: { label: 'Department', type: 'text' },
        notes: { label: 'Notes', type: 'longtext' },
        restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      },
      hooks: {
        beforeCreate: (_req, data) => prepareAction(null, data),
        beforeUpdate: (_req, existing, patch) => prepareAction(existing, patch),
        afterCreate: (req, row) => extras.notifyAssigned(req, row),
        afterUpdate: async (req, before, after) => {
          if (after.owner_id && after.owner_id !== before.owner_id) await extras.notifyAssigned(req, after);
        },
      },
    });
    extras.register();

    ctx.app.get('/api/actions/summary', { preHandler: ctx.requirePerm('actions.view') }, async (req) => {
      const closed = await statusesWith('action_status', 'closed');
      // Figures are the same for everyone (docs/security.md, "Figures"): every open action counts,
      // restricted or not. A restricted action's owner and department are its details, so those
      // groups put it under "Restricted records" for everyone. "Mine" is the caller's own figure.
      const open = `deleted_at is null and not (coalesce(status, '') = any($1::text[]))`;
      const masked = (col: string) => `case when coalesce(restricted, false) and ${col} is not null then ${MASKED_SQL} else ${col} end`;
      const head = (await ctx.db.one<Row>(
        `select count(*)::int as open,
                count(*) filter (where due_on < current_date)::int as overdue,
                count(*) filter (where due_on >= current_date and due_on <= current_date + (7 - extract(isodow from current_date))::int)::int as due_this_week,
                count(*) filter (where owner_id is null)::int as unassigned,
                current_date::text as today,
                (current_date + (7 - extract(isodow from current_date))::int)::text as week_end
         from actions where ${open}`, [closed]))!;
      const group = (expr: string) => ctx.db.query<Row>(
        `select ${expr} as value, count(*)::int as open, count(*) filter (where due_on < current_date)::int as overdue
         from actions where ${open} group by 1 order by 2 desc, 1`, [closed]);
      const owners = await group(masked('owner_id::text'));
      const names = new Map((await ctx.db.query<Row>(
        'select id::text as id, display_name from users where id::text = any($1::text[])', [owners.map((o) => o.value).filter((v) => v && v !== MASKED_VALUE)],
      )).map((u) => [u.id, u.display_name]));
      const sources = await ctx.lookups.values('action_source');
      const mine = (await ctx.db.one<Row>(
        `select count(*)::int as open, count(*) filter (where due_on < current_date)::int as overdue,
                count(*) filter (where due_on >= current_date and due_on <= current_date + (7 - extract(isodow from current_date))::int)::int as due_this_week
         from actions where ${open} and owner_id = $2 and ${ctx.resources.visibleWhere('action', req.user)}`, [closed, req.user!.id]))!;
      return {
        ...head,
        mine,
        open_statuses: (await ctx.lookups.values('action_status')).filter((v) => !v.meta?.closed).map((v) => v.value),
        by_owner: owners.map((o) => (o.value === MASKED_VALUE
          ? { owner_id: null, restricted: true, label: MASKED_LABEL, open: o.open, overdue: o.overdue }
          : { owner_id: o.value, label: o.value ? names.get(o.value) ?? 'Unknown user' : 'Unassigned', open: o.open, overdue: o.overdue })),
        by_source: (await group('source')).map((s) => {
          const lv = sources.find((x) => x.value === s.value);
          return { value: s.value, label: lv?.label ?? s.value ?? 'None', color: lv?.color ?? 'gray', open: s.open, overdue: s.overdue };
        }),
        by_department: (await group(masked(`nullif(department, '')`))).map((d) => (d.value === MASKED_VALUE
          ? { value: null, restricted: true, label: MASKED_LABEL, open: d.open, overdue: d.overdue }
          : { value: d.value, label: d.value ?? 'None', open: d.open, overdue: d.overdue })),
      };
    });

    // ------------------------------------------------------------------ obligations

    ctx.defineResource({
      type: 'obligation', table: 'obligations', module: 'obligations', label: 'Obligation', plural: 'Obligations',
      path: '/api/obligations', route: '/obligations', titleField: 'title', ref: { field: 'ref', prefix: 'OBL-' },
      searchable: ['title', 'source', 'requirement', 'how_met', 'evidence'],
      defaultSort: { field: 'ref', dir: 'asc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Obligation', type: 'text', required: true },
        source: { label: 'Source', type: 'text' },
        requirement: { label: 'Requirement', type: 'longtext' },
        owner_id: { label: 'Owner', type: 'user' },
        how_met: { label: 'How it is met', type: 'longtext' },
        evidence: { label: 'Evidence', type: 'longtext' },
        next_due_on: { label: 'Next due', type: 'date' },
        status: { label: 'Status', type: 'lookup', list: 'obligation_status', default: 'not_assessed' },
      },
    });

    // Obligations are organization data: none are created here. They come from the
    // organization profile at seed time (see seed.ts) or are entered by hand.
  },

  seed: (ctx, opts) => seedRisksModule(ctx, opts),
};

export default mod;
