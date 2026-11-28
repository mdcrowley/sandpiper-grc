// Certificates of insurance (COI-) received from vendors and contractors, and the insurance each
// contract requires (one requirement per line of coverage, with minimum limits). Each certificate is
// checked against the requirements of its contract (or, without one, of its vendor's contracts), and
// each requirement against the certificates on file: a shortfall, a missing or an expired certificate
// is flagged. The check runs whenever either changes, and daily (certificates expire by themselves).
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

export const CERTIFICATE = 'insurance_certificate';
export const REQUIREMENT = 'insurance_requirement';

const day = (v: unknown) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
/** Certificates that count: received or accepted (not asked for only, rejected or superseded). */
const ON_FILE = ['received', 'accepted'];

/** What a certificate lacks against one requirement; empty when it meets it. */
export function gapsOf(cert: Row, req: Row): string[] {
  const gaps: string[] = [];
  const minOcc = num(req.min_per_occurrence);
  const minAgg = num(req.min_aggregate);
  const occ = num(cert.limit_per_occurrence) ?? 0;
  const agg = num(cert.limit_aggregate) ?? 0;
  if (minOcc !== null && minOcc > 0 && occ < minOcc) gaps.push(`limit per occurrence ${money(occ)} is below the required ${money(minOcc)}`);
  if (minAgg !== null && minAgg > 0 && agg < minAgg) gaps.push(`aggregate limit ${money(agg)} is below the required ${money(minAgg)}`);
  if (req.additional_insured && !cert.additional_insured) gaps.push('the organization is not named as additional insured');
  if (req.waiver_of_subrogation && !cert.waiver_of_subrogation) gaps.push('there is no waiver of subrogation');
  return gaps;
}

const sentence = (parts: string[]) => (parts.length ? `${parts.join('; ').replace(/^./, (c) => c.toUpperCase())}.` : null);

