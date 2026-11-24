// Privacy impact assessments (E34-05): one assessment per system that holds personal data
// categories, approved through the "Privacy impact assessment" approval kind, reviewed every
// `review_months`, and marked "needs update" when the system's data categories change after approval.
// The coverage list shows systems holding personal data without an approved assessment in date.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { notePermission } from '../../core/permission-use.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays, readSettings } from './settings.ts';
import { addMonths } from '../../../../shared/dates.ts';

export const PIA_TYPE = 'privacy_assessment';
export const PIA_KIND = 'privacy_assessment';

export const DEFAULT_PIA_WORKFLOW = {
  name: 'Privacy impact assessment',
  description: 'Approving a privacy impact assessment. Someone who may approve privacy records decides.',
  steps: [{ key: 'privacy-approver', name: 'Privacy approver', approvers: { kind: 'permission', permission: 'privacy.approve' }, quorum: 'any' }],
};

/** The system's data category ids now, sorted (for comparing with what was approved). */
async function categoriesOf(ctx: ModuleContext, systemId: string | null): Promise<string[]> {
  if (!systemId || !ctx.resources.get('system')) return [];
  const rows = await ctx.db.query<{ id: string }>(
    `select l.data_category_id::text as id from system_data_categories l join data_categories d on d.id = l.data_category_id and d.deleted_at is null
     where l.system_id = $1 order by 1`, [systemId]);
  return rows.map((r) => r.id);
}

