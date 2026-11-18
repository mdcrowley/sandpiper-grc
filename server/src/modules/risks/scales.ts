import type { ModuleContext, Row } from '../../core/module.ts';

/** One likelihood or impact/severity level. A higher `value` is worse. */
export interface ScaleLevel { value: number; label: string; description?: string }
export interface ScaleRating { key: string; label: string; color: string; sort: number; summary_level: string }
export interface Scale {
  key: string;
  name: string;
  description: string | null;
  likelihood_label: string;
  impact_label: string;
  likelihood_levels: ScaleLevel[];
  impact_levels: ScaleLevel[];
  /** matrix[likelihood value][impact value] = rating key */
  matrix: Record<string, Record<string, string>>;
  ratings: ScaleRating[];
  /** Residual rating at or above which acceptance needs a named executive approver (null = never). */
  acceptance_threshold: string | null;
}

export const COLOURS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'];
export const THRESHOLD_SETTING = 'risks.acceptance_thresholds';
export const DEFAULT_SCALE = 'cyber_5x5';

export const HAZARD_SCALE_NAME = 'Safety hazard matrix (4 by 5)';
export const HAZARD_SCALE_DESCRIPTION = 'Four severity levels by five likelihood levels, the standard hazard risk-assessment matrix.';
/**
 * Name the hazard scale carried in earlier versions. Databases created then are renamed at
 * start-up, unless an administrator has already changed the name.
 */
export const LEGACY_HAZARD_SCALE_NAME = ['Agency', 'Safety', 'Plan'].join(' ');

type ScaleSeed = Omit<Scale, 'acceptance_threshold'> & { sort: number };

function fiveByFive(): ScaleSeed {
  const likelihood_levels: ScaleLevel[] = [
    { value: 1, label: 'Rare', description: 'Not expected in the next five years' },
    { value: 2, label: 'Unlikely', description: 'Could happen once in five years' },
    { value: 3, label: 'Possible', description: 'Could happen once in two years' },
    { value: 4, label: 'Likely', description: 'Expected about once a year' },
    { value: 5, label: 'Almost certain', description: 'Expected several times a year' },
  ];
  const impact_levels: ScaleLevel[] = [
    { value: 1, label: 'Insignificant', description: 'No noticeable effect on service' },
    { value: 2, label: 'Minor', description: 'Brief disruption handled within the team' },
    { value: 3, label: 'Moderate', description: 'Service disruption of hours, or limited data exposure' },
    { value: 4, label: 'Major', description: 'Service disruption of days, a reportable breach or large cost' },
    { value: 5, label: 'Severe', description: 'Prolonged loss of service, harm to the public or lasting damage' },
  ];
  const matrix: Scale['matrix'] = {};
  for (const l of likelihood_levels) {
    matrix[l.value] = {};
    for (const i of impact_levels) {
      const p = l.value * i.value;
      matrix[l.value][i.value] = p >= 20 ? 'extreme' : p >= 10 ? 'high' : p >= 5 ? 'medium' : 'low';
    }
  }
  return {
    key: 'cyber_5x5', name: 'Cyber and enterprise risk (5 by 5)', sort: 10,
    description: 'Five likelihood levels by five impact levels, for cyber and enterprise risk.',
    likelihood_label: 'Likelihood', impact_label: 'Impact',
    likelihood_levels, impact_levels, matrix,
    ratings: [
      { key: 'low', label: 'Low', color: 'green', sort: 10, summary_level: 'low' },
      { key: 'medium', label: 'Medium', color: 'amber', sort: 20, summary_level: 'medium' },
      { key: 'high', label: 'High', color: 'orange', sort: 30, summary_level: 'high' },
      { key: 'extreme', label: 'Extreme', color: 'red', sort: 40, summary_level: 'critical' },
    ],
  };
}

