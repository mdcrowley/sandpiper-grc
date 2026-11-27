import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { ensureDefaultQuestionSet, latestAssessment, registerAssessments } from './assessments.ts';
import { ANONYMIZED_TEXT, onAnonymize } from '../../core/retention.ts';
import { CLAUSE_STATUSES, contractChecklist, DEFAULT_CLAUSES, registerSecurityTerms, saveClauseCheck, worstStatus } from './clauses.ts';
import { addDays, daysBetween, localDate, noticeDate } from './dates.ts';
import {
  CLOSED_CONTRACT_STATUSES, DEFAULT_EVIDENCE_REMINDER_DAYS, DEFAULT_REMINDER_DAYS, EVIDENCE_REMINDER_SETTING,
  evidenceThresholds, parseThresholds, REMINDER_SETTING, reminderThresholds, runContractReminders, runEvidenceReminders,
} from './reminders.ts';
import { ensureIssueLists, registerIssues } from './issues.ts';
import {
  activationBlock, cadence, ensureLifecycleLists, nextDue, recomputeAll, registerLifecycle, runLifecycleReminders,
} from './lifecycle.ts';
import { checksBlock, ensureIntake, registerIntake } from './intake.ts';
import { registerPerformance } from './performance.ts';
import { endedStatuses, ensureOffboardingLists, registerOffboarding, startEndedContracts, startForContract } from './offboarding.ts';
import { seedVendors } from './seed.ts';
import { refreshAllSpend, refreshVendorSpend, registerSpend, annualValueOf } from './spend.ts';

export { runContractReminders, runEvidenceReminders } from './reminders.ts';

