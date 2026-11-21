import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { UUID_RE } from '../../core/errors.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { activeUser, cleanText, idParam } from './shared.ts';

/**
 * Yearly certifications (E27-05): a checklist of statements the organization certifies to a funder
 * each year, each confirmed by the person responsible before the authorized official signs. Signing
 * goes through the approval kind `funding_certification` (one step: the person named as signer).
 * Each year's draft is made from the year before (`funding.certification_month`, a daily job).
 *
 * Statuses: draft (items are edited and confirmed) -> in_review (waiting for the signer, set by the
 * sign request) -> signed (set by the approval) -> submitted (set by hand once sent to the funder).
 */

export const CERT_KIND = 'funding_certification';
export const DEFAULT_CERT_WORKFLOW = 'Funding certification sign-off';
export const CERT_MONTH_SETTING = 'funding.certification_month';
export const DEFAULT_CERT_MONTH = 12;

const ITEM_FIELDS = ['category', 'statement', 'applies', 'responsible_id', 'obligation_id', 'note', 'sort'] as const;

/** What blocks signing: applicable items not yet confirmed (an empty checklist cannot be signed either). */
export async function signingProblems(ctx: ModuleContext, certId: string): Promise<{ applicable: number; confirmed: number; missing: Row[] }> {
  const items = await ctx.db.query<Row>(
    'select id, statement, applies, confirmed_on from funding_certification_items where certification_id = $1 order by sort, created_at', [certId]);
  const applicable = items.filter((i) => i.applies);
  const missing = applicable.filter((i) => !i.confirmed_on).map((i) => ({ id: i.id, statement: i.statement }));
  return { applicable: applicable.length, confirmed: applicable.length - missing.length, missing };
}

/**
 * Makes a draft for `year` from a certification: the same title, funder and signer, the due date a
 * year on, and every item unconfirmed. Answers the new certification, or the one already there.
 */