/** Safety hazard scale (key `hazard_4x5`), laid out as the standard hazard risk-assessment matrix. */
function hazardMatrix(): ScaleSeed {
  // Rows: likelihood. Columns: severity Negligible (1) to Catastrophic (4).
  const rows: [number, string, string, string[]][] = [
    [5, 'Frequent', 'Likely to occur often', ['medium', 'serious', 'high', 'high']],
    [4, 'Probable', 'Will occur several times', ['medium', 'serious', 'high', 'high']],
    [3, 'Occasional', 'Likely to occur at some time', ['low', 'medium', 'serious', 'high']],
    [2, 'Remote', 'Unlikely, but possible', ['low', 'medium', 'medium', 'serious']],
    [1, 'Improbable', 'So unlikely it can be assumed it may not occur', ['low', 'medium', 'medium', 'medium']],
  ];
  const matrix: Scale['matrix'] = {};
  for (const [value, , , cells] of rows) matrix[value] = { 1: cells[0], 2: cells[1], 3: cells[2], 4: cells[3] };
  return {
    key: 'hazard_4x5', name: HAZARD_SCALE_NAME, sort: 20,
    description: HAZARD_SCALE_DESCRIPTION,
    likelihood_label: 'Likelihood', impact_label: 'Severity',
    likelihood_levels: rows.map(([value, label, description]) => ({ value, label, description })).reverse(),
    impact_levels: [
      { value: 1, label: 'Negligible', description: 'Minimal injury, loss or disruption' },
      { value: 2, label: 'Marginal', description: 'Minor injury, loss or disruption' },
      { value: 3, label: 'Critical', description: 'Severe injury, major loss or long disruption' },
      { value: 4, label: 'Catastrophic', description: 'Death, loss of a system or irreversible harm' },
    ],
    matrix,
    ratings: [
      { key: 'low', label: 'Low', color: 'green', sort: 10, summary_level: 'low' },
      { key: 'medium', label: 'Medium', color: 'amber', sort: 20, summary_level: 'medium' },
      { key: 'serious', label: 'Serious', color: 'orange', sort: 30, summary_level: 'high' },
      { key: 'high', label: 'High', color: 'red', sort: 40, summary_level: 'critical' },
    ],
  };
}

const DEFAULT_THRESHOLDS: Record<string, string> = { cyber_5x5: 'high', hazard_4x5: 'serious' };

export interface Scored { rating: string | null; score: number | null; summary_level: string | null }

