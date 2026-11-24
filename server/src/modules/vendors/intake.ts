// Vendor intake with risk tiers and required checks (E41-10).
//
// The organization writes its own intake questionnaire (each question has a few answers to choose
// from) and its own tier rules ("an answer of X to question Y puts the vendor in tier Z at least").
// Completing the questionnaire for a vendor sets its risk tier: the highest tier any rule gives, or the
// default tier when none applies. Each tier needs a set of checks (lookup `vendor_check`); a check is
// recorded as done (with an optional expiry) or waived with a reason, and a contract of the vendor
// cannot become active while a required check is neither (`checksBlock`, called from the contract's
// hooks in index.ts). Waiving needs `vendors.approve`. Everything is the organization's to change
// under Vendors > Intake questions (setting `vendors.intake`); the starter content is neutral.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { assertNotHeld } from '../../core/holds.ts';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';
import { notePermission } from '../../core/permission-use.ts';
import { localDate } from './dates.ts';

export const INTAKE_SETTING = 'vendors.intake';
export const INTAKE_BEFORE_CONTRACT_SETTING = 'vendors.intake_before_contract';

export interface IntakeOption { value: string; label: string }
export interface IntakeQuestion { key: string; text: string; help: string | null; options: IntakeOption[] }
export interface TierRule { question: string; answers: string[]; tier: string }
export interface IntakeConfig {
  questions: IntakeQuestion[];
  rules: TierRule[];
  default_tier: string;
  /** The checks each tier needs: { <tier>: [<check key>] }. */
  required_checks: Record<string, string[]>;
}
export interface TierReason { question: string; question_text: string; answer: string; answer_label: string; tier: string }

export const DEFAULT_TIERS: LookupValue[] = [
  { value: 'low', label: 'Low', color: 'green', sort: 10 },
  { value: 'moderate', label: 'Moderate', color: 'blue', sort: 20 },
  { value: 'high', label: 'High', color: 'amber', sort: 30 },
  { value: 'critical', label: 'Critical', color: 'red', sort: 40 },
];

export const DEFAULT_CHECKS: LookupValue[] = [
  { value: 'exclusion_list', label: 'Exclusion-list check', sort: 10 },
  { value: 'insurance', label: 'Insurance certificate received', sort: 20 },
  { value: 'security_assessment', label: 'Security assessment completed', sort: 30 },
  { value: 'data_agreement', label: 'Data protection terms agreed', sort: 40 },
  { value: 'financial_review', label: 'Financial standing reviewed', sort: 50 },
  { value: 'references', label: 'References taken', sort: 60 },
];

/** A neutral starter questionnaire. An installation rewrites it under Vendors > Intake questions. */
export const DEFAULT_INTAKE: IntakeConfig = {
  questions: [
    {
      key: 'data', text: 'Will the vendor hold or reach our data?', help: 'Think of files, databases, email and reports the vendor receives or can open.',
      options: [
        { value: 'none', label: 'No' },
        { value: 'internal', label: 'Internal business data only' },
        { value: 'personal', label: 'Personal data about riders or staff' },
        { value: 'payment', label: 'Payment card or bank data' },
      ],
    },
    {
      key: 'access', text: 'Will the vendor connect to our systems or networks?', help: null,
      options: [
        { value: 'none', label: 'No' },
        { value: 'on_site', label: 'Only on site, accompanied' },
        { value: 'remote', label: 'Yes, including remote access' },
      ],
    },
    {
      key: 'service', text: 'If this vendor failed, what would happen to service or to people?', help: 'Consider stations, dispatch, fares and rider information.',
      options: [
        { value: 'none', label: 'Nothing riders would notice' },
        { value: 'some', label: 'Some disruption, with a workaround' },
        { value: 'major', label: 'Service stops or people could be harmed' },
      ],
    },
    {
      key: 'spend', text: 'How large is the expected spend?', help: 'Compared with your own purchasing limits.',
      options: [
        { value: 'small', label: 'Within the small-purchase limit' },
        { value: 'large', label: 'Above the small-purchase limit' },
      ],
    },
  ],
  rules: [
    { question: 'service', answers: ['major'], tier: 'critical' },
    { question: 'data', answers: ['personal', 'payment'], tier: 'high' },
    { question: 'access', answers: ['remote'], tier: 'high' },
    { question: 'service', answers: ['some'], tier: 'moderate' },
    { question: 'data', answers: ['internal'], tier: 'moderate' },
    { question: 'access', answers: ['on_site'], tier: 'moderate' },
    { question: 'spend', answers: ['large'], tier: 'moderate' },
  ],
  default_tier: 'low',
  required_checks: {
    low: ['exclusion_list'],
    moderate: ['exclusion_list', 'insurance'],
    high: ['exclusion_list', 'insurance', 'security_assessment', 'data_agreement'],
    critical: ['exclusion_list', 'insurance', 'security_assessment', 'data_agreement', 'financial_review', 'references'],
  },
};