const sameSet = (a: unknown, b: string[]) => {
  const x = (Array.isArray(a) ? a.map(String) : []).sort();
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

export async function registerPrivacy(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function checkAssessment(req: FastifyRequest | null, merged: Row, patch: Row): Promise<Row> {
    if (patch.review_months !== undefined && patch.review_months !== null) {
      const n = Number(patch.review_months);
      if (!Number.isInteger(n) || n < 1 || n > 120) invalid({ review_months: 'Review every 1 to 120 months.' });
    }
    if (patch.data_category_ids !== undefined && patch.data_category_ids !== null) {
      const ids = Array.isArray(patch.data_category_ids) ? patch.data_category_ids.map(String) : null;
      if (!ids || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) invalid({ data_category_ids: 'Choose data categories.' });
      if (req && ctx.resources.get('data_category')) {
        for (const id of ids!) if (!(await ctx.resources.find('data_category', id, req.user))) invalid({ data_category_ids: 'Choose data categories you can see.' });
      }
      patch.data_category_ids = [...new Set(ids)];
    }
    if (patch.answers !== undefined && (typeof patch.answers !== 'object' || patch.answers === null || Array.isArray(patch.answers))) {
      invalid({ answers: 'Send the answers as { question: answer }.' });
    }
    void merged;
    return patch;
  }

  ctx.defineResource({
    type: PIA_TYPE, table: 'privacy_assessments', module: 'privacy', label: 'Privacy impact assessment', plural: 'Privacy impact assessments',
    path: '/api/privacy-assessments', route: '/privacy/assessments', titleField: 'title',
    ref: { field: 'ref', prefix: 'PIA-' },
    searchable: ['title', 'purpose'],
    defaultSort: { field: 'updated_at', dir: 'desc' },
    evidence: true,
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, personal: false },
      system_id: { label: 'System', type: 'ref', to: 'system' },
      owner_id: { label: 'Owner', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'privacy_assessment_status', default: 'draft', readOnly: true },
      data_category_ids: { label: 'Data categories', type: 'json', personal: false },
      purpose: { label: 'Purpose of the processing', type: 'longtext', personal: false },
      legal_basis: { label: 'Legal basis (as recorded)', type: 'longtext', personal: false },
      necessity: { label: 'Necessity and proportionality', type: 'longtext', personal: false },
      retention: { label: 'Retention', type: 'longtext', personal: false },
      sharing: { label: 'Sharing and transfers', type: 'longtext', personal: false },
      risks: { label: 'Risks to people', type: 'longtext', personal: false },
      mitigations: { label: 'Mitigations', type: 'longtext', personal: false },
      residual_risk: { label: 'Residual risk', type: 'lookup', list: 'privacy_risk_level' },
      answers: { label: 'Answers', type: 'json', personal: false },
      review_months: { label: 'Review every (months)', type: 'number', default: 24 },
      approved_on: { label: 'Approved on', type: 'date', readOnly: true },
      approved_by_name: { label: 'Approved by', type: 'text', readOnly: true },
      next_review_on: { label: 'Next review', type: 'date', readOnly: true },
    },
    hooks: {
      beforeCreate: async (req, data) => checkAssessment(req, data, data),
      beforeUpdate: async (req, existing, patch) => checkAssessment(req, { ...existing, ...patch }, patch),
      afterCreate: async (req, row) => { await mirror(row, req?.user?.id ?? null); },
      afterUpdate: async (req, before, after) => { if (before.system_id !== after.system_id) await mirror(after, req?.user?.id ?? null, before.system_id); },
    },
  });

  /** The assessment is linked from its system as `assessed_by` (contract C7), so the system's Related tab shows it. */
  async function mirror(row: Row, by: string | null, oldSystem?: string | null) {
    if (oldSystem) await db.query(`delete from record_links where from_type = 'system' and from_id = $1 and to_type = $2 and to_id = $3 and relation = 'assessed_by'`, [oldSystem, PIA_TYPE, row.id]);
    if (row.system_id) {
      await db.query(`insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('system', $1, $2, $3, 'assessed_by', $4) on conflict do nothing`,
        [row.system_id, PIA_TYPE, row.id, by]);
    }
  }

  // ---------------------------------------------------------------- approval

  async function approve(id: string, byName: string, req: FastifyRequest | null) {
    const row = (await db.one<Row>('select * from privacy_assessments where id = $1', [id]))!;
    const today = todayInZone();
    await ctx.resources.update(PIA_TYPE, id, {
      status: 'approved', approved_on: today, approved_by_name: byName.slice(0, 200),
      next_review_on: addMonths(today, Number(row.review_months) || 24),
    }, null);
    await db.query('update privacy_assessments set approved_category_ids = $2::jsonb, review_reminded_for = null where id = $1', [id, JSON.stringify(await categoriesOf(ctx, row.system_id))]);
    await ctx.audit(req, { action: 'privacy_assessment.approved', recordType: PIA_TYPE, recordId: id, summary: `Privacy impact assessment ${row.ref} approved by ${byName}` });
  }

  // Checked by the approval engine (approvers) and on submit with no workflow, for the role editor.
  notePermission('privacy.approve');
  defineApprovalKind(app, {
    key: PIA_KIND, recordType: PIA_TYPE, label: 'Privacy impact assessment',
    startsWhen: 'Someone submits a privacy impact assessment for approval',
    outcome: 'Approved: the assessment becomes Approved, with its next review date; rejected: it goes back to Draft, with the reason in its history',
    approverPermission: 'privacy.approve',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_PIA_WORKFLOW);
    },
    async onFinish(e) {
      const row = await db.one<Row>('select * from privacy_assessments where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!row) throw new Error('The privacy impact assessment no longer exists.');
      const who = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'approved') return approve(row.id, who, e.req);
      if (row.status === 'in_review') await ctx.resources.update(PIA_TYPE, row.id, { status: 'draft' }, null);
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'privacy_assessment.rejected', recordType: PIA_TYPE, recordId: row.id,
          summary: `Privacy impact assessment ${row.ref} rejected by ${who}: ${e.comment ?? 'no reason given'}`,
        });
      }
    },
  });

  app.post('/api/privacy-assessments/:id/submit', { preHandler: ctx.requirePerm('privacy.edit') }, async (req) => {
    const row = (await ctx.resources.find(PIA_TYPE, String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Assessment not found.');
    if (!['draft', 'needs_update', 'approved'].includes(String(row.status))) ctx.fail(409, 'in_review', 'This assessment is already waiting for approval.');
    const errors: Record<string, string> = {};
    if (!row.system_id) errors.system_id = 'Choose the system assessed.';
    if (!String(row.purpose ?? '').trim()) errors.purpose = 'Describe the purpose of the processing.';
    if (!String(row.risks ?? '').trim()) errors.risks = 'Describe the risks to people.';
    if (!row.residual_risk) errors.residual_risk = 'Rate the residual risk.';
    if (Object.keys(errors).length) invalid(errors);
    const eng = approvalEngine(app);
    if (eng && await eng.running(PIA_KIND, row.id)) ctx.fail(409, 'in_review', 'This assessment is already waiting for approval.');
    await ctx.resources.update(PIA_TYPE, row.id, { status: 'in_review' }, null);
    const started = eng ? await eng.start(PIA_KIND, { ...row, status: 'in_review' }, { requester: req.user!.id, req, note: String(row.title).slice(0, 500) }) : null;
    await ctx.audit(req, { action: 'privacy_assessment.submitted', recordType: PIA_TYPE, recordId: row.id, summary: `Privacy impact assessment ${row.ref} submitted for approval${started ? ` (${started.name})` : ''}` });
    if (!started) {
      // No workflow applies: someone who may approve privacy records approves it at once; otherwise it waits.
      if (ctx.can(req.user, 'privacy.approve')) await approve(row.id, req.user!.displayName, req);
      else {
        await ctx.resources.update(PIA_TYPE, row.id, { status: row.status }, null);
        ctx.fail(409, 'no_workflow', 'No Privacy impact assessment workflow applies, so only someone who may approve privacy records can approve it.');
      }
    }
    const now = (await ctx.resources.find(PIA_TYPE, row.id))!;
    return { status: now.status, instance_id: started?.id ?? null, workflow: started?.name ?? null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/privacy-assessments/:id/submit', tag: 'Privacy', permission: 'privacy.edit',
    summary: 'Submit a privacy impact assessment for approval: starts the Privacy impact assessment workflow, or with none, approves it for someone holding privacy.approve',
    description: 'Needs the system, the purpose, the risks and the residual risk.', response: '{ status, instance_id, workflow }',
  });

  // ---------------------------------------------------------------- needs update, coverage

  /** Approved assessments whose system's data categories changed since approval become "needs update". */
  async function syncNeedsUpdate(): Promise<number> {
    if (!ctx.resources.get('system')) return 0;
    let moved = 0;
    for (const a of await db.query<Row>(`select id, ref, system_id, approved_category_ids from privacy_assessments where deleted_at is null and status = 'approved' and system_id is not null`)) {
      if (sameSet(a.approved_category_ids, await categoriesOf(ctx, a.system_id))) continue;
      await ctx.resources.update(PIA_TYPE, a.id, { status: 'needs_update' }, null);
      await ctx.audit(null, { action: 'privacy_assessment.needs_update', recordType: PIA_TYPE, recordId: a.id, summary: `Privacy impact assessment ${a.ref} needs updating: the system's data categories changed since it was approved` });
      moved += 1;
    }
    return moved;
  }

  async function coverage(user: SessionUser | null | undefined) {
    if (!ctx.resources.get('system') || !ctx.resources.get('data_category')) return { rows: [], total: 0, without_current: 0, hidden: 0 };
    await syncNeedsUpdate();
    const today = todayInZone();
    // Every system holding a personal-data category, and whether it has an approved assessment in date.
    const all = await db.query<Row>(
      `select s.id::text as id, s.name, s.ref,
         exists (select 1 from privacy_assessments p where p.system_id = s.id and p.deleted_at is null and p.status = 'approved'
                   and (p.next_review_on is null or p.next_review_on >= $1::date)) as current
       from systems s where s.deleted_at is null and exists (
         select 1 from system_data_categories l join data_categories d on d.id = l.data_category_id and d.deleted_at is null and d.personal_data
         where l.system_id = s.id)
       order by s.name`, [today]);
    const visible = new Set((await db.query<{ id: string }>(
      `select id::text as id from systems where id = any($1::uuid[]) and ${ctx.resources.visibleWhere('system', user ?? null)}`, [all.map((s) => s.id)])).map((r) => r.id));
    const seeCategories = ctx.can(user ?? null, 'data.view');
    const rows: Row[] = [];
    for (const s of all.filter((x) => visible.has(x.id))) {
      const cats = seeCategories ? await db.query<Row>(
        `select d.id::text as id, d.name from system_data_categories l join data_categories d on d.id = l.data_category_id and d.deleted_at is null and d.personal_data
         where l.system_id = $1 order by d.name`, [s.id]) : [];
      const latest = await db.one<Row>(
        `select id, ref, title, status, next_review_on from privacy_assessments where system_id = $1 and deleted_at is null and ${ctx.resources.visibleWhere(PIA_TYPE, user ?? null)}
         order by case status when 'approved' then 0 when 'in_review' then 1 when 'needs_update' then 2 else 3 end, updated_at desc limit 1`, [s.id]);
      rows.push({ ...s, categories: cats, assessment: latest ?? null });
    }
    // Figures: every system counts, also those the reader may not see.
    return { rows, total: all.length, without_current: all.filter((s) => !s.current).length, hidden: all.length - rows.length };
  }

  app.get('/api/privacy/coverage', { preHandler: ctx.requirePerm('privacy.view') }, async (req) => coverage(req.user));
  ctx.describeRoute({
    method: 'GET', path: '/api/privacy/coverage', tag: 'Privacy', permission: 'privacy.view',
    summary: 'Systems holding personal data categories, and whether each has an approved privacy impact assessment in date; the counts include every system',
    response: '{ rows: [{ id, name, ref, current, categories: [{ id, name }], assessment: { id, ref, title, status, next_review_on } | null }], total, without_current, hidden }',
  });

  // ---------------------------------------------------------------- review reminders

  /** Tells each owner once per review date that an approved assessment's review is coming or past (claimed first). */
  async function runReviewReminders(): Promise<{ due: number; needsUpdate: number }> {
    const needsUpdate = await syncNeedsUpdate();
    const s = await readSettings(ctx);
    const horizon = addDays(todayInZone(), s.reviewReminderDays, false);
    const rows = await db.query<Row>(
      `select id, ref, title, owner_id, next_review_on::text as next_review_on from privacy_assessments
       where deleted_at is null and status = 'approved' and next_review_on is not null and next_review_on <= $1::date
         and review_reminded_for is distinct from next_review_on`, [horizon]);
    let due = 0;
    for (const r of rows) {
      const claimed = await db.one(
        `update privacy_assessments set review_reminded_for = next_review_on where id = $1 and review_reminded_for is distinct from next_review_on returning id`, [r.id]);
      if (!claimed) continue;
      due += 1;
      if (!app.hasDecorator('notify')) continue;
      await app.notify({
        ...(r.owner_id ? { userIds: [r.owner_id] } : { permission: 'privacy.edit' }), kind: 'records',
        title: `Privacy impact assessment review due: ${r.ref} by ${r.next_review_on}`,
        body: 'Review the assessment and submit it for approval again.', recordType: PIA_TYPE, recordId: r.id,
      });
    }
    return { due, needsUpdate };
  }

  return { runReviewReminders, syncNeedsUpdate };
}
