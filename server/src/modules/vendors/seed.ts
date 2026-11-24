import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENCY } from '../../core/config.ts';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { seedIntake } from './seed-intake.ts';
import { seedLifecycle } from './seed-lifecycle.ts';
import { classifyClauseText, saveClauseCheck } from './clauses.ts';
import { addDays, localDate } from './dates.ts';

export const SEED_FILE = 'vendor_contracts.psv';
/** Marks the one contract per vendor that the register import owns, so a re-import updates it. */
export const REGISTER_KEY = 'contract-register';

// Column headers of the contract register export.
const H = {
  vendor: 'Vendor',
  service: 'Service',
  criticality: 'Criticality (proposed)',
  document: 'Document on file',
  dateResolution: 'Date and resolution',
  term: 'Term and renewal',
  value: 'Value',
  hosting: 'Hosting',
  notOnFile: 'Terms not on file',
  action: 'Action',
} as const;

/** Register column -> clause key. Clauses with no column stay "not assessed". */
const CLAUSE_COLUMNS: Record<string, string> = {
  'Data ownership and return': 'data_ownership',
  'Named security standard': 'security_standard',
  'Breach notice': 'breach_notice',
  'Service levels and recovery': 'recovery_sla',
  'Liability cap': 'liability',
  'Cyber insurance required': 'cyber_insurance',
};

const cell = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

// ---------- reading structured values out of free text (only when unambiguous) ----------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const RANGE = new RegExp(`\\b(\\d{1,2}) ${MONTH}(?: (\\d{4}))? to (\\d{1,2}) ${MONTH} (\\d{4})\\b`, 'gi');
const END_ONLY = new RegExp(`^(?:to|until|through) (\\d{1,2}) ${MONTH} (\\d{4})\\b`, 'i');