/** The lists and the starter questionnaire. Called from the module's `seedDefaults` (idempotent). */
export async function ensureIntake(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('vendor_risk_tier', DEFAULT_TIERS, { module: 'vendors' });
  await ctx.lookups.ensure('vendor_check', DEFAULT_CHECKS, { module: 'vendors' });
  if ((await ctx.settings.get<unknown>(INTAKE_SETTING, null)) === null) await ctx.settings.set(INTAKE_SETTING, DEFAULT_INTAKE);
}

export async function intakeConfig(ctx: ModuleContext): Promise<IntakeConfig> {
  const raw = await ctx.settings.get<IntakeConfig | null>(INTAKE_SETTING, null);
  return raw && Array.isArray(raw.questions) ? raw : DEFAULT_INTAKE;
}

const clean = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** Validates a questionnaire and its rules typed on the settings page. Returns the cleaned config or a field message. */
export function parseIntakeConfig(input: unknown, tiers: string[], checks: string[]): { config: IntakeConfig } | { field: string; error: string } {
  const b = (input ?? {}) as Row;
  if (!Array.isArray(b.questions) || !b.questions.length) return { field: 'questions', error: 'Add at least one question.' };
  if (b.questions.length > 40) return { field: 'questions', error: 'Use at most 40 questions.' };
  const questions: IntakeQuestion[] = [];
  const keys = new Set<string>();
  for (const [i, raw] of (b.questions as Row[]).entries()) {
    const text = clean(raw?.text, 500);
    if (!text) return { field: 'questions', error: `Question ${i + 1} has no text.` };
    let key = typeof raw.key === 'string' && /^[a-z0-9_]{1,40}$/.test(raw.key) ? raw.key : slug(text) || `q${i + 1}`;
    for (let n = 2; keys.has(key); n += 1) key = `${key.slice(0, 36)}_${n}`;
    keys.add(key);
    if (!Array.isArray(raw.options) || raw.options.length < 2) return { field: 'questions', error: `Question ${i + 1} needs at least two answers to choose from.` };
    if (raw.options.length > 12) return { field: 'questions', error: `Question ${i + 1}: use at most 12 answers.` };
    const options: IntakeOption[] = [];
    const values = new Set<string>();
    for (const [j, o] of (raw.options as Row[]).entries()) {
      const label = clean(o?.label, 200);
      if (!label) return { field: 'questions', error: `Question ${i + 1}, answer ${j + 1} has no text.` };
      let value = typeof o.value === 'string' && /^[a-z0-9_]{1,40}$/.test(o.value) ? o.value : slug(label) || `a${j + 1}`;
      for (let n = 2; values.has(value); n += 1) value = `${value.slice(0, 36)}_${n}`;
      values.add(value);
      options.push({ value, label });
    }
    questions.push({ key, text, help: clean(raw.help, 500), options });
  }
  const rules: TierRule[] = [];
  if (b.rules !== undefined && !Array.isArray(b.rules)) return { field: 'rules', error: 'Send the rules as a list.' };
  for (const [i, r] of ((b.rules ?? []) as Row[]).entries()) {
    const q = questions.find((x) => x.key === r?.question);
    if (!q) return { field: 'rules', error: `Rule ${i + 1}: choose one of the questions.` };
    const answers = Array.isArray(r.answers) ? [...new Set((r.answers as unknown[]).map(String))] : [];
    if (!answers.length || answers.some((a) => !q.options.some((o) => o.value === a))) {
      return { field: 'rules', error: `Rule ${i + 1}: choose one or more answers of "${q.text}".` };
    }
    if (!tiers.includes(r.tier)) return { field: 'rules', error: `Rule ${i + 1}: choose a risk tier.` };
    rules.push({ question: q.key, answers, tier: r.tier });
  }
  if (rules.length > 100) return { field: 'rules', error: 'Use at most 100 rules.' };
  if (!tiers.includes(b.default_tier)) return { field: 'default_tier', error: 'Choose the tier a vendor gets when no rule applies.' };
  const required: Record<string, string[]> = {};
  const given = (b.required_checks ?? {}) as Row;
  if (typeof given !== 'object' || Array.isArray(given)) return { field: 'required_checks', error: 'Send the checks of each tier.' };
  for (const [tier, list] of Object.entries(given)) {
    if (!tiers.includes(tier)) return { field: 'required_checks', error: `Unknown risk tier "${tier}".` };
    if (!Array.isArray(list) || list.some((c) => !checks.includes(String(c)))) return { field: 'required_checks', error: 'Choose checks from the list of checks.' };
    required[tier] = [...new Set((list as unknown[]).map(String))];
  }
  return { config: { questions, rules, default_tier: b.default_tier, required_checks: required } };
}