export async function copyForward(ctx: ModuleContext, from: Row, year: number, req: FastifyRequest | null): Promise<{ row: Row; created: boolean }> {
  const existing = await ctx.db.one<Row>(
    `select * from funding_certifications where deleted_at is null and year = $1 and lower(title) = lower($2)
       and lower(coalesce(funder_name, '')) = lower(coalesce($3, ''))`, [year, from.title, from.funder_name ?? null]);
  if (existing) return { row: existing, created: false };
  const shift = (d: string | null) => {
    if (!d) return null;
    const [y, m, day] = d.split('-').map(Number);
    return `${y + (year - Number(from.year))}-${String(m).padStart(2, '0')}-${String(m === 2 && day === 29 ? 28 : day).padStart(2, '0')}`;
  };
  const row = await ctx.resources.create('funding_certification', {
    year, title: from.title, funder_name: from.funder_name ?? null, signer_id: from.signer_id ?? null,
    due_on: shift(from.due_on ? String(from.due_on).slice(0, 10) : null), status: 'draft',
    notes: `Made from ${from.ref} (${from.year}).`,
  }, req);
  const items = await ctx.db.query<Row>('select * from funding_certification_items where certification_id = $1 order by sort, created_at', [from.id]);
  for (const i of items) {
    await ctx.db.query(
      `insert into funding_certification_items (certification_id, category, statement, applies, responsible_id, obligation_id, sort, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [row.id, i.category, i.statement, i.applies, i.responsible_id, i.obligation_id, i.sort, req?.user?.id ?? null]);
  }
  await ctx.audit(req, {
    action: 'funding_certification.copy_forward', recordType: 'funding_certification', recordId: row.id,
    summary: `${items.length} item${items.length === 1 ? '' : 's'} copied from ${from.ref} (${from.year}) into the ${year} draft`,
    after: { from: from.id, items: items.length },
  });
  return { row, created: true };
}

/**
 * The daily job: from the month in the setting on, each series of certifications (same title and
 * funder) whose newest year is before the coming year gets a draft for it, made from the newest one.
 * Before that month the coming year is the current one, so a missed year is caught up.
 */
export async function runCertificationRollover(ctx: ModuleContext, today = todayInZone()): Promise<{ year: number; created: number }> {
  const month = Number(await ctx.settings.get(CERT_MONTH_SETTING, DEFAULT_CERT_MONTH));
  const [y, m] = today.split('-').map(Number);
  const target = Number.isInteger(month) && month >= 1 && month <= 12 && m >= month ? y + 1 : y;
  const newest = await ctx.db.query<Row>(
    `select distinct on (lower(title), lower(coalesce(funder_name, ''))) *
     from funding_certifications where deleted_at is null
     order by lower(title), lower(coalesce(funder_name, '')), year desc, created_at desc`);
  let created = 0;
  for (const c of newest) {
    if (Number(c.year) >= target) continue;
    if ((await copyForward(ctx, c, target, null)).created) created += 1;
  }
  return { year: target, created };
}

export async function registerCertifications(ctx: ModuleContext) {
  const { db, app } = ctx;
  const engine = () => approvalEngine(app);
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  function checkYear(merged: Row) {
    const year = Number(merged.year);
    if (!Number.isInteger(year) || year < 1990 || year > 2200) invalid({ year: 'Give the certification year, for example 2027.' });
    return year;
  }

  ctx.defineResource({
    type: 'funding_certification', table: 'funding_certifications', module: 'funding',
    label: 'Funding certification', plural: 'Funding certifications',
    path: '/api/funding-certifications', route: '/funding/certifications', titleField: 'title',
    ref: { field: 'ref', prefix: 'CER-' },
    searchable: ['title', 'funder_name', 'notes'],
    defaultSort: { field: 'year', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      // Text in the form (so it is not shown as 2,026); stored as a whole number and checked in the hooks.
      year: { label: 'Year', type: 'text', required: true, personal: false },
      title: { label: 'Certification', type: 'text', required: true },
      funder_name: { label: 'Funder', type: 'text', personal: false },
      due_on: { label: 'Due', type: 'date' },
      signer_id: { label: 'Authorized official', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'funding_certification_status', default: 'draft' },
      signed_on: { label: 'Signed on', type: 'date', readOnly: true },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (req, data) => {
        data.year = checkYear(data);
        // A new certification starts as a draft; its status follows the sign-off.
        if (req) data.status = 'draft';
        return data;
      },
      beforeUpdate: (req, existing, patch) => {
        if ('year' in patch) patch.year = checkYear(patch);
        if (req && 'status' in patch && patch.status !== existing.status) {
          // By hand only: a signed certification is marked submitted (or back to signed). Review and
          // signing are moved by the sign request and the approval.
          const ok = (existing.status === 'signed' && patch.status === 'submitted') || (existing.status === 'submitted' && patch.status === 'signed');
          if (!ok) invalid({ status: existing.status === 'draft' || existing.status === 'in_review'
            ? 'Ask the authorized official to sign: the status follows the sign-off.'
            : 'A signed certification can only be marked as submitted to the funder.' });
        }
        if (req && existing.status !== 'draft') {
          const locked = 'This cannot change once the certification has gone for signing.';
          if ('signer_id' in patch && (patch.signer_id ?? null) !== (existing.signer_id ?? null)) invalid({ signer_id: locked });
          if ('year' in patch && Number(patch.year) !== Number(existing.year)) invalid({ year: locked });
        }
        return patch;
      },
    },
  });

  defineApprovalKind(app, {
    key: CERT_KIND, recordType: 'funding_certification', label: 'Funding certification sign-off',
    startsWhen: 'Someone asks the authorized official to sign a yearly certification, once every applicable item is confirmed',
    outcome: 'Approved: the certification is signed (dated today); rejected: it goes back to draft, with the reason in its history',
    approverPermission: 'funding.approve',
    async install(h) {
      if (await h.hasDefinitions()) return;
      await h.define({
        name: DEFAULT_CERT_WORKFLOW,
        description: 'The authorized official named on the certification signs it. They need permission to approve funding records.',
        steps: [{
          key: 'sign', name: 'Authorized official', approvers: { kind: 'field', field: 'signer_id' }, quorum: 'any', due_hours: 240,
          conditions: [{ field: 'signer_id', op: 'set' }],
        }],
      });
    },
    async onFinish(e) {
      const cert = await db.one<Row>('select * from funding_certifications where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!cert) throw new Error('The certification no longer exists.');
      if (e.outcome === 'approved') {
        await ctx.resources.update('funding_certification', cert.id, { status: 'signed', signed_on: todayInZone() }, null);
        await ctx.audit(e.req, {
          action: 'funding_certification.signed', recordType: 'funding_certification', recordId: cert.id,
          summary: `${cert.ref} signed by ${e.approverName ?? 'the authorized official'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`,
        });
        return;
      }
      if (cert.status === 'in_review') await ctx.resources.update('funding_certification', cert.id, { status: 'draft' }, null);
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'funding_certification.sign_rejected', recordType: 'funding_certification', recordId: cert.id,
          summary: `${cert.ref} sent back to draft by ${e.approverName ?? 'the authorized official'}: ${e.comment ?? 'no reason given'}`,
          after: { reason: e.comment },
        });
      }
    },
  });

  const view = ctx.requirePerm('funding.view');
  const edit = ctx.requirePerm('funding.edit');

  async function needCert(req: FastifyRequest): Promise<Row> {
    return (await ctx.resources.find('funding_certification', idParam(ctx, req), req.user)) ?? ctx.fail(404, 'not_found', 'Certification not found.');
  }
  const draftOnly = (cert: Row) => {
    if (cert.status !== 'draft') ctx.fail(409, 'not_draft', 'The checklist can only change while the certification is a draft.');
  };

  async function itemRows(certId: string): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select i.*, i.confirmed_on::text as confirmed_on, r.display_name as responsible_name, c.display_name as confirmed_by_name
       from funding_certification_items i
       left join users r on r.id = i.responsible_id
       left join users c on c.id = i.confirmed_by
       where i.certification_id = $1 order by i.sort, i.created_at`, [certId]);
    return rows;
  }

  /** Item values from a request body, checked. */
  async function itemInput(b: Row, creating: boolean): Promise<Row> {
    const out: Row = {};
    const errors: Record<string, string> = {};
    if (creating || 'statement' in b) {
      const s = cleanText(b.statement, 2000);
      if (!s) errors.statement = 'Write the statement being certified.';
      else out.statement = s;
    }
    if ('category' in b) {
      const c = cleanText(b.category, 60);
      if (c && !(await ctx.lookups.values('funding_certification_category')).some((v) => v.value === c)) errors.category = 'Choose a category from the list.';
      else out.category = c;
    }
    if ('applies' in b) out.applies = b.applies !== false && b.applies !== 'false';
    if ('note' in b) out.note = cleanText(b.note, 2000);
    if ('sort' in b) {
      const n = Number(b.sort);
      if (!Number.isInteger(n) || n < 0 || n > 100000) errors.sort = 'Give a whole number of zero or more.';
      else out.sort = n;
    }
    if ('obligation_id' in b) {
      const v = b.obligation_id === null || b.obligation_id === '' ? null : String(b.obligation_id);
      if (v && (!UUID_RE.test(v) || !ctx.resources.get('obligation'))) errors.obligation_id = 'Choose an obligation.';
      else out.obligation_id = v;
    }
    if (Object.keys(errors).length) invalid(errors);
    if ('responsible_id' in b) out.responsible_id = await activeUser(ctx, b.responsible_id, 'responsible_id');
    return out;
  }

  app.get('/api/funding-certifications/:id/items', { preHandler: view }, async (req) => {
    const cert = await needCert(req);
    const progress = await signingProblems(ctx, cert.id);
    return { items: await itemRows(cert.id), applicable: progress.applicable, confirmed: progress.confirmed };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding-certifications/:id/items', tag: 'Funding', permission: 'funding.view',
    summary: 'The checklist of a yearly certification, with how many applicable items are confirmed',
    response: '{ items: [{ id, category, statement, applies, responsible_id, responsible_name, obligation_id, confirmed_by, confirmed_by_name, confirmed_on, note, sort }], applicable, confirmed }',
  });

  app.post('/api/funding-certifications/:id/items', { preHandler: edit }, async (req, reply) => {
    const cert = await needCert(req);
    draftOnly(cert);
    const data = await itemInput((req.body ?? {}) as Row, true);
    if (data.sort === undefined) {
      data.sort = Number((await db.one<Row>('select coalesce(max(sort), 0) + 10 as n from funding_certification_items where certification_id = $1', [cert.id]))!.n);
    }
    const cols = Object.keys(data);
    const row = (await db.one<Row>(
      `insert into funding_certification_items (certification_id, ${cols.join(', ')}, created_by, updated_by)
       values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}, $${cols.length + 2}) returning *`,
      [cert.id, ...cols.map((c) => data[c]), req.user!.id]))!;
    await ctx.audit(req, {
      action: 'funding_certification.item_add', recordType: 'funding_certification', recordId: cert.id,
      summary: `Item added to ${cert.ref}: ${String(row.statement).slice(0, 120)}`, after: data,
    });
    reply.code(201);
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/funding-certifications/:id/items', tag: 'Funding', permission: 'funding.edit',
    summary: 'Add an item to a draft certification\'s checklist',
    body: '{ statement, category?, applies?, responsible_id?, obligation_id?, note?, sort? }', response: 'the item',
  });

  async function needItem(req: FastifyRequest, cert: Row): Promise<Row> {
    const itemId = idParam(ctx, req, 'itemId');
    return (await db.one<Row>('select * from funding_certification_items where id = $1 and certification_id = $2', [itemId, cert.id]))
      ?? ctx.fail(404, 'not_found', 'Item not found.');
  }

  app.patch('/api/funding-certifications/:id/items/:itemId', { preHandler: edit }, async (req) => {
    const cert = await needCert(req);
    draftOnly(cert);
    const item = await needItem(req, cert);
    const data = await itemInput((req.body ?? {}) as Row, false);
    // A changed statement or applicability needs confirming again.
    if (('statement' in data && data.statement !== item.statement) || ('applies' in data && data.applies !== item.applies)) {
      data.confirmed_by = null; data.confirmed_on = null;
    }
    const cols = Object.keys(data);
    if (!cols.length) return item;
    const row = (await db.one<Row>(
      `update funding_certification_items set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${cols.length + 2}
       where id = $1 returning *`, [item.id, ...cols.map((c) => data[c]), req.user!.id]))!;
    const before: Row = {};
    for (const c of cols) before[c] = item[c];
    await ctx.audit(req, {
      action: 'funding_certification.item_update', recordType: 'funding_certification', recordId: cert.id,
      summary: `Item changed on ${cert.ref}: ${String(row.statement).slice(0, 120)}`, before, after: data,
    });
    return row;
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/funding-certifications/:id/items/:itemId', tag: 'Funding', permission: 'funding.edit',
    summary: 'Change an item of a draft certification (a changed statement or applicability needs confirming again)',
    body: '{ statement?, category?, applies?, responsible_id?, obligation_id?, note?, sort? }', response: 'the item',
  });

  app.delete('/api/funding-certifications/:id/items/:itemId', { preHandler: edit }, async (req) => {
    const cert = await needCert(req);
    draftOnly(cert);
    const item = await needItem(req, cert);
    await db.query('delete from funding_certification_items where id = $1', [item.id]);
    await ctx.audit(req, {
      action: 'funding_certification.item_remove', recordType: 'funding_certification', recordId: cert.id,
      summary: `Item removed from ${cert.ref}: ${String(item.statement).slice(0, 120)}`,
      before: Object.fromEntries(ITEM_FIELDS.map((f) => [f, item[f]])),
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/funding-certifications/:id/items/:itemId', tag: 'Funding', permission: 'funding.edit',
    summary: 'Remove an item from a draft certification', response: '{ ok }',
  });

  // Confirming: the person responsible for the item, or anyone who may edit funding records.
  app.post('/api/funding-certifications/:id/items/:itemId/confirm', { preHandler: view }, async (req) => {
    const cert = await needCert(req);
    draftOnly(cert);
    const item = await needItem(req, cert);
    if (item.responsible_id !== req.user!.id && !ctx.can(req.user, 'funding.edit')) {
      ctx.fail(403, 'forbidden', 'Only the person responsible for this item, or someone who may edit funding records, can confirm it.');
    }
    const b = (req.body ?? {}) as Row;
    const confirmed = b.confirmed !== false;
    if (confirmed && !item.applies) ctx.fail(409, 'not_applicable', 'This item is marked as not applying, so there is nothing to confirm.');
    const note = 'note' in b ? cleanText(b.note, 2000) : item.note;
    const row = (await db.one<Row>(
      `update funding_certification_items set confirmed_by = $2, confirmed_on = $3, note = $4, updated_at = now(), updated_by = $5 where id = $1 returning *`,
      [item.id, confirmed ? req.user!.id : null, confirmed ? todayInZone() : null, note, req.user!.id]))!;
    await ctx.audit(req, {
      action: confirmed ? 'funding_certification.item_confirm' : 'funding_certification.item_unconfirm',
      recordType: 'funding_certification', recordId: cert.id,
      summary: `${confirmed ? 'Confirmed' : 'Confirmation withdrawn'} on ${cert.ref}: ${String(item.statement).slice(0, 120)}`,
      after: { item: item.id, note },
    });
    return row;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/funding-certifications/:id/items/:itemId/confirm', tag: 'Funding', permission: 'funding.view',
    summary: 'Confirm an item (or withdraw a confirmation with confirmed: false): the person responsible for it, or someone with funding.edit',
    body: '{ confirmed?: boolean, note?: string }', response: 'the item',
  });

  app.post('/api/funding-certifications/:id/sign-request', { preHandler: edit }, async (req, reply) => {
    const cert = await needCert(req);
    if (cert.status !== 'draft') ctx.fail(409, 'not_draft', 'Only a draft certification can be sent for signing.');
    if (!cert.signer_id) invalid({ signer_id: 'Name the authorized official who signs.' });
    const progress = await signingProblems(ctx, cert.id);
    if (!progress.applicable) ctx.fail(409, 'empty', 'Add the statements being certified before asking for a signature.');
    if (progress.missing.length) {
      ctx.fail(409, 'unconfirmed', `${progress.missing.length} applicable item${progress.missing.length === 1 ? ' is' : 's are'} not confirmed yet. Every applicable item must be confirmed by its owner before signing.`);
    }
    const eng = engine();
    if (!eng) ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available on this installation.');
    if (await eng!.running(CERT_KIND, cert.id)) ctx.fail(409, 'already_requested', 'This certification is already waiting for its signature.');
    const note = cleanText(((req.body ?? {}) as Row).note, 2000);
    const started = await eng!.start(CERT_KIND, cert, { requester: req.user!.id, req, note, data: { year: cert.year } });
    if (!started) ctx.fail(409, 'no_workflow', 'No active sign-off workflow applies. An administrator can set one up under Administration > Approval workflows.');
    await ctx.resources.update('funding_certification', cert.id, { status: 'in_review' }, null);
    await ctx.audit(req, {
      action: 'funding_certification.sign_request', recordType: 'funding_certification', recordId: cert.id,
      summary: `${cert.ref} sent to the authorized official for signing`, after: { workflow: started!.name, note },
    });
    reply.code(201);
    const latest = await eng!.latest(CERT_KIND, cert.id);
    return { instance_id: started!.id, workflow: started!.name, status: latest?.status ?? started!.status };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/funding-certifications/:id/sign-request', tag: 'Funding', permission: 'funding.edit',
    summary: 'Send a draft certification to its authorized official for signing (every applicable item must be confirmed)',
    body: '{ note?: string }', response: '{ instance_id, workflow, status }',
  });

  app.get('/api/funding-certifications/:id/sign-request', { preHandler: view }, async (req) => {
    const cert = await needCert(req);
    const eng = engine();
    const latest = eng ? await eng.latest(CERT_KIND, cert.id) : null;
    const progress = await signingProblems(ctx, cert.id);
    return {
      available: Boolean(eng && (await eng.definitions(CERT_KIND)).length),
      applicable: progress.applicable, confirmed: progress.confirmed,
      request: latest ? { id: latest.id, workflow: latest.name, status: latest.status, started_at: latest.startedAt, finished_at: latest.finishedAt } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/funding-certifications/:id/sign-request', tag: 'Funding', permission: 'funding.view',
    summary: 'The newest sign-off request of a certification, and whether one can be made',
    response: '{ available, applicable, confirmed, request: { id, workflow, status, started_at, finished_at } | null }',
  });

  app.post('/api/funding-certifications/:id/copy-forward', { preHandler: ctx.requirePerm('funding.create') }, async (req, reply) => {
    const cert = await needCert(req);
    const year = Number(((req.body ?? {}) as Row).year ?? Number(cert.year) + 1);
    if (!Number.isInteger(year) || year <= Number(cert.year) || year > Number(cert.year) + 5) invalid({ year: 'Choose a later year (at most five years on).' });
    const { row, created } = await copyForward(ctx, cert, year, req);
    reply.code(created ? 201 : 200);
    return { id: row.id, ref: row.ref, created };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/funding-certifications/:id/copy-forward', tag: 'Funding', permission: 'funding.create',
    summary: 'Make next year\'s draft from a certification (its items, unconfirmed); answers the one already there if it exists',
    body: '{ year?: number }', response: '{ id, ref, created }',
  });

  app.get('/api/funding/settings', { preHandler: view }, async () => ({
    certification_month: Number(await ctx.settings.get(CERT_MONTH_SETTING, DEFAULT_CERT_MONTH)),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/funding/settings', tag: 'Funding', permission: 'funding.view',
    summary: 'Funding settings: the month from which next year\'s certification drafts are made', response: '{ certification_month: 1..12 }',
  });

  app.put('/api/funding/settings', { preHandler: ctx.requirePerm('funding.administer') }, async (req) => {
    const month = Number(((req.body ?? {}) as Row).certification_month);
    if (!Number.isInteger(month) || month < 1 || month > 12) invalid({ certification_month: 'Choose a month from 1 (January) to 12 (December).' });
    await ctx.settings.set(CERT_MONTH_SETTING, month, req);
    return { certification_month: month };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/funding/settings', tag: 'Funding', permission: 'funding.administer',
    summary: 'Change the month from which next year\'s certification drafts are made', body: '{ certification_month: 1..12 }', response: '{ certification_month }',
  });

  app.post('/api/funding/certifications/rollover/run', { preHandler: ctx.requirePerm('funding.administer') }, async () => runCertificationRollover(ctx));
  ctx.describeRoute({
    method: 'POST', path: '/api/funding/certifications/rollover/run', tag: 'Funding', permission: 'funding.administer',
    summary: 'Make the coming year\'s certification drafts now (also runs every day)', response: '{ year, created }',
  });

  await scheduleWork(ctx, 'funding.certification_rollover', () => runCertificationRollover(ctx), { every: 24 * 3_600_000, firstRunInMs: 120_000 });
}