export function registerCertificates(ctx: ModuleContext) {
  const { db } = ctx;
  const contractsOn = () => Boolean(ctx.resources.get('contract'));

  /**
   * Works out the check of every certificate and the state of every requirement of one vendor (or of
   * every vendor), and stores those that changed. Derived values: not audited, never asked of people.
   */
  async function recheck(vendorId: string | null | 'all', today = todayInZone()): Promise<{ certificates: number; requirements: number }> {
    if (vendorId === null) return { certificates: 0, requirements: 0 };
    const all = vendorId === 'all';
    const reqs = contractsOn() ? await db.query<Row>(
      `select r.*, k.vendor_id from insurance_requirements r join contracts k on k.id = r.contract_id
       where r.deleted_at is null and k.deleted_at is null and ($1::boolean or k.vendor_id = $2::uuid)`, [all, all ? null : vendorId]) : [];
    const certs = await db.query<Row>(
      `select c.* from insurance_certificates c where c.deleted_at is null
         and ($1::boolean or c.vendor_id = $2::uuid ${contractsOn() ? 'or c.contract_id in (select id from contracts where vendor_id = $2::uuid)' : ''})`,
      [all, all ? null : vendorId]);
    const applies = (c: Row, r: Row) => c.line === r.line && (c.contract_id ? c.contract_id === r.contract_id : Boolean(c.vendor_id) && c.vendor_id === r.vendor_id);
    const current = (c: Row) => !day(c.expires_on) || day(c.expires_on)! >= today;
    let nc = 0;
    let nr = 0;
    for (const c of certs) {
      let result: string | null = 'none';
      let notes: string | null = null;
      const mine = ON_FILE.includes(c.status) ? reqs.filter((r) => applies(c, r)) : [];
      // A certificate sent by the vendor is checked once staff accept it (E46-65).
      if (c.status === 'to_review') result = null;
      else if (!ON_FILE.includes(c.status)) result = c.check_result ?? 'none';
      else if (mine.length && !current(c)) { result = 'expired'; notes = `Expired on ${day(c.expires_on)}.`; }
      else if (mine.length) {
        const gaps = mine.flatMap((r) => gapsOf(c, r));
        result = gaps.length ? 'short' : 'meets';
        notes = sentence([...new Set(gaps)]);
      }
      if (result !== c.check_result || (notes ?? null) !== (c.check_notes ?? null)) {
        await db.query('update insurance_certificates set check_result = $2, check_notes = $3 where id = $1', [c.id, result, notes]);
        nc++;
      }
    }
    for (const r of reqs) {
      const theirs = certs.filter((c) => ON_FILE.includes(c.status) && applies(c, r));
      const live = theirs.filter(current);
      let state: string;
      let notes: string | null = null;
      if (!theirs.length) { state = 'missing'; notes = 'No certificate of insurance for this line is on file.'; }
      else if (!live.length) { state = 'expired'; notes = `The latest certificate expired on ${theirs.map((c) => day(c.expires_on)).sort().pop()}.`; }
      else if (live.some((c) => gapsOf(c, r).length === 0)) state = 'met';
      else {
        // The certificate closest to meeting it says what is missing.
        const best = [...live].sort((a, b) => gapsOf(a, r).length - gapsOf(b, r).length || (num(b.limit_per_occurrence) ?? 0) - (num(a.limit_per_occurrence) ?? 0))[0];
        state = 'short';
        notes = sentence(gapsOf(best, r));
      }
      if (state !== r.state || (notes ?? null) !== (r.state_notes ?? null)) {
        await db.query('update insurance_requirements set state = $2, state_notes = $3 where id = $1', [r.id, state, notes]);
        nr++;
      }
    }
    return { certificates: nc, requirements: nr };
  }

  /** The vendor a certificate or requirement is about. */
  async function vendorOf(row: Row): Promise<string | null> {
    if (row.vendor_id) return row.vendor_id;
    if (row.contract_id && contractsOn()) return (await db.one<Row>('select vendor_id from contracts where id = $1', [row.contract_id]))?.vendor_id ?? null;
    return null;
  }
  const recheckRows = async (...rows: Row[]) => {
    const vendors = new Set<string | null>();
    for (const r of rows) vendors.add(await vendorOf(r));
    for (const v of vendors) await recheck(v);
  };

  async function lineLabel(line: unknown): Promise<string> {
    return (await ctx.lookups.values('insurance_line')).find((v) => v.value === line)?.label ?? 'Insurance';
  }

  // ---------- what each contract requires ----------

  ctx.defineResource({
    type: REQUIREMENT, table: 'insurance_requirements', module: 'insurance', label: 'Insurance requirement', plural: 'Insurance requirements',
    path: '/api/insurance/requirements', route: '/insurance/requirements', titleField: 'title',
    searchable: ['title', 'notes'],
    defaultSort: { field: 'title', dir: 'asc' },
    fields: {
      title: { label: 'Requirement', type: 'text', required: true, help: 'Made from the line and the contract when left empty.' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract', required: true },
      line: { label: 'Line of coverage', type: 'lookup', list: 'insurance_line', required: true },
      min_per_occurrence: { label: 'Minimum per occurrence', type: 'currency' },
      min_aggregate: { label: 'Minimum aggregate', type: 'currency' },
      additional_insured: { label: 'Organization named as additional insured', type: 'boolean', default: false },
      waiver_of_subrogation: { label: 'Waiver of subrogation', type: 'boolean', default: false },
      state: { label: 'Certificates on file', type: 'lookup', list: 'insurance_requirement_state', readOnly: true },
      state_notes: { label: 'What is missing', type: 'text', readOnly: true, personal: false },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      prepare: async (_req, input, existing) => {
        if (existing || (input.title && String(input.title).trim())) return input;
        const contract = input.contract_id && contractsOn() ? await ctx.resources.labelFor('contract', String(input.contract_id)) : null;
        return { ...input, title: `${await lineLabel(input.line)}${contract ? ` for ${contract}` : ''}` };
      },
      beforeCreate: (_req, data) => amounts(data, ['min_per_occurrence', 'min_aggregate']),
      beforeUpdate: (_req, _existing, patch) => amounts(patch, ['min_per_occurrence', 'min_aggregate']),
      afterCreate: async (_req, row) => { await recheckRows(row); },
      afterUpdate: async (_req, before, after) => { await recheckRows(before, after); },
    },
  });

  function amounts(data: Row, fields: string[]): Row {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      const n = num(data[f]);
      if (n !== null && (!Number.isFinite(n) || n < 0)) errors[f] = 'Enter an amount of zero or more.';
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    return data;
  }

  // ---------- certificates received ----------

  async function certificateRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (!merged.vendor_id && !merged.contract_id && !String(merged.insured_name ?? '').trim()) errors.vendor_id = 'Choose the vendor or contract, or give the insured\'s name.';
    const from = day(merged.effective_on);
    const to = day(merged.expires_on);
    if (from && to && to < from) errors.expires_on = 'The coverage cannot end before it starts.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    amounts(merged, ['limit_per_occurrence', 'limit_aggregate']);
    if (!existing && !merged.owner_id && req?.user) patch.owner_id = actorOf(req).id;
    if (!existing && !merged.received_on && ON_FILE.includes(merged.status ?? 'received') && !isDataLoad(req)) patch.received_on = todayInZone();
    return patch;
  }

  /** A newer certificate on file for the same insured and line supersedes the older ones. */
  async function supersede(req: FastifyRequest | null, row: Row) {
    if (isDataLoad(req) || !ON_FILE.includes(row.status) || !row.line || !day(row.expires_on)) return;
    const older = await db.query<Row>(
      `select id from insurance_certificates where deleted_at is null and id <> $1 and line = $2 and status = any($3::text[])
         and expires_on < $4::date and vendor_id is not distinct from $5::uuid and contract_id is not distinct from $6::uuid`,
      [row.id, row.line, ON_FILE, day(row.expires_on), row.vendor_id ?? null, row.contract_id ?? null]);
    for (const o of older) await ctx.resources.update(CERTIFICATE, o.id, { status: 'superseded' }, null, { via: `the newer certificate ${row.ref ?? ''}`.trim() });
  }

  ctx.defineResource({
    type: CERTIFICATE, table: 'insurance_certificates', module: 'insurance', label: 'Certificate of insurance', plural: 'Certificates of insurance',
    path: '/api/insurance/certificates', route: '/insurance/certificates', titleField: 'title',
    ref: { field: 'ref', prefix: 'COI-' },
    evidence: true,
    searchable: ['title', 'insured_name', 'insurer_name', 'policy_number', 'notes'],
    defaultSort: { field: 'expires_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Certificate', type: 'text', required: true, help: 'Made from the vendor and the line when left empty.' },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', help: 'The vendor or contractor whose insurance it shows.' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract', help: 'The contract whose insurance requirements it answers.' },
      insured_name: { label: 'Insured', type: 'text', personal: false, help: 'The insured as named on the certificate, when it is not a vendor.' },
      line: { label: 'Line of coverage', type: 'lookup', list: 'insurance_line', required: true },
      insurer_name: { label: 'Insurer', type: 'text', personal: false },
      policy_number: { label: 'Policy number', type: 'text' },
      effective_on: { label: 'Coverage from', type: 'date' },
      expires_on: { label: 'Expires', type: 'date' },
      limit_per_occurrence: { label: 'Limit per occurrence', type: 'currency' },
      limit_aggregate: { label: 'Aggregate limit', type: 'currency' },
      additional_insured: { label: 'Organization named as additional insured', type: 'boolean', default: false },
      waiver_of_subrogation: { label: 'Waiver of subrogation', type: 'boolean', default: false },
      received_on: { label: 'Received', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'insurance_certificate_status', default: 'received' },
      check_result: { label: 'Against the contract', type: 'lookup', list: 'insurance_certificate_check', readOnly: true },
      check_notes: { label: 'Shortfall', type: 'text', readOnly: true, personal: false },
      owner_id: { label: 'Followed up by', type: 'user' },
      request_id: { label: 'From request', type: 'ref', to: 'insurance_certificate_request', readOnly: true, help: 'The request the vendor sent it through.' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      prepare: async (_req, raw, existing) => {
        const input = { ...raw };
        // A contract's vendor is the certificate's vendor unless one is given.
        const contract = input.contract_id ?? existing?.contract_id;
        if (!(input.vendor_id ?? existing?.vendor_id) && contract && contractsOn() && typeof contract === 'string' && /^[0-9a-f-]{36}$/i.test(contract)) {
          const v = (await db.one<Row>('select vendor_id from contracts where id = $1', [contract]))?.vendor_id;
          if (v) input.vendor_id = v;
        }
        if (existing || (input.title && String(input.title).trim())) return input;
        const who = input.vendor_id && ctx.resources.get('vendor') ? await ctx.resources.labelFor('vendor', String(input.vendor_id)) : String(input.insured_name ?? '').trim();
        return { ...input, title: `${who ? `${who}: ` : ''}${await lineLabel(input.line)}` };
      },
      beforeCreate: (req, data) => certificateRules(req, null, data),
      beforeUpdate: (req, existing, patch) => certificateRules(req, existing, patch),
      afterCreate: async (req, row) => { await supersede(req, row); await recheckRows(row); },
      afterUpdate: async (req, before, after) => {
        if (before.status !== after.status || day(before.expires_on) !== day(after.expires_on)) await supersede(req, after);
        await recheckRows(before, after);
      },
    },
  });

  // A deleted certificate or requirement changes what the others show.
  ctx.resources.onChange?.(async (change) => {
    if (change.action !== 'delete' && change.action !== 'purge') return;
    if (change.def.type !== CERTIFICATE && change.def.type !== REQUIREMENT) return;
    await recheckRows(change.row);
  });

  // ---------- one contract's requirements and the certificates answering them ----------

  ctx.app.get('/api/insurance/contracts/:id/check', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => {
    const id = String((req.params as Row).id);
    if (!contractsOn() || !(await ctx.resources.find('contract', id, req.user).catch(() => undefined))) return ctx.fail(404, 'not_found', 'Contract not found.');
    const requirements = await db.query<Row>(
      `select r.id, r.title, r.line, r.min_per_occurrence, r.min_aggregate, r.additional_insured, r.waiver_of_subrogation, r.state, r.state_notes
       from insurance_requirements r where r.contract_id = $1 and r.deleted_at is null and ${ctx.resources.visibleWhere(REQUIREMENT, req.user, 'r')} order by r.title`, [id]);
    const certificates = await db.query<Row>(
      `select c.id, c.ref, c.title, c.line, c.status, c.expires_on::text as expires_on, c.limit_per_occurrence, c.limit_aggregate, c.check_result, c.check_notes
       from insurance_certificates c where c.deleted_at is null and ${ctx.resources.visibleWhere(CERTIFICATE, req.user, 'c')}
         and (c.contract_id = $1 or (c.contract_id is null and c.vendor_id = (select vendor_id from contracts where id = $1)))
       order by c.expires_on desc nulls last`, [id]);
    // Requests to the vendor for certificates (E46-65), newest first.
    const requests = await db.query<Row>(
      `select q.id, q.ref, q.title, q.status, q.email, q.needed_by::text as needed_by, q.sent_at, q.link_expires_at, q.submitted_at, q.certificates
       from insurance_certificate_requests q where q.deleted_at is null and ${ctx.resources.visibleWhere('insurance_certificate_request', req.user, 'q')}
         and (q.contract_id = $1 or (q.contract_id is null and q.vendor_id = (select vendor_id from contracts where id = $1)))
       order by q.created_at desc limit 20`, [id]);
    return { requirements, certificates, requests };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/contracts/:id/check', tag: 'Insurance', permission: 'insurance.view',
    summary: 'The insurance one contract requires, each with its state against the certificates on file, those certificates, and the requests to the vendor for certificates',
    response: '{ requirements: [{ id, title, line, min_per_occurrence, min_aggregate, additional_insured, waiver_of_subrogation, state, state_notes }], certificates: [...], requests: [{ id, ref, title, status, email, needed_by, sent_at, link_expires_at, submitted_at, certificates }] }',
  });

  return { recheck };
}

export type CertificateChecks = ReturnType<typeof registerCertificates>;
