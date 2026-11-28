// Dev profile only, all invented: a small insurance program. Policies (one cyber policy whose security
// conditions are tracked by sample controls, one expiring soon, one renewed), contract requirements and
// certificates from the first sample vendors (one short of its contract, one expired), three claims (one
// restricted) with their payments and recoveries one by one, a schedule of values and premium shares,
// and two certificate requests (one answered, its certificate waiting for review). Modules seed in name
// order: controls and fleet exist by now, vendors and safety events do not on a first run, so a second
// run adds the certificates, requirements and requests.
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { CERTIFICATE, REQUIREMENT } from './certificates.ts';
import { CLAIM } from './claims.ts';
import { SHARE } from './allocation.ts';
import { PAYMENT } from './payments.ts';
import { CONDITION, POLICY } from './policies.ts';
import { CERT_REQUEST } from './requests.ts';
import { SCHEDULE_ITEM } from './schedule.ts';

export const INSURANCE_SAMPLE_NOTE = 'Invented sample insurance record.';

const POLICIES: Row[] = [
  { key: 'cyber', title: '[Sample] Cyber liability', line: 'cyber', insurer_name: 'Example Mutual Insurance Company', policy_number: 'CY-0000-1001',
    from: -300, to: 64, due: 20, premium: 48000, occ: 2000000, agg: 2000000, deductible: 25000, renewal: 'gathering',
    sublimits: 'Ransom and extortion: 500,000\nBusiness interruption: 750,000\nRegulatory defense: 250,000',
    conditions: [
      ['Second factor on all remote access', 'Remote-access sign-in needs a second factor', 'met'],
      ['Tested offline backups of critical systems', 'Backup restore test', 'partly'],
      ['Endpoint detection on every staff computer', null, 'not_assessed'],
    ] },
  { key: 'property', title: '[Sample] Property and equipment', line: 'property', insurer_name: 'Example Public Entity Risk Pool', kind: 'risk_pool',
    policy_number: 'PR-0000-2002', from: -120, to: 245, premium: 132000, occ: 50000000, agg: 50000000, deductible: 10000,
    sublimits: 'Flood: 5,000,000\nEarthquake: 2,500,000\nElectronic data processing equipment: 1,000,000', covered: ['site'] },
  { key: 'auto', title: '[Sample] Auto liability and physical damage', line: 'auto_liability', insurer_name: 'Example Public Entity Risk Pool', kind: 'risk_pool',
    policy_number: 'AU-0000-3003', from: -350, to: 15, due: -5, premium: 410000, occ: 5000000, agg: 10000000, deductible: 50000, renewal: 'submitted', covered: ['vehicle'] },
  { key: 'gl_old', title: '[Sample] General liability (previous term)', line: 'general_liability', insurer_name: 'Example Casualty Insurance Company',
    policy_number: 'GL-0000-4003', from: -540, to: -175, premium: 61000, occ: 1000000, agg: 3000000, deductible: 5000, status: 'replaced', renewal: 'bound' },
  { key: 'gl', title: '[Sample] General liability', line: 'general_liability', insurer_name: 'Example Casualty Insurance Company', replaces: 'gl_old',
    policy_number: 'GL-0000-4004', from: -174, to: 190, premium: 64500, occ: 1000000, agg: 3000000, deductible: 5000 },
];

const CLAIMS: Row[] = [
  { title: '[Sample] Bus side-swiped a parked car', claim_kind: 'vehicle', policy: 'auto', status: 'open', incident: -40, reserve: 18000, claimant: 'A member of the public',
    payments: [['repair', 'Example Auto Body Repairs', -20, 2500, 'CHK-0000-101']] },
  { title: '[Sample] Passenger fall while boarding', claim_kind: 'bodily_injury', policy: 'auto', status: 'investigating', incident: -75, reserve: 60000, claimant: 'A passenger',
    payments: [['medical', 'Example Community Clinic', -60, 1200, 'TRF-0000-202']] },
  { title: '[Sample] Storm damage to a depot roof', claim_kind: 'property_damage', policy: 'property', status: 'closed', incident: -200, closed: -60, reserve: 0, direction: 'first_party', claimant: 'The organization',
    payments: [
      ['repair', 'Example Roofing Contractors', -150, 30000, 'CHK-0000-303'], ['expense', 'Example Adjusting Services', -140, 2000, 'CHK-0000-304'],
      ['repair', 'Example Roofing Contractors', -100, 10000, 'CHK-0000-305'], ['insurer_recovery', 'Example Public Entity Risk Pool', -70, 32000, 'REM-0000-306'],
    ] },
];

async function one(ctx: ModuleContext, sql: string, params: unknown[] = []) {
  return ctx.db.one<Row>(sql, params);
}

