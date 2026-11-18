import type { FastifyRequest } from 'fastify';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { CLAUSE_STATUSES, contractChecklist, DEFAULT_CLAUSES, saveClauseCheck, worstStatus } from './clauses.ts';
import { addDays, daysBetween, localDate, noticeDate } from './dates.ts';
import {
  CLOSED_CONTRACT_STATUSES, DEFAULT_REMINDER_DAYS, REMINDER_SETTING, reminderThresholds, runContractReminders,
} from './reminders.ts';
import { seedVendors } from './seed.ts';

export { runContractReminders } from './reminders.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOUR = 60 * 60 * 1000;

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const mod: ModuleDef = {
  key: 'vendors',

  async seedDefaults(ctx) {
    await ctx.lookups.ensure('vendor_criticality', [
      { value: 'critical', label: 'Critical', color: 'red', sort: 10 },
      { value: 'high', label: 'High', color: 'amber', sort: 20 },
      { value: 'medium', label: 'Medium', color: 'blue', sort: 30 },
      { value: 'low', label: 'Low', color: 'gray', sort: 40 },
    ], { module: 'vendors' });
    await ctx.lookups.ensure('vendor_status', [
      { value: 'active', label: 'Active', color: 'green', sort: 10 },
      { value: 'prospective', label: 'Prospective', color: 'blue', sort: 20 },
      { value: 'former', label: 'Former', color: 'gray', sort: 30 },
    ], { module: 'vendors' });
    await ctx.lookups.ensure('contract_document_type', [
      { value: 'agreement', label: 'Agreement', sort: 10 },
      { value: 'master_agreement', label: 'Master agreement', sort: 20 },
      { value: 'order_form', label: 'Order form or quote', sort: 30 },
      { value: 'statement_of_work', label: 'Statement of work', sort: 40 },
      { value: 'amendment', label: 'Amendment', sort: 50 },
      { value: 'renewal', label: 'Renewal', sort: 60 },
      { value: 'acknowledgement', label: 'Acknowledgement of approval only', sort: 70 },
      { value: 'data_agreement', label: 'Data protection agreement', sort: 80 },
      { value: 'none_on_file', label: 'Nothing on file', color: 'red', sort: 90 },
      { value: 'other', label: 'Other', sort: 100 },
    ], { module: 'contracts' });
    await ctx.lookups.ensure('contract_renewal', [
      { value: 'auto_renew', label: 'Renews automatically', color: 'amber', sort: 10 },
      { value: 'fixed', label: 'Fixed term', color: 'blue', sort: 20 },
      { value: 'option', label: 'Option to extend', color: 'teal', sort: 30 },
      { value: 'evergreen', label: 'Runs until ended', color: 'purple', sort: 40 },
      { value: 'unknown', label: 'Not known', color: 'gray', sort: 50 },
    ], { module: 'contracts' });
    await ctx.lookups.ensure('contract_status', [
      { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
      { value: 'active', label: 'Active', color: 'green', sort: 20 },
      { value: 'not_on_file', label: 'Not on file', color: 'red', sort: 30 },
      { value: 'expired', label: 'Expired', color: 'amber', sort: 40 },
      { value: 'terminated', label: 'Ended', color: 'gray', sort: 50 },
    ], { module: 'contracts' });
    await ctx.lookups.ensure('contract_clause', DEFAULT_CLAUSES, { module: 'contracts' });
    await ctx.lookups.ensure('clause_status', CLAUSE_STATUSES, { module: 'contracts' });
    await ctx.lookups.ensure('evidence_type', [
      { value: 'assurance_report', label: 'Assurance report', color: 'blue', sort: 10 },
      { value: 'insurance_certificate', label: 'Insurance certificate', color: 'teal', sort: 20 },
      { value: 'card_data_attestation', label: 'Card-data attestation', color: 'purple', sort: 30 },
      { value: 'questionnaire', label: 'Questionnaire', color: 'amber', sort: 40 },
      { value: 'other', label: 'Other', color: 'gray', sort: 50 },
    ], { module: 'vendors' });
    if ((await ctx.settings.get<unknown>(REMINDER_SETTING, null)) === null) {
      await ctx.settings.set(REMINDER_SETTING, DEFAULT_REMINDER_DAYS);
    }
  },

  async register(ctx) {
    const { db } = ctx;

    async function vendorNameTaken(name: unknown, exceptId?: string): Promise<boolean> {
      const n = text(name);
      if (!n) return false;
      const row = await db.one<Row>(
        'select id from vendors where lower(name) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)',
        [n, exceptId ?? null],
      );
      return !!row;
    }

    // ---------- vendor ----------

    ctx.defineResource({
      type: 'vendor', table: 'vendors', module: 'vendors', label: 'Vendor', plural: 'Vendors',
      path: '/api/vendors', route: '/vendors', titleField: 'name', ref: { field: 'ref', prefix: 'VND-' },
      searchable: ['name', 'services', 'notes'],
      defaultSort: { field: 'name', dir: 'asc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        services: { label: 'Services', type: 'longtext' },
        criticality: { label: 'Criticality', type: 'lookup', list: 'vendor_criticality' },
        status: { label: 'Status', type: 'lookup', list: 'vendor_status', default: 'active' },
        remote_access_method: { label: 'Remote access method', type: 'text' },
        incident_contact_name: { label: 'Incident contact', type: 'text' },
        incident_contact_email: { label: 'Incident contact email', type: 'text' },
        incident_contact_phone: { label: 'Incident contact phone', type: 'text' },
        notes: { label: 'Notes', type: 'longtext' },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          if (await vendorNameTaken(data.name)) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { name: 'A vendor with this name already exists.' });
          }
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          if (patch.name !== undefined && await vendorNameTaken(patch.name, existing.id)) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { name: 'A vendor with this name already exists.' });
          }
          return patch;
        },
      },
    });

    // ---------- contract ----------

    function checkContractNumbers(merged: Row) {
      const fields: Record<string, string> = {};
      const nd = merged.notice_days;
      if (nd !== null && nd !== undefined && (!Number.isInteger(Number(nd)) || Number(nd) < 0 || Number(nd) > 3650)) {
        fields.notice_days = 'Notice period must be a whole number of days.';
      }
      if (merged.start_date && merged.end_date && String(merged.end_date) < String(merged.start_date)) {
        fields.end_date = 'End date cannot be before the start date.';
      }
      if (merged.value_by_year !== null && merged.value_by_year !== undefined) {
        const v = merged.value_by_year;
        const ok = typeof v === 'object' && !Array.isArray(v)
          && Object.entries(v as Row).every(([k, n]) => /^\d{4}$/.test(k) && typeof n === 'number' && Number.isFinite(n));
        if (!ok) fields.value_by_year = 'Value by year must list a year and an amount on each line.';
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    }

    ctx.defineResource({
      type: 'contract', table: 'contracts', module: 'contracts', label: 'Contract', plural: 'Contracts',
      path: '/api/contracts', route: '/contracts', titleField: 'title', ref: { field: 'ref', prefix: 'CON-' },
      searchable: ['title', 'parties', 'resolution_number', 'notes', 'document_on_file', 'term_and_renewal'],
      defaultSort: { field: 'notice_date', dir: 'asc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', required: true },
        status: { label: 'Status', type: 'lookup', list: 'contract_status', default: 'active' },
        document_type: { label: 'Document type', type: 'lookup', list: 'contract_document_type' },
        parties: { label: 'Parties', type: 'text' },
        start_date: { label: 'Start date', type: 'date' },
        end_date: { label: 'End date', type: 'date' },
        term: { label: 'Term', type: 'text' },
        renewal_mechanism: { label: 'Renewal', type: 'lookup', list: 'contract_renewal', default: 'unknown' },
        notice_days: { label: 'Notice period (days)', type: 'number' },
        notice_date: { label: 'Notice date', type: 'date', readOnly: true },
        total_value: { label: 'Total value', type: 'currency' },
        value_by_year: { label: 'Value by year', type: 'json' },
        resolution_number: { label: 'Approval or resolution number', type: 'text' },
        owner_id: { label: 'Owner', type: 'user' },
        document_on_file: { label: 'Document on file', type: 'longtext' },
        date_and_resolution: { label: 'Date and resolution (as recorded)', type: 'longtext' },
        term_and_renewal: { label: 'Term and renewal (as recorded)', type: 'longtext' },
        value_text: { label: 'Value (as recorded)', type: 'longtext' },
        hosting: { label: 'Hosting', type: 'longtext' },
        terms_not_on_file: { label: 'Terms not on file', type: 'longtext' },
        notes: { label: 'Notes', type: 'longtext' },
        import_key: { label: 'Import key', type: 'text', readOnly: true },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          if (!(await ctx.resources.find('vendor', data.vendor_id))) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { vendor_id: 'Vendor not found.' });
          }
          checkContractNumbers(data);
          data.notice_date = noticeDate(data.end_date, data.notice_days);
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          if (patch.vendor_id && patch.vendor_id !== existing.vendor_id && !(await ctx.resources.find('vendor', patch.vendor_id))) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { vendor_id: 'Vendor not found.' });
          }
          const merged = { ...existing, ...patch };
          checkContractNumbers(merged);
          patch.notice_date = noticeDate(merged.end_date, merged.notice_days);
          return patch;
        },
      },
    });

    // ---------- evidence ----------

    ctx.defineResource({
      type: 'evidence_item', table: 'evidence_items', module: 'vendors', label: 'Evidence item', plural: 'Evidence',
      path: '/api/evidence', route: '/evidence', titleField: 'title',
      searchable: ['title', 'note'],
      defaultSort: { field: 'expires_on', dir: 'asc' },
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', required: true },
        contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
        type: { label: 'Type', type: 'lookup', list: 'evidence_type', default: 'other' },
        received_on: { label: 'Received on', type: 'date' },
        expires_on: { label: 'Expires on', type: 'date' },
        note: { label: 'Note', type: 'longtext' },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          await checkEvidenceRefs(data);
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          await checkEvidenceRefs({ ...existing, ...patch });
          return patch;
        },
      },
    });

    async function checkEvidenceRefs(merged: Row) {
      const fields: Record<string, string> = {};
      if (!(await ctx.resources.find('vendor', merged.vendor_id))) fields.vendor_id = 'Vendor not found.';
      if (merged.contract_id) {
        const contract = await ctx.resources.find('contract', merged.contract_id);
        if (!contract) fields.contract_id = 'Contract not found.';
        else if (contract.vendor_id !== merged.vendor_id) fields.contract_id = 'This contract belongs to a different vendor.';
      }
      if (merged.received_on && merged.expires_on && String(merged.expires_on) < String(merged.received_on)) {
        fields.expires_on = 'Expiry cannot be before the date received.';
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    }

    // ---------- helpers for hand-written routes ----------

    async function needVendor(req: FastifyRequest): Promise<Row> {
      const id = (req.params as Row).id;
      return (await ctx.resources.find('vendor', id, req.user)) ?? ctx.fail(404, 'not_found', 'Vendor not found.');
    }
    async function needContract(req: FastifyRequest): Promise<Row> {
      const id = (req.params as Row).id;
      return (await ctx.resources.find('contract', id, req.user)) ?? ctx.fail(404, 'not_found', 'Contract not found.');
    }
    const lookupMap = async (list: string) => new Map((await ctx.lookups.values(list)).map((v) => [v.value, v]));

    // ---------- vendor contacts ----------

    function contactInput(body: Row, mode: 'create' | 'update'): Row {
      const out: Row = {};
      const fields: Record<string, string> = {};
      for (const k of ['name', 'role', 'email', 'phone']) {
        if (body[k] !== undefined) out[k] = text(body[k]);
      }
      if (body.is_incident_contact !== undefined) {
        if (typeof body.is_incident_contact !== 'boolean') fields.is_incident_contact = 'Incident contact must be yes or no.';
        else out.is_incident_contact = body.is_incident_contact;
      }
      if ((mode === 'create' || 'name' in out) && !out.name) fields.name = 'Name is required.';
      if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) fields.email = 'Enter a full email address.';
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      return out;
    }
    const contactView = (r: Row) => ({
      id: r.id, vendor_id: r.vendor_id, name: r.name, role: r.role, email: r.email, phone: r.phone,
      is_incident_contact: r.is_incident_contact, updated_at: r.updated_at,
    });

    ctx.app.get('/api/vendors/:id/contacts', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
      const vendor = await needVendor(req);
      const rows = await db.query<Row>(
        'select * from vendor_contacts where vendor_id = $1 and deleted_at is null order by is_incident_contact desc, name', [vendor.id],
      );
      return rows.map(contactView);
    });

    ctx.app.post('/api/vendors/:id/contacts', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
      const vendor = await needVendor(req);
      const data = contactInput((req.body ?? {}) as Row, 'create');
      const row = (await db.one<Row>(
        `insert into vendor_contacts (vendor_id, name, role, email, phone, is_incident_contact, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$7) returning *`,
        [vendor.id, data.name, data.role ?? null, data.email ?? null, data.phone ?? null, data.is_incident_contact ?? false, req.user!.id],
      ))!;
      await ctx.audit(req, {
        action: 'vendor.contact_add', recordType: 'vendor', recordId: vendor.id,
        summary: `Contact added to ${vendor.name}: ${row.name}`, after: contactView(row),
      });
      reply.code(201);
      return contactView(row);
    });

    async function needContact(vendor: Row, contactId: string): Promise<Row> {
      const row = UUID.test(contactId)
        ? await db.one<Row>('select * from vendor_contacts where id = $1 and vendor_id = $2 and deleted_at is null', [contactId, vendor.id])
        : undefined;
      return row ?? ctx.fail(404, 'not_found', 'Contact not found.');
    }

    ctx.app.patch('/api/vendors/:id/contacts/:contactId', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
      const vendor = await needVendor(req);
      const existing = await needContact(vendor, (req.params as Row).contactId);
      const data = contactInput((req.body ?? {}) as Row, 'update');
      const before: Row = {};
      const after: Row = {};
      for (const [k, v] of Object.entries(data)) {
        if ((existing[k] ?? null) !== (v ?? null)) { before[k] = existing[k]; after[k] = v; }
      }
      if (!Object.keys(after).length) return contactView(existing);
      const merged = { ...existing, ...after };
      const row = (await db.one<Row>(
        `update vendor_contacts set name = $2, role = $3, email = $4, phone = $5, is_incident_contact = $6,
           updated_at = now(), updated_by = $7 where id = $1 returning *`,
        [existing.id, merged.name, merged.role, merged.email, merged.phone, merged.is_incident_contact, req.user!.id],
      ))!;
      await ctx.audit(req, {
        action: 'vendor.contact_update', recordType: 'vendor', recordId: vendor.id,
        summary: `Contact updated on ${vendor.name}: ${row.name}`, before, after,
      });
      return contactView(row);
    });

    ctx.app.delete('/api/vendors/:id/contacts/:contactId', { preHandler: ctx.requirePerm('vendors.edit') }, async (req) => {
      const vendor = await needVendor(req);
      const existing = await needContact(vendor, (req.params as Row).contactId);
      await db.query('update vendor_contacts set deleted_at = now(), updated_by = $2 where id = $1', [existing.id, req.user!.id]);
      await ctx.audit(req, {
        action: 'vendor.contact_remove', recordType: 'vendor', recordId: vendor.id,
        summary: `Contact removed from ${vendor.name}: ${existing.name}`, before: contactView(existing),
      });
      return { ok: true };
    });

    // ---------- vendor summary ----------

    ctx.app.get('/api/vendors/:id/summary', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
      const vendor = await needVendor(req);
      const today = localDate();
      const seesContracts = ctx.can(req.user, 'contracts.view');
      const contracts = seesContracts
        ? await db.query<Row>('select id, notice_date, end_date, status from contracts where vendor_id = $1 and deleted_at is null', [vendor.id])
        : [];
      const open = contracts.filter((c) => !CLOSED_CONTRACT_STATUSES.includes(c.status));
      const upcoming = open.map((c) => c.notice_date).filter((d): d is string => !!d && d >= today).sort();
      const passed = open.map((c) => c.notice_date).filter((d): d is string => !!d && d < today).sort();
      const clauses = seesContracts
        ? await db.query<Row>(
          `select k.clause_key, k.status from contract_clause_checks k join contracts c on c.id = k.contract_id
           where c.vendor_id = $1 and c.deleted_at is null`, [vendor.id])
        : [];
      const clauseKeys = (await ctx.lookups.values('contract_clause')).map((c) => c.value);
      const terms = { present: 0, partial: 0, absent: 0, not_assessed: 0 };
      for (const key of clauseKeys) {
        const worst = worstStatus(clauses.filter((c) => c.clause_key === key).map((c) => c.status));
        terms[worst ?? 'not_assessed'] += 1;
      }
      const evidence = await db.query<Row>(
        'select expires_on from evidence_items where vendor_id = $1 and deleted_at is null', [vendor.id],
      );
      const soon = addDays(today, 90);
      let systems: number | null = null;
      const sys = ctx.resources.get('system');
      if (sys?.fields.vendor_id && ctx.can(req.user, `${sys.module}.view`) && sys.restricted !== true) {
        const flag = sys.restricted === 'flag' && !ctx.can(req.user, 'security.view') ? 'and coalesce(restricted, false) = false' : '';
        systems = (await db.one<{ c: number }>(
          `select count(*)::int c from ${sys.table} where vendor_id = $1 and deleted_at is null ${flag}`, [vendor.id],
        ))!.c;
      }
      return {
        today,
        contracts: contracts.length,
        next_notice_date: upcoming[0] ?? null,
        notice_dates_passed: passed.length,
        terms,
        evidence: evidence.length,
        evidence_expired: evidence.filter((e) => e.expires_on && e.expires_on < today).length,
        evidence_expiring: evidence.filter((e) => e.expires_on && e.expires_on >= today && e.expires_on <= soon).length,
        systems,
      };
    });

    // ---------- security terms ----------

    ctx.app.get('/api/contracts/:id/clauses', { preHandler: ctx.requirePerm('contracts.view') }, async (req) => {
      const contract = await needContract(req);
      return contractChecklist(ctx, contract.id);
    });

    ctx.app.route({
      method: ['PUT', 'PATCH'],
      url: '/api/contracts/:id/clauses/:key',
      preHandler: ctx.requirePerm('contracts.edit'),
      handler: async (req) => {
        const contract = await needContract(req);
        const key = String((req.params as Row).key);
        const b = (req.body ?? {}) as Row;
        await saveClauseCheck(ctx, req, contract, key, { status: b.status, clause_text: b.clause_text, note: b.note });
        return (await contractChecklist(ctx, contract.id)).find((c) => c.clause_key === key);
      },
    });

    ctx.app.get('/api/vendors/terms-matrix', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
      if (!ctx.can(req.user, 'contracts.view')) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
      const wanted = String((req.query as Row).criticality ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const crit = await lookupMap('vendor_criticality');
      const clauses = (await ctx.lookups.values('contract_clause')).map((c) => ({
        key: c.value, label: c.label, description: (c.meta as Row | undefined)?.description ?? null,
      }));
      const vendors = await db.query<Row>(
        `select v.id, v.ref, v.name, v.criticality,
                (select count(*)::int from contracts c where c.vendor_id = v.id and c.deleted_at is null) as contracts
         from vendors v
         where v.deleted_at is null and ($1::text[] is null or v.criticality = any($1::text[]))`,
        [wanted.length ? wanted : null],
      );
      const checks = await db.query<Row>(
        `select c.vendor_id, c.id as contract_id, c.ref as contract_ref, c.title as contract_title,
                k.clause_key, k.status, k.clause_text, k.note
         from contract_clause_checks k join contracts c on c.id = k.contract_id
         where c.deleted_at is null and (c.status is null or c.status <> 'terminated')
         order by c.ref`,
      );
      const order = (v: Row) => crit.get(v.criticality)?.sort ?? 1e6;
      vendors.sort((a, b) => order(a) - order(b) || String(a.name).localeCompare(String(b.name)));
      return {
        clauses,
        vendors: vendors.map((v) => {
          const mine = checks.filter((k) => k.vendor_id === v.id);
          const cells: Record<string, unknown> = {};
          for (const cl of clauses) {
            const items = mine.filter((k) => k.clause_key === cl.key);
            cells[cl.key] = {
              status: worstStatus(items.map((i) => i.status)),
              items: items.map((i) => ({
                contract_id: i.contract_id, contract_ref: i.contract_ref, contract_title: i.contract_title,
                status: i.status, clause_text: i.clause_text, note: i.note,
              })),
            };
          }
          return {
            id: v.id, ref: v.ref, name: v.name, criticality: v.criticality,
            criticality_label: crit.get(v.criticality)?.label ?? null,
            criticality_color: crit.get(v.criticality)?.color ?? 'gray',
            contracts: v.contracts, cells,
          };
        }),
      };
    });

    // ---------- evidence expiring ----------

    ctx.app.get('/api/vendors/evidence-expiring', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
      const raw = Number((req.query as Row).days);
      const days = Number.isFinite(raw) && raw >= 0 ? Math.min(3650, Math.trunc(raw)) : 90;
      const today = localDate();
      const types = await lookupMap('evidence_type');
      const rows = await db.query<Row>(
        `select e.id, e.title, e.type, e.vendor_id, e.contract_id, e.received_on, e.expires_on, e.note, v.name as vendor_name
         from evidence_items e join vendors v on v.id = e.vendor_id
         where e.deleted_at is null and v.deleted_at is null and e.expires_on is not null and e.expires_on <= $1::date
         order by e.expires_on, e.title`,
        [addDays(today, days)],
      );
      return {
        today, days,
        rows: rows.map((r) => ({
          ...r,
          type_label: types.get(r.type)?.label ?? r.type,
          type_color: types.get(r.type)?.color ?? 'gray',
          days_left: daysBetween(today, r.expires_on),
          expired: r.expires_on < today,
        })),
      };
    });

    // ---------- renewal calendar ----------

    ctx.app.get('/api/contracts/renewals', { preHandler: ctx.requirePerm('contracts.view') }, async (req) => {
      const today = localDate();
      const seesVendors = ctx.can(req.user, 'vendors.view');
      const thresholds = await reminderThresholds(ctx);
      const statuses = await lookupMap('contract_status');
      const renewals = await lookupMap('contract_renewal');
      const rows = await db.query<Row>(
        `select c.id, c.ref, c.title, c.vendor_id, v.name as vendor_name, c.status, c.renewal_mechanism,
                c.start_date, c.end_date, c.notice_days, c.notice_date, c.total_value, c.owner_id,
                u.display_name as owner_name, c.term_and_renewal
         from contracts c
         left join vendors v on v.id = c.vendor_id
         left join users u on u.id = c.owner_id
         where c.deleted_at is null and (c.status is null or c.status <> all($1::text[]))
         order by c.notice_date nulls last, c.title`,
        [CLOSED_CONTRACT_STATUSES],
      );
      const reminders = await db.query<Row>('select contract_id, threshold_days, due_on, fired_at, superseded from contract_reminders');
      const ascending = [...thresholds].sort((a, b) => a - b);
      const decorate = (c: Row) => ({
        ...c,
        // Vendor names need vendors.view, as they do everywhere else.
        vendor_name: seesVendors ? c.vendor_name : null,
        status_label: statuses.get(c.status)?.label ?? c.status,
        status_color: statuses.get(c.status)?.color ?? 'gray',
        renewal_label: renewals.get(c.renewal_mechanism)?.label ?? c.renewal_mechanism,
      });
      const contracts = rows.filter((c) => c.notice_date).map((c) => {
        const left = daysBetween(today, c.notice_date);
        const window = left < 0 ? 'passed' : String(ascending.find((t) => left <= t) ?? 'later');
        return {
          ...decorate(c),
          days_to_notice: left,
          window,
          reminders: thresholds.map((t) => {
            const dueOn = addDays(c.notice_date, -t);
            const r = reminders.find((x) => x.contract_id === c.id && Number(x.threshold_days) === t && x.due_on === dueOn);
            return {
              threshold_days: t, due_on: dueOn, fired_at: r?.fired_at ?? null, superseded: r?.superseded ?? false,
              state: r?.fired_at ? (r.superseded ? 'superseded' : 'fired') : today >= dueOn ? 'due' : 'scheduled',
            };
          }),
        };
      });
      return {
        today, thresholds,
        contracts,
        undated: rows.filter((c) => !c.notice_date).map(decorate),
      };
    });

    // ---------- reminder timer ----------

    const safeRun = async () => {
      try {
        await runContractReminders(ctx);
      } catch (err) {
        console.error('[vendors] renewal reminders failed:', (err as Error).message);
      }
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    ctx.app.addHook('onReady', async () => {
      await safeRun();
      timer = setInterval(safeRun, HOUR);
      timer.unref();
    });
    ctx.app.addHook('onClose', async () => {
      if (timer) clearInterval(timer);
    });
  },

  seed: (ctx: ModuleContext, opts) => seedVendors(ctx, opts),
};

export default mod;