export function makeScales(ctx: ModuleContext) {
  /**
   * Gives the hazard scale and the safety category their neutral names in a database created
   * by an earlier version. Only rows still carrying exactly the old text are touched, so it
   * is safe to run at every start and never undoes an administrator's edit.
   */
  async function renameLegacy(): Promise<void> {
    const scale = await ctx.db.one<Row>(
      `update risk_scales set name = $2, description = $3, updated_at = now() where key = 'hazard_4x5' and name = $1 returning key`,
      [LEGACY_HAZARD_SCALE_NAME, HAZARD_SCALE_NAME, HAZARD_SCALE_DESCRIPTION]);
    if (scale) {
      await ctx.audit(null, {
        action: 'risk_scale.update', recordType: 'risk_scale', recordId: 'hazard_4x5',
        summary: `Risk scale renamed: ${HAZARD_SCALE_NAME}`,
        before: { name: LEGACY_HAZARD_SCALE_NAME }, after: { name: HAZARD_SCALE_NAME },
      });
    }
    await ctx.db.query(
      `update lookups set label = 'Safety' where list_key = 'risk_category' and value = 'safety' and label = $1`,
      [`Safety (${LEGACY_HAZARD_SCALE_NAME})`]);
  }

  async function seedDefaults(): Promise<void> {
    await renameLegacy();
    for (const s of [fiveByFive(), hazardMatrix()]) {
      if (await ctx.db.one('select 1 from risk_scales where key = $1', [s.key])) continue; // an administrator may have edited it
      await ctx.db.query(
        `insert into risk_scales (key, name, description, likelihood_label, impact_label, likelihood_levels, impact_levels, matrix, sort)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
        [s.key, s.name, s.description, s.likelihood_label, s.impact_label,
          JSON.stringify(s.likelihood_levels), JSON.stringify(s.impact_levels), JSON.stringify(s.matrix), s.sort],
      );
      for (const r of s.ratings) {
        await ctx.db.query(
          'insert into risk_scale_ratings (scale_key, rating_key, label, color, sort, summary_level) values ($1,$2,$3,$4,$5,$6)',
          [s.key, r.key, r.label, r.color, r.sort, r.summary_level],
        );
      }
    }
  }

  const thresholds = () => ctx.settings.get<Record<string, string | null>>(THRESHOLD_SETTING, DEFAULT_THRESHOLDS);

  async function all(): Promise<Scale[]> {
    const rows = await ctx.db.query<Row>('select * from risk_scales order by sort, name');
    const ratings = await ctx.db.query<Row>('select * from risk_scale_ratings order by sort, label');
    const th = await thresholds();
    const byValue = (a: ScaleLevel, b: ScaleLevel) => a.value - b.value;
    return rows.map((s) => ({
      key: s.key, name: s.name, description: s.description,
      likelihood_label: s.likelihood_label, impact_label: s.impact_label,
      likelihood_levels: [...s.likelihood_levels].sort(byValue),
      impact_levels: [...s.impact_levels].sort(byValue),
      matrix: s.matrix,
      ratings: ratings.filter((r) => r.scale_key === s.key)
        .map((r) => ({ key: r.rating_key, label: r.label, color: r.color, sort: r.sort, summary_level: r.summary_level })),
      acceptance_threshold: th[s.key] ?? null,
    }));
  }

  async function get(key: unknown): Promise<Scale | undefined> {
    return (await all()).find((s) => s.key === key);
  }

  /** Summary level keys, least severe first. */
  async function summaryLevels(): Promise<string[]> {
    return (await ctx.lookups.values('risk_summary_level')).map((v) => v.value);
  }

  /**
   * Rating and sortable score for one likelihood/impact pair. The score ranks by the common
   * summary level first (hundreds), then by position within the scale (0-99), so risks on
   * different scales sort sensibly together.
   */
  function score(scale: Scale, levels: string[], likelihood: unknown, impact: unknown): Scored {
    if (likelihood === null || likelihood === undefined || impact === null || impact === undefined) {
      return { rating: null, score: null, summary_level: null };
    }
    const key = scale.matrix[String(likelihood)]?.[String(impact)];
    const rating = scale.ratings.find((r) => r.key === key);
    if (!rating) return { rating: null, score: null, summary_level: null };
    const lPos = scale.likelihood_levels.findIndex((l) => l.value === Number(likelihood)) + 1;
    const iPos = scale.impact_levels.findIndex((l) => l.value === Number(impact)) + 1;
    const within = Math.round(((lPos * iPos) / (scale.likelihood_levels.length * scale.impact_levels.length)) * 99);
    const level = Math.max(0, levels.indexOf(rating.summary_level)) + 1;
    return { rating: rating.key, score: level * 100 + within, summary_level: rating.summary_level };
  }

  /** Computed columns for a risk row (or merged row + patch). */
  function scoreRisk(scale: Scale, levels: string[], risk: Row): Row {
    const inherent = score(scale, levels, risk.inherent_likelihood, risk.inherent_impact);
    const residual = score(scale, levels, risk.residual_likelihood, risk.residual_impact);
    return {
      inherent_rating: inherent.rating, inherent_score: inherent.score,
      residual_rating: residual.rating, residual_score: residual.score,
      summary_level: residual.summary_level ?? inherent.summary_level,
    };
  }

  /** Re-rates every risk on a scale after the scale changes. Returns how many ratings changed. */
  async function rescore(scaleKey: string): Promise<number> {
    const scale = await get(scaleKey);
    if (!scale) return 0;
    const levels = await summaryLevels();
    let changed = 0;
    for (const r of await ctx.db.query<Row>('select * from risks where scale_key = $1', [scaleKey])) {
      const c = scoreRisk(scale, levels, r);
      if (Object.keys(c).every((k) => (r[k] ?? null) === c[k])) continue;
      await ctx.db.query(
        `update risks set inherent_rating = $2, inherent_score = $3, residual_rating = $4, residual_score = $5, summary_level = $6 where id = $1`,
        [r.id, c.inherent_rating, c.inherent_score, c.residual_rating, c.residual_score, c.summary_level],
      );
      changed += 1;
    }
    return changed;
  }

  /** Checks a full scale definition; throws a 400 with field messages. */
  async function validate(s: Row, isNew: boolean): Promise<void> {
    const f: Record<string, string> = {};
    const levelKeys = await summaryLevels();
    if (isNew && !/^[a-z][a-z0-9_]{1,39}$/.test(String(s.key ?? ''))) f.key = 'Use lower-case letters, numbers and underscores, starting with a letter.';
    if (!String(s.name ?? '').trim()) f.name = 'Name is required.';
    for (const name of ['likelihood_levels', 'impact_levels'] as const) {
      const list = s[name];
      if (!Array.isArray(list) || list.length < 2 || list.length > 10) { f[name] = 'Give between 2 and 10 levels.'; continue; }
      const values = new Set<number>();
      for (const l of list) {
        if (!Number.isInteger(l?.value) || !String(l?.label ?? '').trim()) f[name] = 'Each level needs a whole-number value and a label.';
        else if (values.has(l.value)) f[name] = 'Level values must be different.';
        values.add(l?.value);
      }
    }
    const ratingKeys = new Set<string>();
    if (!Array.isArray(s.ratings) || !s.ratings.length) f.ratings = 'Give at least one rating.';
    else {
      for (const r of s.ratings) {
        if (!/^[a-z][a-z0-9_]*$/.test(String(r?.key ?? '')) || !String(r?.label ?? '').trim()) f.ratings = 'Each rating needs a key and a label.';
        else if (ratingKeys.has(r.key)) f.ratings = 'Rating keys must be different.';
        else if (!COLOURS.includes(r.color)) f.ratings = `Rating colour must be one of: ${COLOURS.join(', ')}.`;
        else if (!levelKeys.includes(r.summary_level)) f.ratings = `Each rating must map to a summary level (${levelKeys.join(', ')}).`;
        else if (!Number.isFinite(Number(r.sort))) f.ratings = 'Each rating needs an order number.';
        ratingKeys.add(r?.key);
      }
    }
    if (!f.likelihood_levels && !f.impact_levels && !f.ratings) {
      const m = s.matrix;
      const ok = m && typeof m === 'object' && s.likelihood_levels.every((l: ScaleLevel) =>
        s.impact_levels.every((i: ScaleLevel) => ratingKeys.has(m[String(l.value)]?.[String(i.value)])));
      if (!ok) f.matrix = 'Every cell of the matrix needs one of the ratings.';
    }
    if (s.acceptance_threshold !== null && s.acceptance_threshold !== undefined && !ratingKeys.has(s.acceptance_threshold)) {
      f.acceptance_threshold = 'The approval threshold must be one of the ratings, or empty.';
    }
    if (Object.keys(f).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', f);
  }

  async function save(s: Row, isNew: boolean, userId: string | null): Promise<void> {
    await ctx.db.tx(async (tx) => {
      const params = [s.key, String(s.name).trim(), s.description ?? null, s.likelihood_label || 'Likelihood', s.impact_label || 'Impact',
        JSON.stringify(s.likelihood_levels), JSON.stringify(s.impact_levels), JSON.stringify(s.matrix), userId];
      if (isNew) {
        await tx.query(
          `insert into risk_scales (key, name, description, likelihood_label, impact_label, likelihood_levels, impact_levels, matrix, updated_by, sort)
           values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9, (select coalesce(max(sort), 0) + 10 from risk_scales))`, params);
      } else {
        await tx.query(
          `update risk_scales set name = $2, description = $3, likelihood_label = $4, impact_label = $5,
             likelihood_levels = $6::jsonb, impact_levels = $7::jsonb, matrix = $8::jsonb, updated_by = $9, updated_at = now() where key = $1`, params);
      }
      await tx.query('delete from risk_scale_ratings where scale_key = $1', [s.key]);
      for (const r of s.ratings as ScaleRating[]) {
        await tx.query(
          'insert into risk_scale_ratings (scale_key, rating_key, label, color, sort, summary_level) values ($1,$2,$3,$4,$5,$6)',
          [s.key, r.key, String(r.label).trim(), r.color, Number(r.sort), r.summary_level],
        );
      }
    });
  }

  return { seedDefaults, all, get, summaryLevels, score, scoreRisk, rescore, validate, save, thresholds };
}

export type Scales = ReturnType<typeof makeScales>;