/** The daily lifecycle work (job `vendors.lifecycle`). */
export async function runLifecycle(ctx: ModuleContext, now: Date = new Date()) {
  const recomputed = await recomputeAll(ctx);
  const reminders = await runLifecycleReminders(ctx, now);
  const offboardings = await startEndedContracts(ctx, now);
  return { recomputed, ...reminders, offboardings };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
      { value: 'acknowledgement', label: 'Acknowledgment of approval only', sort: 70 },
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
      // meta.ended: the contract is over, which starts its offboarding (E35-04).
      { value: 'expired', label: 'Expired', color: 'amber', sort: 40, meta: { ended: true } },
      { value: 'terminated', label: 'Ended', color: 'gray', sort: 50, meta: { ended: true } },
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
    if ((await ctx.settings.get<unknown>(EVIDENCE_REMINDER_SETTING, null)) === null) {
      await ctx.settings.set(EVIDENCE_REMINDER_SETTING, DEFAULT_EVIDENCE_REMINDER_DAYS);
    }
    await ensureDefaultQuestionSet(ctx);
    // The vendor risk lifecycle (E35): exclusion lists, issues, offboarding, reassessment months.
    await ensureLifecycleLists(ctx);
    await ensureIssueLists(ctx);
    await ensureOffboardingLists(ctx);
    // Intake with risk tiers and required checks (E41-10).
    await ensureIntake(ctx);
    // Annual values and spend (E45-43): worked out again at every start (a new year, deleted contracts).
    await refreshAllSpend(ctx);
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
        owner_id: { label: 'Vendor owner', type: 'user' },
        // The lifecycle (E35): worked out by the application.
        last_assessed_on: { label: 'Last assessed on', type: 'date', readOnly: true },
        next_assessment_due: { label: 'Next assessment due', type: 'date', readOnly: true },
        last_exclusion_check_on: { label: 'Last exclusion-list check', type: 'date', readOnly: true },
        // Set by the latest intake questionnaire (E41-10).
        risk_tier: { label: 'Risk tier', type: 'lookup', list: 'vendor_risk_tier', readOnly: true },
        risk_tier_on: { label: 'Risk tier set on', type: 'date', readOnly: true },
        // The sum of its active contracts' annual values (E45-43, spend.ts).
        annual_spend: { label: 'Annual spend', type: 'currency', readOnly: true },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          if (await vendorNameTaken(data.name)) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { name: 'A vendor with this name already exists.' });
          }
          data.next_assessment_due = nextDue((await cadence(ctx)).get(data.criticality) ?? null, data.last_assessed_on ?? null, localDate());
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          if (patch.name !== undefined && await vendorNameTaken(patch.name, existing.id)) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { name: 'A vendor with this name already exists.' });
          }
          // A new criticality brings a new cadence (E35-01).
          if (patch.criticality !== undefined && patch.criticality !== existing.criticality && patch.next_assessment_due === undefined) {
            const added = existing.created_at ? localDate(new Date(existing.created_at)) : localDate();
            patch.next_assessment_due = nextDue((await cadence(ctx)).get(patch.criticality) ?? null, existing.last_assessed_on ?? null, added);
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
      // A value below zero would distort the contract value reports and dashboards (BW-10).
      if (merged.total_value !== null && merged.total_value !== undefined && Number(merged.total_value) < 0) {
        fields.total_value = 'Enter zero or more.';
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
        // Worked out from the value by year, or the total value over the term (E45-43, spend.ts).
        annual_value: { label: 'Annual value', type: 'currency', readOnly: true },
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
        beforeCreate: async (req, data) => {
          if (!(await ctx.resources.find('vendor', data.vendor_id))) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { vendor_id: 'Vendor not found.' });
          }
          checkContractNumbers(data);
          await checkActivation(req, data.vendor_id, (data.status ?? 'active') === 'active');
          data.notice_date = noticeDate(data.end_date, data.notice_days);
          data.annual_value = annualValueOf(data);
          return data;
        },
        beforeUpdate: async (req, existing, patch) => {
          if (patch.vendor_id && patch.vendor_id !== existing.vendor_id && !(await ctx.resources.find('vendor', patch.vendor_id))) {
            ctx.fail(400, 'validation', 'Check the highlighted fields.', { vendor_id: 'Vendor not found.' });
          }
          const merged = { ...existing, ...patch };
          checkContractNumbers(merged);
          // Becoming active, or an active contract moving to another vendor (W23 F3): the new vendor's
          // exclusion-list check and intake checks must allow it, as when a contract is made active.
          const moved = patch.vendor_id !== undefined && String(patch.vendor_id) !== String(existing.vendor_id);
          if (patch.status === 'active' && existing.status !== 'active') await checkActivation(req, merged.vendor_id, true);
          else if (moved && merged.status === 'active') await checkActivation(req, merged.vendor_id, true, 'vendor_id');
          patch.notice_date = noticeDate(merged.end_date, merged.notice_days);
          patch.annual_value = annualValueOf(merged);
          return patch;
        },
        // A contract that moves to an ended status starts the vendor's offboarding (E35-04), once.
        afterUpdate: async (req, before, after) => {
          // A contract moved to another vendor leaves the first vendor's spend (E45-43).
          if (before.vendor_id !== after.vendor_id) await refreshVendorSpend(ctx, [before.vendor_id]);
          if (after.status === before.status || !ctx.resources.get('vendor_offboarding')) return;
          if (!(await endedStatuses(ctx)).includes(after.status)) return;
          await startForContract(ctx, after, after.status === 'terminated' ? 'terminated' : 'contract_ended', req);
        },
      },
    });

    /**
     * A person may make a contract active (or move an active contract to another vendor, W23 F3) only after an exclusion-list check while that setting is on
     * (E35-02), and only once every check the vendor's risk tier needs is done or waived (E41-10).
     */
    async function checkActivation(req: FastifyRequest | null, vendorId: string, activating: boolean, field: 'status' | 'vendor_id' = 'status') {
      if (!req || !activating) return; // system work (imports of the register, samples) is not held up
      const block = (await activationBlock(ctx, vendorId)) ?? (await checksBlock(ctx, vendorId));
      if (block) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: block });
    }

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
        ? await db.query<Row>(
          'select id, ref, title, notice_date, end_date, status, renewal_mechanism from contracts where vendor_id = $1 and deleted_at is null', [vendor.id])
        : [];
      const open = contracts.filter((c) => !CLOSED_CONTRACT_STATUSES.includes(c.status));
      const upcoming = open.map((c) => c.notice_date).filter((d): d is string => !!d && d >= today).sort();
      const passed = open.map((c) => c.notice_date).filter((d): d is string => !!d && d < today).sort();
      const nextContract = upcoming[0] ? open.find((c) => c.notice_date === upcoming[0]) : undefined;
      // E18-75: a passed notice date on a contract still open is the most urgent state; the latest one is the headline.
      const lastPassed = passed[passed.length - 1];
      const passedContract = lastPassed ? open.find((c) => c.notice_date === lastPassed) : undefined;
      const brief = (c: Row) => ({ id: c.id, ref: c.ref, title: c.title, renewal_mechanism: c.renewal_mechanism, end_date: c.end_date });
      const incidentContacts = await db.query<Row>(
        `select name, role, email, phone from vendor_contacts
         where vendor_id = $1 and deleted_at is null and is_incident_contact order by name`, [vendor.id],
      );
      const clauses = seesContracts
        ? await db.query<Row>(
          `select k.clause_key, k.status from clause_checks k join contracts c on c.id = k.scope_id and k.set_key = 'security_terms' and k.scope_type = 'contract' and k.deleted_at is null
           where c.vendor_id = $1 and c.deleted_at is null`, [vendor.id])
        : [];
      const clauseKeys = (await ctx.lookups.values('contract_clause')).map((c) => c.value);
      const terms = { present: 0, partial: 0, absent: 0, not_assessed: 0 };
      for (const key of clauseKeys) {
        const worst = worstStatus(clauses.filter((c) => c.clause_key === key).map((c) => c.status));
        terms[worst ?? 'not_assessed'] += 1;
      }
      const evidence = await db.query<Row>(
        'select expires_on, received_on from evidence_items where vendor_id = $1 and deleted_at is null', [vendor.id],
      );
      const received = evidence.map((e) => e.received_on).filter((d): d is string => !!d).sort();
      const soon = addDays(today, 90);
      let systems: number | null = null;
      const sys = ctx.resources.get('system');
      if (sys?.fields.vendor_id && ctx.can(req.user, `${sys.module}.view`) && sys.restricted !== true) {
        // A figure: every system counts, the same for everyone who may see systems (docs/security.md, "Figures").
        systems = (await db.one<{ c: number }>(
          `select count(*)::int c from ${sys.table} where vendor_id = $1 and deleted_at is null`, [vendor.id],
        ))!.c;
      }
      return {
        today,
        sees_contracts: seesContracts,
        contracts: contracts.length,
        contracts_open: open.length,
        contracts_undated: open.filter((c) => !c.notice_date).length,
        next_notice_date: upcoming[0] ?? null,
        next_notice_contract: nextContract ? brief(nextContract) : null,
        notice_dates_passed: passed.length,
        last_passed_notice_date: lastPassed ?? null,
        last_passed_contract: passedContract ? brief(passedContract) : null,
        terms,
        incident_contacts: incidentContacts,
        evidence_latest_received: received[received.length - 1] ?? null,
        evidence_current: evidence.filter((e) => !e.expires_on || e.expires_on >= today).length,
        assessment: await latestAssessment(ctx, vendor.id),
        evidence: evidence.length,
        evidence_expired: evidence.filter((e) => e.expires_on && e.expires_on < today).length,
        evidence_expiring: evidence.filter((e) => e.expires_on && e.expires_on >= today && e.expires_on <= soon).length,
        systems,
      };
    });

    // ---------- vendor overview (for the list: contracts, next notice date, terms coverage) ----------

    ctx.app.get('/api/vendors/overview', { preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
      if (!ctx.can(req.user, 'contracts.view')) return { today: localDate(), vendors: {} };
      const today = localDate();
      const clauseKeys = (await ctx.lookups.values('contract_clause')).map((c) => c.value);
      const contracts = await db.query<Row>(
        `select id, vendor_id, notice_date, status from contracts where deleted_at is null`,
      );
      const checks = await db.query<Row>(
        `select c.vendor_id, k.clause_key, k.status from clause_checks k join contracts c on c.id = k.scope_id and k.set_key = 'security_terms' and k.scope_type = 'contract' and k.deleted_at is null
         where c.deleted_at is null and (c.status is null or c.status <> 'terminated')`,
      );
      const vendors: Record<string, unknown> = {};
      const byVendor = new Map<string, Row[]>();
      for (const c of contracts) byVendor.set(c.vendor_id, [...(byVendor.get(c.vendor_id) ?? []), c]);
      const checksByVendor = new Map<string, Row[]>();
      for (const k of checks) checksByVendor.set(k.vendor_id, [...(checksByVendor.get(k.vendor_id) ?? []), k]);
      for (const [vendorId, list] of byVendor) {
        const open = list.filter((c) => !CLOSED_CONTRACT_STATUSES.includes(c.status));
        const dates = open.map((c) => c.notice_date).filter((d): d is string => !!d).sort();
        const terms = { present: 0, partial: 0, absent: 0, not_assessed: 0 };
        const mine = checksByVendor.get(vendorId) ?? [];
        for (const key of clauseKeys) {
          terms[worstStatus(mine.filter((k) => k.clause_key === key).map((k) => k.status)) ?? 'not_assessed'] += 1;
        }
        vendors[vendorId] = {
          contracts: list.length,
          // The nearest date still to come, or else the most recent one that has passed.
          notice_date: dates.find((d) => d >= today) ?? dates[dates.length - 1] ?? null,
          terms,
        };
      }
      return { today, vendors };
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

    // Sets one status on many clauses at once: by default only those not yet assessed.
    ctx.app.post('/api/contracts/:id/clauses/bulk', { preHandler: ctx.requirePerm('contracts.edit') }, async (req) => {
      const contract = await needContract(req);
      const b = (req.body ?? {}) as Row;
      const allowed = (await ctx.lookups.values('clause_status')).map((v) => v.value);
      if (typeof b.status !== 'string' || !allowed.includes(b.status)) {
        ctx.fail(400, 'validation', 'Choose a status to apply.', { status: 'Choose a status to apply.' });
      }
      const everything = b.scope === 'all';
      let changed = 0;
      for (const row of await contractChecklist(ctx, contract.id)) {
        if (!everything && row.status !== null) continue;
        if ((await saveClauseCheck(ctx, req, contract, row.clause_key, { status: b.status })).changed) changed += 1;
      }
      return { changed, clauses: await contractChecklist(ctx, contract.id) };
    });

    ctx.app.get('/api/vendors/terms-matrix',{ preHandler: ctx.requirePerm('vendors.view') }, async (req) => {
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
         from clause_checks k join contracts c on c.id = k.scope_id and k.set_key = 'security_terms' and k.scope_type = 'contract' and k.deleted_at is null
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
          reminders: reminderStates(c, thresholds, reminders, today),
        };
      });
      return {
        today, thresholds,
        contracts,
        undated: rows.filter((c) => !c.notice_date).map(decorate),
        can_administer: ctx.can(req.user, 'contracts.administer'),
      };
    });

    function reminderStates(c: Row, thresholds: number[], reminders: Row[], today: string) {
      return thresholds.map((t) => {
        const dueOn = addDays(c.notice_date, -t);
        const r = reminders.find((x) => x.contract_id === c.id && Number(x.threshold_days) === t && x.due_on === dueOn);
        return {
          threshold_days: t, due_on: dueOn, fired_at: r?.fired_at ?? null, superseded: r?.superseded ?? false,
          state: r?.fired_at ? (r.superseded ? 'superseded' : 'fired') : today >= dueOn ? 'due' : 'scheduled',
        };
      });
    }

    // The reminders of one contract, for its own page.
    ctx.app.get('/api/contracts/:id/reminders', { preHandler: ctx.requirePerm('contracts.view') }, async (req) => {
      const contract = await needContract(req);
      const today = localDate();
      const thresholds = await reminderThresholds(ctx);
      const closed = CLOSED_CONTRACT_STATUSES.includes(contract.status);
      const reminders = contract.notice_date && !closed
        ? reminderStates(contract, thresholds, await db.query<Row>(
          'select contract_id, threshold_days, due_on, fired_at, superseded from contract_reminders where contract_id = $1', [contract.id]), today)
        : [];
      return { today, thresholds, closed, reminders };
    });

    // ---------- contracts whose dates are incomplete ----------

    // Open contracts that cannot be placed on the calendar properly: no end date (unless the
    // contract runs until ended), or no notice period.
    ctx.app.get('/api/contracts/missing-dates', { preHandler: ctx.requirePerm('contracts.view') }, async (req) => {
      const seesVendors = ctx.can(req.user, 'vendors.view');
      const renewals = await lookupMap('contract_renewal');
      const rows = await db.query<Row>(
        `select c.id, c.ref, c.title, c.vendor_id, v.name as vendor_name, c.status, c.renewal_mechanism,
                c.start_date, c.end_date, c.notice_days, c.notice_date, c.term, c.owner_id, u.display_name as owner_name,
                c.term_and_renewal, c.date_and_resolution, c.document_on_file
         from contracts c
         left join vendors v on v.id = c.vendor_id
         left join users u on u.id = c.owner_id
         where c.deleted_at is null and (c.status is null or c.status <> all($1::text[]))
           and ((c.end_date is null and coalesce(c.renewal_mechanism, '') <> 'evergreen') or c.notice_days is null)
         order by (c.end_date is null) desc, c.end_date, c.title`,
        [CLOSED_CONTRACT_STATUSES],
      );
      return {
        today: localDate(),
        rows: rows.map((c) => ({
          ...c,
          vendor_name: seesVendors ? c.vendor_name : null,
          renewal_label: renewals.get(c.renewal_mechanism)?.label ?? c.renewal_mechanism,
          missing: [
            ...(c.end_date === null && c.renewal_mechanism !== 'evergreen' ? ['end_date'] : []),
            ...(c.notice_days === null ? ['notice_days'] : []),
          ],
        })),
      };
    });

    // ---------- reminder settings ----------

    ctx.app.get('/api/contracts/reminder-settings', { preHandler: ctx.requirePerm('contracts.view') }, async (req) => ({
      contract_days: await reminderThresholds(ctx),
      evidence_days: await evidenceThresholds(ctx),
      can_edit: ctx.can(req.user, 'contracts.administer'),
      delivered: ctx.app.hasDecorator('notify'),
    }));

    ctx.app.route({ method: ['PUT', 'PATCH'], url: '/api/contracts/reminder-settings', preHandler: ctx.requirePerm('contracts.administer'), handler: async (req) => {
      const b = (req.body ?? {}) as Row;
      const fields: Record<string, string> = {};
      const next: Record<string, number[]> = {};
      for (const key of ['contract_days', 'evidence_days']) {
        if (b[key] === undefined) continue;
        const parsed = parseThresholds(b[key]);
        if ('error' in parsed) fields[key] = parsed.error;
        else next[key] = parsed.days;
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const same = (a: number[], c: number[]) => a.join(',') === c.join(',');
      if (next.contract_days && !same(next.contract_days, await reminderThresholds(ctx))) {
        await ctx.settings.set(REMINDER_SETTING, next.contract_days, req);
      }
      if (next.evidence_days && !same(next.evidence_days, await evidenceThresholds(ctx))) {
        await ctx.settings.set(EVIDENCE_REMINDER_SETTING, next.evidence_days, req);
      }
      return {
        contract_days: await reminderThresholds(ctx), evidence_days: await evidenceThresholds(ctx),
        can_edit: true, delivered: ctx.app.hasDecorator('notify'),
      };
    } });

    // ---------- assessments ----------

    await registerAssessments(ctx);

    // ---------- the vendor risk lifecycle (E35) ----------

    registerSecurityTerms(ctx);
    registerLifecycle(ctx);
    registerIssues(ctx);
    registerOffboarding(ctx);
    registerIntake(ctx);        // E41-10
    registerPerformance(ctx);   // E41-11
    // Anonymizing a vendor at the end of its retention period also clears its contacts and the people
    // and notes of its exclusion-list checks.
    onAnonymize('vendor', async (tx, id) => {
      await tx.query('update vendor_contacts set name = $2, email = null, phone = null, role = null where vendor_id = $1', [id, ANONYMIZED_TEXT]);
      await tx.query('update vendor_exclusion_checks set checked_by = null, note = case when note is null then null else $2 end where vendor_id = $1', [id, ANONYMIZED_TEXT]);
      await tx.query('update vendor_checks set recorded_by = null, created_by = null, updated_by = null, note = case when note is null then null else $2 end where vendor_id = $1', [id, ANONYMIZED_TEXT]);
      await tx.query('update vendor_intakes set completed_by = null, created_by = null, updated_by = null, notes = case when notes is null then null else $2 end where vendor_id = $1', [id, ANONYMIZED_TEXT]);
    });
    // And a contract's performance comments and who recorded them (E41-11).
    onAnonymize('contract', async (tx, id) => {
      await tx.query('update contract_scores set recorded_by = null, created_by = null, updated_by = null, comment = case when comment is null then null else $2 end where contract_id = $1', [id, ANONYMIZED_TEXT]);
    });

    // ---------- reminders, hourly on the job queue (Administration > Background jobs) ----------

    await scheduleWork(ctx, 'vendors.contract_reminders', async () => ({ fired: (await runContractReminders(ctx)).length }), { every: HOUR, firstRunInMs: 60_000 });
    await scheduleWork(ctx, 'vendors.evidence_reminders', async () => ({ fired: (await runEvidenceReminders(ctx)).length }), { every: HOUR, firstRunInMs: 70_000 });
    // Every six hours: annual values and spend (E45-43); a contract's save also works them out.
    registerSpend(ctx);
    await scheduleWork(ctx, 'vendors.spend', async () => refreshAllSpend(ctx), { every: 6 * HOUR, firstRunInMs: 100_000 });
    // Daily: reassessment and exclusion-check reminders, offboardings for contracts whose end date passed.
    await scheduleWork(ctx, 'vendors.lifecycle', async () => runLifecycle(ctx), { every: DAY, firstRunInMs: 90_000 });
  },

  seed: (ctx: ModuleContext, opts) => seedVendors(ctx, opts),
};

export default mod;
