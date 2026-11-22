// Offboarding a vendor when a contract ends (E35-04): a checklist built from the inventory (accounts
// and remote access on the systems the vendor supplies, assets to return, data to get back or have
// destroyed) plus the organization's own template items, worked through item by item and signed off.
// It starts by itself when a contract moves to an ended status, or nightly when a contract's end date
// passes with no renewal; it can also be started by hand. Signing off goes through the approval kind
// `vendor_offboarding` when an approval workflow of that kind is active, otherwise it needs
// `vendors.approve`.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';
import { notePermission } from '../../core/permission-use.ts';
import { ANONYMIZED_TEXT, onAnonymize } from '../../core/retention.ts';
import { addDays, localDate } from './dates.ts';

export const OFFBOARDING_KIND = 'vendor_offboarding';
/** Days from the start of an offboarding to its due date. */
export const OFFBOARDING_DAYS = 30;
/** The nightly start looks back this far for end dates that passed. */
const LOOK_BACK_DAYS = 30;
/** Contract statuses that end a contract, when the list carries no `meta.ended`. */
export const ENDED_FALLBACK = ['expired', 'terminated'];
/** Renewal mechanisms that keep a contract going after its end date. */
const RENEWS = ['auto_renew', 'evergreen'];

export const ITEM_KINDS: LookupValue[] = [
  { value: 'account_access', label: 'Accounts and access', color: 'blue', sort: 10 },
  { value: 'remote_access', label: 'Remote access', color: 'red', sort: 20 },
  { value: 'data_return', label: 'Data returned or destroyed', color: 'purple', sort: 30 },
  { value: 'data_destruction', label: 'Data destruction', color: 'purple', sort: 40 },
  { value: 'asset_return', label: 'Assets returned', color: 'teal', sort: 50 },
  { value: 'other', label: 'Other', color: 'gray', sort: 60 },
];