/**
 * The tier the answers give: the highest tier of any rule that matches, never lower than the default.
 * Reasons are the matching rules, highest tier first. Tiers are ranked by their order in the list.
 */
export function tierFor(config: IntakeConfig, answers: Record<string, string>, tierOrder: string[]): { tier: string; reasons: TierReason[] } {
  const rank = (t: string) => tierOrder.indexOf(t);
  const reasons: TierReason[] = [];
  for (const r of config.rules) {
    const a = answers[r.question];
    if (!a || !r.answers.includes(a) || rank(r.tier) < 0) continue;
    const q = config.questions.find((x) => x.key === r.question);
    if (!q) continue;
    reasons.push({ question: q.key, question_text: q.text, answer: a, answer_label: q.options.find((o) => o.value === a)?.label ?? a, tier: r.tier });
  }
  reasons.sort((x, y) => rank(y.tier) - rank(x.tier));
  let tier = config.default_tier;
  if (reasons[0] && rank(reasons[0].tier) > rank(tier)) tier = reasons[0].tier;
  return { tier, reasons };
}

export type CheckState = 'done' | 'waived' | 'expired' | 'missing';

/** A vendor's required checks and their state today. */
export async function requiredChecks(ctx: ModuleContext, vendorId: string, today: string = localDate()) {
  const vendor = await ctx.db.one<Row>('select risk_tier from vendors where id = $1', [vendorId]);
  const tier = vendor?.risk_tier ?? null;
  const config = await intakeConfig(ctx);
  const checks = await ctx.lookups.values('vendor_check');
  const keys = tier ? (config.required_checks[tier] ?? []) : [];
  const rows = await ctx.db.query<Row>(
    `select c.*, c.done_on::text as done_on, c.expires_on::text as expires_on, u.display_name as recorded_by_name
     from vendor_checks c left join users u on u.id = c.recorded_by
     where c.vendor_id = $1 and c.deleted_at is null order by c.done_on desc, c.created_at desc`, [vendorId]);
  const latest = new Map<string, Row>();
  for (const r of rows) if (!latest.has(r.check_key)) latest.set(r.check_key, r);
  const stateOf = (r: Row | undefined): CheckState => {
    if (!r) return 'missing';
    if (r.expires_on && r.expires_on < today) return 'expired';
    return r.outcome === 'waived' ? 'waived' : 'done';
  };
  const required = keys.map((key) => {
    const r = latest.get(key);
    return { key, label: checks.find((c) => c.value === key)?.label ?? key, state: stateOf(r), latest: r ? checkView(r) : null };
  });
  return { tier, required, history: rows.map(checkView), outstanding: required.filter((r) => r.state === 'missing' || r.state === 'expired') };
}

export const checkView = (r: Row) => ({
  id: r.id, check_key: r.check_key, outcome: r.outcome, done_on: r.done_on, expires_on: r.expires_on ?? null,
  reference: r.reference ?? null, note: r.note ?? null, recorded_by_name: r.recorded_by_name ?? null, created_at: r.created_at,
});

/**
 * Why a contract of this vendor may not become active yet (null when it may): a required check of its
 * tier is neither done nor waived, or, while `vendors.intake_before_contract` is on, it has no tier.
 */