function isoDate(day: string, month: string, year: string): string | null {
  const m = MONTHS[month.toLowerCase().slice(0, 3)];
  const d = Number(day);
  const y = Number(year);
  if (!m || !d || !y) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Start and end dates from text such as "1 March 2030 to 28 Feb 2031". Anything looser gives nothing. */
export function parseTermDates(termText: string | null): { start_date?: string; end_date?: string } {
  if (!termText) return {};
  const ranges = [...termText.matchAll(RANGE)];
  if (ranges.length === 1) {
    const m = ranges[0];
    const end = isoDate(m[4], m[5], m[6]);
    const start = isoDate(m[1], m[2], m[3] ?? m[6]);
    return start && end && start <= end ? { start_date: start, end_date: end } : {};
  }
  if (ranges.length === 0) {
    const m = END_ONLY.exec(termText.trim());
    const end = m ? isoDate(m[1], m[2], m[3]) : null;
    if (end) return { end_date: end };
  }
  return {};
}

export function parseNoticeDays(termText: string | null): number | undefined {
  if (!termText) return undefined;
  const found = [...termText.matchAll(/\b(\d{1,3}) days['’]? (?:written |prior )?notice\b/gi)];
  return found.length === 1 ? Number(found[0][1]) : undefined;
}

export function parseRenewal(termText: string | null, hasEndDate: boolean): string {
  const t = (termText ?? '').toLowerCase();
  if (/\bauto(matic(ally)?)?[- ]?renew|\bautomatic\b.*\brenewal|\brenews (yearly|annually|each year|every year)/.test(t)) return 'auto_renew';
  if (/\boption/.test(t)) return 'option';
  if (/\buntil (terminated|ended)|\bevergreen/.test(t)) return 'evergreen';
  return hasEndDate ? 'fixed' : 'unknown';
}

export function parseResolution(textValue: string | null): string | undefined {
  if (!textValue) return undefined;
  const found = new Set([...textValue.matchAll(/\bresolution (?:no\.? ?|number )?(\d{4}-\d{1,3})\b/gi)].map((m) => m[1]));
  return found.size === 1 ? [...found][0] : undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ways the given currency is written beside an amount: its ISO code and its symbols (for example "USD", "US$", "$"). */
export function currencyMarkers(code: string = CURRENCY): string[] {
  const out = new Set<string>([code.toUpperCase()]);
  for (const currencyDisplay of ['symbol', 'narrowSymbol'] as const) {
    try {
      const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay })
        .formatToParts(0).find((p) => p.type === 'currency')?.value;
      if (part) out.add(part.toUpperCase());
    } catch { /* an unknown code has no symbol; the code itself still works */ }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * A total only when the whole cell is one amount in the organization's currency (GRC_CURRENCY):
 * a bare number, or a number with that currency's code or symbol before or after it, such as
 * "$12,500.00", "12 500,00 EUR" or "£1,200". Thousands may be separated by commas, spaces,
 * apostrophes or full stops. Anything else, including another currency's symbol, gives nothing
 * and the text is kept as recorded.
 */
export function parseTotalValue(valueText: string | null, code: string = CURRENCY): number | undefined {
  let s = (valueText ?? '').trim().toUpperCase();
  if (!s) return undefined;
  const marker = currencyMarkers(code).map(escapeRe).join('|');
  const before = new RegExp(`^(?:${marker})\\s*`).exec(s);
  if (before) s = s.slice(before[0].length);
  else {
    const after = new RegExp(`\\s*(?:${marker})$`).exec(s);
    if (after) s = s.slice(0, s.length - after[0].length);
  }
  let m: RegExpExecArray | null;
  // 12,500.00 | 12 500.00 | 12'500.00 | 12500 | 12500.5
  if ((m = /^(\d{1,3}(?:[, \u00a0\u202f'’]\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s))) {
    return Number(`${m[1].replace(/\D/g, '')}.${m[2] ?? '0'}`);
  }
  // 12.500,00 | 12 500,00 | 12500,5 (decimal comma)
  if ((m = /^(\d{1,3}(?:[. \u00a0\u202f'’]\d{3})+|\d+),(\d{1,2})$/.exec(s)) || (m = /^(\d{1,3}(?:\.\d{3})+)()$/.exec(s))) {
    return Number(`${m[1].replace(/\D/g, '')}.${m[2] || '0'}`);
  }
  return undefined;
}

const nothingOnFile = (documentText: string | null) =>
  /^(no (contract|agreement|document)s? on file|nothing on file|none on file)\b/i.test((documentText ?? '').trim());

// ---------- vendor name matching ----------

const LEGAL_SUFFIX = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'lp', 'llp']);

/** Lower-case, no punctuation, no bracketed text, no trailing "Inc." and the like. */
export function normalizeVendorName(name: string): string {
  const tokens = name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIX.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

/** Other names a vendor entry goes by: whatever sits in brackets, split on commas. */
function vendorAliases(name: string): string[] {
  const out: string[] = [];
  for (const m of name.matchAll(/\(([^)]*)\)/g)) {
    for (const part of m[1].split(/,|;|\band\b/)) {
      const n = normalizeVendorName(part.replace(/\s+as\s+.*$/i, ''));
      if (n.length >= 3) out.push(n);
    }
  }
  return out;
}

const sameName = (a: string, b: string) => a !== '' && b !== '' && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `));

/** The vendor that a system's free-text vendor name points at, if any. */
export function matchVendor(systemVendorName: string, vendors: { id: string; name: string }[]): string | null {
  const primary = systemVendorName.split(/[;/]/)[0].replace(/\([^)]*\)/g, ' ').split(/\s+(?:through|via)\s+/i)[0];
  const wanted = normalizeVendorName(primary);
  if (wanted.length < 3) return null;
  const main = vendors.map((v) => ({ id: v.id, n: normalizeVendorName(v.name) }));
  const exact = main.find((v) => v.n === wanted);
  if (exact) return exact.id;
  const close = main.filter((v) => sameName(v.n, wanted));
  if (close.length === 1) return close[0].id;
  if (close.length > 1) return null;
  const alias = vendors.filter((v) => vendorAliases(v.name).some((a) => sameName(a, wanted)));
  return alias.length === 1 ? alias[0].id : null;
}

// ---------- upserts ----------

interface Stats {
  vendorsCreated: number; vendorsUpdated: number;
  contractsCreated: number; contractsUpdated: number;
  clauseChecks: number; actions: number; evidence: number; contacts: number; systemsLinked: number;
}
const newStats = (): Stats => ({
  vendorsCreated: 0, vendorsUpdated: 0, contractsCreated: 0, contractsUpdated: 0,
  clauseChecks: 0, actions: 0, evidence: 0, contacts: 0, systemsLinked: 0,
});

const differs = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

async function upsertVendor(ctx: ModuleContext, name: string, data: Row, stats: Stats): Promise<Row> {
  const existing = await ctx.db.one<Row>(
    'select * from vendors where lower(name) = lower($1) and deleted_at is null order by created_at limit 1', [name],
  );
  if (!existing) {
    stats.vendorsCreated += 1;
    return ctx.resources.create('vendor', { name, ...data });
  }
  const patch: Row = {};
  for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined && differs(existing[k], v)) patch[k] = v;
  if (!Object.keys(patch).length) return existing;
  stats.vendorsUpdated += 1;
  return ctx.resources.update('vendor', existing.id, patch);
}

/**
 * `refresh` fields always follow the source; `fill` fields are set on creation and afterwards
 * only where the record is still empty, so edits made in the application survive a re-import.
 */
async function upsertContract(
  ctx: ModuleContext, vendorId: string, importKey: string, refresh: Row, fill: Row, stats: Stats,
): Promise<Row> {
  const existing = await ctx.db.one<Row>(
    'select * from contracts where vendor_id = $1 and import_key = $2 and deleted_at is null order by created_at limit 1',
    [vendorId, importKey],
  );
  if (!existing) {
    stats.contractsCreated += 1;
    return ctx.resources.create('contract', { vendor_id: vendorId, import_key: importKey, ...fill, ...refresh });
  }
  const patch: Row = {};
  for (const [k, v] of Object.entries(refresh)) if (differs(existing[k], v)) patch[k] = v;
  for (const [k, v] of Object.entries(fill)) {
    const empty = existing[k] === null || existing[k] === undefined || (k === 'renewal_mechanism' && existing[k] === 'unknown');
    if (empty && v !== null && v !== undefined && differs(existing[k], v)) patch[k] = v;
  }
  if (!Object.keys(patch).length) return existing;
  stats.contractsUpdated += 1;
  return ctx.resources.update('contract', existing.id, patch);
}

/** Sets a clause check from source text, unless the same text is already recorded (a person may have re-graded it). */
async function seedClause(
  ctx: ModuleContext, contract: Row, key: string, clauseText: string | null, stats: Stats, status?: string | null,
) {
  if (!clauseText) return;
  const existing = await ctx.db.one<Row>(
    `select clause_text from clause_checks where set_key = 'security_terms' and scope_type = 'contract' and scope_id = $1 and sub_key = '' and clause_key = $2`, [contract.id, key],
  );
  if (existing && existing.clause_text === clauseText) return;
  const { changed } = await saveClauseCheck(ctx, null, contract, key, {
    status: status === undefined ? classifyClauseText(clauseText) : status, clause_text: clauseText,
  });
  if (changed) stats.clauseChecks += 1;
}

async function seedAction(ctx: ModuleContext, vendor: Row, actionText: string | null, stats: Stats) {
  const def = ctx.resources.get('action');
  if (!def || !actionText || /^(none|not applicable|n\/a)\.?$/i.test(actionText)) return;
  if (!def.fields.source_type || !def.fields.source_id) return;
  const title = `Contract follow-up: ${vendor.name}`.slice(0, 200);
  // Includes deleted rows on purpose: an action someone removed is not recreated.
  const existing = await ctx.db.one<Row>(
    `select id from ${def.table} where source_type = 'vendor' and source_id::text = $1 and title = $2 limit 1`,
    [vendor.id, title],
  );
  if (existing) return;
  const priority = vendor.criticality === 'critical' || vendor.criticality === 'high' ? 'high'
    : vendor.criticality === 'low' ? 'low' : 'medium';
  await ctx.resources.create('action', {
    title, description: actionText, status: 'open', priority,
    source: 'other', source_type: 'vendor', source_id: vendor.id,
  });
  stats.actions += 1;
}

/** Points systems at their vendor record where the system's vendor name matches. Never overwrites a link. */
async function linkSystems(ctx: ModuleContext, stats: Stats) {
  const def = ctx.resources.get('system');
  if (!def?.fields.vendor_id || !def.fields.vendor_name) return;
  const vendors = await ctx.db.query<{ id: string; name: string }>('select id, name from vendors where deleted_at is null order by created_at');
  const systems = await ctx.db.query<Row>(
    `select id, vendor_name from ${def.table} where deleted_at is null and vendor_id is null and vendor_name is not null`,
  );
  for (const s of systems) {
    const vendorId = matchVendor(String(s.vendor_name), vendors);
    if (!vendorId) continue;
    await ctx.resources.update('system', s.id, { vendor_id: vendorId });
    stats.systemsLinked += 1;
  }
}

// ---------- pilot: the contract register ----------

/** Returns null when the register file is not in the seed folder: nothing to load, not an error. */
async function seedPilot(ctx: ModuleContext, opts: SeedOptions, stats: Stats): Promise<number | null> {
  if (!existsSync(join(opts.seedDir, SEED_FILE))) return null;
  const rows = ctx.readSeed(opts, SEED_FILE, '|');
  const levels = new Set((await ctx.lookups.values('vendor_criticality')).map((v) => v.value));
  let loaded = 0;
  for (const r of rows) {
    const name = cell(r[H.vendor]);
    if (!name) continue;
    loaded += 1;

    const critText = cell(r[H.criticality]);
    const critWord = (critText ?? '').toLowerCase().split(/\s+/)[0];
    const criticality = levels.has(critWord) ? critWord : null;
    const vendorData: Row = { services: cell(r[H.service]), criticality };
    const before = await ctx.db.one<Row>('select notes from vendors where lower(name) = lower($1) and deleted_at is null', [name]);
    if (!before && critText && critText.toLowerCase() !== critWord) vendorData.notes = `Criticality as proposed in the contract register: ${critText}`;
    const vendor = await upsertVendor(ctx, name, vendorData, stats);

    const documentText = cell(r[H.document]);
    const termText = cell(r[H.term]);
    const none = nothingOnFile(documentText);
    const dates = parseTermDates(termText);
    const refresh: Row = {
      document_on_file: documentText,
      date_and_resolution: cell(r[H.dateResolution]),
      term_and_renewal: termText,
      value_text: cell(r[H.value]),
      hosting: cell(r[H.hosting]),
      terms_not_on_file: cell(r[H.notOnFile]),
    };
    const fill: Row = {
      title: `${name} agreement`.slice(0, 200),
      status: none ? 'not_on_file' : 'active',
      document_type: none ? 'none_on_file' : null,
      start_date: dates.start_date ?? null,
      end_date: dates.end_date ?? null,
      notice_days: parseNoticeDays(termText) ?? null,
      renewal_mechanism: parseRenewal(termText, !!dates.end_date),
      resolution_number: parseResolution(refresh.date_and_resolution) ?? null,
      total_value: parseTotalValue(refresh.value_text) ?? null,
    };
    const contract = await upsertContract(ctx, vendor.id, REGISTER_KEY, refresh, fill, stats);

    for (const [column, key] of Object.entries(CLAUSE_COLUMNS)) {
      await seedClause(ctx, contract, key, cell(r[column]), stats);
    }
    try {
      await seedAction(ctx, vendor, cell(r[H.action]), stats);
    } catch (err) {
      console.warn(`[vendors] could not create the follow-up action for one vendor: ${(err as Error).message}`);
    }
  }
  return loaded;
}

// ---------- dev: invented sample data ----------

interface DevVendor {
  name: string; services: string; criticality: string; remote: string | null;
  contact: { name: string; role: string; email: string; phone: string };
  contract: {
    title: string; type: string; renewal: string; startOffset: number; endOffset: number; noticeDays: number | null;
    term: string; total: number | null; resolution: string | null; hosting: string;
  };
  clauses: Record<string, [status: string | null, text: string]>;
  evidence: { title: string; type: string; receivedOffset: number; expiresOffset: number | null }[];
}

const DEV_VENDORS: DevVendor[] = [
  {
    name: 'Northbank Software', services: 'Finance and payroll system, hosted by the vendor', criticality: 'critical',
    remote: 'Vendor support portal with named accounts',
    contact: { name: 'Priya Raman', role: 'Customer success manager', email: 'priya.raman@northbank.example', phone: '555-0101' },
    contract: { title: 'Northbank subscription agreement', type: 'master_agreement', renewal: 'auto_renew', startOffset: -700, endOffset: 80, noticeDays: 60, term: '3 years, then yearly', total: 420000, resolution: '2099-01', hosting: 'Vendor cloud, United States' },
    clauses: {
      independent_assurance: ['present', 'Annual independent assurance report supplied on request.'],
      mfa: ['present', 'Multi-factor sign-in required for all administrative access.'],
      breach_notice: ['partial', 'Notice "without undue delay"; no fixed number of hours.'],
      data_ownership: ['present', 'Customer owns its data; returned within 30 days of exit.'],
      recovery_sla: ['present', 'Recovery time 8 hours, recovery point 1 hour, 99.9 percent uptime.'],
      cyber_insurance: ['present', 'Cyber liability cover of 5,000,000.'],
      liability: ['absent', 'Cap of 12 months\' fees with no carve-out for data breach.'],
      subcontractors: ['partial', 'Subcontractors listed on a web page; no flow-down wording.'],
      security_standard: ['present', 'ISO/IEC 27001 certification maintained.'],
    },
    evidence: [
      { title: 'Assurance report (sample year)', type: 'assurance_report', receivedOffset: -340, expiresOffset: 25 },
      { title: 'Certificate of insurance', type: 'insurance_certificate', receivedOffset: -100, expiresOffset: 265 },
    ],
  },
  {
    name: 'Harbour Signal Systems', services: 'Operations and scheduling software', criticality: 'critical',
    remote: 'Standing site-to-site VPN',
    contact: { name: 'Tomasz Zielinski', role: 'Support lead', email: 'support@harboursignal.example', phone: '555-0102' },
    contract: { title: 'Harbour Signal support and license agreement', type: 'agreement', renewal: 'option', startOffset: -400, endOffset: 110, noticeDays: 90, term: '2 years with three one-year options', total: 1250000, resolution: '2099-02', hosting: 'Vendor cloud' },
    clauses: {
      breach_notice: ['present', 'Within 24 hours of discovery.'],
      data_ownership: ['partial', 'Customer owns its data; return on exit not covered.'],
      recovery_sla: ['partial', 'Response times stated; no recovery times.'],
      cyber_insurance: ['absent', 'Not stated.'],
      liability: ['absent', 'Fees paid; loss of data excluded.'],
      security_standard: ['absent', 'None; "appropriate measures" only.'],
    },
    evidence: [
      { title: 'Security questionnaire', type: 'questionnaire', receivedOffset: -380, expiresOffset: -15 },
    ],
  },
  {
    name: 'Castle Peak Telecom', services: 'Cloud telephone service', criticality: 'high', remote: null,
    contact: { name: 'Dana Whitlock', role: 'Account manager', email: 'dana.whitlock@castlepeak.example', phone: '555-0103' },
    contract: { title: 'Castle Peak telephone service order', type: 'order_form', renewal: 'fixed', startOffset: -345, endOffset: 20, noticeDays: 30, term: '1 year', total: 38400, resolution: null, hosting: 'Vendor cloud' },
    clauses: {
      breach_notice: ['absent', 'None.'],
      data_ownership: ['absent', 'Not stated.'],
      recovery_sla: ['present', '99.99 percent uptime with service credits.'],
      security_standard: ['partial', 'Refers to "industry standards" only.'],
    },
    evidence: [
      { title: 'Certificate of insurance', type: 'insurance_certificate', receivedOffset: -300, expiresOffset: 65 },
    ],
  },
  {
    name: 'Linden Payment Services', services: 'Fare collection, smart cards and card acceptance', criticality: 'critical', remote: null,
    contact: { name: 'Marcus Oyelaran', role: 'Security officer', email: 'security@lindenpay.example', phone: '555-0104' },
    contract: { title: 'Linden payment services agreement', type: 'agreement', renewal: 'auto_renew', startOffset: -900, endOffset: 195, noticeDays: 120, term: '3 years, renews yearly', total: null, resolution: '2099-03', hosting: 'Vendor cloud' },
    clauses: {
      independent_assurance: ['present', 'Card-data attestation of compliance supplied each year.'],
      breach_notice: ['present', 'Within 48 hours.'],
      data_ownership: ['present', 'Customer data returned or destroyed at termination.'],
      cyber_insurance: ['partial', 'Yes, but limits to be agreed.'],
      liability: ['partial', 'Cap of 24 months\' fees; breach costs partly carved out.'],
    },
    evidence: [
      { title: 'Card-data attestation of compliance', type: 'card_data_attestation', receivedOffset: -320, expiresOffset: 45 },
      { title: 'Assurance report (sample year)', type: 'assurance_report', receivedOffset: -60, expiresOffset: 305 },
    ],
  },
  {
    name: 'Quillfeather Mapping', services: 'Route planning and vehicle location software', criticality: 'low', remote: null,
    contact: { name: 'Elin Sorensen', role: 'Account manager', email: 'elin@quillfeather.example', phone: '555-0105' },
    contract: { title: 'Quillfeather planning subscription', type: 'renewal', renewal: 'fixed', startOffset: -200, endOffset: 165, noticeDays: null, term: '1 year', total: 18250, resolution: null, hosting: 'Vendor cloud' },
    clauses: {
      data_ownership: ['present', 'Customer owns its data.'],
    },
    evidence: [],
  },
  {
    name: 'Redbrick Managed IT', services: 'Managed firewalls, patching, monitoring and backups', criticality: 'critical',
    remote: 'Remote management tool with privileged access',
    contact: { name: 'Sam Achterberg', role: 'Service desk manager', email: 'servicedesk@redbrick.example', phone: '555-0106' },
    contract: { title: 'Redbrick managed services agreement', type: 'none_on_file', renewal: 'unknown', startOffset: -1100, endOffset: 40, noticeDays: 90, term: 'Year to year', total: null, resolution: null, hosting: 'Vendor datacenter' },
    clauses: {},
    evidence: [
      { title: 'Certificate of insurance', type: 'insurance_certificate', receivedOffset: -400, expiresOffset: -35 },
    ],
  },
];

async function seedDev(ctx: ModuleContext, stats: Stats): Promise<number> {
  const today = localDate();
  for (const v of DEV_VENDORS) {
    const vendor = await upsertVendor(ctx, v.name, {
      services: v.services, criticality: v.criticality, remote_access_method: v.remote,
      incident_contact_name: v.contact.name, incident_contact_email: v.contact.email, incident_contact_phone: v.contact.phone,
    }, stats);

    const hasContact = await ctx.db.one('select 1 from vendor_contacts where vendor_id = $1 and lower(name) = lower($2)', [vendor.id, v.contact.name]);
    if (!hasContact) {
      const row = await ctx.db.one<Row>(
        `insert into vendor_contacts (vendor_id, name, role, email, phone, is_incident_contact) values ($1,$2,$3,$4,$5,true) returning id`,
        [vendor.id, v.contact.name, v.contact.role, v.contact.email, v.contact.phone],
      );
      await ctx.audit(null, {
        action: 'vendor.contact_add', recordType: 'vendor', recordId: vendor.id,
        summary: `Contact added to ${vendor.name}: ${v.contact.name}`, after: { id: row!.id, name: v.contact.name },
      });
      stats.contacts += 1;
    }

    const c = v.contract;
    const none = c.type === 'none_on_file';
    const contract = await upsertContract(ctx, vendor.id, 'dev-sample', { hosting: c.hosting }, {
      title: c.title, document_type: c.type, status: none ? 'not_on_file' : 'active', renewal_mechanism: c.renewal,
      parties: `Sample Organization; ${v.name}`, term: c.term,
      start_date: addDays(today, c.startOffset), end_date: addDays(today, c.endOffset),
      notice_days: c.noticeDays, total_value: c.total, resolution_number: c.resolution,
    }, stats);
    for (const [key, [status, clauseText]] of Object.entries(v.clauses)) {
      await seedClause(ctx, contract, key, clauseText, stats, status);
    }
    for (const e of v.evidence) {
      const have = await ctx.db.one('select 1 from evidence_items where vendor_id = $1 and title = $2', [vendor.id, e.title]);
      if (have) continue;
      await ctx.resources.create('evidence_item', {
        vendor_id: vendor.id, contract_id: contract.id, title: e.title, type: e.type,
        received_on: addDays(today, e.receivedOffset),
        expires_on: e.expiresOffset === null ? null : addDays(today, e.expiresOffset),
      });
      stats.evidence += 1;
    }
  }
  return DEV_VENDORS.length;
}

export async function seedVendors(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const stats = newStats();
  const loaded = opts.profile === 'pilot' ? await seedPilot(ctx, opts, stats) : await seedDev(ctx, stats);
  await linkSystems(ctx, stats);
  const total = (await ctx.db.one<{ c: number }>('select count(*)::int c from vendors where deleted_at is null'))!.c;
  const parts = [
    loaded === null ? `no ${SEED_FILE} in the seed folder, contract register skipped` : `${loaded} register rows`,
    `vendors ${stats.vendorsCreated} new, ${stats.vendorsUpdated} updated (${total} in total)`,
    `contracts ${stats.contractsCreated} new, ${stats.contractsUpdated} updated`,
    `${stats.clauseChecks} clause checks set`,
  ];
  if (stats.evidence) parts.push(`${stats.evidence} evidence items`);
  if (stats.contacts) parts.push(`${stats.contacts} contacts`);
  if (stats.actions) parts.push(`${stats.actions} actions`);
  if (stats.systemsLinked) parts.push(`${stats.systemsLinked} systems linked`);
  if (opts.profile === 'dev') parts.push(...await seedLifecycle(ctx), ...await seedIntake(ctx));
  return parts.join('; ');
}