export async function ensureOffboardingLists(ctx: ModuleContext): Promise<void> {
  const own = { module: 'vendors' };
  await ctx.lookups.ensure('offboarding_trigger', [
    { value: 'contract_ended', label: 'Contract ended', color: 'gray', sort: 10 },
    { value: 'terminated', label: 'Contract terminated', color: 'red', sort: 20 },
    { value: 'vendor_exit', label: 'Vendor leaving', color: 'amber', sort: 30 },
    { value: 'manual', label: 'Started by hand', color: 'blue', sort: 40 },
  ], own);
  await ctx.lookups.ensure('offboarding_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'amber', sort: 20 },
    { value: 'signed_off', label: 'Signed off', color: 'green', sort: 30, meta: { closed: true } },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 40, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('offboarding_item_kind', ITEM_KINDS, own);
  await ctx.lookups.ensure('offboarding_item_status', [
    { value: 'to_do', label: 'To do', color: 'amber', sort: 10 },
    { value: 'done', label: 'Done', color: 'green', sort: 20 },
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', sort: 30 },
  ], own);
  // The organization's own items added to every offboarding (meta.kind picks the group).
  await ctx.lookups.ensure('offboarding_item_template', [
    { value: 'badges', label: 'Collect building access badges and keys issued to the vendor\'s staff', sort: 10, meta: { kind: 'other' } },
    { value: 'shared_secrets', label: 'Change shared passwords and keys the vendor knew', sort: 20, meta: { kind: 'account_access' } },
    { value: 'contacts', label: 'Remove the vendor from contact, on-call and escalation lists', sort: 30, meta: { kind: 'other' } },
    { value: 'final_invoice', label: 'Settle the final invoice and close open purchase orders', sort: 40, meta: { kind: 'other' } },
  ], own);
}

/** Contract status values that mean the contract has ended. */
export async function endedStatuses(ctx: ModuleContext): Promise<string[]> {
  const values = await ctx.lookups.values('contract_status');
  const flagged = values.filter((v) => (v.meta as Row | undefined)?.ended).map((v) => v.value);
  return flagged.length ? flagged : ENDED_FALLBACK;
}

async function notify(ctx: ModuleContext, input: Row): Promise<number> {
  if (!ctx.app.hasDecorator('notify')) return 0;
  return (await (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify(input)).sent;
}

/**
 * Adds the checklist items an offboarding needs and does not have yet: never twice for the same record
 * and kind, never removing anything. Answers how many it added.
 */
export async function buildItems(ctx: ModuleContext, offboardingId: string, by: string | null = null): Promise<number> {
  const { db } = ctx;
  const ob = await db.one<Row>('select * from vendor_offboardings where id = $1', [offboardingId]);
  if (!ob) return 0;
  const vendor = await db.one<Row>('select id, name, remote_access_method from vendors where id = $1', [ob.vendor_id]);
  if (!vendor) return 0;
  const wanted: { kind: string; record_type: string | null; record_id: string | null; item: string }[] = [];
  const vendorRemote = Boolean(String(vendor.remote_access_method ?? '').trim());

  const sys = ctx.resources.get('system');
  const systems = sys?.fields.vendor_id
    ? await db.query<Row>(
      `select * from ${sys!.table} where deleted_at is null and (vendor_id = $1${sys!.fields.contract_id ? ' or ($2::uuid is not null and contract_id = $2::uuid)' : ''}) order by ${sys!.titleField}`,
      sys!.fields.contract_id ? [ob.vendor_id, ob.contract_id ?? null] : [ob.vendor_id])
    : [];
  // OT security adds the vendor's remote access to each system (contract C2), when that is installed.
  const otField = Boolean(sys?.fields.vendor_remote_access);
  let remoteItems = 0;
  for (const s of systems) {
    const name = [s.ref, s[sys!.titleField]].filter(Boolean).join(' ');
    wanted.push({ kind: 'account_access', record_type: 'system', record_id: s.id, item: `Remove ${vendor.name}'s accounts and access to ${name}` });
    const viaOt = otField && s.vendor_remote_access && s.vendor_remote_access !== 'none';
    if (viaOt || vendorRemote) {
      wanted.push({ kind: 'remote_access', record_type: 'system', record_id: s.id, item: `End ${vendor.name}'s remote access to ${name}` });
      remoteItems += 1;
    }
  }
  if (vendorRemote && !remoteItems) {
    wanted.push({ kind: 'remote_access', record_type: 'vendor', record_id: vendor.id, item: `End ${vendor.name}'s remote access (${String(vendor.remote_access_method).trim().slice(0, 120)})` });
  }

  const asset = ctx.resources.get('asset');
  if (asset?.fields.vendor_id) {
    const assets = await db.query<Row>(
      `select * from ${asset.table} where deleted_at is null${asset.fields.status ? ` and coalesce(status, '') <> 'disposed'` : ''}
         and (vendor_id = $1${asset.fields.contract_id ? ' or ($2::uuid is not null and contract_id = $2::uuid)' : ''}) order by ${asset.titleField}`,
      asset.fields.contract_id ? [ob.vendor_id, ob.contract_id ?? null] : [ob.vendor_id]);
    for (const a of assets) {
      wanted.push({ kind: 'asset_return', record_type: 'asset', record_id: a.id, item: `Return or collect ${[a.tag, a[asset.titleField]].filter(Boolean).join(' ')}` });
    }
  }

  const cat = ctx.resources.get('data_category');
  if (cat && systems.length && (await db.one<Row>("select to_regclass('system_data_categories')::text as t"))?.t) {
    const cats = await db.query<Row>(
      `select distinct d.id, d.name from system_data_categories sd join ${cat.table} d on d.id = sd.data_category_id and d.deleted_at is null
       where sd.system_id = any($1::uuid[]) order by d.name`, [systems.map((s) => s.id)]);
    for (const d of cats) {
      wanted.push({ kind: 'data_return', record_type: 'data_category', record_id: d.id, item: `Get ${d.name} back from ${vendor.name}, or have it destroyed and keep the certificate` });
    }
  }

  for (const t of await ctx.lookups.values('offboarding_item_template')) {
    const kind = String((t.meta as Row | undefined)?.kind ?? 'other');
    wanted.push({ kind: ITEM_KINDS.some((k) => k.value === kind) ? kind : 'other', record_type: null, record_id: null, item: t.label });
  }

  let sort = Number((await db.one<Row>('select coalesce(max(sort), 0)::int as s from vendor_offboarding_items where offboarding_id = $1', [ob.id]))?.s ?? 0);
  let added = 0;
  for (const w of wanted) {
    sort += 10;
    const row = await db.one<Row>(
      `insert into vendor_offboarding_items (offboarding_id, kind, record_type, record_id, item, sort, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7) on conflict do nothing returning id`,
      [ob.id, w.kind, w.record_type, w.record_id, w.item.slice(0, 500), sort, by]);
    if (row) added += 1;
  }
  return added;
}

/** Starts an offboarding for a contract that ended, once per contract (claimed on the contract first). */
export async function startForContract(ctx: ModuleContext, contract: Row, trigger: string, req: FastifyRequest | null): Promise<Row | null> {
  const claimed = await ctx.db.one(
    'update contracts set offboarding_started_on = $2::date where id = $1 and offboarding_started_on is null returning id', [contract.id, localDate()]);
  if (!claimed) return null;
  if (await ctx.db.one(`select 1 from vendor_offboardings where contract_id = $1 and deleted_at is null and status <> 'canceled'`, [contract.id])) return null;
  const row = await ctx.resources.create('vendor_offboarding', {
    vendor_id: contract.vendor_id, contract_id: contract.id, trigger, due_on: addDays(localDate(), OFFBOARDING_DAYS),
    owner_id: contract.owner_id ?? null, status: 'open',
  }, req ?? undefined);
  return row;
}

/** Nightly: contracts whose end date passed in the last days with no renewal get an offboarding. */
export async function startEndedContracts(ctx: ModuleContext, now: Date = new Date()): Promise<number> {
  const today = localDate(now);
  const ended = await endedStatuses(ctx);
  const rows = await ctx.db.query<Row>(
    `select * from contracts where deleted_at is null and offboarding_started_on is null
       and end_date is not null and end_date < $1::date and end_date >= $2::date
       and coalesce(renewal_mechanism, '') <> all($3::text[])
       and coalesce(status, '') <> all($4::text[]) and coalesce(status, '') <> 'draft'`,
    [today, addDays(today, -LOOK_BACK_DAYS), RENEWS, ended]);
  let started = 0;
  for (const c of rows) if (await startForContract(ctx, c, 'contract_ended', null)) started += 1;
  return started;
}

export function registerOffboarding(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const engine = () => approvalEngine(app);
  notePermission('vendors.approve');

  ctx.defineResource({
    type: 'vendor_offboarding', table: 'vendor_offboardings', module: 'vendors', label: 'Vendor offboarding', plural: 'Vendor offboardings',
    path: '/api/vendor-offboardings', route: '/vendors/offboardings', titleField: 'ref', ref: { field: 'ref', prefix: 'OFB-' },
    searchable: ['ref', 'notes'],
    defaultSort: { field: 'due_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', required: true },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
      trigger: { label: 'Started because', type: 'lookup', list: 'offboarding_trigger', default: 'manual' },
      status: { label: 'Status', type: 'lookup', list: 'offboarding_status', default: 'open' },
      owner_id: { label: 'Owner', type: 'user' },
      due_on: { label: 'Due', type: 'date' },
      signed_off_on: { label: 'Signed off on', type: 'date', readOnly: true },
      signed_off_by_name: { label: 'Signed off by', type: 'text', readOnly: true, personal: true },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: async (req, data) => {
        const fields: Record<string, string> = {};
        if (!(await ctx.resources.find('vendor', data.vendor_id))) fields.vendor_id = 'Vendor not found.';
        if (data.contract_id) {
          const c = await ctx.resources.find('contract', data.contract_id);
          if (!c) fields.contract_id = 'Contract not found.';
          else if (c.vendor_id !== data.vendor_id) fields.contract_id = 'This contract belongs to a different vendor.';
          else if (await db.one(`select 1 from vendor_offboardings where contract_id = $1 and deleted_at is null and coalesce(status, '') <> 'canceled'`, [c.id])) {
            fields.contract_id = 'This contract already has an offboarding.';
          }
        }
        if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
        if (req && data.status && data.status !== 'open') data.status = 'open'; // people start it open; signing off has its own route
        if (!data.due_on) data.due_on = addDays(localDate(), OFFBOARDING_DAYS);
        return data;
      },
      beforeUpdate: async (req, existing, patch) => {
        if (req && patch.status === 'signed_off' && existing.status !== 'signed_off') {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'Use "Sign off" on the checklist: every item must be done or not applicable first.' });
        }
        if (req && existing.status === 'signed_off' && patch.status !== undefined && patch.status !== 'signed_off') {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { status: 'A signed-off offboarding cannot be reopened. Start a new one instead.' });
        }
        return patch;
      },
      afterCreate: async (req, row) => {
        await buildItems(ctx, row.id, req?.user?.id ?? null);
        if (row.owner_id && row.owner_id !== req?.user?.id) {
          const vendor = await db.one<Row>('select name from vendors where id = $1', [row.vendor_id]);
          await notify(ctx, {
            userIds: [row.owner_id], kind: 'assignment', recordType: 'vendor_offboarding', recordId: row.id,
            title: `Offboard ${vendor?.name ?? 'a vendor'}: ${row.ref}`, body: `Work through the checklist by ${row.due_on}.`,
            route: `/vendors/offboardings/${row.id}`,
          });
        }
      },
    },
  });

  // ---------- the approval kind ----------

  async function signOff(ob: Row, byName: string, req: FastifyRequest | null): Promise<void> {
    await ctx.resources.update('vendor_offboarding', ob.id, { status: 'signed_off', signed_off_on: localDate(), signed_off_by_name: byName.slice(0, 200) });
    await ctx.audit(req, {
      action: 'vendor_offboarding.sign_off', recordType: 'vendor_offboarding', recordId: ob.id,
      summary: `Offboarding ${ob.ref} signed off by ${byName}`, after: { signed_off_by_name: byName },
    });
  }

  defineApprovalKind(app, {
    key: OFFBOARDING_KIND, recordType: 'vendor_offboarding', label: 'Vendor offboarding sign-off',
    startsWhen: 'Someone signs off a vendor offboarding whose checklist items are all done or not applicable',
    outcome: 'Approved: the offboarding is signed off with the approver\'s name and the date; rejected: it stays in progress, with the reason in its history',
    approverPermission: 'vendors.approve',
    route: (id) => `/vendors/offboardings/${id}`,
    async onFinish(e) {
      if (e.outcome === 'canceled') return;
      const ob = await db.one<Row>('select * from vendor_offboardings where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!ob || ob.status === 'signed_off' || ob.status === 'canceled') return;
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'vendor_offboarding.sign_off_rejected', recordType: 'vendor_offboarding', recordId: ob.id,
          summary: `Sign-off of ${ob.ref} rejected by ${e.approverName ?? 'an approver'}: ${e.comment ?? 'no reason given'}`,
          after: { workflow: e.instance.name, reason: e.comment },
        });
        return;
      }
      const open = await db.one<Row>(`select count(*)::int as n from vendor_offboarding_items where offboarding_id = $1 and status = 'to_do'`, [ob.id]);
      if (Number(open?.n ?? 0) > 0) throw new Error('Items were added to the checklist after sign-off was asked for. Finish them and ask again.');
      await signOff(ob, `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`, e.req);
    },
  });

  // ---------- items, refresh and sign-off ----------

  async function needOffboarding(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id ?? '');
    if (!UUID_RE.test(id)) ctx.fail(404, 'not_found', 'Offboarding not found.');
    return (await ctx.resources.find('vendor_offboarding', id, req.user)) ?? ctx.fail(404, 'not_found', 'Offboarding not found.');
  }
  const closed = (ob: Row) => ob.status === 'signed_off' || ob.status === 'canceled';

  /** A label for an item's record, only when the reader may see that record (otherwise a plain word). */
  async function itemsOf(ob: Row, req: FastifyRequest) {
    const rows = await db.query<Row>(
      `select i.*, i.done_on::text as done_on, u.display_name as done_by_name from vendor_offboarding_items i
       left join users u on u.id = i.done_by where i.offboarding_id = $1 order by i.sort, i.created_at`, [ob.id]);
    const out = [];
    for (const r of rows) {
      let record: Row | null = null;
      if (r.record_type && r.record_id) {
        const def = ctx.resources.get(r.record_type);
        const seen = def ? await ctx.resources.find(r.record_type, r.record_id, req.user) : undefined;
        record = seen
          ? { type: r.record_type, id: r.record_id, label: (await ctx.resources.labelFor(r.record_type, r.record_id)) ?? def!.label, route: def!.route ? `${def!.route}/${r.record_id}` : null }
          : { type: r.record_type, id: null, label: def ? `A ${def.label.toLowerCase()} you cannot open` : 'A record that is not available', route: null };
      }
      out.push({
        id: r.id, kind: r.kind, item: seenText(r, record), status: r.status, done_by_name: r.done_by_name ?? null, done_on: r.done_on,
        evidence_note: r.evidence_note, sort: r.sort, record,
      });
    }
    return out;
  }
  // The item text names the record; it is shown only when the reader may see that record.
  const seenText = (r: Row, record: Row | null) => (record && !record.id ? `${ITEM_KINDS.find((k) => k.value === r.kind)?.label ?? 'Item'}: ${record.label}` : r.item);

  async function view(ob: Row, req: FastifyRequest) {
    const items = await itemsOf(ob, req);
    const eng = engine();
    const latest = eng ? await eng.latest(OFFBOARDING_KIND, ob.id) : null;
    const workflows = eng ? (await eng.definitions(OFFBOARDING_KIND)).length : 0;
    return {
      items,
      counts: {
        total: items.length, done: items.filter((i) => i.status === 'done').length,
        not_applicable: items.filter((i) => i.status === 'not_applicable').length, to_do: items.filter((i) => i.status === 'to_do').length,
      },
      approval: {
        workflow: workflows > 0,
        running: latest?.status === 'running' ? { id: latest.id, name: latest.name } : null,
        last: latest && latest.status !== 'running' ? { name: latest.name, status: latest.status, finished_at: latest.finishedAt } : null,
      },
      can_edit: ctx.can(req.user, 'vendors.edit') && !closed(ob),
      can_sign_off: !closed(ob) && (workflows > 0 ? ctx.can(req.user, 'vendors.edit') : ctx.can(req.user, 'vendors.approve')),
    };
  }

  app.get('/api/vendor-offboardings/:id/items', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => view(await needOffboarding(req), req));
  ctx.describeRoute({
    method: 'GET', path: '/api/vendor-offboardings/:id/items', tag: 'Vendors', permission: 'vendors.view',
    summary: 'An offboarding\'s checklist: each item with its record (named only when the reader may see it), counts and where sign-off stands',
    response: '{ items: [{ id, kind, item, status, done_by_name, done_on, evidence_note, record: { type, id, label, route } | null }], counts: { total, done, not_applicable, to_do }, approval: { workflow, running, last }, can_edit, can_sign_off }',
  });

  app.post('/api/vendor-offboardings/:id/items/:itemId', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
    const ob = await needOffboarding(req);
    if (closed(ob)) ctx.fail(409, 'closed', 'This offboarding is signed off or canceled, so its checklist cannot change.');
    const itemId = String((req.params as Row).itemId ?? '');
    const item = UUID_RE.test(itemId) ? await db.one<Row>('select * from vendor_offboarding_items where id = $1 and offboarding_id = $2', [itemId, ob.id]) : undefined;
    if (!item) ctx.fail(404, 'not_found', 'Checklist item not found.');
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const status = b.status === undefined ? item!.status : String(b.status);
    if (!['to_do', 'done', 'not_applicable'].includes(status)) fields.status = 'Choose to do, done or not applicable.';
    const note = b.evidence_note === undefined ? item!.evidence_note : (typeof b.evidence_note === 'string' && b.evidence_note.trim() ? b.evidence_note.trim().slice(0, 2000) : null);
    if (status === 'not_applicable' && !note) fields.evidence_note = 'Say why this item does not apply.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const done = status === 'done' || status === 'not_applicable';
    const changedStatus = status !== item!.status;
    await db.query(
      `update vendor_offboarding_items set status = $2, evidence_note = $3,
         done_by = case when $4 then (case when $5 then $6::uuid else done_by end) else null end,
         done_on = case when $4 then (case when $5 then $7::date else done_on end) else null end,
         updated_at = now(), updated_by = $6 where id = $1`,
      [item!.id, status, note, done, changedStatus, req.user!.id, localDate()]);
    if (changedStatus || note !== item!.evidence_note) {
      await ctx.audit(req, {
        action: 'vendor_offboarding.item', recordType: 'vendor_offboarding', recordId: ob.id,
        summary: `Offboarding ${ob.ref}: "${item!.item.slice(0, 120)}" ${changedStatus ? `marked ${status.replace('_', ' ')}` : 'note updated'}`,
        before: { item_id: item!.id, status: item!.status, evidence_note: item!.evidence_note }, after: { item_id: item!.id, status, evidence_note: note },
      });
    }
    if (ob.status === 'open' && changedStatus) await ctx.resources.update('vendor_offboarding', ob.id, { status: 'in_progress' });
    return view((await ctx.resources.find('vendor_offboarding', ob.id))!, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-offboardings/:id/items/:itemId', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Mark one checklist item to do, done or not applicable (which needs a note), with an evidence note; the first change moves the offboarding to In progress',
    body: '{ status?: "to_do" | "done" | "not_applicable", evidence_note?: string }', response: 'as GET /api/vendor-offboardings/:id/items',
  });

  app.post('/api/vendor-offboardings/:id/refresh-items', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
    const ob = await needOffboarding(req);
    if (closed(ob)) ctx.fail(409, 'closed', 'This offboarding is signed off or canceled, so its checklist cannot change.');
    const added = await buildItems(ctx, ob.id, req.user!.id);
    if (added) {
      await ctx.audit(req, {
        action: 'vendor_offboarding.refresh', recordType: 'vendor_offboarding', recordId: ob.id,
        summary: `Offboarding ${ob.ref}: ${added} checklist item${added === 1 ? '' : 's'} added from the inventory and the template`, after: { added },
      });
    }
    return { added, ...(await view(ob, req)) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-offboardings/:id/refresh-items', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Add checklist items for systems, remote access, assets, data categories and template items that the offboarding does not have yet (nothing is removed)',
    response: '{ added, ...as GET /api/vendor-offboardings/:id/items }',
  });

  app.post('/api/vendor-offboardings/:id/sign-off', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const ob = await needOffboarding(req);
    if (closed(ob)) ctx.fail(409, 'closed', 'This offboarding is already signed off or canceled.');
    const open = Number((await db.one<Row>(`select count(*)::int as n from vendor_offboarding_items where offboarding_id = $1 and status = 'to_do'`, [ob.id]))?.n ?? 0);
    if (open) ctx.fail(409, 'items_open', `${open} checklist item${open === 1 ? ' is' : 's are'} still to do. Mark each one done or not applicable first.`);
    const eng = engine();
    if (eng && (await eng.definitions(OFFBOARDING_KIND)).length) {
      if (await eng.running(OFFBOARDING_KIND, ob.id)) ctx.fail(409, 'already_requested', 'Sign-off of this offboarding is already waiting for approval.');
      const note = typeof (req.body as Row | undefined)?.note === 'string' ? String((req.body as Row).note).trim().slice(0, 2000) : null;
      const started = await eng.start(OFFBOARDING_KIND, ob, { requester: req.user!.id, req, note });
      if (started) {
        await ctx.audit(req, {
          action: 'vendor_offboarding.sign_off_requested', recordType: 'vendor_offboarding', recordId: ob.id,
          summary: `Sign-off of offboarding ${ob.ref} asked for through the approval workflow "${started.name}"`, after: { workflow: started.name },
        });
        reply.code(202);
        return { workflow: started.name, status: (await eng.latest(OFFBOARDING_KIND, ob.id))?.status ?? started.status, ...(await view((await ctx.resources.find('vendor_offboarding', ob.id))!, req)) };
      }
    }
    // No approval workflow applies: someone who holds the approval permission signs it off directly.
    if (!ctx.can(req.user, 'vendors.approve')) ctx.fail(403, 'forbidden', 'Signing off an offboarding needs permission to approve vendor records.');
    await signOff(ob, req.user!.displayName, req);
    return { workflow: null, status: 'signed_off', ...(await view((await ctx.resources.find('vendor_offboarding', ob.id))!, req)) };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-offboardings/:id/sign-off', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Sign off an offboarding whose items are all done or not applicable: through the Vendor offboarding sign-off approval workflow when one is active (202), otherwise directly by someone who holds vendors.approve',
    description: '409 `items_open` while an item is still to do; 409 `already_requested` while a sign-off approval is running; 403 without a workflow for someone without vendors.approve.',
    body: '{ note?: string }', response: '{ workflow: string | null, status, ...as GET /api/vendor-offboardings/:id/items }',
  });

  // Anonymizing an offboarding at the end of its retention period clears the people and notes of its items.
  onAnonymize('vendor_offboarding', async (tx, id) => tx.query(
    `update vendor_offboarding_items set done_by = null, evidence_note = case when evidence_note is null then null else $2 end where offboarding_id = $1`,
    [id, ANONYMIZED_TEXT]));
}
