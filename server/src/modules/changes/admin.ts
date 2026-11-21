import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { SETTING_QUESTIONNAIRE, SETTING_RULES, type Base, type Req } from './base.ts';
import { approvalEngine } from '../../core/approval-kinds.ts';
import { KIND, type ChangeApproval } from './approval.ts';
import { ANY, type ApprovalRule, type Questionnaire, type RiskQuestion } from './rules.ts';

const KEY = /^[a-z_][a-z0-9_]*$/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const CLEAN = ['id', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at'];
const content = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== null && !CLEAN.includes(k)));

/** Data an administrator maintains: templates, blackout periods, the questionnaire and approval rules. */
export function makeAdmin(ctx: ModuleContext, base: Base, approval: ChangeApproval) {
  const { db } = ctx;

  async function needRow(table: string, label: string, id: string): Promise<Row> {
    const row = UUID_RE.test(id) ? await db.one<Row>(`select * from ${table} where id = $1 and deleted_at is null`, [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', `${label} not found.`);
  }

  async function removeRow(req: Req, table: string, label: string, action: string, recordType: string, id: string, name: (r: Row) => string) {
    const row = await needRow(table, label, id);
    await db.query(`update ${table} set deleted_at = now(), updated_by = $2 where id = $1`, [row.id, req?.user?.id ?? null]);
    await ctx.audit(req, { action, recordType, recordId: row.id, summary: `${label} deleted: ${name(row)}`, before: content(row) });
    return { ok: true };
  }

  // ---------- standard change templates ----------

  async function templateInput(body: Row, partial: boolean): Promise<Row> {
    const risks = (await ctx.lookups.values('change_risk')).map((v) => v.value);
    const c = base.checker(body, partial);
    c.text('name', 'Name', true);
    c.text('summary', 'When to use it');
    c.text('title', 'Change title', true);
    c.text('description', 'What will be done');
    c.text('reason', 'Why it is needed');
    c.text('implementation_plan', 'Implementation plan', true);
    c.text('test_plan', 'Test plan');
    c.text('backout_plan', 'Back-out plan', true);
    c.oneOf('risk_level', 'Risk', risks);
    c.int('duration_minutes', 'Usual duration in minutes', 5, 7 * 24 * 60);
    c.uuid('system_id', 'Main system');
    c.bool('active', 'Active');
    const data = c.finish();
    if (data.risk_level === null) data.risk_level = 'low';
    if (data.duration_minutes === null) data.duration_minutes = 60;
    if (data.active === null) data.active = true;
    return data;
  }

  /** Templates with how often each has been used, so over-use can be spotted. */
  async function listTemplates(includeInactive: boolean): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select t.*, coalesce(u.uses, 0)::int as uses, coalesce(u.uses_90_days, 0)::int as uses_90_days, u.last_used_at
       from change_templates t
       left join (
         select template_id, count(*) as uses, count(*) filter (where created_at > now() - interval '90 days') as uses_90_days,
                max(created_at) as last_used_at
         from changes where template_id is not null and deleted_at is null group by template_id
       ) u on u.template_id = t.id
       where t.deleted_at is null ${includeInactive ? '' : 'and t.active'}
       order by t.name`);
    const names = await base.systemNames(rows.map((r) => r.system_id).filter(Boolean));
    return rows.map((r) => ({ ...r, system_label: r.system_id ? names.get(r.system_id) ?? null : null }));
  }

  async function addTemplate(req: Req, body: Row): Promise<Row> {
    const data = await templateInput(body, false);
    const row = await base.insertRow('change_templates', { ...data, created_by: req?.user?.id ?? null, updated_by: req?.user?.id ?? null });
    await ctx.audit(req, {
      action: 'change.template_create', recordType: 'change_template', recordId: row.id,
      summary: `Standard change template created: ${row.name}`, after: data,
    });
    return row;
  }

  async function updateTemplate(req: Req, id: string, body: Row): Promise<Row> {
    const existing = await needRow('change_templates', 'Template', id);
    const d = base.diff(existing, await templateInput(body, true));
    if (!d.changed) return existing;
    const row = await base.updateRow('change_templates', existing.id, d.after, req);
    await ctx.audit(req, {
      action: 'change.template_update', recordType: 'change_template', recordId: row.id,
      summary: `Standard change template updated: ${row.name}`, before: d.before, after: d.after,
    });
    return row;
  }

  const removeTemplate = (req: Req, id: string) =>
    removeRow(req, 'change_templates', 'Template', 'change.template_delete', 'change_template', id, (r) => r.name);

  /** A standard change: filled in from the template and approved already. */
  async function createFromTemplate(req: Req, templateId: string, body: Row): Promise<Row> {
    const tpl = await needRow('change_templates', 'Template', templateId);
    if (!tpl.active) ctx.fail(409, 'template_inactive', 'This template is no longer in use.');
    const c = base.checker(body, false);
    c.datetime('planned_start', 'Planned start', true);
    c.datetime('planned_end', 'Planned end');
    c.text('title', 'Title');
    c.text('description', 'What will be done');
    c.uuid('system_id', 'Main system');
    c.uuid('asset_id', 'Main asset');
    c.uuid('assignee_id', 'Implementer');
    c.uuid('owner_id', 'Owner');
    const d = c.finish();
    const start = new Date(d.planned_start);
    const data: Row = {
      title: d.title ?? tpl.title, description: d.description ?? tpl.description, reason: tpl.reason,
      implementation_plan: tpl.implementation_plan, test_plan: tpl.test_plan, backout_plan: tpl.backout_plan,
      change_type: 'standard', system_id: d.system_id ?? tpl.system_id,
      asset_id: d.asset_id, assignee_id: d.assignee_id, owner_id: d.owner_id,
      planned_start: start.toISOString(),
      planned_end: d.planned_end ?? new Date(start.getTime() + Number(tpl.duration_minutes) * 60000).toISOString(),
    };
    for (const k of Object.keys(data)) if (data[k] === null || data[k] === undefined) delete data[k];
    // The administrator's custom fields (`cf_<key>`) pass through; the resource engine validates them (E18-34).
    for (const [k, v] of Object.entries(body)) if (k.startsWith('cf_')) data[k] = v;
    const row = await base.createWith(req, data, {
      status: 'approved', template_id: tpl.id, template_name: tpl.name,
      risk_computed: tpl.risk_level, risk_level: tpl.risk_level, submitted_at: new Date().toISOString(),
    });
    await ctx.audit(req, {
      action: 'change.from_template', recordType: 'change', recordId: row.id,
      summary: `Standard change ${base.changeLabel(row)} raised from the template "${tpl.name}"; it is pre-approved`,
      after: { template_id: tpl.id, template: tpl.name },
    });
    return row;
  }

  // ---------- blackout periods ----------

  function blackoutInput(body: Row, partial: boolean, existing?: Row): Row {
    const c = base.checker(body, partial);
    c.text('name', 'Name', true);
    c.datetime('starts_at', 'Start', true);
    c.datetime('ends_at', 'End', true);
    c.text('reason', 'Reason');
    c.oneOf('repeat', 'Repeats', ['none', 'weekly', 'monthly']);
    c.date('repeat_until', 'Repeat until');
    if (body.system_ids !== undefined) {
      const ids = Array.isArray(body.system_ids) ? [...new Set((body.system_ids as unknown[]).map(String))] : null;
      if (!ids || ids.some((id) => !UUID_RE.test(id))) c.errors.system_ids = 'Choose systems from the inventory.';
      else c.out.system_ids = ids;
    }
    const data = c.finish();
    if (data.repeat === null) data.repeat = 'none';
    const start = data.starts_at ?? existing?.starts_at;
    const end = data.ends_at ?? existing?.ends_at;
    if (start && end && new Date(end) <= new Date(start)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { ends_at: 'The end must be after the start.' });
    }
    const repeat = data.repeat ?? existing?.repeat ?? 'none';
    const until = data.repeat_until !== undefined ? data.repeat_until : existing?.repeat_until;
    if (repeat !== 'none' && start && end) {
      const span = new Date(end).getTime() - new Date(start).getTime();
      if (span > (repeat === 'weekly' ? 7 : 28) * 86_400_000) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { repeat: `A period that repeats ${repeat === 'weekly' ? 'every week' : 'every month'} must be shorter than the repeat.` });
      }
    }
    const untilDay = until instanceof Date ? until.toISOString().slice(0, 10) : until ? String(until).slice(0, 10) : null;
    if (untilDay && start && untilDay < todayInZone(new Date(start)) /* the start's local day (OP-07) */) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { repeat_until: 'Repeat until must be after the start.' });
    }
    return data;
  }

  /** Systems named on a blackout must exist (when the inventory is loaded). */
  async function checkBlackoutSystems(data: Row) {
    const ids = data.system_ids as string[] | undefined;
    if (!ids?.length) return;
    if (!ctx.resources.get('system')) ctx.fail(400, 'validation', 'Check the highlighted fields.', { system_ids: 'Systems are not available in this installation.' });
    for (const id of ids) if (!(await ctx.resources.find('system', id))) ctx.fail(400, 'validation', 'Check the highlighted fields.', { system_ids: 'A chosen system was not found.' });
  }

  async function listBlackouts(): Promise<Row[]> {
    const rows = await db.query<Row>('select * from change_blackouts where deleted_at is null order by starts_at desc');
    const ids = (r: Row): string[] => (Array.isArray(r.system_ids) ? r.system_ids : []);
    const names = await base.systemNames(rows.flatMap(ids));
    return rows.map((r) => ({ ...r, systems: ids(r).map((id) => ({ id, label: names.get(id) ?? 'System' })) }));
  }

  async function addBlackout(req: Req, body: Row): Promise<Row> {
    const data = blackoutInput(body, false);
    await checkBlackoutSystems(data);
    const row = await base.insertRow('change_blackouts', { ...data, created_by: req?.user?.id ?? null, updated_by: req?.user?.id ?? null });
    await ctx.audit(req, {
      action: 'change.blackout_create', recordType: 'change_blackout', recordId: row.id,
      summary: `Blackout period created: ${row.name}`, after: data,
    });
    return row;
  }

  async function updateBlackout(req: Req, id: string, body: Row): Promise<Row> {
    const existing = await needRow('change_blackouts', 'Blackout period', id);
    const input = blackoutInput(body, true, existing);
    await checkBlackoutSystems(input);
    const d = base.diff(existing, input);
    if (!d.changed) return existing;
    const row = await base.updateRow('change_blackouts', existing.id, d.after, req);
    await ctx.audit(req, {
      action: 'change.blackout_update', recordType: 'change_blackout', recordId: row.id,
      summary: `Blackout period updated: ${row.name}`, before: d.before, after: d.after,
    });
    return row;
  }

  const removeBlackout = (req: Req, id: string) =>
    removeRow(req, 'change_blackouts', 'Blackout period', 'change.blackout_delete', 'change_blackout', id, (r) => r.name);

  // ---------- questionnaire and approval rules (settings) ----------

  async function getSettings() {
    // Each rule's approvals and approvers are read from the first step of its approval workflow (E05-13).
    const rules = await approval.rulesWithWorkflows(await base.approvalRules());
    const named = [...new Set(rules.flatMap((r) => r.approver_user_ids ?? []))];
    return {
      questionnaire: await base.questionnaire(),
      approval_rules: rules,
      // The change approval workflows a rule may name (Administration > Approval workflows).
      workflows: approvalEngine(ctx.app) ? await approvalEngine(ctx.app)!.definitions(KIND) : [],
      // For the rules editor: the roles that can be chosen and the names of the people already named.
      roles: await db.query<{ key: string; name: string }>('select key, name from roles where enabled order by name'),
      user_names: Object.fromEntries((named.length
        ? await db.query<{ id: string; display_name: string }>('select id, display_name from users where id = any($1::uuid[])', [named])
        : []).map((u) => [u.id, u.display_name])),
    };
  }

  async function cleanQuestionnaire(input: Row, errors: Record<string, string>): Promise<Questionnaire> {
    const levels = (await ctx.lookups.values('change_risk')).map((v) => v.value);
    const questions: RiskQuestion[] = [];
    const seen = new Set<string>();
    if (!Array.isArray(input?.questions) || !input.questions.length) errors.questions = 'Add at least one question.';
    for (const [i, q] of ((Array.isArray(input?.questions) ? input.questions : []) as Row[]).entries()) {
      const label = String(q?.label ?? '').trim();
      const key = String(q?.key ?? '').trim() || slug(label);
      const weight = Number(q?.weight);
      if (!label) errors[`questions.${i}.label`] = 'Write the question.';
      if (!KEY.test(key)) errors[`questions.${i}.label`] ??= 'The question needs some letters or digits.';
      else if (seen.has(key)) errors[`questions.${i}.label`] ??= 'This question appears twice.';
      seen.add(key);
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) errors[`questions.${i}.weight`] = 'Weight must be from 0 to 100.';
      const options = [];
      const values = new Set<string>();
      for (const [j, o] of ((Array.isArray(q?.options) ? q.options : []) as Row[]).entries()) {
        const optionLabel = String(o?.label ?? '').trim();
        const value = String(o?.value ?? '').trim() || slug(optionLabel);
        const score = Number(o?.score);
        if (!optionLabel || !value) errors[`questions.${i}.options.${j}.label`] = 'Write the answer.';
        else if (values.has(value)) errors[`questions.${i}.options.${j}.label`] = 'This answer appears twice.';
        values.add(value);
        if (!Number.isFinite(score) || score < 0 || score > 100) errors[`questions.${i}.options.${j}.score`] = 'Score must be from 0 to 100.';
        options.push({ value, label: optionLabel, score });
      }
      if (options.length < 2) errors[`questions.${i}.options`] = 'Give at least two answers.';
      else if (!options.some((o) => o.score > 0)) errors[`questions.${i}.options`] = 'At least one answer needs a score above zero.';
      const help = String(q?.help ?? '').trim();
      questions.push({ key, label, weight, options, ...(help ? { help } : {}) });
    }
    if (questions.length && !questions.some((q) => q.weight > 0)) errors.questions = 'At least one question needs a weight above zero.';

    const bands = [];
    for (const level of levels) {
      const band = ((Array.isArray(input?.bands) ? input.bands : []) as Row[]).find((b) => b?.level === level);
      if (band) bands.push({ level, upTo: Number(band.upTo ?? NaN) });
    }
    if (!bands.length) errors.bands = 'Set the score at which each risk level ends.';
    bands.sort((a, b) => a.upTo - b.upTo);
    for (const [i, b] of bands.entries()) {
      if (!Number.isFinite(b.upTo) || b.upTo < 0 || b.upTo > 100) errors[`bands.${b.level}`] = 'Enter a score from 0 to 100.';
      else if (i > 0 && b.upTo === bands[i - 1].upTo) errors[`bands.${b.level}`] = 'Two levels cannot end at the same score.';
    }
    // The highest level always runs to the top of the scale.
    if (bands.length) bands[bands.length - 1].upTo = 100;
    return { questions, bands };
  }

  async function cleanRules(input: unknown, errors: Record<string, string>): Promise<ApprovalRule[]> {
    const types = (await ctx.lookups.values('change_type')).map((v) => v.value);
    const levels = (await ctx.lookups.values('change_risk')).map((v) => v.value);
    const rules: ApprovalRule[] = [];
    const seen = new Set<string>();
    if (!Array.isArray(input) || !input.length) errors.approval_rules = 'Add at least one rule.';
    for (const [i, r] of ((Array.isArray(input) ? input : []) as Row[]).entries()) {
      const changeType = String(r?.change_type ?? '');
      const riskLevel = String(r?.risk_level ?? ANY) || ANY;
      const approvals = Number(r?.approvals);
      if (changeType !== ANY && !types.includes(changeType)) errors[`approval_rules.${i}.change_type`] = 'Choose a change type.';
      if (riskLevel !== ANY && !levels.includes(riskLevel)) errors[`approval_rules.${i}.risk_level`] = 'Choose a risk level.';
      if (!Number.isInteger(approvals) || approvals < 0 || approvals > 5) errors[`approval_rules.${i}.approvals`] = 'Enter a whole number from 0 to 5.';
      else if (changeType === 'emergency' && approvals > 1) errors[`approval_rules.${i}.approvals`] = 'An emergency change proceeds with one approver.';
      const pair = `${changeType}/${riskLevel}`;
      if (seen.has(pair)) errors[`approval_rules.${i}.risk_level`] ??= 'There is already a rule for this type and risk.';
      seen.add(pair);
      const roles = Array.isArray(r?.approver_roles) ? r.approver_roles : String(r?.approver_roles ?? '').split(',');
      const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean))];
      const userIds = list(r?.approver_user_ids);
      const roleKeys = list(r?.approver_role_keys);
      if (userIds.length) {
        const known = userIds.every((id) => UUID_RE.test(id))
          ? (await db.query<{ id: string }>(`select id from users where id = any($1::uuid[]) and status = 'active' and deleted_at is null`, [userIds])).map((u) => u.id)
          : [];
        if (known.length !== userIds.length) errors[`approval_rules.${i}.approver_user_ids`] = 'Choose active users.';
      }
      if (roleKeys.length) {
        const known = (await db.query<{ key: string }>('select key from roles where key = any($1::text[])', [roleKeys])).map((x) => x.key);
        if (known.length !== roleKeys.length) errors[`approval_rules.${i}.approver_role_keys`] = 'Choose roles that exist.';
      }
      // A rule that names its approvers must name enough of them to reach the number it asks for.
      if (!roleKeys.length && userIds.length && Number.isInteger(approvals) && userIds.length < approvals) {
        errors[`approval_rules.${i}.approver_user_ids`] = `Name at least ${approvals} approvers, or add a role.`;
      }
      rules.push({
        change_type: changeType, risk_level: riskLevel, approvals,
        approver_roles: [...new Set((roles as unknown[]).map((x) => String(x).trim()).filter(Boolean))],
        ...(userIds.length ? { approver_user_ids: userIds } : {}),
        ...(roleKeys.length ? { approver_role_keys: roleKeys } : {}),
        workflow_id: r?.workflow_id && UUID_RE.test(String(r.workflow_id)) ? String(r.workflow_id) : null,
        pir_required: changeType === 'emergency' ? true : r?.pir_required === true,
        retrospective: r?.retrospective === true,
      });
    }
    return rules;
  }

  async function putSettings(req: Req, body: Row) {
    const errors: Record<string, string> = {};
    const current = await getSettings();
    const questionnaire = body.questionnaire !== undefined ? await cleanQuestionnaire(body.questionnaire, errors) : undefined;
    const rules = body.approval_rules !== undefined ? await cleanRules(body.approval_rules, errors) : undefined;
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    let recalculate = false;
    if (questionnaire && differs(questionnaire, current.questionnaire)) { await ctx.settings.set(SETTING_QUESTIONNAIRE, questionnaire, req); recalculate = true; }
    const plain = (list: ApprovalRule[]) => list.map(({ workflow_name: _n, ...r }: ApprovalRule & { workflow_name?: string | null }) => r);
    // A rule sent without its workflow (an older client) keeps the one it has.
    const pair = (r: ApprovalRule) => `${r.change_type}/${r.risk_level}`;
    const had = new Map(current.approval_rules.map((r) => [pair(r), r.workflow_id ?? null]));
    for (const r of rules ?? []) r.workflow_id ??= had.get(pair(r)) ?? null;
    if (rules && differs(rules, plain(current.approval_rules))) {
      // Each rule that asks for approval keeps a workflow whose first step follows it.
      await ctx.settings.set(SETTING_RULES, await approval.syncWorkflows(rules, req), req);
      recalculate = true;
    }

    // Drafts follow the new rules at once (each change is audited); submitted changes keep the path they were given.
    let recalculated = 0;
    if (recalculate) {
      const drafts = await db.query<{ id: string; updated_at: Date }>(`select id, updated_at from changes where deleted_at is null and status = 'draft'`);
      for (const d of drafts) {
        const row = await ctx.resources.update('change', d.id, {}, null);
        if (new Date(row.updated_at).getTime() !== new Date(d.updated_at).getTime()) recalculated += 1;
      }
    }
    return { ...(await getSettings()), recalculated };
  }

  // ---------- register overview ----------

  async function overview(weekFrom: unknown, weekTo: unknown) {
    const from = new Date(String(weekFrom ?? ''));
    const to = new Date(String(weekTo ?? ''));
    const hasWeek = !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime());
    const row = (await db.one<Row>(
      `select (count(*) filter (where status = 'submitted'))::int as awaiting_approval,
              (count(*) filter (where status = 'in_progress'))::int as in_progress,
              (count(*) filter (where status in ('approved', 'scheduled')))::int as upcoming,
              (count(*) filter (where change_type = 'emergency' and status not in ('closed', 'cancelled', 'rejected')))::int as emergency_open,
              (count(*) filter (where status = 'completed' and pir_required and pir_completed_at is null))::int as review_due,
              (count(*) filter (where $1::timestamptz is not null and planned_start >= $1::timestamptz and planned_start < $2::timestamptz
                                  and status not in ('cancelled', 'rejected')))::int as this_week
       from changes where deleted_at is null`,
      [hasWeek ? from.toISOString() : null, hasWeek ? to.toISOString() : null]))!;
    return row;
  }

  return {
    listTemplates, addTemplate, updateTemplate, removeTemplate, createFromTemplate,
    listBlackouts, addBlackout, updateBlackout, removeBlackout,
    getSettings, putSettings, overview,
  };
}

export type Admin = ReturnType<typeof makeAdmin>;
