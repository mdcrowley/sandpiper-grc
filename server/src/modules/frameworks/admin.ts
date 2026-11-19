// Settings of the frameworks module on a screen (E07-23), and refreshing the shipped NIST CSF 2.0
// wording on an installation that loaded it earlier (E18-03).
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { refreshText } from './importer.ts';
import { loadCsf2 } from './reference.ts';
import { DEFAULT_LEAD_DAYS, LEAD_SETTING } from './reminders.ts';

const TARGET_SETTING = 'frameworks.target_status';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FrameworkSettings {
  target_status: string;
  review_reminder_days: number;
  statuses: { value: string; label: string; color: string; weight: number }[];
}

async function readSettings(ctx: ModuleContext): Promise<FrameworkSettings> {
  const statuses = (await ctx.lookups.values('outcome_status')).map((v) => ({
    value: v.value, label: v.label, color: v.color ?? 'gray', weight: Math.min(1, Math.max(0, Number(v.meta?.weight) || 0)),
  }));
  const wanted = await ctx.settings.get<string>(TARGET_SETTING, 'largely_met');
  const lead = Math.min(90, Math.max(0, Math.round(Number(await ctx.settings.get<number>(LEAD_SETTING, DEFAULT_LEAD_DAYS)) || 0)));
  return {
    target_status: statuses.some((s) => s.value === wanted) ? wanted : statuses[statuses.length - 1]?.value ?? wanted,
    review_reminder_days: lead,
    statuses,
  };
}

export function registerAdmin(ctx: ModuleContext) {
  const { db } = ctx;
  const view = { preHandler: ctx.requirePerm('frameworks.view') };
  const edit = { preHandler: ctx.requirePerm('frameworks.edit') };
  const administer = { preHandler: ctx.requirePerm('frameworks.administer') };
  const param = (req: FastifyRequest, name = 'id') => String((req.params as Row)[name] ?? '');

  // ---------- settings: target status, status weights, reminder lead time ----------

  ctx.app.get('/api/frameworks/settings', view, async (req) => ({
    ...(await readSettings(ctx)), can_administer: ctx.can(req.user, 'frameworks.administer'),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/frameworks/settings', tag: 'Frameworks', permission: 'frameworks.view',
    summary: 'The target status, the weight of each status and the review reminder lead time',
  });

  ctx.app.put('/api/frameworks/settings', administer, async (req) => {
    const b = (req.body ?? {}) as Row;
    const current = await readSettings(ctx);
    const errors: Record<string, string> = {};
    const weights = new Map(current.statuses.map((s) => [s.value, s.weight]));
    if (b.weights !== undefined) {
      if (!b.weights || typeof b.weights !== 'object' || Array.isArray(b.weights)) errors.weights = 'Send the weights as { status: number }.';
      else {
        for (const [status, raw] of Object.entries(b.weights as Row)) {
          const w = Number(raw);
          if (!weights.has(status)) errors[`weights.${status}`] = `There is no status "${status}".`;
          else if (raw === null || raw === '' || !Number.isFinite(w) || w < 0 || w > 1) errors[`weights.${status}`] = 'A weight is a number from 0 to 1 (0% to 100%).';
          else weights.set(status, Math.round(w * 100) / 100);
        }
      }
    }
    const target = b.target_status === undefined ? current.target_status : String(b.target_status);
    if (!weights.has(target)) errors.target_status = 'Choose one of the statuses.';
    else if ((weights.get(target) ?? 0) <= 0) errors.target_status = 'The target status needs a weight above 0%, or no outcome can reach it.';
    let lead = current.review_reminder_days;
    if (b.review_reminder_days !== undefined) {
      const n = Number(b.review_reminder_days);
      if (b.review_reminder_days === null || b.review_reminder_days === '' || !Number.isInteger(n) || n < 0 || n > 90) {
        errors.review_reminder_days = 'Enter a whole number of days from 0 to 90.';
      } else lead = n;
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    const changedWeights = current.statuses.filter((s) => weights.get(s.value) !== s.weight);
    if (changedWeights.length) {
      for (const s of changedWeights) {
        await db.query(
          `update lookups set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{weight}', to_jsonb($2::numeric))
           where list_key = 'outcome_status' and value = $1`, [s.value, weights.get(s.value)]);
      }
      await ctx.audit(req, {
        action: 'frameworks.weights_change', recordType: 'setting', recordId: 'outcome_status.weight',
        summary: `Outcome status weights changed: ${changedWeights.map((s) => `${s.label} ${Math.round(s.weight * 100)}% to ${Math.round(weights.get(s.value)! * 100)}%`).join(', ')}`,
        before: Object.fromEntries(changedWeights.map((s) => [s.value, s.weight])),
        after: Object.fromEntries(changedWeights.map((s) => [s.value, weights.get(s.value)])),
      });
    }
    // settings.set writes its own audit event.
    if (target !== await ctx.settings.get<string>(TARGET_SETTING, 'largely_met')) await ctx.settings.set(TARGET_SETTING, target, req);
    if (lead !== current.review_reminder_days) await ctx.settings.set(LEAD_SETTING, lead, req);
    return { ...(await readSettings(ctx)), can_administer: true };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/frameworks/settings', tag: 'Frameworks', permission: 'frameworks.administer',
    summary: 'Change the target status, status weights or review reminder lead time (audited)',
    body: {
      type: 'object',
      properties: {
        target_status: { type: 'string', description: 'A value of the outcome_status list, with a weight above 0' },
        weights: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 }, description: '{ status: weight from 0 to 1 }' },
        review_reminder_days: { type: 'integer', minimum: 0, maximum: 90 },
      },
    },
  });

  // ---------- refreshing the shipped wording ----------

  ctx.app.post('/api/frameworks/:id/refresh-text', edit, async (req) => {
    const id = param(req);
    const fw = UUID.test(id) ? await db.one<Row>('select id, key, name from frameworks where id = $1 and deleted_at is null', [id]) : undefined;
    if (!fw) ctx.fail(404, 'not_found', 'Framework not found.');
    const ref = loadCsf2();
    if (String(fw!.key).toLowerCase() !== ref.key) {
      ctx.fail(409, 'no_reference', 'The application ships wording for NIST CSF 2.0 only. Load a corrected reference file for this framework instead.');
    }
    const b = (req.body ?? {}) as Row;
    return refreshText(ctx, fw!, ref, req, b.dryRun === true || b.dry_run === true);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/frameworks/:id/refresh-text', tag: 'Frameworks', permission: 'frameworks.edit',
    summary: 'Bring NIST CSF 2.0 outcome, function and category wording in line with the text shipped with the application',
    description: 'Changes wording only: nothing is added or removed, and statuses, owners, targets, evidence and mappings are untouched. `{ "dryRun": true }` lists the differences without changing anything.',
    body: { type: 'object', properties: { dryRun: { type: 'boolean' } } },
  });
}