export async function checksBlock(ctx: ModuleContext, vendorId: string): Promise<string | null> {
  const { tier, outstanding } = await requiredChecks(ctx, vendorId);
  if (!tier) {
    return (await ctx.settings.get<boolean>(INTAKE_BEFORE_CONTRACT_SETTING, false)) === true
      ? 'Complete the vendor\'s intake questionnaire before the contract becomes active.'
      : null;
  }
  if (!outstanding.length) return null;
  const label = (await ctx.lookups.values('vendor_risk_tier')).find((t) => t.value === tier)?.label ?? tier;
  return `The vendor's ${label} risk tier needs these checks done or waived before the contract becomes active: ${outstanding.map((o) => o.label).join(', ')}.`;
}

/** Figure: vendors with a tier whose required checks are not all done or waived (every vendor counts). */
export async function vendorsWithChecksOutstanding(ctx: ModuleContext): Promise<number> {
  const config = await intakeConfig(ctx);
  const today = localDate();
  const vendors = await ctx.db.query<Row>(`select id, risk_tier from vendors where deleted_at is null and risk_tier is not null and coalesce(status, '') <> 'former'`);
  const latest = await ctx.db.query<Row>(
    `select distinct on (vendor_id, check_key) vendor_id, check_key, expires_on::text as expires_on
     from vendor_checks where deleted_at is null order by vendor_id, check_key, done_on desc, created_at desc`);
  const current = new Set(latest.filter((c) => !c.expires_on || c.expires_on >= today).map((c) => `${c.vendor_id}:${c.check_key}`));
  return vendors.filter((v) => (config.required_checks[v.risk_tier] ?? []).some((k) => !current.has(`${v.id}:${k}`))).length;
}

async function notify(ctx: ModuleContext, input: Row): Promise<void> {
  if (!ctx.app.hasDecorator('notify')) return;
  await (ctx.app as unknown as { notify: (i: Row) => Promise<unknown> }).notify(input);
}