export async function seedInsurance(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample insurance records are dev profile only)';
  const owner = (await one(ctx, `select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  const ids: Record<string, string> = {};
  let made = 0;
  for (const p of POLICIES) {
    let row = await one(ctx, 'select id from insurance_policies where title = $1 and deleted_at is null', [p.title]);
    if (!row) {
      row = await ctx.resources.create(POLICY, {
        title: p.title, line: p.line, insurer_kind: p.kind ?? 'insurer', insurer_name: p.insurer_name, broker_name: 'Example Brokerage Services',
        policy_number: p.policy_number, effective_on: dayInZone(p.from), expires_on: dayInZone(p.to), premium: p.premium,
        limit_per_occurrence: p.occ, limit_aggregate: p.agg, deductible: p.deductible, sublimits: p.sublimits ?? null,
        named_insureds: 'The organization and its board members, officers and employees acting for it.',
        status: p.status ?? 'active', renewal_status: p.renewal ?? 'not_started', renewal_application_due: p.due === undefined ? null : dayInZone(p.due),
        replaces_id: p.replaces ? ids[p.replaces] ?? null : null, owner_id: owner, notes: INSURANCE_SAMPLE_NOTE,
      });
      made++;
      for (const [title, control, status] of (p.conditions ?? []) as [string, string | null, string][]) {
        const c = control && ctx.resources.get('control') ? await one(ctx, 'select id from controls where title = $1 and deleted_at is null limit 1', [control]) : undefined;
        await ctx.resources.create(CONDITION, { policy_id: row.id, title, control_id: c?.id ?? null, status, due_on: dayInZone(p.to - 30), owner_id: owner });
      }
      // A few covered records of the sample estate.
      for (const type of (p.covered ?? []) as string[]) {
        const def = ctx.resources.get(type);
        if (!def) continue;
        const recs = await ctx.db.query<Row>(`select id from ${def.table} where deleted_at is null order by created_at limit 3`);
        for (const r of recs) {
          await ctx.db.query('insert into insurance_covered (policy_id, record_type, record_id, created_by) values ($1,$2,$3,$4) on conflict do nothing', [row.id, type, r.id, owner]);
        }
      }
    }
    ids[p.key] = row.id;
  }

  let claims = 0;
  for (const c of CLAIMS) {
    if (await one(ctx, 'select 1 from insurance_claims where title = $1 and deleted_at is null', [c.title])) continue;
    const claim = await ctx.resources.create(CLAIM, {
      title: c.title, claim_kind: c.claim_kind, policy_id: ids[c.policy] ?? null, status: c.status, direction: c.direction ?? 'against',
      incident_on: dayInZone(c.incident), reported_on: dayInZone(c.incident + 2), closed_on: c.closed === undefined ? null : dayInZone(c.closed),
      claimant_name: c.claimant, reserve: c.reserve, owner_id: owner, notes: INSURANCE_SAMPLE_NOTE,
    });
    // Each payment and recovery one by one; the claim's totals are worked out from them.
    for (const [kind, payee, on, amount, reference] of (c.payments ?? []) as [string, string, number, number, string][]) {
      await ctx.resources.create(PAYMENT, { claim_id: claim.id, kind, payee, paid_on: dayInZone(on), amount, reference });
    }
    claims++;
  }

  // The property schedule of values: the sample sites on the property policy, valued; and the premium
  // split by insured value. The auto policy's premium is split by the number of vehicles per site.
  let scheduled = 0;
  if (ids.property && ctx.resources.get('site') && !(await one(ctx, 'select 1 from insurance_schedule_items where policy_id = $1 and deleted_at is null', [ids.property]))) {
    const sites = await ctx.db.query<Row>('select id, name from sites where deleted_at is null order by created_at limit 3');
    const values = [[8_500_000, 1_200_000, 2_400_000, 600_000, 'Masonry, steel roof', 1998], [4_200_000, 650_000, 900_000, 250_000, 'Steel frame, metal roof', 2009], [1_800_000, 300_000, 150_000, 0, 'Wood frame', 1985]];
    for (const [i, s] of sites.entries()) {
      const [building, contents, equipment, income, construction, year] = values[i];
      await ctx.resources.create(SCHEDULE_ITEM, {
        title: String(s.name), policy_id: ids.property, site_id: s.id, occupancy: i === 0 ? 'Vehicle maintenance and storage' : i === 1 ? 'Offices' : 'Passenger shelter and ticket office',
        construction, year_built: year, building_value: building, contents_value: contents, equipment_value: equipment, income_value: income,
        valuation_basis: 'replacement_cost', valued_on: dayInZone(i === 2 ? -1500 : -200), notes: INSURANCE_SAMPLE_NOTE,
      });
      await ctx.resources.create(SHARE, { title: '', policy_id: ids.property, site_id: s.id });
      scheduled++;
    }
    await ctx.resources.update(POLICY, ids.property, { allocation_method: 'insured_value' });
  }
  if (ids.auto && ctx.resources.get('site') && !(await one(ctx, 'select 1 from insurance_premium_shares where policy_id = $1 and deleted_at is null', [ids.auto]))) {
    const sites = await ctx.db.query<Row>('select id from sites where deleted_at is null order by created_at limit 2');
    for (const [i, s] of sites.entries()) await ctx.resources.create(SHARE, { title: '', policy_id: ids.auto, site_id: s.id, measure: i === 0 ? 42 : 18 });
    if (sites.length) await ctx.resources.update(POLICY, ids.auto, { allocation_method: 'measure', allocation_measure: 'Vehicles' });
  }

  // Contract requirements and certificates, once the sample vendors and contracts exist.
  let certs = 0;
  if (ctx.resources.get('contract') && ctx.resources.get('vendor')) {
    const contracts = await ctx.db.query<Row>(`select id, vendor_id from contracts where deleted_at is null and vendor_id is not null order by created_at limit 2`);
    const samples: Row[] = [
      { line: 'general_liability', minOcc: 1000000, minAgg: 2000000, occ: 1000000, agg: 2000000, expires: 140, additional: true },
      { line: 'general_liability', minOcc: 2000000, minAgg: 4000000, occ: 1000000, agg: 2000000, expires: 25, additional: false },
    ];
    for (const [i, k] of contracts.entries()) {
      const s = samples[i];
      if (await one(ctx, 'select 1 from insurance_requirements where contract_id = $1 and deleted_at is null', [k.id])) continue;
      await ctx.resources.create(REQUIREMENT, { title: '', contract_id: k.id, line: s.line, min_per_occurrence: s.minOcc, min_aggregate: s.minAgg, additional_insured: true });
      await ctx.resources.create(CERTIFICATE, {
        title: '', vendor_id: k.vendor_id, contract_id: k.id, line: s.line, insurer_name: 'Example Specialty Insurance Company', policy_number: `SC-0000-${500 + i}`,
        effective_on: dayInZone(s.expires - 365), expires_on: dayInZone(s.expires), limit_per_occurrence: s.occ, limit_aggregate: s.agg,
        additional_insured: s.additional, status: 'received', received_on: dayInZone(s.expires - 360), owner_id: owner, notes: INSURANCE_SAMPLE_NOTE,
      });
      // An older certificate that has lapsed, for the expired figures.
      await ctx.resources.create(CERTIFICATE, {
        title: '', vendor_id: k.vendor_id, contract_id: k.id, line: 'auto_liability', insurer_name: 'Example Specialty Insurance Company', policy_number: `SA-0000-${600 + i}`,
        effective_on: dayInZone(-400), expires_on: dayInZone(-35), limit_per_occurrence: 1000000, limit_aggregate: 1000000,
        status: 'accepted', received_on: dayInZone(-395), owner_id: owner, notes: INSURANCE_SAMPLE_NOTE,
      });
      certs += 2;
    }
  }
  // Requests to vendors for certificates: one the vendor answered (its certificate waits for review)
  // and one not sent yet. Nothing is emailed by the sample data.
  let requests = 0;
  if (ctx.resources.get('contract') && ctx.resources.get('vendor') && !(await one(ctx, 'select 1 from insurance_certificate_requests where deleted_at is null'))) {
    const contracts = await ctx.db.query<Row>(`select id, vendor_id from contracts where deleted_at is null and vendor_id is not null order by created_at limit 2`);
    for (const [i, k] of contracts.entries()) {
      const answered = i === 0;
      const r = await ctx.resources.create(CERT_REQUEST, {
        title: '', contract_id: k.id, vendor_id: k.vendor_id, lines: ['general_liability', 'auto_liability'], email: `insurance${i + 1}@vendor.example`,
        recipient_name: 'Insurance desk', needed_by: dayInZone(answered ? -10 : 14), status: answered ? 'received' : 'draft', owner_id: owner, notes: INSURANCE_SAMPLE_NOTE,
      });
      if (answered) {
        await ctx.resources.create(CERTIFICATE, {
          title: '', vendor_id: k.vendor_id, contract_id: k.id, line: 'auto_liability', insurer_name: 'Example Specialty Insurance Company', policy_number: 'SA-0000-700',
          effective_on: dayInZone(-30), expires_on: dayInZone(335), limit_per_occurrence: 1000000, limit_aggregate: 2000000, additional_insured: true,
          status: 'to_review', received_on: dayInZone(-12), owner_id: owner, request_id: r.id,
          notes: `${INSURANCE_SAMPLE_NOTE} Sent by the vendor through ${r.ref}: check the details against the file, then set it to Accepted or Rejected.`,
        });
        await ctx.db.query(`update insurance_certificate_requests set sent_at = now() - interval '20 days', opened_at = now() - interval '15 days', submitted_at = now() - interval '12 days', responder_name = 'Invented insurance desk', certificates = 1 where id = $1`, [r.id]);
      }
      requests++;
    }
  }
  return `insurance policies ${made}, claims ${claims}, certificates ${certs}, scheduled properties ${scheduled}, certificate requests ${requests}`;
}