export function registerIntake(ctx: ModuleContext): void {
  const { app, db } = ctx;
  // Waiving a required check is checked with ctx.can inside the routes below.
  notePermission('vendors.approve');

  async function needVendor(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id ?? '');
    if (!UUID_RE.test(id)) ctx.fail(404, 'not_found', 'Vendor not found.');
    return (await ctx.resources.find('vendor', id, req.user)) ?? ctx.fail(404, 'not_found', 'Vendor not found.');
  }
  const tierOrder = async () => (await ctx.lookups.values('vendor_risk_tier')).map((t) => t.value);
  const lookupOf = (list: LookupValue[], value: string | null) => {
    const v = list.find((x) => x.value === value);
    return { label: v?.label ?? value, color: v?.color ?? 'gray' };
  };

  // ---------- settings: the questionnaire, the tier rules and the checks of each tier ----------

  async function settingsView(req: FastifyRequest) {
    return {
      config: await intakeConfig(ctx),
      tiers: await ctx.lookups.values('vendor_risk_tier'),
      checks: await ctx.lookups.values('vendor_check'),
      intake_before_contract: (await ctx.settings.get<boolean>(INTAKE_BEFORE_CONTRACT_SETTING, false)) === true,
      can_edit: ctx.can(req.user, 'vendors.administer'),
    };
  }

  app.get('/api/vendors/intake-settings', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => settingsView(req));
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/intake-settings', tag: 'Vendors', permission: 'vendors.view',
    summary: 'The vendor intake questionnaire, the rules that set a risk tier from its answers and the checks each tier needs',
    response: '{ config: { questions: [{ key, text, help, options: [{ value, label }] }], rules: [{ question, answers, tier }], default_tier, required_checks: { <tier>: [<check>] } }, tiers, checks, intake_before_contract, can_edit }',
  });

  app.put('/api/vendors/intake-settings', { preHandler: ctx.requirePerm('vendors.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    if (b.config !== undefined) {
      const parsed = parseIntakeConfig(b.config, await tierOrder(), (await ctx.lookups.values('vendor_check')).map((c) => c.value));
      if ('error' in parsed) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [parsed.field]: parsed.error });
      // settings.set writes the audit event, with the old and new questionnaire.
      if (JSON.stringify(parsed.config) !== JSON.stringify(await intakeConfig(ctx))) await ctx.settings.set(INTAKE_SETTING, parsed.config, req);
    }
    if (b.intake_before_contract !== undefined) {
      if (typeof b.intake_before_contract !== 'boolean') ctx.fail(400, 'validation', 'Check the highlighted fields.', { intake_before_contract: 'Send true or false.' });
      if (b.intake_before_contract !== ((await ctx.settings.get<boolean>(INTAKE_BEFORE_CONTRACT_SETTING, false)) === true)) {
        await ctx.settings.set(INTAKE_BEFORE_CONTRACT_SETTING, b.intake_before_contract, req);
      }
    }
    return settingsView(req);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/vendors/intake-settings', tag: 'Vendors', permission: 'vendors.administer',
    summary: 'Change the intake questionnaire, its tier rules and the checks each tier needs, and whether a contract needs a completed intake before it becomes active',
    description: 'Intakes already completed keep the questions they were answered against and the tier they gave; a new tier comes only from a new intake. The tiers and the checks themselves are the lookup lists vendor_risk_tier (ranked by their order) and vendor_check.',
    body: '{ config?: { questions, rules, default_tier, required_checks }, intake_before_contract?: boolean }',
    response: 'as GET',
  });

  // What tier these answers would give, while the questionnaire is being filled in.
  app.post('/api/vendors/intake/preview', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
    const answers = ((req.body ?? {}) as Row).answers;
    const clean: Record<string, string> = {};
    if (answers && typeof answers === 'object' && !Array.isArray(answers)) for (const [k, v] of Object.entries(answers as Row)) if (typeof v === 'string') clean[k] = v;
    const tiers = await ctx.lookups.values('vendor_risk_tier');
    const config = await intakeConfig(ctx);
    const result = tierFor(config, clean, tiers.map((t) => t.value));
    const checks = await ctx.lookups.values('vendor_check');
    return {
      ...result, tier_label: lookupOf(tiers, result.tier).label, tier_color: lookupOf(tiers, result.tier).color,
      required_checks: (config.required_checks[result.tier] ?? []).map((k) => ({ key: k, label: lookupOf(checks, k).label })),
    };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendors/intake/preview', tag: 'Vendors', permission: 'vendors.view',
    summary: 'The risk tier and required checks that a set of intake answers would give (nothing is saved)',
    body: '{ answers: { <question key>: <answer value> } }',
    response: '{ tier, tier_label, tier_color, reasons: [{ question, question_text, answer, answer_label, tier }], required_checks: [{ key, label }] }',
  });

  // ---------- a vendor's intake ----------

  const intakeView = (r: Row, tiers: LookupValue[]) => ({
    id: r.id, completed_on: r.completed_on, completed_by_name: r.completed_by_name ?? null, tier: r.tier,
    tier_label: lookupOf(tiers, r.tier).label, tier_color: lookupOf(tiers, r.tier).color,
    questions: r.questions, answers: r.answers, reasons: r.reasons, notes: r.notes ?? null,
  });

  app.get('/api/vendors/:id/intake', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
    const vendor = await needVendor(req);
    const tiers = await ctx.lookups.values('vendor_risk_tier');
    const rows = await db.query<Row>(
      `select i.*, i.completed_on::text as completed_on, u.display_name as completed_by_name
       from vendor_intakes i left join users u on u.id = i.completed_by
       where i.vendor_id = $1 and i.deleted_at is null order by i.completed_on desc, i.created_at desc`, [vendor.id]);
    const config = await intakeConfig(ctx);
    return {
      tier: vendor.risk_tier ?? null, tier_on: vendor.risk_tier_on ?? null,
      tier_label: vendor.risk_tier ? lookupOf(tiers, vendor.risk_tier).label : null,
      tier_color: vendor.risk_tier ? lookupOf(tiers, vendor.risk_tier).color : null,
      latest: rows[0] ? intakeView(rows[0], tiers) : null,
      history: rows.map((r) => ({ id: r.id, completed_on: r.completed_on, completed_by_name: r.completed_by_name ?? null, tier: r.tier, tier_label: lookupOf(tiers, r.tier).label, tier_color: lookupOf(tiers, r.tier).color })),
      questions: config.questions,
      can_complete: ctx.can(req.user, 'vendors.edit'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/:id/intake', tag: 'Vendors', permission: 'vendors.view',
    summary: 'A vendor\'s risk tier, its latest intake questionnaire with the reasons for the tier, earlier intakes, and the questions in use',
    response: '{ tier, tier_on, tier_label, tier_color, latest: { id, completed_on, completed_by_name, tier, tier_label, questions, answers, reasons, notes } | null, history: [...], questions, can_complete }',
  });

  app.post('/api/vendors/:id/intake', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const vendor = await needVendor(req);
    const b = (req.body ?? {}) as Row;
    const config = await intakeConfig(ctx);
    const given = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : {}) as Row;
    const answers: Record<string, string> = {};
    const missing: string[] = [];
    for (const q of config.questions) {
      const a = given[q.key];
      if (typeof a === 'string' && q.options.some((o) => o.value === a)) answers[q.key] = a;
      else missing.push(q.text);
    }
    if (missing.length) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { answers: `Answer every question. Not answered: ${missing.join('; ')}` });
    }
    const notes = clean(b.notes, 4000);
    const tiers = await ctx.lookups.values('vendor_risk_tier');
    const { tier, reasons } = tierFor(config, answers, tiers.map((t) => t.value));
    const today = localDate();
    const row = (await db.one<Row>(
      `insert into vendor_intakes (vendor_id, questions, answers, tier, reasons, notes, completed_on, completed_by, created_by, updated_by)
       values ($1,$2::jsonb,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$8,$8) returning *, completed_on::text as completed_on`,
      [vendor.id, JSON.stringify(config.questions), JSON.stringify(answers), tier, JSON.stringify(reasons), notes, today, req.user!.id],
    ))!;
    // System work: the tier is read-only to people. The change is audited on the vendor.
    if (vendor.risk_tier !== tier || vendor.risk_tier_on !== today) await ctx.resources.update('vendor', vendor.id, { risk_tier: tier, risk_tier_on: today });
    const tierLabel = lookupOf(tiers, tier).label;
    await ctx.audit(req, {
      action: 'vendor.intake', recordType: 'vendor', recordId: vendor.id,
      summary: `Intake questionnaire completed for ${vendor.name}: ${tierLabel} risk tier`,
      before: { risk_tier: vendor.risk_tier ?? null }, after: { intake_id: row.id, risk_tier: tier, answers, reasons: reasons.map((r) => `${r.question_text}: ${r.answer_label}`) },
    });
    const { outstanding } = await requiredChecks(ctx, vendor.id, today);
    if (outstanding.length && vendor.owner_id && vendor.owner_id !== req.user!.id) {
      await notify(ctx, {
        userIds: [vendor.owner_id], kind: 'general', recordType: 'vendor', recordId: vendor.id,
        title: `${vendor.name}: ${tierLabel} risk tier, ${outstanding.length} check${outstanding.length === 1 ? '' : 's'} to do`,
        body: `Needed before a contract becomes active: ${outstanding.map((o) => o.label).join(', ')}.`, route: `/vendors/${vendor.id}?tab=intake`,
      });
    }
    reply.code(201);
    return intakeView({ ...row, completed_by_name: req.user!.displayName }, tiers);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendors/:id/intake', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Complete the intake questionnaire for a vendor, which sets its risk tier by the organization\'s rules',
    description: 'Every question in use must be answered with one of its answers. The vendor\'s risk tier becomes the highest tier any rule gives (or the default tier) and its required checks follow from the tier. The vendor\'s owner is told when checks are outstanding.',
    body: '{ answers: { <question key>: <answer value> }, notes?: string }',
    response: 'the intake: { id, completed_on, tier, tier_label, reasons, answers, questions, notes }',
  });

  // ---------- required checks ----------

  app.get('/api/vendors/:id/checks', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
    const vendor = await needVendor(req);
    const checks = await ctx.lookups.values('vendor_check');
    const status = await requiredChecks(ctx, vendor.id);
    return {
      tier: status.tier,
      required: status.required,
      outstanding: status.outstanding.length,
      history: status.history.map((h) => ({ ...h, check_label: lookupOf(checks, h.check_key).label })),
      checks: checks.map((c) => ({ value: c.value, label: c.label })),
      intake_before_contract: (await ctx.settings.get<boolean>(INTAKE_BEFORE_CONTRACT_SETTING, false)) === true,
      can_record: ctx.can(req.user, 'vendors.edit'),
      can_waive: ctx.can(req.user, 'vendors.edit') && ctx.can(req.user, 'vendors.approve'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendors/:id/checks', tag: 'Vendors', permission: 'vendors.view',
    summary: 'The checks a vendor\'s risk tier needs, each done, waived, expired or missing, and every check recorded',
    response: '{ tier, required: [{ key, label, state: "done" | "waived" | "expired" | "missing", latest }], outstanding, history: [{ id, check_key, check_label, outcome, done_on, expires_on, reference, note, recorded_by_name }], checks, intake_before_contract, can_record, can_waive }',
  });

  app.post('/api/vendors/:id/checks', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const vendor = await needVendor(req);
    const b = (req.body ?? {}) as Row;
    const checks = await ctx.lookups.values('vendor_check');
    const fields: Record<string, string> = {};
    if (!checks.some((c) => c.value === b.check_key)) fields.check_key = 'Choose a check.';
    const outcome = b.outcome === 'waived' ? 'waived' : b.outcome === 'done' || b.outcome === undefined ? 'done' : null;
    if (!outcome) fields.outcome = 'Choose done or waived.';
    if (outcome === 'waived' && !ctx.can(req.user, 'vendors.approve')) ctx.fail(403, 'forbidden', 'Waiving a required check needs permission to approve for vendors.');
    const today = localDate();
    const doneOn = b.done_on ? String(b.done_on) : today;
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
    if (!isDate(doneOn)) fields.done_on = 'Enter a date.';
    else if (doneOn > today) fields.done_on = 'The date cannot be in the future.';
    const expiresOn = b.expires_on ? String(b.expires_on) : null;
    if (expiresOn && !isDate(expiresOn)) fields.expires_on = 'Enter a date.';
    else if (expiresOn && isDate(doneOn) && expiresOn < doneOn) fields.expires_on = 'The expiry cannot be before the date.';
    const reference = clean(b.reference, 200);
    const note = clean(b.note, 2000);
    if (outcome === 'waived' && !note) fields.note = 'Give the reason for the waiver.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const row = (await db.one<Row>(
      `insert into vendor_checks (vendor_id, check_key, outcome, done_on, expires_on, reference, note, recorded_by, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8) returning *, done_on::text as done_on, expires_on::text as expires_on`,
      [vendor.id, b.check_key, outcome, doneOn, expiresOn, reference, note, req.user!.id],
    ))!;
    const label = lookupOf(checks, b.check_key).label;
    await ctx.audit(req, {
      action: outcome === 'waived' ? 'vendor.check_waived' : 'vendor.check_done', recordType: 'vendor', recordId: vendor.id,
      summary: outcome === 'waived' ? `Check waived for ${vendor.name}: ${label} (${note})` : `Check done for ${vendor.name}: ${label} (${doneOn})`,
      after: { check_id: row.id, check_key: b.check_key, outcome, done_on: doneOn, expires_on: expiresOn, reference, note },
    });
    reply.code(201);
    return { ...checkView({ ...row, recorded_by_name: req.user!.displayName }), check_label: label };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendors/:id/checks', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Record a check of a vendor as done, or waive it with a reason',
    description: 'Waiving (outcome "waived") also needs vendors.approve and a reason in note. A check with an expiry is needed again after that date. The latest record of each check counts.',
    body: '{ check_key: string (lookup vendor_check), outcome?: "done" | "waived", done_on?: date (default today), expires_on?: date, reference?: string, note?: string }',
    response: 'the check',
  });

  app.delete('/api/vendors/:id/checks/:checkId', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
    const vendor = await needVendor(req);
    const checkId = String((req.params as Row).checkId ?? '');
    const row = UUID_RE.test(checkId)
      ? await db.one<Row>('select *, done_on::text as done_on, expires_on::text as expires_on from vendor_checks where id = $1 and vendor_id = $2 and deleted_at is null', [checkId, vendor.id])
      : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Check not found.');
    if (row.outcome === 'waived' && !ctx.can(req.user, 'vendors.approve')) ctx.fail(403, 'forbidden', 'Removing a waiver needs permission to approve for vendors.');
    await assertNotHeld(db, 'vendor', vendor.id, 'delete');
    await db.query('update vendor_checks set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [row.id, req.user!.id]);
    const label = lookupOf(await ctx.lookups.values('vendor_check'), row.check_key).label;
    await ctx.audit(req, {
      action: 'vendor.check_removed', recordType: 'vendor', recordId: vendor.id,
      summary: `Check record removed from ${vendor.name}: ${label} (${row.outcome}, ${row.done_on})`, before: checkView(row),
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/vendors/:id/checks/:checkId', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Remove a check recorded in error (a waiver needs vendors.approve; refused while the vendor is under a legal hold)',
    response: '{ ok: true }',
  });
}
